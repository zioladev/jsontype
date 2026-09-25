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

  test("objects keyed by paths or ids become Record<string, T>", () => {
    const lock = {
      name: "site",
      packages: {
        "": { name: "site", dependencies: { "@astrojs/vercel": "^8.0.0", astro: "^5.1.0" } },
        "node_modules/astro": { version: "5.1.0", dependencies: { "@astrojs/compiler": "^2.10.0", "@babel/types": "^7.26.0" } },
        "node_modules/vite": { version: "6.0.0", optional: true },
      },
    };
    expect(ts(lock)).toBe(
      `export interface Root {
  name: string;
  packages: Record<string, Package>;
}

export interface Package {
  name?: string;
  dependencies?: Record<string, string>;
  version?: string;
  optional?: boolean;
}`,
    );
    expect(ts({ "1001": { n: 1 }, "1002": { n: 2 }, "1003": { n: 3 } })).toBe(
      `export type Root = Record<string, RootItem>;

export interface RootItem {
  n: number;
}`,
    );
    expect(ts({ headers: { "Content-Type": "a", "X-Request-Id": "b", Accept: "c" } })).toContain(
      "headers: Record<string, string>;",
    );
    expect(ts({ scores: { "2024-01": 1, "2024-02": null, "2024-03": 3 } })).toContain(
      "scores: Record<string, number | null>;",
    );
  });

  test("many same-shaped values or scattered keys become Record<string, T>", () => {
    const people = Object.fromEntries("ada bo cy di ed fay gus hal".split(" ").map((k, i) => [k, { age: i }]));
    expect(ts({ people })).toContain("people: Record<string, PeopleItem>;");
    const words = "alpha beta gamma delta epsilon zeta eta theta".split(" ");
    const rows = words.map((w, i) => ({ labels: { [w]: "x", [words[(i + 1) % 8]!]: "y" } }));
    expect(ts(rows)).toContain("labels: Record<string, string>;");
  });

  test("ordinary objects stay interfaces", () => {
    const profile = { first: "a", last: "b", email: "c", city: "d", zip: "e", phone: "f", role: "g", team: "h" };
    expect(ts(profile)).toContain("export interface Root {\n  first: string;");
    expect(ts({ "first-name": "a", "last-name": "b" })).toContain('"first-name": string;');
    expect(ts({ "a-1": 1, "a-2": "x", "a-3": true })).toContain('"a-1": number;');
    const config = { db: { host: "h" }, cache: { ttl: 1 }, log: { level: "l" }, a: { x: 1 }, b: { y: 1 }, c: { z: 1 }, d: { w: 1 }, e: { v: 1 } };
    expect(ts(config)).toContain("export interface Root {\n  db: Db;");
  });

  test("a large dictionary infers in well under a frame", () => {
    const big = Object.fromEntries(
      Array.from({ length: 20_000 }, (_, i) => [`node_modules/pkg-${i}`, { version: `1.0.${i}`, ...(i % 5 ? {} : { dev: true }) }]),
    );
    const t0 = performance.now();
    const out = ts(big);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(out).toContain("export type Root = Record<string, RootItem>;");
    expect(out).toContain("dev?: boolean;");
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
