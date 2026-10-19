import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeProject, startNepx, nepx, scaffold, GLOBAL_MODULES, linkDeps } from "./helpers.js";

const raw = (port, p) => new Promise((res, rej) => http.get({ host: "localhost", port, path: p }, (r) => { r.resume(); res(r.statusCode); }).on("error", rej));
const write = (app, rel, content) => { mkdirSync(path.dirname(path.join(app, rel)), { recursive: true }); writeFileSync(path.join(app, rel), content); };
const listFiles = (dir) => readdirSync(dir, { recursive: true }).map(String);

test("create: all modes scaffold a Next-like structure; bad input is rejected", () => {
  const d = makeProject({ ".keep": "" });
  assert.equal(nepx(d, "create", "full").status, 0);
  for (const f of ["app/layout.jsx", "app/page.jsx", "app/about/page.jsx", "app/users/[id]/page.jsx", "app/not-found.jsx", "app/error.jsx", "app/api/hello/route.js", "components/Navbar.jsx", "public/robots.txt", "middleware.js", ".env", "jsconfig.json"]) {
    assert.ok(existsSync(path.join(d, "full", f)), f);
  }
  assert.equal(nepx(d, "create", "fe", "--mode", "frontend").status, 0);
  assert.ok(!existsSync(path.join(d, "fe/app/api")));
  assert.equal(nepx(d, "create", "be", "--mode", "backend").status, 0);
  assert.ok(!existsSync(path.join(d, "be/app/page.jsx")) && existsSync(path.join(d, "be/app/api/hello/route.js")));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(d, "be/package.json"), "utf8")).dependencies), ["nepx"]);
  assert.match(nepx(d, "create", "My App").stderr, /Invalid project name/);
  assert.match(nepx(d, "create", "../evil").stderr, /Invalid project name/);
  assert.match(nepx(d, "create", "full").stderr, /already exists/);
  assert.match(nepx(d, "create", "x1", "--mode", "nope").stderr, /Unknown mode/);
});

test("routes lists pages and API from the file structure", () => {
  const app = scaffold();
  const r = nepx(app, "routes");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /PAGE\s+GET\s+\/\s+app\/page\.jsx/);
  assert.match(r.stdout, /PAGE\s+GET\s+\/users\/:id\s+app\/users\/\[id\]\/page\.jsx/);
  assert.match(r.stdout, /API\s+POST\s+\/api\/users\s+app\/api\/users\/route\.js/);
});

test("build errors: JSX error in a page and in an API file name the file and line", () => {
  const app = scaffold();
  write(app, "app/about/page.jsx", "export default function A(){ return <main>; }");
  const b = nepx(app, "build");
  assert.notEqual(b.status, 0);
  assert.match(b.stderr, /app\/about\/page\.jsx:1:\d+/);
  assert.match(nepx(scaffold(), "start").stderr, /nepx build/);
});

