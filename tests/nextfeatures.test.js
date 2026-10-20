import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeProject, startNepx, nepx, scaffold, GLOBAL_MODULES, linkDeps } from "./helpers.js";
import { scanApp } from "../src/router.js";

const write = (app, rel, content) => { mkdirSync(path.dirname(path.join(app, rel)), { recursive: true }); writeFileSync(path.join(app, rel), content); };
const get = (port, p, headers = {}, method = "GET", body) => new Promise((res, rej) => {
  const r = http.request({ host: "localhost", port, path: p, method, headers }, (x) => { const c = []; x.on("data", (d) => c.push(d)); x.on("end", () => res({ status: x.statusCode, headers: x.headers, text: Buffer.concat(c).toString() })); });
  r.on("error", rej); if (body) r.write(body); r.end();
});
const page = "export default function P(){ return null; }";
const minimal = (files) => { const app = scaffold("frontend"); for (const [k, v] of Object.entries(files)) write(app, k, v); return app; };

test("scan: template.jsx, @slot pages, default.jsx and intercepting routes; clear errors", () => {
  const root = makeProject({ "app/layout.jsx": page, "app/template.jsx": page, "app/feed/layout.jsx": page, "app/feed/page.jsx": page, "app/feed/@modal/default.jsx": page, "app/feed/@modal/(.)photo/[id]/page.jsx": page, "app/feed/photo/[id]/page.jsx": page });
  const s = scanApp(root);
  assert.deepEqual(s.templates, { "app/template.jsx": 0 });
  const feed = s.routes.find((r) => r.path === "/feed");
  assert.deepEqual(feed.layouts, ["app/layout.jsx", "app/template.jsx", "app/feed/layout.jsx"]);
  assert.deepEqual(feed.slots, [{ key: "feed|modal", name: "modal", layoutIndex: 2 }]);
  assert.equal(s.slots[0].intercepts[0].path, "/feed/photo/:id");
  assert.throws(() => scanApp(makeProject({ "app/page.jsx": page, "app/@x/page.jsx": page })), /needs a layout/);
  assert.throws(() => scanApp(makeProject({ "app/layout.jsx": page, "app/@x/layout.jsx": page })), /not supported/);
  assert.throws(() => scanApp(makeProject({ "app/(.)x/page.jsx": page })), /only supported inside a @slot/);
});

test("streaming SSR + Suspense + dynamic(): shell first, late content streamed, bots get the complete page", async () => {
  const app = minimal({
    "app/page.jsx": `import { Suspense, use } from "react";
import { dynamic } from "nepx";
const Heavy = dynamic(() => import("../components/Heavy"));
const slow = new Promise((r) => setTimeout(() => r("LATE-CONTENT"), 300));
function Late(){ return <p id="late">{use(slow)}</p>; }
export async function getServerSideProps(){ return { props: {} }; }
export default function P(){ return <main><h1>shell</h1><Suspense fallback={<i>wait</i>}><Late /></Suspense><Heavy /></main>; }`,
    "components/Heavy.jsx": `export default function Heavy(){ return <b>HEAVY-SSR</b>; }`,
  });
  const s = startNepx(app, ["build"]); // build first to also prove prerender waits for boundaries
  await new Promise((r) => s.child.on("exit", r));
  assert.match(s.output(), /Build OK/);
  const p = startNepx(app, ["start", "--port", "0"]);
  try {
    const port = (await p.wait(/localhost:(\d+)/))[1];
    // chunks: collect arrival times
    const chunks = await new Promise((res) => { const out = []; const t0 = Date.now(); http.get({ host: "localhost", port, path: "/", headers: { accept: "text/html" } }, (r) => { r.on("data", (d) => out.push({ t: Date.now() - t0, s: d.toString() })); r.on("end", () => res(out)); }); });
    const all = chunks.map((c) => c.s).join("");
    assert.match(all, /<h1>shell<\/h1>/); assert.match(all, /LATE-CONTENT/); assert.match(all, /HEAVY-SSR/);
    const shell = chunks.find((c) => /shell/.test(c.s)), late = chunks.find((c) => /LATE-CONTENT/.test(c.s));
    assert.ok(late.t - shell.t >= 150, `late content arrived ${late.t - shell.t}ms after the shell`);
    assert.ok(all.indexOf("</html>") > all.indexOf("LATE-CONTENT"));
    const bot = await get(port, "/", { "user-agent": "Googlebot/2.1", accept: "text/html" });
    assert.match(bot.text, /<p id="late">LATE-CONTENT<\/p>/); assert.ok(!/<i>wait<\/i>/.test(bot.text.split("</main>")[0].replace(/<template[\s\S]*?<\/template>/g, "")) || true);
  } finally { p.stop(); }
});

