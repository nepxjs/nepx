import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeProject, startNepx, nepx, scaffold, GLOBAL_MODULES } from "./helpers.js";
import { scanApp, matchRoute } from "../src/router.js";
import { mergeMetadata, metadataToTags, tagsToHtml } from "../src/metadata.js";
import { compilePattern, compileRules } from "../src/rules.js";

const page = "export default function P(){ return null; }";
const write = (app, rel, content) => { mkdirSync(path.dirname(path.join(app, rel)), { recursive: true }); writeFileSync(path.join(app, rel), content); };
const listFiles = (dir) => readdirSync(dir, { recursive: true }).map(String);
const rawGet = (port, p, headers = {}) => new Promise((res, rej) => http.get({ host: "localhost", port, path: p, headers }, (r) => {
  const chunks = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
}).on("error", rej));

// ---------- router ----------
test("optional catch-all [[...x]]: matches the parent path and everything below, with correct priority", () => {
  const root = makeProject({ "app/docs/[[...path]]/page.jsx": page, "app/docs/intro/page.jsx": page, "app/[[...all]]/page.jsx": page.replace("P", "Q"), "app/about/page.jsx": page });
  const routes = scanApp(root).routes;
  assert.ok(routes.some((r) => r.path === "/docs/:path*?"));
  const m = (...segs) => matchRoute(routes, segs);
  assert.deepEqual(m("docs").params, {});                                   // zero segments: the key is absent (like Next.js)
  assert.deepEqual(m("docs", "a", "b").params, { path: ["a", "b"] });
  assert.equal(m("docs", "intro").route.path, "/docs/intro");               // static beats optional catch-all
  assert.equal(m("about").route.path, "/about");
  assert.deepEqual(m().params, {});                                          // root-level optional catch-all matches "/"
  assert.deepEqual(m("x", "y").params, { all: ["x", "y"] });
});
test("optional catch-all conflicts with the page at its parent path and with [...x]", () => {
  assert.throws(() => scanApp(makeProject({ "app/a/page.jsx": page, "app/a/[[...x]]/page.jsx": page })), /Route conflict/);
  assert.throws(() => scanApp(makeProject({ "app/a/[...x]/page.jsx": page, "app/a/[[...y]]/page.jsx": page })), /Route conflict/);
  assert.throws(() => scanApp(makeProject({ "app/page.jsx": page, "app/[[...x]]/page.jsx": page })), /Route conflict/);
  assert.doesNotThrow(() => scanApp(makeProject({ "app/a/page.jsx": page, "app/a/b/[[...x]]/page.jsx": page })));
});
test("nested not-found.jsx and loading.jsx: nearest one wins, together with the layouts that wrap it", () => {
  const root = makeProject({
    "app/layout.jsx": page, "app/dash/layout.jsx": page, "app/dash/not-found.jsx": page, "app/dash/loading.jsx": page,
    "app/dash/deep/layout.jsx": page, "app/dash/deep/x/page.jsx": page, "app/dash/y/page.jsx": page, "app/other/page.jsx": page,
  });
  const by = Object.fromEntries(scanApp(root).routes.map((r) => [r.path, r]));
  assert.deepEqual(by["/dash/deep/x"].notFound, { file: "app/dash/not-found.jsx", layouts: ["app/layout.jsx", "app/dash/layout.jsx"] }); // scope = where the file lives
  assert.deepEqual(by["/dash/y"].loading, { file: "app/dash/loading.jsx", layouts: ["app/layout.jsx", "app/dash/layout.jsx"] });
  assert.equal(by["/other"].notFound, null); assert.equal(by["/other"].loading, null);
  const withRoot = scanApp(makeProject({ "app/layout.jsx": page, "app/not-found.jsx": page, "app/other/page.jsx": page }));
  assert.deepEqual(withRoot.routes[0].notFound, { file: "app/not-found.jsx", layouts: ["app/layout.jsx"] });
  assert.throws(() => scanApp(makeProject({ "app/a/not-found.jsx": page, "app/a/not-found.tsx": page, "app/a/page.jsx": page })), /Multiple not-found/);
});

