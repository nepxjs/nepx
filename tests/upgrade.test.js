// Tests for the v0.3 feature set: nested error.jsx, cookies()/headers(), rewrites, middleware rewrite()/next(),
// ISR (revalidate + revalidatePath), sitemap/robots/manifest, CSS Modules, asset imports, prefetch, router.refresh().
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeProject, startNepx, nepx, scaffold, GLOBAL_MODULES } from "./helpers.js";
import { scanApp, inspectRoutes } from "../src/router.js";
import { cssModule } from "../src/cssmodules.js";
import { assetUrl } from "../src/assets.js";
import { formatSitemap, formatRobots } from "../src/metaroutes.js";
import { IsrCache, revalidatePath } from "../src/isr.js";
import { compileRules } from "../src/rules.js";
import { rewrite, next, isDynamicError } from "../src/shared.js";
import { cookies } from "../src/request-context.js";

const page = "export default function P(){ return null; }";
const write = (app, rel, content) => { mkdirSync(path.dirname(path.join(app, rel)), { recursive: true }); writeFileSync(path.join(app, rel), content); };
const get = (port, p, headers = {}) => new Promise((res, rej) => http.get({ host: "localhost", port, path: p, headers }, (r) => {
  const chunks = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => res({ status: r.statusCode, headers: r.headers, text: Buffer.concat(chunks).toString("utf8"), body: Buffer.concat(chunks) }));
}).on("error", rej));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- units ----------
test("nested error.jsx: the nearest one wins, together with the layouts above it", () => {
  const root = makeProject({
    "app/layout.jsx": page, "app/error.jsx": page, "app/dash/layout.jsx": page, "app/dash/error.jsx": page,
    "app/dash/a/page.jsx": page, "app/other/page.jsx": page,
  });
  const by = Object.fromEntries(scanApp(root).routes.map((r) => [r.path, r]));
  assert.deepEqual(by["/dash/a"].errorScope, { file: "app/dash/error.jsx", layouts: ["app/layout.jsx", "app/dash/layout.jsx"] });
  assert.deepEqual(by["/other"].errorScope, { file: "app/error.jsx", layouts: ["app/layout.jsx"] });
  assert.throws(() => scanApp(makeProject({ "app/x/error.jsx": page, "app/x/error.tsx": page, "app/x/page.jsx": page })), /Multiple error files/);
});

