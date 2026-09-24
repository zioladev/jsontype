import { infer } from "./infer";
import type { ShareStore } from "./db";
import { PAGE } from "./page.gen";

export const MAX_JSON_BYTES = 1_000_000;
const ID = /^[A-Za-z0-9_-]{10}$/;

// Share ids are content-addressed: the same JSON always gets the same link.
function shareId(json: string): string {
  return new Bun.CryptoHasher("sha256").update(json).digest("base64url").slice(0, 10);
}

// Behind a TLS-terminating proxy (Render, Fly, …) the request arrives as
// plain http, so trust the proxy's X-Forwarded-Proto for the link we hand out.
function publicUrl(req: Request, path: string): string {
  const url = new URL(path, req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto === "https" || proto === "http") url.protocol = `${proto}:`;
  return url.href;
}

// The page with an optional share baked in, so a /s/:id link paints the saved
// JSON and types on first load with no extra request.
function page(seed: unknown, status = 200): Response {
  const body =
    seed === undefined
      ? PAGE
      : PAGE.replace(
          "<!--seed-->",
          `<script id="seed" type="application/json">${JSON.stringify(seed).replace(/</g, "\\u003c")}</script>`,
        );
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}

export function routes(store: ShareStore) {
  return {
    "/": () => page(undefined),

    "/s/:id": (req: Bun.BunRequest<"/s/:id">) => {
      const share = ID.test(req.params.id) ? store.get(req.params.id) : null;
      if (!share) return page({ missing: true }, 404);
      return page({ id: share.id, json: share.json, types: share.types });
    },

    "/api/share": {
      POST: async (req: Request) => {
        const body = (await req.json().catch(() => null)) as { json?: unknown } | null;
        const json = body?.json;
        if (typeof json !== "string") return Response.json({ error: "Body must be { json: string }" }, { status: 400 });
        if (Buffer.byteLength(json) > MAX_JSON_BYTES) {
          return Response.json({ error: "That JSON is over the 1 MB share limit" }, { status: 413 });
        }

        let value: unknown;
        try {
          value = JSON.parse(json);
        } catch {
          return Response.json({ error: "That isn't valid JSON" }, { status: 400 });
        }

        // Types are inferred here, not taken from the client, and stored with
        // the JSON so the link shows exactly what was saved.
        const id = shareId(json);
        store.save({ id, json, types: infer(value).code });
        return Response.json({ id, url: publicUrl(req, `/s/${id}`) }, { status: 201 });
      },
    },

    "/api/share/:id": {
      GET: (req: Bun.BunRequest<"/api/share/:id">) => {
        const share = ID.test(req.params.id) ? store.get(req.params.id) : null;
        if (!share) return Response.json({ error: "Not found" }, { status: 404 });
        return Response.json(share);
      },
    },
  };
}

export function notFound(): Response {
  return new Response("Not found", { status: 404 });
}
