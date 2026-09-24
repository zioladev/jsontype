import { expect, test } from "bun:test";
import { locateJsonError } from "../src/jsonError";

const at = (text: string) => {
  const e = locateJsonError(text);
  return e && `${e.line}:${e.column} ${e.message}`;
};

test("valid JSON has no error", () => {
  expect(locateJsonError('{"a": [1, 2.5e3, "x\\n", true, null]}')).toBeNull();
});

test("points at the line and column of common mistakes", () => {
  expect(at('{\n  "a": 1,\n}')).toBe("2:9 Trailing comma before '}'");
  expect(at("{'a': 1}")).toBe("1:2 Property names must use double quotes");
  expect(at('{"a": 1 "b": 2}')).toBe("1:9 Expected ',' or '}' after property value, found '\"'");
  expect(at('{"a": undefined}')).toBe("1:7 Unexpected word 'undefined' — strings need double quotes");
  expect(at('[1, 2')).toBe("1:6 Unexpected end of input — missing ']'");
  expect(at('{"a": "open}')).toBe("1:7 Unterminated string");
  expect(at("[01]")).toBe("1:3 Invalid number");
  expect(at("{} x")).toBe("1:4 Unexpected 'x' after the end of the JSON value");
});

test("agrees with JSON.parse on what is valid", () => {
  for (const text of ['"\\u12"', "[1,]", "tru", '"\t"', "-", "1.", "{} {}", " [ ] ", '"\\/"', "-0.5E+2"]) {
    let ok = true;
    try {
      JSON.parse(text);
    } catch {
      ok = false;
    }
    expect({ text, valid: locateJsonError(text) === null }).toEqual({ text, valid: ok });
  }
});