test("metadata routes: sitemap/robots/manifest become routes; formats are correct and escaped", async () => {
  const root = makeProject({ "app/page.jsx": page, "app/sitemap.js": "export default () => [];", "app/robots.js": "export default () => ({});", "app/manifest.js": "export default () => ({});" });
  const paths = scanApp(root).routes.map((r) => r.path).sort();
  assert.deepEqual(paths, ["/", "/manifest.webmanifest", "/robots.txt", "/sitemap.xml"]);
  assert.throws(() => scanApp(makeProject({ "app/sitemap.js": "export default () => [];", "app/sitemap.xml/route.js": "export function GET(){}" })), /Route conflict/);
  const xml = formatSitemap([{ url: "https://x.dev/a?b=1&c=2", lastModified: new Date("2026-01-02T03:04:05Z"), changeFrequency: "weekly", priority: 0.8 }]);
  assert.match(xml, /<loc>https:\/\/x\.dev\/a\?b=1&amp;c=2<\/loc><lastmod>2026-01-02T03:04:05\.000Z<\/lastmod><changefreq>weekly<\/changefreq><priority>0\.8<\/priority>/);
  assert.throws(() => formatSitemap([{ nope: 1 }]), /"url" must be a string/);
  assert.equal(formatRobots({ rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/tmp"] }], sitemap: "https://x.dev/sitemap.xml" }),
    "User-Agent: *\nAllow: /\nDisallow: /admin\nDisallow: /tmp\n\nSitemap: https://x.dev/sitemap.xml\n");
  const info = await inspectRoutes(root, scanApp(root));
  assert.ok(info.routes.every((r) => !r.error), JSON.stringify(info.routes.map((r) => r.error)));
});

test("revalidate: validated at inspect time (positive number, not together with getServerSideProps)", async () => {
  const root = makeProject({
    "app/ok/page.jsx": "export const revalidate = 60; export default function P(){ return null; }",
    "app/neg/page.jsx": "export const revalidate = -5; export default function P(){ return null; }",
    "app/both/page.jsx": "export const revalidate = 5; export async function getServerSideProps(){ return { props: {} }; } export default function P(){ return null; }",
  });
  const info = await inspectRoutes(root, scanApp(root));
  const by = Object.fromEntries(info.routes.map((r) => [r.path, r]));
  assert.equal(by["/ok"].revalidate, 60); assert.equal(by["/ok"].error, null);
  assert.match(by["/neg"].error, /revalidate must be a positive number/);
  assert.match(by["/both"].error, /cannot export both revalidate and getServerSideProps/);
});

test("CSS Modules: scoped names are stable, :global and strings/urls/numbers are left alone", () => {
  const src = `/* .commented */ .title { color: red; margin: 1.5em; background: url("a.b.png"); } .box .inner:hover { x: y } :global(.keep) .a-b { content: ".nope" }`;
  const a = cssModule(src, "app/x.module.css"), b = cssModule(src, "app/x.module.css"), c = cssModule(src, "app/other/x.module.css");
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a.map).sort(), ["a-b", "box", "inner", "title"]);
  assert.notEqual(a.map.title, c.map.title); // same file name in another folder -> different class
  assert.match(a.map.title, /^x_title_[0-9a-f]{6}$/);
  assert.ok(a.css.includes(".keep ") && !a.css.includes(".keep_") && a.css.includes("1.5em") && a.css.includes('"a.b.png"') && a.css.includes('".nope"') && a.css.includes("/* .commented */"));
  assert.ok(a.css.includes(`.${a.map.title} {`) && a.css.includes(`.${a.map.box} .${a.map.inner}:hover`));
});

test("asset urls are content-hashed", () => {
  const u = assetUrl("/p/My Logo.PNG", Buffer.from("abc"));
  assert.match(u, /^\/_nepx\/m-My-Logo\.[0-9a-f]{8}\.png$/);
  assert.notEqual(u, assetUrl("/p/My Logo.PNG", Buffer.from("abd")));
});

test("ISR cache: fresh/stale lookup, in-flight dedupe, revalidatePath (page and layout)", async () => {
  const c = new IsrCache();
  assert.equal(c.lookup("/a", 10), null);
  c.set("/a", { html: "x", at: 1000 }); c.set("/blog/1", { html: "y", at: 1000 }); c.set("/blog", { html: "z", at: 1000 });
  assert.equal(c.lookup("/a", 10, 5000).stale, false);
  assert.equal(c.lookup("/a", 10, 12000).stale, true);
  let runs = 0;
  const [p1, p2] = [c.refresh("/a", async () => { runs++; await sleep(20); return 1; }), c.refresh("/a", async () => { runs++; return 2; })];
  assert.equal(p1, p2); await p1; assert.equal(runs, 1);
  revalidatePath("/a"); assert.equal(c.get("/a"), undefined); assert.ok(c.get("/blog/1"));
  revalidatePath("/blog", "layout"); assert.equal(c.get("/blog/1"), undefined); assert.equal(c.get("/blog"), undefined);
  assert.throws(() => revalidatePath("nope"), /must be a string starting with/);
  assert.throws(() => revalidatePath("/a", "x"), /type must be/);
  c.close();
});