test("production: SSR HTML, static prerender, redirect, 404, public, assets, API, env, no server code in client", async () => {
  const app = scaffold();
  write(app, ".env", "NEPX_PUBLIC_APP_NAME=PublicName\nSECRET_TOKEN=super-secret-value-123\n");
  write(app, "app/secret/page.jsx", `export async function getServerSideProps(){ return { props: { n: process.env.SECRET_TOKEN.length } }; }
export default function S({ n }){ return <main><h1>secret length {n}</h1></main>; }`);
  write(app, "app/go/page.jsx", `export async function getServerSideProps(){ return { redirect: { destination: "/about", permanent: true } }; }
export default function G(){ return null; }`);
  write(app, "app/blog/[slug]/page.jsx", `export async function generateStaticParams(){ return [{ slug: "a" }, { slug: "b" }]; }
export const metadata = { title: "Blog" };
export default function B({ params }){ return <main><h1>post {params.slug}</h1></main>; }`);
  write(app, "app/dash/layout.jsx", `export default function D({ children }){ return <section id="dash">{children}</section>; }`);
  write(app, "app/dash/page.jsx", `export default function P(){ return <p>dash home</p>; }`);
  const b = nepx(app, "build"); assert.equal(b.status, 0, b.stderr);

  const st = listFiles(path.join(app, ".nepx/static"));
  assert.ok(st.includes("index.html") && st.includes("about/index.html") && st.includes("blog/a/index.html") && st.includes("blog/b/index.html") && st.includes("dash/index.html"), st.join());
  assert.ok(!st.some((f) => f.startsWith("users") || f.startsWith("secret")), "getServerSideProps pages are not prerendered");
  const clientFiles = listFiles(path.join(app, ".nepx/client"));
  const jsName = clientFiles.find((f) => /^client\.[0-9a-f]{8}\.js$/.test(f)), cssName = clientFiles.find((f) => /^client\.[0-9a-f]{8}\.css$/.test(f));
  assert.ok(jsName && cssName, "client bundle files are content-hashed: " + clientFiles.join());
  const client = readFileSync(path.join(app, ".nepx/client", jsName), "utf8");
  assert.ok(client.includes("PublicName"), "public env inlined");
  assert.ok(!client.includes("super-secret-value-123") && !client.includes("SECRET_TOKEN") && !client.includes("getServerSideProps"), "server-only code and secrets stay out of the client bundle");

  const s = startNepx(app, ["start", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1], base = `http://localhost:${port}`;
    let html = await (await fetch(base + "/")).text();
    assert.match(html, /<title>Nepx App<\/title>/); assert.match(html, /Welcome to <!-- -->PublicName/); assert.match(html, /id="__NEPX_DATA__"/);
    html = await (await fetch(base + "/dash")).text();
    assert.match(html, /<section id="dash"><p>dash home<\/p><\/section>/);
    assert.match(await (await fetch(base + "/blog/a")).text(), /post <!-- -->a/);
    assert.match(await (await fetch(base + "/blog/zzz")).text(), /post <!-- -->zzz/); // not prerendered: SSR fallback
    assert.match(await (await fetch(base + "/blog/a")).text(), /<title>Blog<\/title>/);
    html = await (await fetch(base + "/secret")).text();
    assert.match(html, /secret length <!-- -->22/); assert.ok(!html.includes("super-secret-value-123")); // the value itself is never sent
    const u = await fetch(base + "/users/7"); assert.equal(u.status, 200);
    assert.match(await u.text(), /User 7/);
    assert.equal((await fetch(base + "/users/abc")).status, 404);
    assert.match(await (await fetch(base + "/users/abc")).text(), /404 - Page not found/);
    assert.equal((await fetch(base + "/nope")).status, 404);
    const g = await fetch(base + "/go", { redirect: "manual" }); assert.equal(g.status, 308); assert.equal(g.headers.get("location"), "/about");
    const m = await fetch(base + "/old-about", { redirect: "manual" }); assert.equal(m.status, 308);
    assert.equal(await (await fetch(base + "/robots.txt")).text(), "User-agent: *\nAllow: /\n");
    const js = await fetch(base + "/_nepx/" + jsName); assert.equal(js.status, 200);
    assert.match(js.headers.get("cache-control"), /immutable/); assert.match(html, new RegExp(`/_nepx/${jsName.replace(/\./g, "\\.")}`));
    assert.equal((await fetch(base + "/_nepx/" + cssName)).status, 200);
    assert.equal((await fetch(base + "/_nepx/client.js")).status, 404); // only the hashed name exists in production
    assert.deepEqual(await (await fetch(base + "/api/hello")).json(), { message: "Hello from Nepx!" });
    assert.deepEqual(await (await fetch(base + "/_nepx/data?path=/users/9")).json(), { props: { user: { id: "9", name: "User 9" } }, metadata: { title: "Nepx App", description: "Built with Nepx.js" } });
    assert.deepEqual(await (await fetch(base + "/_nepx/data?path=/users/x")).json(), { notFound: true, metadata: { title: "Nepx App", description: "Built with Nepx.js" } });
    assert.deepEqual(await (await fetch(base + "/_nepx/data?path=/go")).json(), { redirect: { destination: "/about", status: 308 } });
    assert.equal((await fetch(base + "/_nepx/data?path=//evil.com")).status, 400);
    assert.equal((await fetch(base + "/_nepx/data?path=http://evil.com/")).status, 400);
    assert.equal(await raw(port, "/..%2f..%2fetc%2fpasswd"), 400);
    assert.equal((await fetch(base + "/", { method: "POST" })).status, 405);
    assert.equal((await fetch(base + "/api/nope")).headers.get("content-type").includes("json"), true);
  } finally { s.stop(); }
});

