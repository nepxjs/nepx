// Tests for the development error overlay: source maps, code frames, server/build/browser errors, production safety.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { makeProject, startNepx, nepx, scaffold, linkDeps, GLOBAL_MODULES } from "./helpers.js";
import { SourceMap, parseInlineMap } from "../src/sourcemap.js";
import { buildPayload, terminalFrame, resolveBrowserError, errorPageHtml, devScripts } from "../src/overlay.js";
import { analyze } from "../src/build.js";
import { bundleClient, errorAssets } from "../src/bundle.js";

const write = (app, rel, content) => { mkdirSync(path.dirname(path.join(app, rel)), { recursive: true }); writeFileSync(path.join(app, rel), content); };
const get = (port, p, headers = {}, method = "GET", body = null) => new Promise((res, rej) => {
  const r = http.request({ host: "localhost", port, path: p, method, headers }, (resp) => {
    const chunks = []; resp.on("data", (c) => chunks.push(c)); resp.on("end", () => res({ status: resp.statusCode, headers: resp.headers, text: Buffer.concat(chunks).toString("utf8") }));
  });
  r.on("error", rej); r.end(body);
});
const HTML = { accept: "text/html" };
const freePort = () => new Promise((res) => { const srv = net.createServer().listen(0, () => { const { port } = srv.address(); srv.close(() => res(port)); }); });

// ---------- units ----------
test("sourcemap: maps generated positions back to the original line/column", async () => {
  const { transform } = await import("esbuild");
  const src = "const a = 1;\nfunction f() {\n  throw new Error('x');\n}\nf();\n";
  const out = await transform(src, { loader: "js", sourcemap: "external", sourcefile: "a.js" });
  const map = new SourceMap(JSON.parse(out.map));
  const idx = out.code.indexOf("throw"), before = out.code.slice(0, idx).split("\n");
  const pos = map.find(before.length, before[before.length - 1].length);
  assert.deepEqual([pos.source, pos.line, pos.column], ["a.js", 3, 2]);
  assert.equal(map.find(999, 0), null);
  const inline = await transform(src, { loader: "js", sourcemap: "inline", sourcefile: "b.js" });
  assert.ok(parseInlineMap(inline.code) instanceof SourceMap);
  assert.equal(parseInlineMap("no map here"), null);
});

test("buildPayload: code frame around the failing line, project-relative paths, framework frames flagged", () => {
  const root = makeProject({ "app/boom/page.jsx": "import x from 'y';\n\nexport default function B() {\n  return user.name;\n}\n" });
  const file = path.join(root, "app/boom/page.jsx");
  const err = new TypeError(`Cannot read ${file}`);
  err.stack = `TypeError: Cannot read ${file}\n    at B (file://${file}:4:15)\n    at renderWithHooks (${root}/node_modules/react-dom/cjs/x.js:10:2)\n    at node:internal/process:1:1`;
  const p = buildPayload(err, { projectRoot: root, method: "GET", url: "/boom", requestId: "r1" });
  assert.equal(p.kind, "Server Error");
  assert.equal(p.message, "Cannot read app/boom/page.jsx"); // absolute project path removed
  assert.deepEqual(p.request, { method: "GET", url: "/boom", id: "r1", status: 500 });
  assert.equal(p.code[0].file, "app/boom/page.jsx");
  assert.equal(p.code[0].line, 4);
  assert.deepEqual(p.code[0].lines.map((l) => l.n), [1, 2, 3, 4, 5]);
  assert.deepEqual(p.frames.map((f) => [f.fn, f.ignored]), [["B", false], ["renderWithHooks", true], ["<anonymous>", true]]);
  assert.ok(p.frames.every((f) => !("abs" in f)), "absolute paths are not sent to the browser");
  const t = terminalFrame(p);
  assert.match(t, /app\/boom\/page\.jsx:4:15/); assert.match(t, /> 4 \|   return user\.name;/); assert.match(t, /\^/);
});