test("rewrites config + middleware helpers", async () => {
  const rules = await compileRules({ rewrites: [{ source: "/shop/:id", destination: "/products/:id" }, { source: "/docs/:rest*", destination: "/wiki/:rest*?x=1" }] });
  assert.equal(rules.rewrites[0].resolve("/shop/7", "?a=1"), "/products/7?a=1");
  assert.equal(rules.rewrites[1].resolve("/docs/a/b", ""), "/wiki/a/b?x=1");
  assert.equal(rules.rewrites[0].resolve("/other", ""), null);
  await assert.rejects(compileRules({ rewrites: [{ source: "/a", destination: "//evil.example/x" }] }), /destination must be a path/);
  await assert.rejects(compileRules({ rewrites: [{ source: "/a", destination: "https://user@evil.example/x" }] }), /external destination/);
  await assert.rejects(compileRules({ rewrites: [{ source: "/a/:h", destination: "https://:h.example/x" }] }), /external destination/);
  await assert.doesNotReject(compileRules({ rewrites: [{ source: "/api/:p*", destination: "https://api.example.com/v1/:p*" }] }));
  assert.equal(rewrite("/x").headers.get("x-nepx-rewrite"), "/x");
  assert.throws(() => rewrite("//evil.example"), /destination must be a path/);
  assert.equal(next({ headers: { "x-a": "1" } }).headers.get("x-a"), "1");
  assert.throws(() => cookies(), (e) => isDynamicError(e));
});

