// Nepx 1.4: mutable cookies, draftMode, revalidateTag / unstable_cache / cacheTag, after(), instrumentation,
// external rewrites (proxy), route segment config (dynamic, tags), viewport, <Form>, permanentRedirect.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { start, HTML } from "./server-helpers.js";
import { makeProject, nepx, scaffold, linkDeps } from "./helpers.js";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { compileRules } from "../src/rules.js";
import { loadInstrumentation } from "../src/instrumentation.js";
import { scanApp, inspectRoutes } from "../src/router.js";
import { metadataToTags, mergeMetadata } from "../src/metadata.js";
import { permanentRedirect } from "../src/shared.js";

const layout = "export default function L({children}){ return <html><body>{children}</body></html>; }";
const setCookies = (r) => [].concat(r.headers.getSetCookie?.() ?? []);
const wait = async (fn, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };

test("cookies().set / delete add Set-Cookie headers; bad names and options are rejected", async () => {
  const { base } = await start({
    "app/layout.jsx": layout,
    "app/api/c/route.js": `import { cookies } from "nepx";
export async function GET(){ const c = cookies(); c.set("theme", "dark mode", { httpOnly: true, maxAge: 60, sameSite: "strict" }); c.set({ name: "b", value: "2", secure: true }); c.delete("old"); return Response.json({ seen: c.get("theme")?.value, old: c.has("old") }); }`,
    "app/api/bad/route.js": `import { cookies } from "nepx"; export async function GET(){ try { cookies().set("bad name", "x"); } catch (e) { return Response.json({ err: e.message }); } return Response.json({}); }`,
    "app/api/bad2/route.js": `import { cookies } from "nepx"; export async function GET(){ try { cookies().set("a", "x", { sameSite: "weird" }); } catch (e) { return Response.json({ err: e.message }); } return Response.json({}); }`,
  });
  const r = await fetch(base + "/api/c", { headers: { cookie: "old=1" } });
  const sc = setCookies(r);
  assert.equal(sc.length, 3);
  assert.match(sc[0], /^theme=dark%20mode; Path=\/; Max-Age=60; HttpOnly; SameSite=Strict$/);
  assert.match(sc[1], /^b=2; Path=\/; Secure$/);
  assert.match(sc[2], /^old=; Path=\/; Max-Age=0; Expires=Thu, 01 Jan 1970/);
  assert.deepEqual(await r.json(), { seen: "dark%20mode".length ? "dark mode" : "", old: false });
  assert.match((await (await fetch(base + "/api/bad")).json()).err, /invalid cookie name/);
  assert.match((await (await fetch(base + "/api/bad2")).json()).err, /sameSite/);
});

test("draftMode: signed cookie, pages bypass the ISR cache, forged cookies are ignored", async () => {
  const { base } = await start({
    "app/layout.jsx": layout,
    "app/page.jsx": `import { draftMode } from "nepx"; let n = 0;
export const revalidate = 3600;
export default function P(){ n++; return <p id="n">render-{n}</p>; }`,
    "app/api/draft/route.js": `import { draftMode } from "nepx";
export async function GET(req){ const d = draftMode(); const on = new URL(req.url).searchParams.get("off") === null; on ? d.enable() : d.disable(); return Response.json({ enabled: d.isEnabled }); }`,
    "app/api/state/route.js": `import { draftMode } from "nepx"; export async function GET(){ return Response.json({ enabled: draftMode().isEnabled }); }`,
  });
  const a = await fetch(base + "/", { headers: HTML }); const aText = await a.text();
  assert.equal(a.headers.get("x-nepx-cache"), "MISS");
  assert.match(aText, /render-(?:<!-- -->)?1/);
  const b = await fetch(base + "/", { headers: HTML }); assert.equal(b.headers.get("x-nepx-cache"), "HIT"); assert.match(await b.text(), /render-(?:<!-- -->)?1/);

  const on = await fetch(base + "/api/draft"); assert.deepEqual(await on.json(), { enabled: true });
  const cookie = setCookies(on)[0]; assert.match(cookie, /^__nepx_draft=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Lax/);
  const pair = cookie.split(";")[0];
  const d = await fetch(base + "/", { headers: { ...HTML, cookie: pair } });
  assert.equal(d.headers.get("cache-control"), "private, no-store");
  assert.equal(d.headers.get("x-nepx-cache"), null);
  assert.match(await d.text(), /render-(?:<!-- -->)?2/); // a fresh render, not the cached copy
  assert.deepEqual(await (await fetch(base + "/api/state", { headers: { cookie: pair } })).json(), { enabled: true });
  assert.deepEqual(await (await fetch(base + "/api/state", { headers: { cookie: "__nepx_draft=" + "0".repeat(64) } })).json(), { enabled: false });
  assert.deepEqual(await (await fetch(base + "/api/state")).json(), { enabled: false });
  const off = await fetch(base + "/api/draft?off", { headers: { cookie: pair } });
  assert.match(setCookies(off)[0], /^__nepx_draft=; Path=\/; Max-Age=0/);
  const c = await fetch(base + "/", { headers: HTML }); assert.equal(c.headers.get("x-nepx-cache"), "HIT"); // everybody else still gets the cached page
});