test("buildPayload: build errors list every location with its own code frame and no call stack", () => {
  const root = makeProject({ "app/a/page.jsx": "const a = ;\n", "app/b/page.jsx": "x\ny\nz <\n" });
  const err = new Error("Client build failed:\napp/a/page.jsx:1:11: Unexpected \";\"");
  err.details = [{ text: "Unexpected \";\"", file: "app/a/page.jsx", line: 1, column: 11 }, { text: "Bad", file: "app/b/page.jsx", line: 3, column: 3 }, { text: "Nowhere" }];
  const p = buildPayload(err, { projectRoot: root, kind: "Build Error" });
  assert.equal(p.kind, "Build Error"); assert.deepEqual(p.frames, []); assert.equal(p.stack, "");
  assert.deepEqual(p.code.map((c) => [c.file, c.line, c.text]), [["app/a/page.jsx", 1, "Unexpected \";\""], ["app/b/page.jsx", 3, "Bad"]]);
  // a loader SyntaxError ("file:line:col: message") becomes a Build Error with a code frame too
  const se = new SyntaxError(`${root}/app/a/page.jsx:1:11: Unexpected ";"`);
  const q = buildPayload(se, { projectRoot: root });
  assert.equal(q.kind, "Build Error"); assert.equal(q.code[0].line, 1);
});

test("buildPayload never reads files outside the project", () => {
  const root = makeProject({ "app/page.jsx": "x" }), other = makeProject({ "secret.txt": "top secret\n" });
  const err = new Error("x"); err.stack = `Error: x\n    at f (${path.join(other, "secret.txt")}:1:1)`;
  assert.deepEqual(buildPayload(err, { projectRoot: root }).code, []);
});

test("error page + scripts: payload is embedded safely, the plain stack only shows without JS", () => {
  const p = buildPayload(new Error("</script><b>x"), { projectRoot: "/nowhere" });
  const html = errorPageHtml(p);
  assert.ok(!html.includes("</script><b>"), "script-closing text is escaped inside the payload");
  assert.match(html, /<noscript><pre>/); assert.match(html, /__nepxOverlay/); assert.match(html, /EventSource/);
  assert.equal(devScripts(null).includes("__NEPX_DEV_ERROR__="), false);
});

test("resolveBrowserError: a frame in the bundled client.js maps to the page source + code frame", async () => {
  const app = makeProject({
    "package.json": "{}",
    "app/layout.jsx": "export default function L({ children }) { return <div>{children}</div>; }",
    "app/click/page.jsx": `"use client";\nimport { useState } from "react";\n\nexport default function Click() {\n  const [n, setN] = useState(0);\n  function handle() {\n    const cfg = undefined;\n    setN(n + cfg.value);\n  }\n  return <button onClick={handle}>{n}</button>;\n}\n`,
  });
  linkDeps(app);
  const scan = await analyze(app);
  const assets = await bundleClient(app, scan, { dev: true });
  const code = assets.get("/_nepx/client.js").body.toString("utf8");
  const idx = code.indexOf("cfg.value"), lines = code.slice(0, idx).split("\n");
  const stack = `TypeError: x\n    at handle (http://localhost:3000/_nepx/client.js:${lines.length}:${lines[lines.length - 1].length + 1})\n    at HTMLUnknownElement.callCallback (http://localhost:3000/_nepx/client.js:1:1)`;
  const r = resolveBrowserError({ stack }, { assets, projectRoot: app });
  assert.deepEqual([r.frames[0].fn, r.frames[0].file, r.frames[0].line, r.frames[0].ignored], ["handle", "app/click/page.jsx", 8, false]);
  assert.equal(r.code[0].file, "app/click/page.jsx"); assert.equal(r.code[0].line, 8);
  assert.match(r.code[0].lines.find((l) => l.n === 8).text, /cfg\.value/);
  assert.equal(resolveBrowserError({ stack: "garbage" }, { assets, projectRoot: app }).frames.length, 0);
});

test("errorAssets: compile errors reach the overlay and keep the message greppable", () => {
  const err = new Error("Client build failed:\napp/about/page.jsx:1:7: bad"); err.details = [{ text: "bad", file: "app/about/page.jsx", line: 1, column: 7 }];
  const js = errorAssets(err, makeProject({ "app/about/page.jsx": "x" })).get("/_nepx/client.js").body.toString("utf8");
  assert.match(js, /__nepxOverlay\.show/); assert.match(js, /about\/page\.jsx:1:7/); assert.match(js, /"kind":"Build Error"/);
});