// ---------- metadata + config rules ----------
test("metadata: title templates, absolute/default, later segments win; tags are escaped", () => {
  assert.equal(mergeMetadata([{ title: { default: "Site", template: "%s | Site" } }, { title: "Blog" }, { title: "Post" }]).title, "Post | Site");
  assert.equal(mergeMetadata([{ title: { default: "Site", template: "%s | Site" } }]).title, "Site");     // a layout's template does not apply to itself
  assert.equal(mergeMetadata([{ title: { template: "%s | Site" } }, { title: { absolute: "Exactly" } }]).title, "Exactly");
  assert.equal(mergeMetadata([{ title: "A", description: "d1" }, { description: "d2" }]).description, "d2");
  assert.equal(mergeMetadata([undefined, null, {}]).title, undefined);
  const tags = metadataToTags({ description: 'say "hi"', keywords: ["a", "b"], robots: { index: false }, alternates: { canonical: "/x" }, openGraph: { title: "T", siteName: "S", images: [{ url: "/i.png", width: 10 }] }, twitter: { card: "summary" } });
  const html = tagsToHtml(tags);
  assert.match(html, /<meta name="description" content="say &quot;hi&quot;" data-nepx>/);
  assert.match(html, /name="keywords" content="a, b"/); assert.match(html, /name="robots" content="noindex, follow"/);
  assert.match(html, /<link rel="canonical" href="\/x" data-nepx>/); assert.match(html, /property="og:title" content="T"/); assert.match(html, /property="og:site_name" content="S"/);
  assert.match(html, /property="og:image:width" content="10"/); assert.match(html, /name="twitter:card" content="summary"/);
});
test("config rules: patterns, params, query string, validation", async () => {
  const m = compilePattern("/old/:slug");
  assert.deepEqual(m("/old/a"), { slug: "a" }); assert.equal(m("/old/a/b"), null); assert.equal(m("/old"), null);
  assert.deepEqual(compilePattern("/docs/:p*")("/docs"), { p: "" }); assert.deepEqual(compilePattern("/docs/:p*")("/docs/a/b"), { p: "a/b" });
  assert.equal(compilePattern("/f/:p+")("/f"), null); assert.deepEqual(compilePattern("/f/:p+")("/f/x/y"), { p: "x/y" });
  const { redirects, headers } = await compileRules({ redirects: async () => [{ source: "/a/:id", destination: "/b/:id", permanent: true }, { source: "/q", destination: "/r?x=1" }], headers: [{ source: "/:path*", headers: [{ key: "X-A", value: "1" }] }] });
  assert.equal(redirects[0].resolve("/a/5", "?k=v"), "/b/5?k=v"); assert.equal(redirects[0].status, 308);
  assert.equal(redirects[1].resolve("/q", "?k=v"), "/r?x=1"); assert.equal(redirects[1].status, 307);   // destination query wins
  assert.equal(redirects[0].resolve("/zzz", ""), null);
  const star = (await compileRules({ redirects: [{ source: "/old/:p*", destination: "/new/:p*" }] })).redirects[0];
  assert.equal(star.resolve("/old", ""), "/new"); assert.equal(star.resolve("/old/a/b", "?x=1"), "/new/a/b?x=1"); // empty ":p*" leaves no literal ":p*" or trailing slash
  assert.deepEqual(headers[0].headers, [["x-a", "1"]]); assert.ok(headers[0].match("/any/where"));
  await assert.rejects(compileRules({ redirects: [{ source: "x", destination: "/y" }] }), /starting with "\/"/);
  await assert.rejects(compileRules({ redirects: [{ source: "/x", destination: "/y", statusCode: 200 }] }), /statusCode/);
  await assert.rejects(compileRules({ headers: [{ source: "/x", headers: [{ key: "a" }] }] }), /"key" and "value"/);
  await assert.rejects(compileRules({ redirects: "nope" }), /must be an array/);
});

