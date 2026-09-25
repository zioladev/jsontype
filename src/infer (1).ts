// Hand-written JSON → TypeScript inference. Shared by the browser (live
// preview) and the server (what a share link stores), so both always agree.
//
// Three passes: `shapeOf` reduces a value to a structural Shape, merging every
// element of an array into one Shape; `refine` spots objects that are really
// dictionaries and turns them into `Record<string, T>`; `toTypeScript` names
// the object shapes and prints them as interfaces.

type Prim = "string" | "number" | "boolean" | "null";

export type Shape =
  | { kind: "prim"; name: Prim }
  | { kind: "never" } // element type of an empty array; printed as `unknown`
  | { kind: "array"; of: Shape }
  | { kind: "object"; fields: Map<string, Field> }
  | { kind: "map"; of: Shape } // an object used as a dictionary: Record<string, T>
  | { kind: "union"; of: Shape[] };

export interface Field {
  shape: Shape;
  optional: boolean;
}

const NEVER: Shape = { kind: "never" };
const prim = (name: Prim): Shape => ({ kind: "prim", name });

export function shapeOf(value: unknown): Shape {
  if (value === null) return prim("null");
  if (Array.isArray(value)) {
    let of = NEVER;
    for (const item of value) of = absorb(of, item);
    return { kind: "array", of };
  }
  switch (typeof value) {
    case "string":
      return prim("string");
    case "number":
      return prim("number");
    case "boolean":
      return prim("boolean");
    case "object": {
      const fields = new Map<string, Field>();
      for (const [key, v] of Object.entries(value as object)) {
        fields.set(key, { shape: shapeOf(v), optional: false });
      }
      return { kind: "object", fields };
    }
  }
  throw new TypeError(`Not a JSON value: ${typeof value}`);
}

// Fold one more array element into the shape of the elements so far.
// Equivalent to merge(acc, shapeOf(value)), but updates `acc` in place in the
// common cases instead of building a throwaway shape per element, which keeps
// 20k-item arrays fast. Safe because `acc` is only ever owned by one array.
function absorb(acc: Shape, value: unknown): Shape {
  const target = acc.kind === "union" ? acc.of.find((s) => sameKind(s, value)) : sameKind(acc, value) ? acc : undefined;

  if (target?.kind === "prim") return acc;
  if (target?.kind === "array") {
    for (const item of value as unknown[]) target.of = absorb(target.of, item);
    return acc;
  }
  if (target?.kind === "object") {
    const obj = value as Record<string, unknown>;
    for (const [key, field] of target.fields) {
      if (!Object.hasOwn(obj, key)) field.optional = true;
    }
    for (const key in obj) {
      const field = target.fields.get(key);
      if (field) field.shape = absorb(field.shape, obj[key]);
      else target.fields.set(key, { shape: shapeOf(obj[key]), optional: true });
    }
    return acc;
  }
  return merge(acc, shapeOf(value));
}

function sameKind(s: Shape, value: unknown): boolean {
  switch (s.kind) {
    case "prim":
      return value === null ? s.name === "null" : typeof value === s.name;
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return false;
  }
}

// Merge two shapes seen at the same position (e.g. two elements of one array).
// Objects fold into a single object whose keys become optional when a sample
// lacks them; arrays fold element-wise; anything else becomes a flat union.
export function merge(a: Shape, b: Shape): Shape {
  if (a.kind === "never") return b;
  if (b.kind === "never") return a;

  // Fast paths for the common case: a homogeneous array.
  if (a.kind === "object" && b.kind === "object") return mergeObjects(a, b);
  if (a.kind === "prim" && b.kind === "prim" && a.name === b.name) return a;
  if (a.kind === "array" && b.kind === "array") return { kind: "array", of: merge(a.of, b.of) };

  const prims: Prim[] = [];
  let obj: Extract<Shape, { kind: "object" }> | undefined;
  let arr: Extract<Shape, { kind: "array" }> | undefined;
  let map: Extract<Shape, { kind: "map" }> | undefined;

  for (const s of [...members(a), ...members(b)]) {
    if (s.kind === "prim") {
      if (!prims.includes(s.name)) prims.push(s.name);
    } else if (s.kind === "object") {
      obj = obj ? mergeObjects(obj, s) : s;
    } else if (s.kind === "array") {
      arr = arr ? { kind: "array", of: merge(arr.of, s.of) } : s;
    } else if (s.kind === "map") {
      map = map ? { kind: "map", of: merge(map.of, s.of) } : s;
    }
  }

  // Keep first-seen order, but `null` always reads last: `Foo | null`.
  const of: Shape[] = prims.filter((p) => p !== "null").map(prim);
  if (obj) of.push(obj);
  if (arr) of.push(arr);
  if (map) of.push(map);
  if (prims.includes("null")) of.push(prim("null"));
  return of.length === 1 ? of[0]! : { kind: "union", of };
}