// ---------- dev server ----------
test("dev: server errors render the overlay page (HTML), JSON with stack for fetch(), and are never swallowed", async () => {
  const app = scaffold();
  rmSync(path.join(app, "app/error.jsx"), { force: true }); // no error.jsx: failures must fall back to the overlay page
  write(app, "app/boom/page.jsx", `export default function Boom() {\n  const user = null;\n  return <main>{user.name}</main>;\n}\n`);
  write(app, "app/api/bad/route.js", `export async function GET() {\n  return Response.json(JSON.parse("{nope"));\n}\n`);
  write(app, "app/broken/page.jsx", `export default function S() {\n  return <main><h1>oops</main>;\n}\n`);
  const s = startNepx(app, ["dev", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1];
    let r = await get(port, "/boom", HTML);
    assert.equal(r.status, 500); assert.match(r.headers["content-type"], /text\/html/);
    const payload = JSON.parse(/__NEPX_DEV_ERROR__=(\{.*?\})<\/script>/s.exec(r.text)[1]);
    assert.equal(payload.kind, "Server Error"); assert.match(payload.message, /Cannot read properties of null/);
    assert.equal(payload.code[0].file, "app/boom/page.jsx"); assert.equal(payload.code[0].line, 3); // source-mapped, not the transformed line
    assert.equal(payload.frames[0].file, "app/boom/page.jsx");
    assert.equal(payload.request.method, "GET"); assert.equal(payload.handled, false);
    assert.match(r.text, /__nepxOverlay/); assert.match(r.text, /EventSource/);
    assert.match(s.output(), /> 3 \|\s+return <main>\{user\.name\}<\/main>/); // terminal shows the code frame too

    r = await get(port, "/boom"); // no Accept: text/html (curl, fetch) -> JSON
    assert.equal(r.status, 500); assert.match(r.headers["content-type"], /json/);
    assert.match(JSON.parse(r.text).stack, /page\.jsx:3/);

    r = await get(port, "/api/bad", HTML); assert.equal(r.status, 500); assert.match(r.text, /__NEPX_DEV_ERROR__/);
    r = await get(port, "/api/bad"); assert.match(JSON.parse(r.text).stack, /route\.js:2/);

    r = await get(port, "/broken", HTML); // syntax error in a page: build error with the location
    assert.equal(r.status, 500);
    const bp = JSON.parse(/__NEPX_DEV_ERROR__=(\{.*?\})<\/script>/s.exec(r.text)[1]);
    assert.equal(bp.kind, "Build Error"); assert.equal(bp.code[0].file, "app/broken/page.jsx"); assert.equal(bp.code[0].line, 2);
    assert.ok(!bp.message.includes(app), "no absolute paths in the message");

    // the client bundle fails to build too: client.js hands the structured error to the overlay
    const js = (await get(port, "/_nepx/client.js")).text;
    assert.match(js, /__nepxOverlay\.show/); assert.match(js, /broken\/page\.jsx:2:/);

    // the resolve endpoint is POST only and bounded
    assert.equal((await get(port, "/_nepx/overlay/resolve")).status, 404);
    r = await get(port, "/_nepx/overlay/resolve", { "content-type": "application/json" }, "POST", "{not json");
    assert.equal(r.status, 400);
    r = await get(port, "/_nepx/overlay/resolve", { "content-type": "application/json" }, "POST", JSON.stringify({ stack: "x" }));
    assert.deepEqual(JSON.parse(r.text).frames, []);
  } finally { s.stop(); }
});