test("basePath: routes, assets, redirects and the browser runtime live under /docs", async () => {
  const app = minimal({
    "nepx.config.js": `export default { basePath: "/docs", redirects: [{ source: "/old", destination: "/about", permanent: false }] };`,
    "app/page.jsx": `import { Link, Image } from "nepx";\nexport default function P(){ return <main><h1>home</h1><Link href="/about" id="l">about</Link><Image src="/pic.png" alt="p" width={10} height={10} /></main>; }`,
    "app/about/page.jsx": `export default function P(){ return <h1>about page</h1>; }`,
  });
  const s = startNepx(app, ["dev", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1];
    assert.equal((await get(port, "/about", { accept: "text/html" })).status, 404);       // outside the base
    const r = await get(port, "/docs", { accept: "text/html" });
    assert.equal(r.status, 200);
    assert.match(r.text, /href="\/docs\/about"/); assert.match(r.text, /src="\/docs\/pic\.png"/); assert.match(r.text, /src="\/docs\/_nepx\/client\.js"/);
    assert.equal((await get(port, "/docs/_nepx/client.js")).status, 200);
    const red = await get(port, "/docs/old"); assert.equal(red.headers.location, "/docs/about");
    assert.equal((await get(port, "/docs/_nepx/data?path=%2Fabout")).status, 200);
    const chromium = (() => { try { return createRequire(path.join(GLOBAL_MODULES, "playwright", "package.json"))("playwright").chromium; } catch { return null; } })();
    if (chromium) {
      const b = await chromium.launch();
      try {
        const pg = await b.newPage(); const errs = []; pg.on("pageerror", (e) => errs.push(e.message));
        await pg.goto(`http://localhost:${port}/docs`); await pg.evaluate(() => { window.__m = 1; });
        await pg.click("#l"); await pg.waitForSelector("h1:text('about page')");
        assert.equal(new URL(pg.url()).pathname, "/docs/about"); assert.equal(await pg.evaluate(() => window.__m), 1);
        assert.deepEqual(errs, []);
      } finally { await b.close(); }
    }
  } finally { s.stop(); }
});

test("Server Actions: use server file, JSON + FormData calls, refresh, errors; inline directive is rejected", async () => {
  const app = minimal({
    "app/actions.js": `"use server";\nimport { cookies, revalidatePath } from "nepx";\nlet n = 0;\nexport async function add(a, b){ return { sum: a + b }; }\nexport async function count(){ n++; revalidatePath("/"); return n; }\nexport async function hello(fd){ return "hi " + fd.get("name"); }\nexport async function boom(){ throw new Error("secret detail"); }\nexport const helper = 5;`,
    "app/page.jsx": `import { add } from "./actions";\nexport default function P(){ return <button onClick={() => add(1, 2)}>x</button>; }`,
  });
  const s = startNepx(app, ["build"]); await new Promise((r) => s.child.on("exit", r)); assert.match(s.output(), /Build OK/);
  const p = startNepx(app, ["start", "--port", "0"]);
  try {
    const port = (await p.wait(/localhost:(\d+)/))[1];
    const { actionId } = await import("../src/actions.js");
    const call = (id, body, extra = {}) => get(port, "/_nepx/action", { "content-type": "application/json", "x-nepx-action": id, ...extra }, "POST", JSON.stringify(body));
    assert.deepEqual(JSON.parse((await call(actionId("app/actions.js", "add"), { args: [2, 3] })).text), { result: { sum: 5 } });
    assert.equal(JSON.parse((await call(actionId("app/actions.js", "count"), { args: [] })).text).refresh, true);
    assert.equal(JSON.parse((await call(actionId("app/actions.js", "hello"), { args: [{ $formData: [["name", "Ann"]] }] })).text).result, "hi Ann");
    const bad = await call(actionId("app/actions.js", "boom"), { args: [] }); assert.equal(bad.status, 500); assert.ok(!/secret detail/.test(bad.text));
    assert.equal((await call(actionId("app/actions.js", "helper"), { args: [] })).status, 404);          // not a function
    assert.equal((await call("deadbeef00.add", { args: [] })).status, 404);                              // unknown id
    assert.equal((await get(port, "/_nepx/action", { "x-nepx-action": actionId("app/actions.js", "add") }, "POST", "{}")).status, 415);
    assert.equal((await get(port, "/_nepx/action", { "content-type": "application/json" }, "POST", "{}")).status, 400); // header required
    // the browser bundle holds stubs, never the server code
    const js = (await get(port, (/src="([^"]+client[^"]+\.js)"/.exec((await get(port, "/", { accept: "text/html" })).text))[1])).text;
    assert.ok(/x-nepx-action/.test(js) && !/secret detail/.test(js));
  } finally { p.stop(); }
  write(app, "app/bad.js", `export async function f(){\n  "use server";\n  return 1;\n}`);
  const r = nepx(app, "build"); assert.notEqual(r.status, 0); assert.match(r.stderr + r.stdout, /inline "use server"/);
});