function members(s: Shape): Shape[] {
  return s.kind === "union" ? s.of : [s];
}

function mergeObjects(
  a: Extract<Shape, { kind: "object" }>,
  b: Extract<Shape, { kind: "object" }>,
): Extract<Shape, { kind: "object" }> {
  const fields = new Map<string, Field>();
  for (const [key, fa] of a.fields) {
    const fb = b.fields.get(key);
    if (!fb) fields.set(key, fa.optional ? fa : { shape: fa.shape, optional: true });
    else {
      const shape = merge(fa.shape, fb.shape);
      const optional = fa.optional || fb.optional;
      // Reuse the existing field when nothing changed, to keep allocation down.
      fields.set(key, shape === fa.shape && optional === fa.optional ? fa : { shape, optional });
    }
  }
  for (const [key, fb] of b.fields) {
    if (!a.fields.has(key)) fields.set(key, { shape: fb.shape, optional: true });
  }
  return { kind: "object", fields };
}

// ── dictionaries ──────────────────────────────────────────────────────────
//
// `{"node_modules/astro": {...}, "node_modules/vite": {...}}` is a lookup
// table, not an interface with 479 properties. An object is treated as one
// when every value has the same type and at least one of these holds:
//   - most keys aren't identifiers (paths, ids, dates, "Content-Type")
//   - it is the merge of many samples whose key sets mostly didn't overlap
//   - it has many keys whose values are objects of the identical shape
// Runs after merging, so a dictionary repeated across array items (e.g. every
// package's `dependencies`) is judged on all of its keys at once.

const MIN_KEYS_ODD = 3; // with mostly non-identifier keys
const MIN_KEYS_MANY = 8; // with mostly optional keys, or identical object values

export function refine(s: Shape): Shape {
  switch (s.kind) {
    case "prim":
    case "never":
      return s;
    case "array":
      return { kind: "array", of: refine(s.of) };
    case "map":
      return { kind: "map", of: refine(s.of) };
    case "union":
      return { kind: "union", of: s.of.map(refine) };
    case "object": {
      const values = dictionaryValues(s);
      if (values) return { kind: "map", of: refine(values) };
      const fields = new Map<string, Field>();
      for (const [key, f] of s.fields) fields.set(key, { shape: refine(f.shape), optional: f.optional });
      return { kind: "object", fields };
    }
  }
}

// The merged value shape if `s` reads as a dictionary, else undefined.
function dictionaryValues(s: Extract<Shape, { kind: "object" }>): Shape | undefined {
  const n = s.fields.size;
  if (n < MIN_KEYS_ODD) return undefined;

  const fields = [...s.fields.values()];
  let of: Shape = NEVER;
  for (const f of fields) of = merge(of, f.shape);
  if (!homogeneous(of)) return undefined;

  let odd = 0;
  for (const key of s.fields.keys()) if (!IDENT.test(key)) odd++;
  if (odd * 2 >= n) return of;

  if (n < MIN_KEYS_MANY) return undefined;
  if (fields.filter((f) => f.optional).length * 2 >= n) return of;
  const first = fields[0]!.shape;
  if (first.kind === "object" && first.fields.size > 0) {
    const sig = signature(first);
    if (fields.every((f) => signature(f.shape) === sig)) return of;
  }
  return undefined;
}

// One type for every value: a single kind, optionally `| null`.
function homogeneous(s: Shape): boolean {
  if (s.kind !== "union") return true;
  return s.of.length === 2 && s.of.some((m) => m.kind === "prim" && m.name === "null");
}

// ── printing ──────────────────────────────────────────────────────────────