test("revalidateTag drops ISR pages (page `tags` export and cacheTag()) and unstable_cache entries", async () => {
  const { base } = await start({
    "app/layout.jsx": layout,
    "app/a/page.jsx": `let n = 0; export const revalidate = 3600; export const tags = ["posts"];
export default function P(){ n++; return <p>a-{n}</p>; }`,
    "app/b/page.jsx": `import { cacheTag } from "nepx"; let n = 0; export const revalidate = 3600;
export default function P(){ cacheTag("other"); n++; return <p>b-{n}</p>; }`,
    "app/api/data/route.js": `import { unstable_cache } from "nepx"; let calls = 0;
const load = unstable_cache(async (id) => ({ id, calls: ++calls }), ["data"], { tags: ["posts"] });
export async function GET(req){ return Response.json(await load(new URL(req.url).searchParams.get("id") ?? "1")); }`,
    "app/api/ttl/route.js": `import { unstable_cache } from "nepx"; let calls = 0;
const load = unstable_cache(async () => ++calls, ["ttl"], { revalidate: 0.05 });
export async function GET(){ return Response.json({ calls: await load() }); }`,
    "app/api/bust/route.js": `import { revalidateTag } from "nepx"; export async function POST(req){ revalidateTag(new URL(req.url).searchParams.get("tag")); return Response.json({ ok: true }); }`,
    "app/api/badtag/route.js": `import { revalidateTag, unstable_cache } from "nepx"; export async function GET(){ const out = {}; try { revalidateTag(""); } catch (e) { out.a = e.message; } try { unstable_cache(() => 1, [], { revalidate: -1 }); } catch (e) { out.b = e.message; } return Response.json(out); }`,
  });
  const text = async (p) => { const r = await fetch(base + p, { headers: HTML }); return [r.headers.get("x-nepx-cache"), await r.text()]; };
  assert.match((await text("/a"))[1], /a-(?:<!-- -->)?1/); assert.equal((await text("/a"))[0], "HIT");
  assert.match((await text("/b"))[1], /b-(?:<!-- -->)?1/);
  assert.deepEqual(await (await fetch(base + "/api/data?id=1")).json(), { id: "1", calls: 1 });
  assert.deepEqual(await (await fetch(base + "/api/data?id=1")).json(), { id: "1", calls: 1 }); // cached
  assert.deepEqual(await (await fetch(base + "/api/data?id=2")).json(), { id: "2", calls: 2 }); // other args: other key

  await fetch(base + "/api/bust?tag=posts", { method: "POST" });
  const a2 = await text("/a"); assert.equal(a2[0], "MISS"); assert.match(a2[1], /a-(?:<!-- -->)?2/);          // page `tags` export
  assert.match((await text("/b"))[1], /b-(?:<!-- -->)?1/);                                                       // other tag: untouched
  assert.deepEqual(await (await fetch(base + "/api/data?id=1")).json(), { id: "1", calls: 3 });    // unstable_cache entry dropped

  await fetch(base + "/api/bust?tag=other", { method: "POST" });
  const b2 = await text("/b"); assert.equal(b2[0], "MISS"); assert.match(b2[1], /b-(?:<!-- -->)?2/);           // cacheTag() at render time

  const t1 = await (await fetch(base + "/api/ttl")).json(), t2 = await (await fetch(base + "/api/ttl")).json();
  assert.equal(t1.calls, t2.calls);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal((await (await fetch(base + "/api/ttl")).json()).calls, t1.calls + 1);                // revalidate seconds expire the entry
  const bad = await (await fetch(base + "/api/badtag")).json();
  assert.match(bad.a, /non-empty string/); assert.match(bad.b, /positive number/);
});