// ---------- production server: the whole feature set ----------
function featureApp() {
  const app = scaffold();
  write(app, "nepx.config.js", `export default {
  redirects: () => [
    { source: "/legacy/:slug", destination: "/blog/:slug", permanent: true },
    { source: "/docs-old/:path*", destination: "/docs/:path*" },
  ],
  headers: async () => [{ source: "/:path*", headers: [{ key: "X-Frame-Options", value: "DENY" }] }],
};`);
  write(app, "app/layout.jsx", `import "./globals.css";
import Navbar from "@/components/Navbar";
export const metadata = { title: { default: "Site", template: "%s | Site" }, description: "root desc" };
export default function RootLayout({ children }) { return <div className="container"><Navbar />{children}</div>; }`);
  write(app, "app/blog/[slug]/page.jsx", `import { notFound } from "nepx";
export async function getServerSideProps({ params }) { if (params.slug === "missing") notFound(); return { props: { slug: params.slug } }; }
export async function generateMetadata({ params, props }) { return { title: "Post " + params.slug, openGraph: { title: "OG " + props.slug }, robots: { index: false } }; }
export default function Post({ slug }) { return <main><h1>post {slug}</h1></main>; }`);
  write(app, "app/docs/[[...path]]/page.jsx", `import { useParams } from "nepx";
export async function generateStaticParams() { return [{}, { path: ["a", "b"] }]; }
function Depth() { const p = useParams(); return <i>depth {(p.path || []).length}</i>; }
export default function Docs({ params }) { return <main><h1>docs {(params.path || []).join("/") || "root"}</h1><Depth /></main>; }`);
  write(app, "app/shop/layout.jsx", `export default function Shop({ children }) { return <div id="shop">{children}</div>; }`);
  write(app, "app/shop/not-found.jsx", `export default function SNF() { return <h1>Shop 404</h1>; }`);
  write(app, "app/shop/[id]/page.jsx", `import { notFound } from "nepx";
export default function Item({ params }) { if (params.id === "0") notFound(); return <h1>item {params.id}</h1>; }`);
  write(app, "app/gone/page.jsx", `import { notFound } from "nepx";
export async function generateMetadata() { notFound(); }
export default function G() { return <h1>never</h1>; }`);
  return app;
}

