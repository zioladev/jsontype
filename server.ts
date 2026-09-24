// jsontype — JSON → TypeScript, instantly.
// One Bun process: this file is the HTTP server, bun:sqlite stores the share
// links, `bun build` bundles the page it serves, and `bun test` covers it.
import { openStore } from "./src/db";
import { MAX_JSON_BYTES, notFound, routes } from "./src/app";

// Vercel's filesystem is read-only apart from /tmp.
const dbPath = process.env.JSONTYPE_DB ?? (process.env.VERCEL ? "/tmp/jsontype.sqlite" : "jsontype.sqlite");

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  maxRequestBodySize: MAX_JSON_BYTES * 4, // room for JSON-string escaping
  routes: routes(openStore(dbPath)),
  fetch: notFound,
});

console.log(`jsontype on ${server.url}`);