test("dev: with error.jsx the app's own error page is shown and the overlay only gets the collapsed details", async () => {
  const app = scaffold();
  write(app, "app/boom/page.jsx", `export default function Boom() { throw new Error("kaboom"); }`);
  const s = startNepx(app, ["dev", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1];
    const r = await get(port, "/boom", HTML);
    assert.equal(r.status, 500);
    assert.match(r.text, /Something went wrong/); assert.match(r.text, /class="container"/); // error.jsx inside the root layout
    const payload = JSON.parse(/__NEPX_DEV_ERROR__=(\{.*?\})<\/script>/s.exec(r.text)[1]);
    assert.equal(payload.handled, true); assert.equal(payload.message, "kaboom");
  } finally { s.stop(); }
});

test("production: no overlay, no stack, no resolve endpoint, nothing leaks", async () => {
  const app = scaffold();
  write(app, "app/gssp/page.jsx", `export async function getServerSideProps() { throw new Error("secret boom"); }\nexport default function P() { return <main />; }\n`);
  write(app, "app/error.jsx", "export default function E({ error }){ return <p>failed: {error.message}</p>; }");
  const b = nepx(app, "build"); assert.equal(b.status, 0, b.stderr);
  const s = startNepx(app, ["start", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1];
    let r = await get(port, "/gssp", HTML);
    assert.equal(r.status, 500); assert.ok(!r.text.includes("secret boom")); assert.ok(!r.text.includes("__nepxOverlay")); assert.ok(!r.text.includes("__NEPX_DEV_ERROR__"));
    r = await get(port, "/", HTML); assert.ok(!r.text.includes("__nepxOverlay"));
    assert.equal((await get(port, "/_nepx/overlay/resolve", { "content-type": "application/json" }, "POST", "{}")).status, 404);
  } finally { s.stop(); }
});

test("default 404 page is styled and keeps the 404 status; a project's own not-found.jsx still wins", async () => {
  const app = makeProject({ "package.json": "{}", "app/page.jsx": "export default function H(){ return <main>home</main>; }" });
  linkDeps(app);
  const s = startNepx(app, ["dev", "--port", "0"]);
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1];
    const r = await get(port, "/nope", HTML);
    assert.equal(r.status, 404); assert.match(r.text, /<h1[^>]*>404 - Page not found<\/h1>/); assert.match(r.text, /Back to home/); assert.match(r.text, /style="/);
    assert.ok(!r.text.includes("__NEPX_DEV_ERROR__="), "a 404 is not an error overlay");
  } finally { s.stop(); }
});

// ---------- real browser (skipped when Playwright/Chromium is unavailable) ----------
let chromium = null;
try { chromium = createRequire(path.join(GLOBAL_MODULES, "playwright", "package.json"))("playwright").chromium; } catch { /* skip */ }

const overlayState = (page) => page.evaluate(() => {
  const host = document.querySelector("nepx-dev-overlay"); if (!host) return null;
  const sr = host.shadowRoot, t = (sel) => sr.querySelector(sel)?.textContent ?? null;
  return { open: !!sr.querySelector(".bd"), pill: t(".pill"), kind: t(".kind"), title: t(".title"), file: t(".cfh"), frames: [...sr.querySelectorAll(".fr:not(.ig) .l")].map((x) => x.textContent), page: t(".pg") };
});