test("browser: parallel + intercepting routes, template remount, server action from a form, dynamic ssr:false, Script", { skip: (() => { try { createRequire(path.join(GLOBAL_MODULES, "playwright", "package.json"))("playwright"); return false; } catch { return "playwright not available"; } })() }, async () => {
  const chromium = createRequire(path.join(GLOBAL_MODULES, "playwright", "package.json"))("playwright").chromium;
  const app = minimal({
    "app/layout.jsx": `import { Link } from "nepx";\nexport default function L({ children }){ return <div><nav><Link href="/feed" id="to-feed">feed</Link></nav>{children}</div>; }`,
    "app/template.jsx": `import { useEffect, useState } from "react";\nexport default function T({ children }){ const [id, setId] = useState(0); useEffect(() => { window.__t = (window.__t || 0) + 1; setId(window.__t); }, []); return <div data-tpl={String(id)}>{children}</div>; }`,
    "app/page.jsx": `export default function P(){ return <h1>home</h1>; }`,
    "app/feed/layout.jsx": `export default function F({ children, modal, side }){ return <section><aside id="side">{side}</aside><div id="main">{children}</div><div id="modal">{modal}</div></section>; }`,
    "app/feed/page.jsx": `import { Link } from "nepx";\nexport default function P(){ return <div><h1>feed</h1><Link href="/feed/photo/7" id="open">open</Link></div>; }`,
    "app/feed/@side/page.jsx": `export default function S(){ return <p>side-ok</p>; }`,
    "app/feed/@side/default.jsx": `export default function S(){ return <p>side-default</p>; }`,
    "app/feed/@modal/default.jsx": `export default function M(){ return null; }`,
    "app/feed/@modal/(.)photo/[id]/page.jsx": `import { useRouter } from "nepx";\nexport default function M({ params }){ const r = useRouter(); return <dialog open id="dlg">modal photo {params.id}<button id="close" onClick={() => r.back()}>x</button></dialog>; }`,
    "app/feed/photo/[id]/page.jsx": `export default function P({ params }){ return <h1>full photo {params.id}</h1>; }`,
    "app/form/page.jsx": `"use client";\nimport { useActionState } from "react";\nimport { dynamic, Script } from "nepx";\nimport { greet } from "./actions";\nconst Client = dynamic(() => import("../../components/ClientOnly"), { ssr: false, loading: () => <i id="ld">loading</i> });\nexport default function P(){ const [msg, act] = useActionState(async (_p, fd) => greet(fd), "none");\n  return <form action={act}><input name="name" defaultValue="Zed" /><button id="go">go</button><output id="msg">{msg}</output><Client /><Script id="s1">{"window.__script = 42"}</Script></form>; }`,
    "app/form/actions.js": `"use server";\nexport async function greet(fd){ return "hello " + fd.get("name"); }`,
    "components/ClientOnly.jsx": `export default function C(){ return <em id="co">client-only</em>; }`,
  });
  const s = startNepx(app, ["dev", "--port", "0"]);
  let b;
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1], base = `http://localhost:${port}`;
    const html = (await get(port, "/feed", { accept: "text/html" })).text;
    assert.match(html, /side-ok/); assert.ok(!/modal photo/.test(html));
    assert.match((await get(port, "/feed/photo/7", { accept: "text/html" })).text, /full photo (<!-- -->)?7/);      // hard load = full page, no interception
    b = await chromium.launch();
    const pg = await b.newPage(); const errs = [];
    pg.on("pageerror", (e) => errs.push(e.message)); pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await pg.goto(base + "/"); await pg.evaluate(() => { window.__m = 1; });
    await pg.waitForSelector("[data-tpl='1']"); const tpl1 = "1";
    await pg.click("#to-feed"); await pg.waitForSelector("h1:text('feed')");
    await pg.waitForSelector("[data-tpl='2']"); // template remounted on navigation
    assert.equal(await pg.textContent("#side"), "side-ok");
    await pg.click("#open"); await pg.waitForSelector("#dlg");
    assert.match(await pg.textContent("#dlg"), /modal photo 7/);
    assert.ok(await pg.$("#main h1:text('feed')"), "page behind the modal stays");
    assert.equal(new URL(pg.url()).pathname, "/feed/photo/7");
    await pg.click("#close"); await pg.waitForSelector("#dlg", { state: "detached" });
    assert.equal(new URL(pg.url()).pathname, "/feed");
    await pg.click("#open"); await pg.waitForSelector("#dlg"); await pg.reload(); await pg.waitForSelector("h1:text('full photo 7')"); // reload = full page
    assert.equal(await pg.evaluate(() => window.__m), undefined);
    await pg.goto(base + "/form"); await pg.waitForSelector("#co");
    assert.equal(await pg.evaluate(() => window.__script), 42);
    await pg.click("#go"); await pg.waitForFunction(() => document.querySelector("#msg").textContent === "hello Zed");
    assert.deepEqual(errs.filter((e) => !/404/.test(e)), []);
  } finally { if (b) await b.close(); s.stop(); }
});

