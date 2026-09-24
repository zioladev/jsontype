// Collapsible, read-only view of the parsed JSON. Children are built only
// when a node is first opened, so a 50k-line document costs nothing until
// you drill into it.

const PAGE = 500; // children rendered per "show more" step
const OPEN_DEPTH = 1; // levels expanded by default

export function renderTree(root: HTMLElement, value: unknown) {
  root.replaceChildren(node(null, value, 0));
}

function node(key: string | number | null, value: unknown, depth: number): HTMLElement {
  if (value === null || typeof value !== "object") {
    const leaf = el("div", "leaf");
    if (key !== null) leaf.append(keyEl(key));
    leaf.append(prim(value));
    return leaf;
  }

  const entries: [string | number, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [i, v])
    : Object.entries(value);
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];

  const details = el("details");
  const summary = el("summary");
  if (key !== null) summary.append(keyEl(key));
  summary.append(
    text(entries.length ? open : open + close),
    el("span", "meta", `${entries.length} ${Array.isArray(value) ? "item" : "key"}${entries.length === 1 ? "" : "s"}`),
  );
  details.append(summary);

  const kids = el("div", "kids");
  let shown = 0;
  const more = () => {
    const end = Math.min(shown + PAGE, entries.length);
    const frag = document.createDocumentFragment();
    for (; shown < end; shown++) {
      const [k, v] = entries[shown]!;
      frag.append(node(k, v, depth + 1));
    }
    if (shown < entries.length) {
      const btn = el("button", "more", `Show ${Math.min(PAGE, entries.length - shown)} more of ${entries.length - shown}`);
      btn.type = "button";
      btn.onclick = () => {
        btn.remove();
        more();
      };
      frag.append(btn);
    }
    kids.append(frag);
  };

  if (entries.length) {
    details.append(kids);
    if (depth < OPEN_DEPTH) {
      details.open = true;
      more();
    } else {
      details.addEventListener("toggle", function first() {
        if (!details.open) return;
        details.removeEventListener("toggle", first);
        more();
      });
    }
  }
  return details;
}

function keyEl(key: string | number) {
  return el("span", "k", typeof key === "number" ? `${key}: ` : `${JSON.stringify(key)}: `);
}

function prim(v: unknown) {
  if (v === null) return el("span", "z", "null");
  if (typeof v === "string") return el("span", "s", JSON.stringify(v));
  if (typeof v === "number") return el("span", "n", String(v));
  return el("span", "b", String(v));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, content?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (content !== undefined) e.textContent = content;
  return e;
}

const text = (s: string) => document.createTextNode(s);