test("browser: runtime errors open the overlay with the original source; Esc collapses it, the badge reopens it", { skip: !chromium && "playwright not available" }, async () => {
  const app = scaffold();
  write(app, "app/click/page.jsx", `"use client";\nimport { useState } from "react";\n\nexport default function Click() {\n  const [n, setN] = useState(0);\n  function handle() {\n    const cfg = undefined;\n    setN(n + cfg.value);\n  }\n  return <main><button id="b" onClick={handle}>{n}</button><button id="p" onClick={() => Promise.reject(new Error("late"))}>p</button></main>;\n}\n`);
  const s = startNepx(app, ["dev", "--port", "0"]);
  let browser;
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1], base = `http://localhost:${port}`;
    browser = await chromium.launch();
    const page = await browser.newPage();
    page.on("pageerror", () => {}); // the errors below are intentional
    await page.goto(base + "/click");
    assert.equal(await overlayState(page), null, "nothing is injected until there is an error");

    await page.click("#b");
    await page.waitForFunction(() => document.querySelector("nepx-dev-overlay")?.shadowRoot.querySelector(".cfh"), null, { timeout: 5000 }); // source-mapped details arrived
    let st = await overlayState(page);
    assert.equal(st.open, true); assert.equal(st.kind, "Runtime Error");
    assert.match(st.title, /Cannot read properties of undefined/);
    assert.match(st.file, /^app\/click\/page\.jsx:8:\d+$/); assert.match(st.frames[0], /^app\/click\/page\.jsx:8:\d+$/);

    await page.keyboard.press("Escape");
    st = await overlayState(page); assert.equal(st.open, false); assert.match(st.pill, /1 error/);
    await page.evaluate(() => document.querySelector("nepx-dev-overlay").shadowRoot.querySelector(".pill").click());
    assert.equal((await overlayState(page)).open, true);
    await page.keyboard.press("Escape");

    await page.click("#p"); // async errors (not catchable by error.jsx) are reported too
    await page.waitForFunction(() => /2/.test(document.querySelector("nepx-dev-overlay").shadowRoot.querySelector(".pg")?.textContent ?? ""), null, { timeout: 5000 });
    st = await overlayState(page); assert.equal(st.kind, "Unhandled Rejection"); assert.equal(st.title, "Error: late"); assert.equal(st.page, "2 / 2");
  } finally { await browser?.close(); s.stop(); }
});

test("browser: server error page shows the overlay; an error.jsx-handled client error is only a non-blocking badge", { skip: !chromium && "playwright not available" }, async () => {
  const app = scaffold();
  write(app, "app/boom/page.jsx", `export default function Boom() {\n  const user = null;\n  return <main>{user.name}</main>;\n}\n`);
  write(app, "app/crash/page.jsx", `"use client";\nimport { useState } from "react";\nexport default function Crash() {\n  const [bad, setBad] = useState(false);\n  if (bad) throw new Error("render exploded");\n  return <main><button id="go" onClick={() => setBad(true)}>go</button></main>;\n}\n`);
  const s = startNepx(app, ["dev", "--port", "0"]);
  let browser;
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1], base = `http://localhost:${port}`;
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(base + "/boom");
    let st = await overlayState(page);
    assert.equal(st.open, false); assert.match(st.pill, /1 error/); // handled by the project's error.jsx -> collapsed

    await page.goto(base + "/crash");
    assert.equal(await overlayState(page), null);
    await page.click("#go");
    await page.waitForSelector("text=Something went wrong");
    st = await overlayState(page);
    assert.equal(st.open, false, "must not cover the app's own error UI"); assert.match(st.pill, /1 error/);
    await page.evaluate(() => document.querySelector("nepx-dev-overlay").shadowRoot.querySelector(".pill").click());
    await page.waitForFunction(() => document.querySelector("nepx-dev-overlay").shadowRoot.querySelector(".cfh"), null, { timeout: 5000 });
    st = await overlayState(page); assert.match(st.title, /render exploded/); assert.match(st.file, /^app\/crash\/page\.jsx:5:\d+$/);
  } finally { await browser?.close(); s.stop(); }
});

test("browser: without error.jsx a server error is a full overlay page that fixes itself when the file is fixed", { skip: !chromium && "playwright not available" }, async () => {
  const app = makeProject({ "package.json": "{}", "app/page.jsx": `export default function H() {\n  const x = undefined;\n  return <main>{x.y}</main>;\n}\n` });
  linkDeps(app);
  const fixed = await freePort();
  const s = startNepx(app, ["dev", "--port", String(fixed)]); // a fixed port: the restart after the fix must come back on the same URL
  let browser;
  try {
    const port = (await s.wait(/localhost:(\d+)/))[1], base = `http://localhost:${port}`;
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(base + "/");
    let st = await overlayState(page);
    assert.equal(st.open, true); assert.equal(st.kind, "Server Error"); assert.match(st.file, /^app\/page\.jsx:3:\d+$/);
    write(app, "app/page.jsx", `export default function H() { return <main><h1 id="ok">fixed</h1></main>; }`);
    await page.waitForSelector("#ok", { timeout: 20000 }); // live reload picked up the fix
    assert.equal(await overlayState(page), null);
  } finally { await browser?.close(); s.stop(); }
});