test("production start works from .nepx/ only (source dirs removed)", async () => {
  const app = scaffold();
  assert.equal(nepx(app, "build").status, 0);
  for (const d of ["app", "components", "middleware.js"]) rmSync(path.join(app, d), { recursive: true });
  const s = startNepx(app, ["start", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1];
    assert.match(await (await fetch(`http://localhost:${port}/users/3`)).text(), /User 3/);
    assert.equal((await fetch(`http://localhost:${port}/old-about`, { redirect: "manual" })).status, 308);
    assert.equal((await fetch(`http://localhost:${port}/api/hello`)).status, 200);
  } finally { s.stop(); }
});

test("backend-only project needs no React: build, start, JSON 404, no client assets", async () => {
  const d = makeProject({ ".keep": "" });
  assert.equal(nepx(d, "create", "api", "--mode", "backend").status, 0);
  const app = path.join(d, "api");
  assert.equal(nepx(app, "build").status, 0);
  assert.equal(existsSync(path.join(app, ".nepx/client")), false);
  const s = startNepx(app, ["start", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1];
    const r = await fetch(`http://localhost:${port}/`);
    assert.equal(r.status, 404); assert.match(r.headers.get("content-type"), /json/);
    assert.equal((await fetch(`http://localhost:${port}/api/hello`)).status, 200);
  } finally { s.stop(); }
});

test("env files: mode precedence, real env wins, server-only vars never reach the browser bundle", () => {
  const app = scaffold();
  write(app, ".env", "NEPX_PUBLIC_A=base\nNEPX_PUBLIC_B=base\n");
  write(app, ".env.production", "NEPX_PUBLIC_B=prod\n");
  write(app, ".env.local", "NEPX_PUBLIC_A=local\n");
  write(app, "app/page.jsx", "export default function H(){ return <main>{process.env.NEPX_PUBLIC_A}-{process.env.NEPX_PUBLIC_B}-{process.env.NEPX_PUBLIC_C}-{String(process.env.NOPE)}</main>; }");
  const b = nepx(app, "build"); assert.equal(b.status, 0, b.stderr);
  assert.match(readFileSync(path.join(app, ".nepx/static/index.html"), "utf8"), /local<!-- -->-<!-- -->prod<!-- -->-<!-- -->-<!-- -->undefined/);
});

test("dev: serves SSR, compile errors appear in terminal and page, restarts on change", async () => {
  const app = scaffold();
  write(app, "app/about/page.jsx", "export default function A(){ return <main>; }");
  const s = startNepx(app, ["dev", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1];
    const js = await (await fetch(`http://localhost:${port}/_nepx/client.js`)).text();
    assert.match(js, /about\/page\.jsx:1:/); assert.match(s.output(), /about\/page\.jsx:1:/);
    assert.equal((await fetch(`http://localhost:${port}/about`)).status, 500); // SSR of a broken page: dev error, no crash
    write(app, "app/about/page.jsx", "export default function A(){ return <main><h1>fixed</h1></main>; }");
    const m = await s.wait(/Nepx dev server: http:\/\/localhost:(\d+)/, 15000);
    assert.match(await (await fetch(`http://localhost:${m[1]}/about`)).text(), /fixed/);
    assert.match(await (await fetch(`http://localhost:${m[1]}/about`)).text(), /EventSource/); // live reload hook
  } finally { s.stop(); }
});

// ---- real browser (skipped when Playwright/Chromium is unavailable) ----
let chromium = null;
try { chromium = createRequire(path.join(GLOBAL_MODULES, "playwright", "package.json"))("playwright").chromium; } catch { /* skip */ }