// ---------- servers ----------
test("production: sitemap/robots/manifest, rewrites, middleware rewrite()/next(), cookies()/headers(), hashed assets, CSS modules", async () => {
  const app = scaffold();
  write(app, "app/sitemap.js", `export default async function sitemap(){ return [{ url: "https://x.dev/", priority: 1 }]; }`);
  write(app, "app/robots.js", `export default () => ({ rules: { userAgent: "*", disallow: "/admin" }, sitemap: "https://x.dev/sitemap.xml" });`);
  write(app, "app/manifest.js", `export default () => ({ name: "My App", start_url: "/" });`);
  write(app, "app/products/[id]/page.jsx", `export default function P({ params }){ return <main><h1>product {params.id}</h1></main>; }`);
  write(app, "app/me/page.jsx", `import { cookies, headers } from "nepx";
export default function Me(){ const c = cookies().get("user"); const ua = headers().get("user-agent"); return <main><h1>hi {c ? c.value : "anonymous"}</h1><p>{ua ? "has-ua" : "no-ua"}</p></main>; }`);
  write(app, "app/api/gone/route.js", `import { notFound } from "nepx"; export function GET(){ notFound(); }`);
  write(app, "app/styled/page.jsx", `import styles from "./styled.module.css";
import logo from "../../assets/logo.svg";
export default function S(){ return <main><h1 className={styles.title}>styled</h1><img id="logo" src={logo} alt="logo" width="10" height="10" /></main>; }`);
  write(app, "app/styled/styled.module.css", `.title { color: rgb(1, 2, 3); background: url(../../assets/bg.svg); }`);
  write(app, "assets/logo.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>`);
  write(app, "assets/bg.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>`);
  write(app, "middleware.js", `import { rewrite, next } from "nepx";
export const config = { matcher: ["/mw/:path*"] };
export default function middleware(request, { url }) {
  if (url.pathname === "/mw/inside") return rewrite("/about");
  return next({ headers: { "x-from-middleware": "yes" } });
}`);
  write(app, "app/mw/other/page.jsx", `export default function O(){ return <main><h1>other</h1></main>; }`);
  write(app, "nepx.config.js", `export default { rewrites: [{ source: "/shop/:id", destination: "/products/:id" }] };`);
  const b = nepx(app, "build"); assert.equal(b.status, 0, b.stderr + b.stdout);
  const statics = readdirSync(path.join(app, ".nepx/static"), { recursive: true }).map(String);
  assert.ok(!statics.some((f) => f.startsWith("me")), "pages using cookies()/headers() are not prerendered: " + statics.join());
  assert.ok(statics.includes("styled/index.html"));
  const cdir = path.join(app, ".nepx/client");
  const clientFiles = readdirSync(cdir);
  const cssFile = clientFiles.find((f) => /^client\.[0-9a-f]{8}\.css$/.test(f));
  const css = readFileSync(path.join(cdir, cssFile), "utf8");
  const mediaFiles = clientFiles.filter((f) => /^m-/.test(f));
  assert.ok(mediaFiles.some((f) => /^m-logo\.[0-9a-f]{8}\.svg$/.test(f)), mediaFiles.join());
  assert.ok(/url\("?\/_nepx\/m-bg\.\w{8}\.svg"?\)/.test(css), "css url() assets are emitted with hashed names: " + css.slice(0, 300));

  const s = startNepx(app, ["start", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1];
    let r = await get(port, "/sitemap.xml");
    assert.equal(r.status, 200); assert.match(r.headers["content-type"], /application\/xml/); assert.match(r.text, /<loc>https:\/\/x\.dev\/<\/loc><priority>1<\/priority>/);
    r = await get(port, "/robots.txt"); assert.match(r.headers["content-type"], /text\/plain/); assert.match(r.text, /Disallow: \/admin\n\nSitemap:/);
    r = await get(port, "/manifest.webmanifest"); assert.deepEqual(JSON.parse(r.text), { name: "My App", start_url: "/" });
    assert.equal((await get(port, "/sitemap.xml")).status, 200);
    assert.equal((await new Promise((res) => { const q = http.request({ host: "localhost", port, path: "/sitemap.xml", method: "POST" }, (x) => { x.resume(); res(x.statusCode); }); q.end(); })), 405);

    // config rewrite: the URL stays /shop/7, the content comes from /products/7
    r = await get(port, "/shop/7"); assert.equal(r.status, 200); assert.match(r.text, /product <!-- -->7/); assert.match(r.text, /"resolved":"\/products\/7"/);
    r = await get(port, "/_nepx/data?path=" + encodeURIComponent("/shop/9")); assert.equal(JSON.parse(r.text).resolved, "/products/9");
    // middleware rewrite + next()
    r = await get(port, "/mw/inside"); assert.equal(r.status, 200); assert.match(r.text, /<h1>About<\/h1>/);
    r = await get(port, "/mw/other"); assert.match(r.text, /<h1>other<\/h1>/); assert.equal(r.headers["x-from-middleware"], "yes");

    // cookies()/headers() in a page
    r = await get(port, "/me"); assert.match(r.text, /hi <!-- -->anonymous/); assert.match(r.text, /no-ua/);
    r = await get(port, "/me", { cookie: "user=Ada%20L", "user-agent": "t" }); assert.match(r.text, /hi <!-- -->Ada L/); assert.match(r.text, /has-ua/);
    // notFound() in a route handler
    r = await get(port, "/api/gone"); assert.equal(r.status, 404);

    // CSS modules: SSR class name == class in the css file; hashed immutable assets
    r = await get(port, "/styled");
    const cls = /<h1 class="([^"]+)">styled/.exec(r.text)[1];
    assert.match(cls, /^styled_title_[0-9a-f]{6}$/); assert.ok(css.includes("." + cls), "client css defines " + cls);
    const logo = /id="logo"[^>]*src="([^"]+)"|src="([^"]+)"[^>]*id="logo"/.exec(r.text); const logoUrl = logo[1] || logo[2];
    const lr = await get(port, logoUrl);
    assert.equal(lr.status, 200); assert.match(lr.headers["content-type"], /image\/svg\+xml/); assert.match(lr.headers["cache-control"], /immutable/);
    const bgUrl = /url\("?(\/_nepx\/m-bg\.\w{8}\.svg)"?\)/.exec(css)[1];
    assert.equal((await get(port, bgUrl)).status, 200);
  } finally { s.stop(); }
});