test("after() runs once the response is sent; its errors never reach the client", async () => {
  globalThis.__nepxAfter = [];
  const { base } = await start({
    "app/layout.jsx": layout,
    "app/api/a/route.js": `import { after, headers } from "nepx";
export async function GET(){ after(() => { globalThis.__nepxAfter.push("first:" + headers().get("x-test")); }); after(() => { throw new Error("boom"); }); after(async () => { await new Promise((r) => setTimeout(r, 10)); globalThis.__nepxAfter.push("last"); });
  globalThis.__nepxAfter.push("handler"); return Response.json({ ok: true }); }`,
  });
  const r = await fetch(base + "/api/a", { headers: { "x-test": "yes" } });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  assert.ok(await wait(() => globalThis.__nepxAfter.includes("last")));
  assert.deepEqual(globalThis.__nepxAfter, ["handler", "first:yes", "last"]);
});

test("instrumentation: register() runs at startup, onRequestError gets 500s with route info", async () => {
  const root = makeProject({
    "app/page.jsx": "export default function P(){ return null; }",
    "instrumentation.js": `globalThis.__registered = (globalThis.__registered ?? 0) + 1; export async function register(){ globalThis.__registerRuntime = process.env.NEPX_RUNTIME; } export function onRequestError(){}`,
  });
  const inst = await loadInstrumentation(root);
  assert.equal(globalThis.__registerRuntime, "nodejs"); assert.equal(typeof inst.onRequestError, "function");
  assert.equal(await loadInstrumentation(makeProject({ "app/page.jsx": "export default () => null" })), null);
  await assert.rejects(loadInstrumentation(makeProject({ "instrumentation.js": "export const register = 1;" })), /"register" must be a function/);
  await assert.rejects(loadInstrumentation(makeProject({ "instrumentation.js": "export async function register(){ throw new Error('nope'); }" })), /register\(\) failed: nope/);

  const seen = [];
  const { base } = await start({
    "app/layout.jsx": layout,
    "app/api/crash/route.js": `export async function GET(){ throw new Error("kaboom"); }`,
    "app/api/ok/route.js": `export async function GET(){ return Response.json({ ok: true }); }`,
    "app/api/forbid/route.js": `import { forbidden } from "nepx"; export async function GET(){ forbidden(); }`,
  }, { instrumentation: { onRequestError: async (err, request, ctx) => { seen.push({ message: err.message, request, ctx }); } } });
  const origErr = console.error; console.error = () => {};
  try { assert.equal((await fetch(base + "/api/crash?x=1")).status, 500); } finally { console.error = origErr; }
  await fetch(base + "/api/ok"); await fetch(base + "/api/forbid");
  assert.ok(await wait(() => seen.length === 1));
  assert.equal(seen.length, 1); // 200s and deliberate 4xx are not errors
  assert.equal(seen[0].message, "kaboom");
  assert.equal(seen[0].request.path, "/api/crash?x=1"); assert.equal(seen[0].request.method, "GET");
  assert.equal(seen[0].ctx.routerKind, "App Router"); assert.equal(seen[0].ctx.routePath, "/api/crash"); assert.equal(seen[0].ctx.routeType, "route");
  assert.ok(seen[0].ctx.requestId);
});

