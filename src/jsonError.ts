// Find where and why a JSON string fails to parse.
//
// JSON.parse error messages differ by engine (Safari's has no position at
// all), so after a failed parse we re-scan the text with a small validator
// that reports the same thing everywhere: a message, a line and a column.

export interface JsonError {
  message: string;
  offset: number;
  line: number; // 1-based
  column: number; // 1-based
}

class Fail {
  constructor(
    readonly message: string,
    readonly offset: number,
  ) {}
}

export function locateJsonError(text: string): JsonError | null {
  let i = 0;
  let lastComma = 0; // where the most recent ',' was, to point at trailing commas

  const fail = (message: string, at = i): never => {
    throw new Fail(message, at);
  };
  const describe = (at: number) =>
    at >= text.length ? "end of input" : `'${text[at]}'`;
  const unexpected = (at = i): never => fail(`Unexpected ${describe(at)}`, at);

  const ws = () => {
    while (i < text.length) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i++;
      else break;
    }
  };

  const value = (): void => {
    ws();
    const c = text[i];
    if (c === "{") return object();
    if (c === "[") return array();
    if (c === '"') return string();
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) return number();
    for (const word of ["true", "false", "null"]) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return;
      }
    }
    if (c === "'") fail("Strings must use double quotes");
    if (c === "}" || c === "]") fail(`Unexpected '${c}' — expected a value`);
    if (c !== undefined && /[A-Za-z_]/.test(c)) {
      const word = /^[A-Za-z_]\w*/.exec(text.slice(i, i + 32))![0];
      fail(`Unexpected word '${word}' — strings need double quotes`);
    }
    unexpected();
  };

  const object = () => {
    i++; // {
    ws();
    if (text[i] === "}") return void i++;
    for (;;) {
      ws();
      if (text[i] === "}") fail("Trailing comma before '}'", lastComma);
      if (text[i] === "'") fail("Property names must use double quotes");
      if (text[i] !== '"') {
        if (i >= text.length) fail("Unexpected end of input — missing '}'");
        fail("Expected a property name in double quotes");
      }
      string();
      ws();
      if (text[i] !== ":") fail(`Expected ':' after property name, found ${describe(i)}`);
      i++;
      value();
      ws();
      if (text[i] === ",") {
        lastComma = i++;
        continue;
      }
      if (text[i] === "}") return void i++;
      if (i >= text.length) fail("Unexpected end of input — missing '}'");
      fail(`Expected ',' or '}' after property value, found ${describe(i)}`);
    }
  };

  const array = () => {
    i++; // [
    ws();
    if (text[i] === "]") return void i++;
    for (;;) {
      ws();
      if (text[i] === "]") fail("Trailing comma before ']'", lastComma);
      value();
      ws();
      if (text[i] === ",") {
        lastComma = i++;
        continue;
      }
      if (text[i] === "]") return void i++;
      if (i >= text.length) fail("Unexpected end of input — missing ']'");
      fail(`Expected ',' or ']' after array element, found ${describe(i)}`);
    }
  };

  const string = () => {
    const start = i++;
    for (;;) {
      if (i >= text.length) fail("Unterminated string", start);
      const c = text.charCodeAt(i);
      if (c === 0x22) return void i++; // "
      if (c < 0x20) fail(c === 0x0a ? "Unterminated string (line break inside quotes)" : "Control character in string");
      if (c === 0x5c) {
        // backslash
        const e = text[i + 1];
        if (e === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail("Invalid \\u escape");
          i += 6;
        } else if (e !== undefined && '"\\/bfnrt'.includes(e)) {
          i += 2;
        } else {
          fail(`Invalid escape '\\${e ?? ""}'`);
        }
      } else i++;
    }
  };

  const number = () => {
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
    if (!m) fail("Invalid number");
    i += m![0].length;
    const next = text[i];
    if (next !== undefined && /[0-9.eExX]/.test(next)) fail("Invalid number");
  };

  try {
    ws();
    if (i >= text.length) fail("Empty input");
    value();
    ws();
    if (i < text.length) fail(`Unexpected ${describe(i)} after the end of the JSON value`);
    return null;
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    return { message: e.message, offset: e.offset, ...position(text, e.offset) };
  }
}

function position(text: string, offset: number) {
  let line = 1;
  let lineStart = 0;
  for (let j = 0; j < offset && j < text.length; j++) {
    if (text[j] === "\n") {
      line++;
      lineStart = j + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}