test("dev: ISR serves MISS -> HIT -> STALE (background refresh) and revalidatePath; requests are logged", async () => {
  const app = scaffold();
  write(app, "app/isr/page.jsx", `let n = 0;
export const revalidate = 1;
export default function I(){ n++; return <main><h1>render {n}</h1></main>; }`);
  write(app, "app/api/revalidate/route.js", `import { revalidatePath } from "nepx"; export async function POST(){ revalidatePath("/isr"); return Response.json({ ok: true }); }`);
  const s = startNepx(app, ["dev", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1];
    let r = await get(port, "/isr?x=1"); assert.equal(r.headers["x-nepx-cache"], "MISS"); assert.match(r.text, /render <!-- -->1/);
    assert.match(r.headers["cache-control"], /s-maxage=1/);
    r = await get(port, "/isr"); assert.equal(r.headers["x-nepx-cache"], "HIT"); assert.match(r.text, /render <!-- -->1/);
    await sleep(1200);
    r = await get(port, "/isr"); assert.equal(r.headers["x-nepx-cache"], "STALE"); assert.match(r.text, /render <!-- -->1/); // old copy is served while it refreshes
    await sleep(300);
    r = await get(port, "/isr"); assert.equal(r.headers["x-nepx-cache"], "HIT"); assert.match(r.text, /render <!-- -->2/);
    const post = await new Promise((res) => { const q = http.request({ host: "localhost", port, path: "/api/revalidate", method: "POST" }, (x) => { x.resume(); x.on("end", () => res(x.statusCode)); }); q.end(); });
    assert.equal(post, 200);
    r = await get(port, "/isr"); assert.equal(r.headers["x-nepx-cache"], "MISS"); assert.match(r.text, /render <!-- -->3/);
    assert.match(s.output(), /GET \/isr 200 \d+ms/);
    assert.ok(!/GET \/_nepx\//.test(s.output()));
  } finally { s.stop(); }
});

test("nested error.jsx: server render failure uses the nearest error page inside its layouts (500)", async () => {
  const app = scaffold();
  write(app, "app/dash/layout.jsx", `export default function D({ children }){ return <section id="dash"><aside>side</aside>{children}</section>; }`);
  write(app, "app/dash/error.jsx", `export default function E({ error }){ return <div id="dash-error">dash failed: {error.message}</div>; }`);
  write(app, "app/dash/page.jsx", `export async function getServerSideProps(){ throw new Error("kaboom"); } export default function P(){ return null; }`);
  write(app, "app/solo/page.jsx", `export async function getServerSideProps(){ throw new Error("kaboom2"); } export default function P(){ return null; }`);
  assert.equal(nepx(app, "build").status, 0);
  const s = startNepx(app, ["start", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1];
    let r = await get(port, "/dash");
    assert.equal(r.status, 500); assert.match(r.text, /<section id="dash"><aside>side<\/aside><div id="dash-error">dash failed: <!-- -->Internal Server Error<\/div><\/section>/);
    assert.ok(!r.text.includes("kaboom"));
    r = await get(port, "/solo"); assert.equal(r.status, 500); assert.match(r.text, /Something went wrong/); // root error.jsx
  } finally { s.stop(); }
});

// ---- real browser ----
let chromium = null;
try { chromium = createRequire(path.join(GLOBAL_MODULES, "playwright", "package.json"))("playwright").chromium; } catch { /* skip */ }

test("browser: error.jsx catches client render errors, keeps layouts mounted, reset() recovers", { skip: !chromium && "playwright not available" }, async () => {
  const app = scaffold();
  write(app, "app/dash/layout.jsx", `import { useState } from "react";
export default function D({ children }){ const [n, setN] = useState(0); return <section id="dash"><button id="count" onClick={() => setN(n + 1)}>count {n}</button>{children}</section>; }`);
  write(app, "app/dash/error.jsx", `export default function E({ error, reset }){ return <div id="dash-error"><p>failed: {error.message}</p><button id="retry" onClick={reset}>retry</button></div>; }`);
  write(app, "app/dash/page.jsx", `import { useState } from "react";
function Bomb(){ throw new Error("render bomb"); }
export default function P(){ const [show, setShow] = useState(false); return <main><button id="arm" onClick={() => setShow(true)}>arm</button>{show && <Bomb />}</main>; }
`);
  write(app, "app/dash/other/page.jsx", `export default function O(){ return <h2 id="other">other</h2>; }`);
  write(app, "components/Navbar.jsx", `import { Link } from "nepx"; export default function N(){ return <nav><Link href="/dash">Dash</Link><Link href="/dash/other">Other</Link><Link href="/about">About</Link></nav>; }`);
  const s = startNepx(app, ["dev", "--port", "0"]);
  let browser;
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1], base = `http://localhost:${port}`;
    browser = await chromium.launch();
    const page = await browser.newPage();
    const expected = [];
    page.on("console", (m) => { if (m.type() === "error") expected.push(m.text()); });
    await page.goto(base + "/dash");
    await page.click("#count"); await page.click("#count");
    await page.click("#arm");
    await page.waitForSelector("#dash-error");
    assert.match(await page.textContent("#dash-error p"), /render bomb/);
    assert.equal(await page.textContent("#count"), "count 2", "the layout above error.jsx stays mounted with its state");
    assert.ok(await page.$("nav"), "root layout still there");
    await page.click('nav a[href="/dash/other"]'); await page.waitForSelector("#other");  // navigating away clears the error
    assert.equal(await page.textContent("#count"), "count 2", "layout state survives client navigation");
    await page.click('nav a[href="/dash"]'); await page.waitForSelector("#arm");
    await page.click("#arm"); await page.waitForSelector("#dash-error");
    await page.click("#retry"); await page.waitForSelector("#arm");           // reset() re-renders the segment from scratch
    assert.equal(await page.$("#dash-error"), null);
    assert.equal(await page.textContent("#count"), "count 2");
    await page.click("#arm"); await page.waitForSelector("#dash-error");     // and the boundary catches again
  } finally { await browser?.close(); s.stop(); }
});