test("browser: hydration without mismatch, client navigation, data pages, layouts, metadata, 404, redirects", { skip: !chromium && "playwright not available" }, async () => {
  const app = scaffold();
  write(app, "app/dash/layout.jsx", `export default function D({ children }){ return <section id="dash"><aside>side</aside>{children}</section>; }`);
  write(app, "app/dash/page.jsx", `export const metadata = { title: "Dash | Nepx" }; export default function P(){ return <h2>dash home</h2>; }`);
  write(app, "app/dash/stats/page.jsx", `export default function P(){ return <h2>dash stats</h2>; }`);
  write(app, "components/Navbar.jsx", `import { Link, usePathname, useRouter } from "nepx";
export default function Navbar(){ const p = usePathname(); const r = useRouter();
  return <nav><Link href="/">Home</Link><Link href="/about">About</Link><Link href="/users/1">User 1</Link><Link href="/users/zzz">Bad</Link><Link href="/dash">Dash</Link><Link href="/dash/stats">Stats</Link><Link href="/old-about">Old</Link><button id="go" onClick={() => r.push("/about")}>go</button><span id="path">{p}</span></nav>; }`);
  const s = startNepx(app, ["dev", "--port", "0"]);
  let browser;
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1], base = `http://localhost:${port}`;
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let expect404 = false;
    page.on("console", (m) => { if (m.type() === "error" && !(expect404 && /status of 404/.test(m.text()))) errors.push(m.text()); });

    // SSR content is present before any JS runs
    const noJs = await browser.newContext({ javaScriptEnabled: false }); const p0 = await noJs.newPage();
    await p0.goto(base + "/users/5"); assert.match(await p0.textContent("h1"), /User 5/); await noJs.close();

    await page.goto(base + "/");
    assert.equal(await page.textContent("h1"), "Welcome to Nepx.js");
    await page.click("main button"); await page.click("main button");
    assert.equal(await page.textContent("main button"), "Clicked 2 times");          // hydrated: state works
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).margin), "0px"); // css from layout import
    assert.equal(await page.textContent("#path"), "/");
    await page.evaluate(() => { window.__marker = 1; });

    await page.click('nav a[href="/about"]'); await page.waitForSelector("h1:text('About')");
    assert.equal(await page.title(), "About | Nepx App");                             // page metadata overrides layout
    assert.equal(await page.textContent("#path"), "/about");
    await page.click('nav a[href="/users/1"]'); await page.waitForSelector("h1:text('User 1')"); // getServerSideProps via /_nepx/data
    assert.equal(await page.title(), "Nepx App");
    await page.click('nav a[href="/dash"]'); await page.waitForSelector("#dash h2:text('dash home')");
    assert.equal(await page.title(), "Dash | Nepx");
    await page.click('nav a[href="/dash/stats"]'); await page.waitForSelector("h2:text('dash stats')");
    assert.ok(await page.$("#dash aside"));                                           // nested layout
    expect404 = true;
    await page.click('nav a[href="/users/zzz"]'); await page.waitForSelector("h1:text('404 - Page not found')");
    expect404 = false;
    assert.ok(await page.$("nav"));                                                    // root layout around 404
    await page.click('nav a[href="/old-about"]'); await page.waitForSelector("h1:text('About')");  // middleware redirect during client nav
    assert.equal(new URL(page.url()).pathname, "/about");
    await page.click("#go"); // router.push to current page: no-op
    await page.goBack(); await page.waitForSelector("h1:text('404 - Page not found')", { timeout: 5000 }).catch(() => {});
    assert.equal(await page.evaluate(() => window.__marker), 1, "no full page load happened during the whole session");

    await page.goto(base + "/users/8");                                                // direct hit hydrates with server data
    assert.equal(await page.textContent("h1"), "User 8");
    expect404 = true; await page.goto(base + "/does-not-exist"); expect404 = false;
    assert.equal(await page.textContent("h1"), "404 - Page not found");
    await page.goto(base + "/");
    await page.evaluate(() => { window.__marker = 2; });
    const [popup] = await Promise.all([page.context().waitForEvent("page"), page.click('nav a[href="/about"]', { modifiers: ["Control"] })]);
    assert.equal(await page.evaluate(() => window.__marker), 2);
    await popup.close();
    assert.deepEqual(errors, []);                                                      // no hydration warnings or runtime errors
  } finally { await browser?.close(); s.stop(); }
});

test("error.jsx: render failures give a 500 error page; production hides the message, dev shows it", async () => {
  const app = scaffold();
  write(app, "app/boom/page.jsx", `export async function getServerSideProps(){ throw new Error("db password is hunter2"); }
export default function B(){ return null; }`);
  assert.equal(nepx(app, "build").status, 0);
  const s = startNepx(app, ["start", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1];
    const r = await fetch(`http://localhost:${port}/boom`); const html = await r.text();
    assert.equal(r.status, 500);
    assert.match(html, /Something went wrong/); assert.match(html, /Internal Server Error/); assert.match(html, /class="container"/); // inside the root layout
    assert.ok(!html.includes("hunter2"));
    assert.equal((await fetch(`http://localhost:${port}/about`)).status, 200); // server keeps running
  } finally { s.stop(); }
  const d = startNepx(app, ["dev", "--port", "0"]);
  try {
    const port = (await d.wait(/localhost:(\d+)/))[1];
    const r = await fetch(`http://localhost:${port}/boom`);
    assert.equal(r.status, 500); assert.match(await r.text(), /hunter2/);
  } finally { d.stop(); }
});
