import { infer } from "../infer";
import { locateJsonError, type JsonError } from "../jsonError";
import { highlight } from "./highlight";
import { renderTree } from "./tree";
import { SAMPLE } from "./sample";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>("input");
const errorBox = $<HTMLButtonElement>("error");
const typesOut = $<HTMLPreElement>("types");
const code = typesOut.firstElementChild as HTMLElement;
const treeOut = $<HTMLDivElement>("tree");
const empty = $<HTMLParagraphElement>("empty");
const notice = $<HTMLDivElement>("notice");
const stats = $<HTMLSpanElement>("stats");
const copyBtn = $<HTMLButtonElement>("copy");
const shareBtn = $<HTMLButtonElement>("share");
const link = $<HTMLAnchorElement>("link");
const tabTypes = $<HTMLButtonElement>("tab-types");
const tabTree = $<HTMLButtonElement>("tab-tree");

// What's on screen right now.
let types = "";
let parsed: unknown;
let valid = false;
let treeFor: unknown = undefined; // the value the tree was last built from
let errorAt = 0;

// ── core loop: parse → infer → paint ──────────────────────────────────────

let queued = false;
function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    run();
  });
}

function run() {
  const text = input.value;
  $<HTMLButtonElement>("clear").hidden = !text;

  if (!text.trim()) {
    valid = false;
    types = "";
    code.textContent = "";
    treeOut.replaceChildren();
    treeFor = undefined;
    showError(null);
    setStale(false);
    empty.hidden = false;
    stats.textContent = "";
    syncButtons();
    return;
  }

  const t0 = performance.now();
  try {
    parsed = JSON.parse(text);
  } catch {
    let err: JsonError | null = null;
    try {
      err = locateJsonError(text);
    } catch {} // pathological nesting: fall back to the generic message
    valid = false;
    showError(err ?? { message: "Invalid JSON", offset: 0, line: 1, column: 1 });
    setStale(true);
    syncButtons();
    return;
  }
  const result = infer(parsed);
  const ms = performance.now() - t0;

  valid = true;
  types = result.code;
  code.innerHTML = highlight(types);
  showError(null);
  setStale(false);
  empty.hidden = true;
  if (!treeOut.hidden) paintTree();

  const kb = new Blob([text]).size / 1024;
  stats.textContent =
    `${result.interfaces} interface${result.interfaces === 1 ? "" : "s"} · ` +
    `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB · ${ms < 1 ? ms.toFixed(2) : ms.toFixed(1)} ms`;
  syncButtons();
}

function paintTree() {
  if (treeFor === parsed) return;
  treeFor = parsed;
  renderTree(treeOut, parsed);
}

function setStale(stale: boolean) {
  typesOut.classList.toggle("stale", stale);
  treeOut.classList.toggle("stale", stale);
}

function syncButtons() {
  copyBtn.disabled = !valid;
  shareBtn.disabled = !valid;
}

// ── inline parse error, with the offending line and a caret ──────────────

function showError(err: JsonError | null) {
  errorBox.hidden = !err;
  if (!err) return;
  errorAt = err.offset;

  const lineText = input.value.split("\n")[err.line - 1] ?? "";
  // Show at most ~60 chars around the column so long minified lines stay readable.
  const from = Math.max(0, err.column - 40);
  const snippet = lineText.slice(from, from + 60);
  const col = err.column - 1 - from;

  const msg = document.createElement("span");
  msg.className = "msg";
  msg.textContent = err.message;
  const where = document.createElement("span");
  where.className = "where";
  where.textContent = `line ${err.line}, column ${err.column}`;
  const pad = col + (from > 0 ? 1 : 0);
  const pre = document.createElement("pre");
  const caret = document.createElement("b");
  caret.textContent = "^";
  pre.append((from > 0 ? "…" : "") + snippet + "\n" + " ".repeat(pad), caret);
  errorBox.replaceChildren(msg, where, pre);
  errorBox.title = "Jump to error";
}

