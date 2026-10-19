// dynamicParams = false: only params from generateStaticParams() are served.
import test from "node:test";
import assert from "node:assert/strict";
import { makeProject, linkDeps } from "./helpers.js";
import { scanApp, inspectRoutes } from "../src/router.js";
import { allowedKeys } from "../src/dynamic-params.js";
import { toManifest } from "../src/build.js";
import { start, HTML } from "./server-helpers.js";

const comp = "export default function P({ params }){ return <p id='p'>post {JSON.stringify(params)}</p>; }";
const layout = "export default function L({ children }){ return <html><body>{children}</body></html>; }";

test("allowedKeys: single, catch-all and optional params; invalid entries are skipped", () => {
  const one = { segments: [{ static: "blog" }, { param: "slug" }] };
  assert.deepEqual([...allowedKeys(one, [{ slug: "a" }, { slug: 2 }, null, "x"])].sort(), ["blog/2", "blog/a"]);
  const rest = { segments: [{ static: "docs" }, { catchall: "path" }] };
  assert.deepEqual([...allowedKeys(rest, [{ path: ["a", "b"] }])], ["docs/a/b"]);
  const opt = { segments: [{ optional: "path" }] };
  assert.deepEqual([...allowedKeys(opt, [{}, { path: ["x"] }])].sort(), ["", "x"]);
  assert.equal(allowedKeys(one, undefined).size, 0);
});

test("dynamicParams is validated and lands in the manifest", async () => {
  const root = makeProject({
    "app/ok/[id]/page.jsx": `export const dynamicParams = false; export const generateStaticParams = () => [{ id: "1" }]; ${comp}`,
    "app/nogsp/[id]/page.jsx": `export const dynamicParams = false; ${comp}`,
    "app/bad/[id]/page.jsx": `export const dynamicParams = "no"; export const generateStaticParams = () => []; ${comp}`,
    "app/open/[id]/page.jsx": `export const generateStaticParams = () => []; ${comp}`,
  });
  linkDeps(root);
  const info = await inspectRoutes(root, scanApp(root));
  const by = Object.fromEntries(info.routes.map((r) => [r.path, r]));
  assert.equal(by["/ok/:id"].error, null);
  assert.match(by["/nogsp/:id"].error, /needs generateStaticParams/);
  assert.match(by["/bad/:id"].error, /must be true or false/);
  const m = toManifest({ routes: info.routes.filter((r) => !r.error) }, false);
  assert.equal(m.routes.find((r) => r.path === "/ok/:id").dynamicParams, false);
  assert.equal(m.routes.find((r) => r.path === "/open/:id").dynamicParams, true);
});

test("server: unknown params answer 404 (HTML and client data), known ones render, open routes are unaffected", async () => {
  const { base } = await start({
    "app/layout.jsx": layout,
    "app/blog/[slug]/page.jsx": `export const dynamicParams = false; export async function generateStaticParams(){ return [{ slug: "hello" }, { slug: "world" }]; } ${comp}`,
    "app/docs/[...path]/page.jsx": `export const dynamicParams = false; export const generateStaticParams = () => [{ path: ["a", "b"] }]; ${comp}`,
    "app/open/[id]/page.jsx": comp,
  });
  const ok = await fetch(base + "/blog/hello", { headers: HTML });
  assert.equal(ok.status, 200); assert.match(await ok.text(), /post/);
  assert.equal((await fetch(base + "/blog/world", { headers: HTML })).status, 200);
  assert.equal((await fetch(base + "/blog/nope", { headers: HTML })).status, 404);
  assert.equal((await fetch(base + "/docs/a/b", { headers: HTML })).status, 200);
  assert.equal((await fetch(base + "/docs/a/c", { headers: HTML })).status, 404);
  assert.equal((await fetch(base + "/open/anything", { headers: HTML })).status, 200);
  const data = await (await fetch(base + "/_nepx/data?path=" + encodeURIComponent("/blog/nope"), { headers: { "x-nepx-data": "1" } })).json();
  assert.equal(data.notFound, true);
});