export interface InferResult {
  code: string;
  interfaces: number;
}

export function toTypeScript(value: unknown, rootName = "Root"): string {
  return infer(value, rootName).code;
}

export function infer(value: unknown, rootName = "Root"): InferResult {
  const printer = new Printer();
  const shape = refine(shapeOf(value));

  if (shape.kind === "object" && shape.fields.size > 0) {
    printer.declare(shape, rootName);
  } else {
    // Arrays and primitives at the root become a type alias that points at
    // the interfaces it needs.
    const slot = printer.reserve();
    const expr = printer.expr(shape, rootName);
    printer.fill(slot, `export type ${rootName} = ${expr};`);
  }
  return { code: printer.output(), interfaces: printer.interfaces };
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Global type names an interface shouldn't shadow.
const RESERVED = new Set(
  "Array Boolean Date Error Function Map Number Object Promise Record RegExp Set String Symbol".split(" "),
);

class Printer {
  private decls: string[] = [];
  private names = new Set<string>(RESERVED);
  private bySignature = new Map<string, string>();
  interfaces = 0;

  reserve(): number {
    return this.decls.push("") - 1;
  }

  fill(slot: number, text: string) {
    this.decls[slot] = text;
  }

  output(): string {
    return this.decls.join("\n\n") + "\n";
  }

  // Declare an interface for an object shape and return its name.
  // Structurally identical objects share one interface.
  declare(shape: Extract<Shape, { kind: "object" }>, hint: string): string {
    const sig = signature(shape);
    const existing = this.bySignature.get(sig);
    if (existing) return existing;

    const name = this.uniqueName(pascal(hint));
    this.bySignature.set(sig, name);
    this.interfaces++;

    // Reserve the slot first so parents print above their children.
    const slot = this.reserve();
    const lines = [`export interface ${name} {`];
    for (const [key, field] of shape.fields) {
      const prop = IDENT.test(key) ? key : JSON.stringify(key);
      lines.push(`  ${prop}${field.optional ? "?" : ""}: ${this.expr(field.shape, key)};`);
    }
    lines.push("}");
    this.fill(slot, lines.join("\n"));
    return name;
  }

  expr(shape: Shape, hint: string): string {
    switch (shape.kind) {
      case "prim":
        return shape.name;
      case "never":
        return "unknown";
      case "object":
        return shape.fields.size === 0 ? "Record<string, unknown>" : this.declare(shape, hint);
      case "array": {
        const inner = this.expr(shape.of, singular(hint));
        return shape.of.kind === "union" ? `(${inner})[]` : `${inner}[]`;
      }
      case "map":
        return `Record<string, ${this.expr(shape.of, singular(hint))}>`;
      case "union":
        return shape.of.map((s) => this.expr(s, hint)).join(" | ");
    }
  }

  private uniqueName(base: string): string {
    let name = base;
    for (let n = 2; this.names.has(name); n++) name = `${base}${n}`;
    this.names.add(name);
    return name;
  }
}

// A key-order-independent fingerprint of a shape, for de-duplicating interfaces.
function signature(s: Shape): string {
  switch (s.kind) {
    case "prim":
      return s.name;
    case "never":
      return "never";
    case "array":
      return `${signature(s.of)}[]`;
    case "map":
      return `{[]:${signature(s.of)}}`;
    case "union":
      return `(${s.of.map(signature).sort().join("|")})`;
    case "object":
      return `{${[...s.fields]
        .map(([k, f]) => `${JSON.stringify(k)}${f.optional ? "?" : ""}:${signature(f.shape)}`)
        .sort()
        .join(",")}}`;
  }
}

export function pascal(hint: string): string {
  const words = hint
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const name = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
  if (!name) return "Item";
  return /^[0-9]/.test(name) ? `T${name}` : name;
}

// Name for the elements of an array property: `users` → `user`,
// `categories` → `category`, `data` → `dataItem`.
export function singular(hint: string): string {
  if (/[^aeiou]ies$/i.test(hint)) return hint.slice(0, -3) + "y";
  if (/(ss|x|ch|sh|atus)es$/i.test(hint)) return hint.slice(0, -2);
  if (/[^sui]s$/i.test(hint)) return hint.slice(0, -1);
  return `${hint}Item`;
}