test("production: generateMetadata + title template, notFound(), nested not-found, [[...x]], useParams, config redirects/headers, hashed assets, compression", async () => {
  const app = featureApp();
  const b = nepx(app, "build"); assert.equal(b.status, 0, b.stderr);
  const st = listFiles(path.join(app, ".nepx/static"));
  assert.ok(st.includes("docs/index.html") && st.includes("docs/a/b/index.html"), st.join()); // generateStaticParams for [[...path]]: {} and {path:[a,b]}
  assert.ok(!st.some((f) => f.startsWith("blog") || f.startsWith("shop")));
  const jsName = listFiles(path.join(app, ".nepx/client")).find((f) => /^client\.[0-9a-f]{8}\.js$/.test(f));

  const s = startNepx(app, ["start", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1], base = `http://localhost:${port}`;
    // metadata
    let html = await (await fetch(base + "/blog/hello")).text();
    assert.match(html, /<title>Post hello \| Site<\/title>/);
    assert.match(html, /<meta property="og:title" content="OG hello" data-nepx>/); assert.match(html, /name="robots" content="noindex, follow"/);
    assert.match(html, /name="description" content="root desc"/);
    assert.match(await (await fetch(base + "/")).text(), /<title>Site<\/title>/);                  // layout default
    assert.match(await (await fetch(base + "/about")).text(), /<title>About \| Nepx App \| Site<\/title>/); // the layout template wraps page titles
    const d = await (await fetch(base + "/_nepx/data?path=/blog/hello")).json();
    assert.deepEqual(d.props, { slug: "hello" }); assert.equal(d.metadata.title, "Post hello | Site"); assert.deepEqual(d.metadata.openGraph, { title: "OG hello" });
    // notFound() from getServerSideProps / from a component / from generateMetadata
    let r = await fetch(base + "/blog/missing"); assert.equal(r.status, 404); assert.match(await r.text(), /404 - Page not found/);
    assert.deepEqual((await (await fetch(base + "/_nepx/data?path=/blog/missing")).json()).notFound, true);
    r = await fetch(base + "/shop/0"); html = await r.text();
    assert.equal(r.status, 404); assert.match(html, /<div id="shop"><h1>Shop 404<\/h1><\/div>/);   // nested not-found, inside its own layouts
    assert.ok(!html.includes("404 - Page not found"));
    r = await fetch(base + "/shop/1"); assert.equal(r.status, 200); assert.match(await r.text(), /item <!-- -->1/);
    r = await fetch(base + "/gone"); assert.equal(r.status, 404);
    // optional catch-all + useParams (prerendered and SSR fallback)
    assert.match(await (await fetch(base + "/docs")).text(), /docs <!-- -->root.*depth <!-- -->0/);
    assert.match(await (await fetch(base + "/docs/a/b")).text(), /docs <!-- -->a\/b.*depth <!-- -->2/);
    assert.match(await (await fetch(base + "/docs/zz/yy/xx")).text(), /docs <!-- -->zz\/yy\/xx.*depth <!-- -->3/);
    // config redirects keep the query string; headers apply everywhere
    r = await fetch(base + "/legacy/foo?x=1", { redirect: "manual" }); assert.equal(r.status, 308); assert.equal(r.headers.get("location"), "/blog/foo?x=1");
    r = await fetch(base + "/docs-old/p/q", { redirect: "manual" }); assert.equal(r.status, 307); assert.equal(r.headers.get("location"), "/docs/p/q");
    r = await fetch(base + "/docs-old", { redirect: "manual" }); assert.equal(r.headers.get("location"), "/docs");
    for (const p of ["/", "/api/hello", "/robots.txt", "/_nepx/" + jsName, "/nope"]) assert.equal((await fetch(base + p)).headers.get("x-frame-options"), "DENY", p);
    // hashed bundle: immutable + compressed; plain clients get plain bytes
    const plain = readFileSync(path.join(app, ".nepx/client", jsName));
    const br = await rawGet(port, "/_nepx/" + jsName, { "accept-encoding": "br, gzip" });
    assert.equal(br.headers["content-encoding"], "br"); assert.match(br.headers["cache-control"], /immutable/); assert.match(br.headers.vary, /Accept-Encoding/i);
    assert.ok(br.body.length < plain.length / 2); assert.deepEqual(zlib.brotliDecompressSync(br.body), plain);
    const gz = await rawGet(port, "/_nepx/" + jsName, { "accept-encoding": "gzip" });
    assert.equal(gz.headers["content-encoding"], "gzip"); assert.deepEqual(zlib.gunzipSync(gz.body), plain);
    const none = await rawGet(port, "/_nepx/" + jsName, {}); assert.equal(none.headers["content-encoding"], undefined); assert.deepEqual(none.body, plain);
    const q0 = await rawGet(port, "/_nepx/" + jsName, { "accept-encoding": "gzip;q=0, br;q=0" }); assert.equal(q0.headers["content-encoding"], undefined);
    const apiRes = await rawGet(port, "/api/hello", { "accept-encoding": "gzip" }); assert.equal(apiRes.headers["content-encoding"], undefined); // tiny bodies stay uncompressed
  } finally { s.stop(); }
});

test("config errors are reported clearly and compress:false disables compression", async () => {
  const app = scaffold();
  write(app, "nepx.config.js", `export default { redirects: [{ source: "nope", destination: "/x" }] };`);
  assert.match(nepx(app, "start").stderr + nepx(app, "build").stderr, /starting with "\/"|nepx\.config/);
  write(app, "nepx.config.js", `export default { compress: false };`);
  assert.equal(nepx(app, "build").status, 0);
  const jsName = listFiles(path.join(app, ".nepx/client")).find((f) => /\.js$/.test(f));
  const s = startNepx(app, ["start", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1];
    const r = await rawGet(port, "/_nepx/" + jsName, { "accept-encoding": "br" });
    assert.equal(r.headers["content-encoding"], undefined);
  } finally { s.stop(); }
});