test("external rewrites proxy the request (method, body, query, cookies) and the answer; the host cannot be chosen by the visitor", async () => {
  const upstream = http.createServer((req, res) => {
    const c = []; req.on("data", (d) => c.push(d));
    req.on("end", () => {
      if (req.url.startsWith("/redir")) { res.writeHead(302, { location: "/elsewhere" }); return res.end(); }
      res.writeHead(201, { "content-type": "application/json", "set-cookie": ["up=1; Path=/", "up2=2; Path=/"], "x-up": "yes" });
      res.end(JSON.stringify({ method: req.method, url: req.url, body: Buffer.concat(c).toString(), cookie: req.headers.cookie ?? null, fwd: req.headers["x-forwarded-host"] ?? null, host: req.headers.host }));
    });
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const up = upstream.address().port;
  try {
    const rules = await compileRules({ rewrites: [{ source: "/ext/:p*", destination: `http://127.0.0.1:${up}/v1/:p*` }, { source: "/go", destination: `http://127.0.0.1:${up}/redir` }, { source: "/dead", destination: "http://127.0.0.1:1/x" }] });
    const { base } = await start({ "app/layout.jsx": layout, "app/page.jsx": "export default () => <p>home</p>", "app/api/own/route.js": "export async function GET(){ return Response.json({ own: true }); }" }, { rewrites: rules.rewrites });
    const r = await fetch(base + "/ext/a/b?x=1&y=2", { method: "POST", headers: { "content-type": "text/plain", cookie: "s=1" }, body: "payload" });
    assert.equal(r.status, 201); assert.equal(r.headers.get("x-up"), "yes");
    assert.deepEqual(setCookies(r), ["up=1; Path=/", "up2=2; Path=/"]);
    const j = await r.json();
    assert.deepEqual({ ...j, host: undefined, fwd: undefined }, { method: "POST", url: "/v1/a/b?x=1&y=2", body: "payload", cookie: "s=1", host: undefined, fwd: undefined });
    assert.equal(j.host, `127.0.0.1:${up}`); assert.equal(j.fwd, new URL(base).host);
    const g = await (await fetch(base + "/ext")).json(); assert.equal(g.url, "/v1"); // ":p*" with nothing captured
    const red = await fetch(base + "/go", { redirect: "manual" }); assert.equal(red.status, 302); assert.equal(red.headers.get("location"), "/elsewhere"); // not followed
    assert.equal((await fetch(base + "/dead")).status, 502);
    assert.equal((await fetch(base + "/")).status, 200); assert.deepEqual(await (await fetch(base + "/api/own")).json(), { own: true }); // other routes untouched
    // client-side navigation to a proxied URL falls back to a full page load
    assert.deepEqual(await (await fetch(base + "/_nepx/data?path=" + encodeURIComponent("/ext/x"))).json(), { reload: true });
  } finally { upstream.closeAllConnections?.(); upstream.close(); }
});

test("route segment config: dynamic + tags are validated and reach the manifest", async () => {
  const p = "export default () => null;";
  const root = makeProject({
    "app/layout.jsx": p, "app/ok/page.jsx": `${p} export const dynamic = "force-dynamic"; export const tags = ["x"];`,
    "app/bad/page.jsx": `${p} export const dynamic = "sometimes";`, "app/both/page.jsx": `${p} export const dynamic = "force-dynamic"; export const revalidate = 5;`,
    "app/badtags/page.jsx": `${p} export const tags = [1];`, "app/auto/page.jsx": `${p} export const dynamic = "auto";`,
  });
  const info = await inspectRoutes(root, scanApp(root));
  const by = (x) => info.routes.find((r) => r.path === x);
  assert.equal(by("/ok").error, null); assert.equal(by("/ok").dynamic, "force-dynamic"); assert.deepEqual(by("/ok").tags, ["x"]);
  assert.match(by("/bad").error, /dynamic must be "auto", "force-dynamic" or "force-static"/);
  assert.match(by("/both").error, /force-dynamic page cannot export revalidate/);
  assert.match(by("/badtags").error, /tags must be an array/);
  assert.equal(by("/auto").error, null); assert.equal(by("/auto").dynamic, undefined);
});

test("build: force-dynamic is never prerendered; force-static prerenders a page that reads cookies()", () => {
  const app = scaffold("frontend");
  const write = (rel, c) => { mkdirSync(path.dirname(path.join(app, rel)), { recursive: true }); writeFileSync(path.join(app, rel), c); };
  write("app/dyn/page.jsx", `export const dynamic = "force-dynamic"; export default function P(){ return <p>DYN</p>; }`);
  write("app/stat/page.jsx", `import { cookies, headers } from "nepx"; export const dynamic = "force-static";
export default function P(){ return <p>STAT-{cookies().get("x")?.value ?? "none"}-{headers().get("user-agent") ?? "none"}</p>; }`);
  write("app/auto/page.jsx", `import { cookies } from "nepx"; export default function P(){ return <p>AUTO-{cookies().get("x")?.value ?? "none"}</p>; }`);
  const out = nepx(app, "build");
  assert.match(String(out.stdout ?? out), /Build OK/);
  assert.ok(!existsSync(path.join(app, ".nepx/static/dyn/index.html")));
  assert.ok(!existsSync(path.join(app, ".nepx/static/auto/index.html"))); // dynamic by usage: per request
  assert.match(require_read(path.join(app, ".nepx/static/stat/index.html")), /STAT-(?:<!-- -->)?none(?:<!-- -->)?-(?:<!-- -->)?none/);
});
import { readFileSync } from "node:fs";
const require_read = (f) => readFileSync(f, "utf8");

test("viewport / generateViewport: one viewport meta, theme colors with media, color-scheme", async () => {
  const tags = (m) => metadataToTags(m).map((t) => t.attrs);
  assert.deepEqual(tags({ viewport: { maximumScale: 1, userScalable: false, themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#000" }, "#fff"], colorScheme: "dark light" } }), [
    { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" },
    { name: "theme-color", content: "#000", media: "(prefers-color-scheme: dark)" }, { name: "theme-color", content: "#fff" }, { name: "color-scheme", content: "dark light" },
  ]);
  assert.equal(tags({ viewport: { width: 500, initialScale: 2 } })[0].content, "width=500, initial-scale=2");
  assert.equal(tags({ title: "x" }).length, 0);
  assert.equal(mergeMetadata([{ viewport: { themeColor: "#111" } }, { viewport: { themeColor: "#222" } }]).viewport.themeColor, "#222");

  const { base } = await start({
    "app/layout.jsx": `export const viewport = { themeColor: "#123456" }; export default function L({children}){ return <html><body>{children}</body></html>; }`,
    "app/page.jsx": `export const viewport = { maximumScale: 1 }; export default () => <p>one</p>;`,
    "app/dyn/[id]/page.jsx": `export async function generateViewport({ params }){ return { initialScale: 1, themeColor: "#" + params.id.repeat(3) }; } export default () => <p>two</p>;`,
    "app/plain/page.jsx": `export default () => <p>plain</p>;`,
  });
  const html = await (await fetch(base + "/", { headers: HTML })).text();
  assert.equal(html.match(/name="viewport"/g).length, 1);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/);
  assert.match(html, /name="theme-color" content="#123456"/); // layout viewport merged under the page's
  assert.match(await (await fetch(base + "/dyn/abc", { headers: HTML })).text(), /name="theme-color" content="#abcabcabc"/);
  const plain = await (await fetch(base + "/plain", { headers: HTML })).text();
  assert.equal(plain.match(/name="viewport"/g).length, 1); // still the default viewport
  const data = await (await fetch(base + "/_nepx/data?path=/dyn/xyz")).json();
  assert.equal(data.metadata.viewport.themeColor, "#xyzxyzxyz"); // client navigation gets it too
});

test("<Form> renders a GET form (basePath-aware); function actions pass through; bad input is rejected", async () => {
  const React = (await import("react")).default ?? (await import("react"));
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { Form } = await import("../src/components.js");
  const { RouterContext } = await import("../src/link.js");
  const h = React.createElement;
  const html = renderToStaticMarkup(h(Form, { action: "/search", className: "s" }, h("input", { name: "q" })));
  assert.equal(html, '<form class="s" action="/search" method="get"><input name="q"/></form>');
  const withBase = renderToStaticMarkup(h(RouterContext.Provider, { value: { pathname: "/", searchParams: new URLSearchParams(), params: {}, basePath: "/docs" } }, h(Form, { action: "/search" })));
  assert.match(withBase, /action="\/docs\/search"/);
  const fn = renderToStaticMarkup(h(Form, { action: async () => {} }, "x"));
  assert.match(fn, /^<form action="javascript:/); // React's server-action form
  assert.throws(() => renderToStaticMarkup(h(Form, {})), /needs an "action"/);
});

test("permanentRedirect answers 308", () => {
  const r = permanentRedirect("/new");
  assert.equal(r.status, 308); assert.equal(r.headers.get("location"), "/new");
});
