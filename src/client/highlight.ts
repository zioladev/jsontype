// Colour the TypeScript that infer() prints. It only has to understand our
// own output format, so it works line by line.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const span = (cls: string, s: string) => `<span class="${cls}">${esc(s)}</span>`;

const INTERFACE = /^export interface (\w+) \{$/;
const ALIAS = /^export type (\w+) = (.*);$/;
const PROP = /^ {2}("(?:[^"\\]|\\.)*"|[A-Za-z_$][\w$]*)(\??): (.*);$/;

export function highlight(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      let m: RegExpExecArray | null;
      if ((m = INTERFACE.exec(line))) {
        return `${span("kw", "export interface")} ${span("nm", m[1]!)} ${span("pu", "{")}`;
      }
      if ((m = ALIAS.exec(line))) {
        return `${span("kw", "export type")} ${span("nm", m[1]!)} ${span("pu", "=")} ${typeExpr(m[2]!)}${span("pu", ";")}`;
      }
      if ((m = PROP.exec(line))) {
        const key = m[1]!.startsWith('"') ? span("st", m[1]!) : esc(m[1]!);
        return `  ${key}${m[2] ? span("pu", "?") : ""}${span("pu", ":")} ${typeExpr(m[3]!)}${span("pu", ";")}`;
      }
      if (line === "}") return span("pu", "}");
      return esc(line);
    })
    .join("\n");
}

function typeExpr(expr: string): string {
  return expr.replace(/[A-Za-z_$][\w$]*|[^A-Za-z_$\s]+/g, (tok) => {
    if (/^(string|number|boolean|null|unknown)$/.test(tok)) return span("pr", tok);
    if (/^[A-Za-z_$]/.test(tok)) return span("nm", tok);
    return span("pu", tok);
  });
}