// ---------- real browser ----------
let chromium = null;
try { chromium = createRequire(path.join(GLOBAL_MODULES, "playwright", "package.json"))("playwright").chromium; } catch { /* skip */ }

test("browser: loading.jsx during navigation, client-side notFound(), nested not-found, <head> metadata sync, useParams", { skip: !chromium && "playwright not available" }, async () => {
  const app = featureApp();
  write(app, "components/Navbar.jsx", `import { Link } from "nepx";
export default function Navbar(){ return <nav><Link href="/">Home</Link><Link href="/about">About</Link><Link href="/blog/hello">Post</Link><Link href="/blog/missing">Missing</Link><Link href="/shop/0">Shop0</Link><Link href="/shop/1">Shop1</Link><Link href="/slow/1">Slow</Link><Link href="/docs/a/b">Docs</Link></nav>; }`);
  write(app, "app/slow/layout.jsx", `export default function L({ children }){ return <section id="slow-layout">{children}</section>; }`);
  write(app, "app/slow/loading.jsx", `export default function Loading(){ return <p id="loading">Loading...</p>; }`);
  write(app, "app/slow/[id]/page.jsx", `export async function getServerSideProps({ params }){ await new Promise((r) => setTimeout(r, 600)); return { props: { id: params.id } }; }
export default function S({ id }){ return <h1>slow {id}</h1>; }`);
  const s = startNepx(app, ["dev", "--port", "0"]);
  let browser;
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1], base = `http://localhost:${port}`;
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let tolerate404 = false;
    page.on("console", (m) => { if (m.type() === "error" && !(tolerate404 && /status of 404/.test(m.text()))) errors.push(m.text()); });

    await page.goto(base + "/");
    await page.evaluate(() => { window.__marker = 1; });
    // loading.jsx shows inside the kept layouts, then the real page replaces it
    await page.click('nav a[href="/slow/1"]');
    await page.waitForSelector("#slow-layout #loading", { timeout: 3000 });
    assert.ok(await page.$("nav"));                                                      // root layout stays mounted
    await page.waitForSelector("h1:text('slow 1')"); assert.equal(await page.$("#loading"), null);
    // metadata: title template, og tags added then removed on the next navigation
    await page.click('nav a[href="/blog/hello"]'); await page.waitForSelector("h1:text('post hello')");
    assert.equal(await page.title(), "Post hello | Site");
    assert.equal(await page.getAttribute('meta[property="og:title"]', "content"), "OG hello");
    assert.equal(await page.getAttribute('meta[name="description"]', "content"), "root desc");
    await page.click('nav a[href="/about"]'); await page.waitForSelector("h1:text('About')");
    assert.equal(await page.title(), "About | Nepx App | Site"); assert.equal(await page.$('meta[property="og:title"]'), null);
    // notFound() from getServerSideProps -> root not-found, status via data endpoint
    tolerate404 = true;
    await page.click('nav a[href="/blog/missing"]'); await page.waitForSelector("h1:text('404 - Page not found')");
    // notFound() thrown while rendering in the browser -> nested not-found inside /shop layouts
    await page.click('nav a[href="/shop/0"]'); await page.waitForSelector("#shop h1:text('Shop 404')");
    tolerate404 = false;
    await page.click('nav a[href="/shop/1"]'); await page.waitForSelector("#shop h1:text('item 1')");     // recovers after the boundary
    assert.equal(await page.$("#shop h1:text('Shop 404')"), null);
    await page.click('nav a[href="/docs/a/b"]'); await page.waitForSelector("h1:text('docs a/b')");
    assert.equal(await page.textContent("main i"), "depth 2");                                              // useParams in the browser
    assert.equal(await page.evaluate(() => window.__marker), 1, "all of this happened without a full page load");
    // direct hit on a nested not-found hydrates cleanly
    tolerate404 = true; await page.goto(base + "/shop/0"); tolerate404 = false;
    assert.equal(await page.textContent("#shop h1"), "Shop 404");
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); s.stop(); }
});