test("browser: Link prefetch (hover) is used once; GSSP pages are not prefetched unless asked; router.refresh() re-fetches without reload", { skip: !chromium && "playwright not available" }, async () => {
  const app = scaffold();
  write(app, "app/stamp/page.jsx", `let n = 0;
export async function getServerSideProps(){ n++; return { props: { n } }; }
export default function S({ n }){ return <main><h1 id="stamp">stamp {n}</h1></main>; }`);
  write(app, "components/Navbar.jsx", `import { Link, useRouter } from "nepx";
export default function N(){ const r = useRouter(); return <nav><Link href="/about">About</Link><Link href="/stamp">Stamp</Link><Link href="/users/1" prefetch>User</Link><button id="refresh" onClick={() => r.refresh()}>refresh</button></nav>; }`);
  const s = startNepx(app, ["dev", "--port", "0"]);
  let browser;
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1], base = `http://localhost:${port}`;
    browser = await chromium.launch();
    const page = await browser.newPage();
    const dataCalls = [];
    page.on("request", (r) => { if (r.url().includes("/_nepx/data")) dataCalls.push(decodeURIComponent(r.url().split("path=")[1])); });
    await page.goto(base + "/");
    await page.evaluate(() => { window.__marker = 1; });
    await page.hover('nav a[href="/about"]'); await page.waitForTimeout(300);
    assert.deepEqual(dataCalls, ["/about"], "hover prefetches a page without getServerSideProps");
    await page.click('nav a[href="/about"]'); await page.waitForSelector("h1:text('About')");
    assert.deepEqual(dataCalls, ["/about"], "the click used the prefetched data (no second request)");
    await page.hover('nav a[href="/stamp"]'); await page.waitForTimeout(300);
    assert.deepEqual(dataCalls, ["/about"], "getServerSideProps pages are not prefetched on hover");
    await page.hover('nav a[href="/users/1"]'); await page.waitForTimeout(300);
    assert.deepEqual(dataCalls, ["/about", "/users/1"], "prefetch={true} opts in");
    await page.click('nav a[href="/stamp"]'); await page.waitForSelector("#stamp");
    assert.equal(await page.textContent("#stamp"), "stamp 1");
    await page.click("#refresh"); await page.waitForSelector("#stamp:text('stamp 2')");
    assert.equal(await page.evaluate(() => window.__marker), 1, "refresh did not reload the page");
    assert.equal(new URL(page.url()).pathname, "/stamp");
  } finally { await browser?.close(); s.stop(); }
});

