import { describe, expect, test } from "bun:test";
import { singular, toTypeScript } from "../src/infer";

const ts = (value: unknown) => toTypeScript(value).trim();

describe("inference", () => {
  test("nested objects become named interfaces, parents first", () => {
    expect(ts({ id: 1, user: { name: "Ada", address: { city: "Oslo" } } })).toBe(
      `export interface Root {
  id: number;
  user: User;
}

export interface User {
  name: string;
  address: Address;
}

export interface Address {
  city: string;
}`,
    );
  });

  test("null alongside a value is T | null; null alone stays null", () => {
    expect(ts([{ nick: "a", gone: null }, { nick: null, gone: null }])).toBe(
      `export type Root = RootItem[];

export interface RootItem {
  nick: string | null;
  gone: null;
}`,
    );
  });

  test("a key missing from some array items becomes optional", () => {
    expect(ts({ users: [{ id: 1, email: "a@b.c" }, { id: 2 }, { id: 3, admin: true }] })).toBe(
      `export interface Root {
  users: User[];
}

export interface User {
  id: number;
  email?: string;
  admin?: boolean;
}`,
    );
  });

  test("optional detection reaches objects nested inside array items", () => {
    const out = ts({ rows: [{ meta: { a: 1 } }, { meta: { a: 2, b: "x" } }] });
    expect(out).toContain("export interface Meta {\n  a: number;\n  b?: string;\n}");
  });

  test("empty array is unknown[]; an empty array next to a full one takes its type", () => {
    expect(ts({ tags: [], groups: [[], ["x"]] })).toBe(
      `export interface Root {
  tags: unknown[];
  groups: string[][];
}`,
    );
  });

  test("mixed primitive arrays become a parenthesised union", () => {
    expect(ts({ ab: ["v2", 7, true, 8, "v3"] })).toContain("ab: (string | number | boolean)[];");
    expect(ts([1, null, 2])).toBe("export type Root = (number | null)[];");
  });

  test("objects and primitives mixed in one array", () => {
    expect(ts({ items: [{ id: 1 }, "legacy", null] })).toContain("items: (string | Item | null)[];");
  });

  test("keys that aren't identifiers are quoted", () => {
    expect(ts({ "postal-code": "x", "2fa": true, $ok: 1 })).toBe(
      `export interface Root {
  "postal-code": string;
  "2fa": boolean;
  $ok: number;
}`,
    );
  });

  test("identical shapes share one interface; clashing names get a suffix", () => {
    const out = ts({ from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 }, a: { user: { x: 1 } }, b: { user: { y: "" } } });
    expect(out).toContain("from: From;\n  to: From;");
    expect(out).toContain("export interface User {\n  x: number;\n}");
    expect(out).toContain("export interface User2 {\n  y: string;\n}");
  });

  test("primitives, {} and [] at the root", () => {
    expect(ts("hi")).toBe("export type Root = string;");
    expect(ts({})).toBe("export type Root = Record<string, unknown>;");
    expect(ts([])).toBe("export type Root = unknown[];");
  });

  test("array property names are singularised for their element interface", () => {
    expect(["users", "categories", "addresses", "statuses", "data", "status"].map(singular)).toEqual([
      "user",
      "category",
      "address",
      "status",
      "dataItem",
      "statusItem",
    ]);
  });

  test("a large payload infers in well under a frame", () => {
    const big = Array.from({ length: 20_000 }, (_, i) => ({
      id: i,
      name: `user${i}`,
      tags: ["a", "b"],
      profile: i % 3 ? { bio: "x", links: [{ url: "u" }] } : null,
      ...(i % 7 ? {} : { flagged: true }),
    }));
    const t0 = performance.now();
    const out = ts(big);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(out).toContain("profile: Profile | null;");
    expect(out).toContain("flagged?: boolean;");
  });
});
