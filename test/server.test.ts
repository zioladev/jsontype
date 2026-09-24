import { afterAll, expect, test } from "bun:test";
import { notFound, routes } from "../src/app";
import { openStore } from "../src/db";

const store = openStore(":memory:");
const server = Bun.serve({ port: 0, routes: routes(store), fetch: notFound });
afterAll(() => server.stop(true));

test("save & share round-trips the exact JSON and its types", async () => {
  const json = '{\n  "id": 1,\n  "tags": []\n}';
  const res = await fetch(new URL("/api/share", server.url), { method: "POST", body: JSON.stringify({ json }) });
  expect(res.status).toBe(201);
  const { id, url } = (await res.json()) as { id: string; url: string };
  expect(url).toBe(new URL(`/s/${id}`, server.url).href);

  // Same JSON, same link.
  const again = await fetch(new URL("/api/share", server.url), { method: "POST", body: JSON.stringify({ json }) });
  expect(((await again.json()) as { id: string }).id).toBe(id);

  const saved = (await (await fetch(new URL(`/api/share/${id}`, server.url))).json()) as { json: string; types: string };
  expect(saved.json).toBe(json);
  expect(saved.types).toContain("tags: unknown[];");

  // The share page embeds the saved JSON so it paints on first load.
  const page = await (await fetch(url)).text();
  expect(page).toContain('<script id="seed" type="application/json">');
  expect(page).toContain(JSON.stringify(json).slice(1, -1));
});

test("seed data can't break out of its script tag", async () => {
  const json = JSON.stringify({ x: "</script><script>alert(1)</script>" });
  const { url } = (await (
    await fetch(new URL("/api/share", server.url), { method: "POST", body: JSON.stringify({ json }) })
  ).json()) as { url: string };
  const page = await (await fetch(url)).text();
  expect(page).not.toContain("</script><script>alert(1)");
});

test("rejects invalid JSON and unknown ids", async () => {
  const bad = await fetch(new URL("/api/share", server.url), { method: "POST", body: JSON.stringify({ json: "{" }) });
  expect(bad.status).toBe(400);
  expect((await fetch(new URL("/s/nope123456", server.url))).status).toBe(404);
  expect((await fetch(new URL("/api/share/nope123456", server.url))).status).toBe(404);
});