test("browser: rewritten URL renders and navigates the destination route; static prerender is skipped for cookies() pages", { skip: !chromium && "playwright not available" }, async () => {
  const app = scaffold();
  write(app, "app/products/[id]/page.jsx", `export default function P({ params }){ return <main><h1 id="p">product {params.id}</h1></main>; }`);
  write(app, "nepx.config.js", `export default { rewrites: [{ source: "/shop/:id", destination: "/products/:id" }] };`);
  write(app, "components/Navbar.jsx", `import { Link } from "nepx"; export default function N(){ return <nav><Link href="/about">About</Link><Link href="/shop/42">Shop</Link></nav>; }`);
  const s = startNepx(app, ["dev", "--port", "0"]);
  let browser;
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1], base = `http://localhost:${port}`;
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(base + "/shop/7");
    assert.equal(await page.textContent("#p"), "product 7");
    assert.equal(new URL(page.url()).pathname, "/shop/7");
    await page.evaluate(() => { window.__marker = 1; });
    await page.click('nav a[href="/about"]'); await page.waitForSelector("h1:text('About')");
    await page.click('nav a[href="/shop/42"]'); await page.waitForSelector("#p:text('product 42')");
    assert.equal(new URL(page.url()).pathname, "/shop/42");
    assert.equal(await page.evaluate(() => window.__marker), 1);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); s.stop(); }
});

test("browser (production build): visible links are prefetched, hydration is clean, navigation does not reload", { skip: !chromium && "playwright not available" }, async () => {
  const app = scaffold();
  write(app, "app/styled/page.jsx", `import styles from "./s.module.css"; export default function S(){ return <h1 id="s" className={styles.t}>styled</h1>; }`);
  write(app, "app/styled/s.module.css", `.t { color: rgb(0, 128, 0); }`);
  write(app, "components/Navbar.jsx", `import { Link } from "nepx"; export default function N(){ return <nav><Link href="/about">About</Link><Link href="/styled">Styled</Link><Link href="/users/1">User</Link><Link href="/about" prefetch={false} id="nopre">Off</Link></nav>; }`);
  const b = nepx(app, "build"); assert.equal(b.status, 0, b.stderr);
  const s = startNepx(app, ["start", "--port", "0"]);
  let browser;
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1], base = `http://localhost:${port}`;
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [], calls = [];
    page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("request", (r) => { if (r.url().includes("/_nepx/data")) calls.push(decodeURIComponent(r.url().split("path=")[1])); });
    await page.goto(base + "/");
    await page.waitForTimeout(500);
    assert.deepEqual([...new Set(calls)].sort(), ["/about", "/styled"], "visible links to pages without getServerSideProps are prefetched; /users/1 (getServerSideProps) is not");
    await page.evaluate(() => { window.__marker = 1; });
    await page.click('nav a[href="/styled"]'); await page.waitForSelector("#s");
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("s")).color), "rgb(0, 128, 0)");
    await page.click('nav a[href="/users/1"]'); await page.waitForSelector("h1:text('User 1')");
    assert.equal(await page.evaluate(() => window.__marker), 1);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); s.stop(); }
});