errorBox.addEventListener("click", () => {
  input.focus();
  input.setSelectionRange(errorAt, errorAt + 1);
  // Scroll the textarea so the error line is in view.
  const lineHeight = parseFloat(getComputedStyle(input).lineHeight) || 20;
  const line = input.value.slice(0, errorAt).split("\n").length - 1;
  input.scrollTop = Math.max(0, line * lineHeight - input.clientHeight / 3);
});

// ── tabs ──────────────────────────────────────────────────────────────────

function selectTab(tree: boolean) {
  tabTypes.setAttribute("aria-selected", String(!tree));
  tabTree.setAttribute("aria-selected", String(tree));
  typesOut.hidden = tree;
  treeOut.hidden = !tree;
  copyBtn.hidden = tree;
  if (tree && valid) paintTree();
}
tabTypes.onclick = () => selectTab(false);
tabTree.onclick = () => selectTab(true);

// ── copy, with a brief confirmation ───────────────────────────────────────

function confirm(btn: HTMLButtonElement, label: string) {
  const original = btn.dataset.label ?? btn.textContent!;
  btn.dataset.label = original;
  btn.textContent = label;
  btn.classList.add("done");
  clearTimeout(Number(btn.dataset.timer));
  btn.dataset.timer = String(
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove("done");
    }, 1400),
  );
}

copyBtn.onclick = async () => {
  try {
    await navigator.clipboard.writeText(types);
    confirm(copyBtn, "Copied ✓");
  } catch {
    // Clipboard blocked: select the output so ⌘C works.
    getSelection()?.selectAllChildren(code);
  }
};

// ── save & share ──────────────────────────────────────────────────────────

async function share() {
  if (!valid) return;
  shareBtn.disabled = true;
  shareBtn.textContent = "Saving…";
  try {
    const res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: input.value }),
    });
    const body = (await res.json()) as { id?: string; url?: string; error?: string };
    if (!res.ok || !body.url) throw new Error(body.error ?? `Save failed (${res.status})`);

    history.replaceState(null, "", `/s/${body.id}`);
    showLink(body.url, "saved");
    try {
      await navigator.clipboard.writeText(body.url);
      showLink(body.url, "link copied");
    } catch {}
  } catch (e) {
    showNotice(e instanceof Error ? e.message : "Save failed");
  } finally {
    shareBtn.textContent = "Save & share";
    syncButtons();
  }
}
shareBtn.onclick = share;

function showLink(url: string, note?: string) {
  link.href = url;
  link.textContent = url.replace(/^https?:\/\//, "");
  if (note) link.dataset.note = note;
  else delete link.dataset.note;
  link.hidden = false;
}

function showNotice(message: string) {
  notice.textContent = message;
  notice.hidden = false;
  setTimeout(() => (notice.hidden = true), 5000);
}

// ── input wiring ──────────────────────────────────────────────────────────

input.addEventListener("input", () => {
  // The URL shouldn't claim to be a saved share once the JSON changes.
  if (location.pathname !== "/") {
    history.replaceState(null, "", "/");
    link.hidden = true;
  }
  schedule();
});

$<HTMLButtonElement>("sample").onclick = () => load(SAMPLE);
$<HTMLButtonElement>("clear").onclick = () => load("");

function load(text: string) {
  input.value = text;
  input.dispatchEvent(new Event("input"));
  input.focus();
  input.setSelectionRange(0, 0);
  input.scrollTop = 0;
}

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    share();
  }
});

// ── rehydrate a shared link (/s/:id) from the server-embedded seed ────────

const seedEl = document.getElementById("seed");
if (seedEl) {
  const seed = JSON.parse(seedEl.textContent!) as { id?: string; json?: string; types?: string; missing?: boolean };
  if (seed.missing) {
    history.replaceState(null, "", "/");
    showNotice("That share link doesn't exist (or has expired).");
    run();
  } else if (seed.json !== undefined) {
    input.value = seed.json;
    run();
    // Show exactly the types that were saved.
    types = seed.types!;
    code.innerHTML = highlight(types);
    showLink(location.href);
  }
}
if (!seedEl) run();