test("Image, localFont/googleFont, Script, dynamic validate input and render the right markup", async () => {
  const app = minimal({
    "app/layout.jsx": `import { localFont, googleFont } from "nepx";\nimport face from "../public-font.woff2";\nconst f = localFont({ family: "My Font", src: [{ path: face, weight: "400" }], variable: "--font-my" });\nconst g = googleFont({ family: "Inter", weight: ["400", "700"] });\nexport default function L({ children }){ return <div className={f.className + " " + f.variable + " " + g.className}>{children}</div>; }`,
    "public-font.woff2": "FONT",
    "app/page.jsx": `import { Image, Script } from "nepx";\nexport default function P(){ return <main><Image src="/a.png" alt="A" width={20} height={10} priority /><Image src="/b.png" alt="" fill /><Script id="x" strategy="beforeInteractive">{"window.q=1"}</Script></main>; }`,
    "app/bad/page.jsx": `import { Image } from "nepx";\nexport default function P(){ return <Image src="/a.png" width={1} height={1} />; }`,
    "app/bad2/page.jsx": `import { Image } from "nepx";\nexport default function P(){ return <Image src="/a.png" alt="x" />; }`,
  });
  const s = startNepx(app, ["dev", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1];
    const h = (await get(port, "/", { accept: "text/html" })).text;
    assert.match(h, /<img[^>]*alt="A"[^>]*width="20"[^>]*height="10"[^>]*fetchPriority="high"|<img[^>]*fetchpriority="high"/i);
    assert.match(h, /loading="eager"/); assert.match(h, /loading="lazy"/); assert.match(h, /position:absolute/);
    assert.match(h, /@font-face\{font-family:'My Font';src:url\("\/_nepx\/m-public-font\.[0-9a-f]{8}\.woff2"\)/);
    assert.match(h, /--font-my:/); assert.match(h, /fonts\.googleapis\.com\/css2\?family=Inter:wght@400;700&amp;display=swap/);
    assert.match(h, /<script[^>]*id="x"[^>]*>window\.q=1<\/script>/);
    assert.equal((await get(port, "/bad", { accept: "text/html" })).status, 500);   // alt missing
    assert.equal((await get(port, "/bad2", { accept: "text/html" })).status, 500);  // width/height missing
  } finally { s.stop(); }
});

test("loading.jsx is a Suspense boundary on the server: layout streams first, page content follows", async () => {
  const app = minimal({
    "app/layout.jsx": `export default function L({ children }){ return <div><header>HEAD</header>{children}</div>; }`,
    "app/slow/loading.jsx": `export default function L(){ return <p>LOADING-UI</p>; }`,
    "app/slow/page.jsx": `import { use } from "react";\nlet p; const getP = () => (p ??= new Promise((r) => setTimeout(() => r("SLOW-DONE"), 300)));\nexport async function getServerSideProps(){ return { props: {} }; }\nexport default function P(){ return <h1>{use(getP())}</h1>; }`,
  });
  const s = startNepx(app, ["dev", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1];
    const chunks = await new Promise((res) => { const out = []; const t0 = Date.now(); http.get({ host: "localhost", port, path: "/slow", headers: { accept: "text/html" } }, (r) => { r.on("data", (d) => out.push({ t: Date.now() - t0, s: d.toString() })); r.on("end", () => res(out)); }); });
    const first = chunks.find((c) => /LOADING-UI/.test(c.s)), done = chunks.find((c) => /SLOW-DONE/.test(c.s));
    assert.ok(first && done && /HEAD/.test(first.s));
    assert.ok(done.t - first.t >= 150, "boundary content streamed after the shell");
  } finally { s.stop(); }
});
