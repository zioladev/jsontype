# jsontype

**JSON → TypeScript, instantly.** Paste JSON on the left and TypeScript interfaces appear on the right as you type. Copy them, or **Save & share** for a `/s/:id` link that reopens the exact JSON and types.

One tool does all of it. Bun runs the TypeScript server, serves it with `Bun.serve()`, bundles the frontend with `Bun.build`, tests it with `bun test`, and stores shares in `bun:sqlite`. There are no runtime dependencies.

```sh
bun install
bun run dev        # build + serve on :3000, rebuilds and restarts on change
bun run test       # inference, parse-error and share round-trip tests
bun run typecheck
```

## How it works

| File | What it does |
| --- | --- |
| `src/infer.ts` | Hand-written inference. It runs in the browser for the live preview and on the server when a share is saved. |
| `src/jsonError.ts` | Finds where a parse failed (line, column, reason). Browsers word `JSON.parse` errors differently, and Safari gives no position. |
| `src/app.ts` | Routes: `/`, `/s/:id`, `POST /api/share`, `GET /api/share/:id`. |
| `src/db.ts` | `bun:sqlite` with no ORM: one table and two prepared statements. |
| `build.ts` | Bundles `src/client/*` and inlines it into one HTML page (≈9 KB gzipped) that the server imports. |
| `server.ts` | `Bun.serve()` entry point. |

Inference rules:

- Nested objects become named interfaces.
- `null` next to a value gives `T | null`.
- A key missing from some items in an array of objects becomes optional (`key?`).
- `[]` becomes `unknown[]`.
- Mixed primitive arrays become a union: `(string | number)[]`.
- Identical shapes share one interface.

Share ids are a hash of the content, so the same JSON always gets the same link. A `/s/:id` page embeds the saved JSON and types in the HTML, so it renders on first paint with no extra fetch.

## Deploy (Vercel)

1. Create a Vercel project from this repo with **Root Directory** set to `jsontype`.
2. `vercel.json` sets `"bunVersion": "1.x"`. With `bun.lock` and a root `server.ts`, Vercel's Bun preset sends every request to the `Bun.serve()` server.
3. Add the domain `jsontype.ziola.dev`.

Vercel's filesystem is ephemeral and every function instance has its own `/tmp`. On Vercel, shares live in `/tmp/jsontype.sqlite` and **don't persist** across cold starts or instances. That's fine for a live demo on a warm instance, but links won't last. For durable links, run it anywhere with a persistent disk (`JSONTYPE_DB=/data/jsontype.sqlite bun server.ts`).
