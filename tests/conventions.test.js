// File-based icons / OG images, has/missing conditions, trailingSlash.
import test from "node:test";
import assert from "node:assert/strict";
import { compileRules } from "../src/rules.js";
import { loadConfig } from "../src/config.js";
import { iconMetadata } from "../src/appicons.js";
import { makeProject } from "./helpers.js";
import { start, HTML } from "./server-helpers.js";

const layout = "export default function L({ children }){ return <html><body>{children}</body></html>; }";
const home = "export default function P(){ return <p id='h'>home</p>; }";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test("iconMetadata builds icons / openGraph / twitter defaults (basePath aware)", () => {
  const files = new Map([["favicon.ico", "/x"], ["apple-icon.png", "/x"], ["opengraph-image.png", "/x"], ["twitter-image.jpg", "/x"]]);
  assert.deepEqual(iconMetadata(files, "/docs"), {
    icons: { icon: ["/docs/favicon.ico"], apple: ["/docs/apple-icon.png"] },
    openGraph: { images: ["/docs/opengraph-image.png"] }, twitter: { images: ["/docs/twitter-image.jpg"] },
  });
  assert.deepEqual(iconMetadata(new Map()), {});
});

test("has / missing: validated and evaluated (header, cookie, query, host)", async () => {
  const r = await compileRules({
    redirects: [{ source: "/beta", destination: "/new", has: [{ type: "cookie", key: "beta", value: "1|yes" }], missing: [{ type: "query", key: "stay" }] }],
    headers: [{ source: "/:p*", headers: [{ key: "X-Mobile", value: "1" }], has: [{ type: "header", key: "User-Agent", value: ".*Mobile.*" }] }],
    rewrites: [{ source: "/", destination: "/eu", has: [{ type: "host", value: "eu\\.example\\.com" }] }],
  });
  const q = (s) => new URLSearchParams(s);
  assert.equal(r.redirects[0].resolve("/beta", "", { cookies: { beta: "yes" }, query: q("") }), "/new");
  assert.equal(r.redirects[0].resolve("/beta", "", { cookies: { beta: "no" }, query: q("") }), null);
  assert.equal(r.redirects[0].resolve("/beta", "?stay=1", { cookies: { beta: "1" }, query: q("stay=1") }), null);
  assert.ok(r.headers[0].match("/a", { headers: { "user-agent": "iPhone Mobile Safari" } }));
  assert.ok(!r.headers[0].match("/a", { headers: { "user-agent": "curl" } }));
  assert.equal(r.rewrites[0].resolve("/", "", { host: "eu.example.com" }), "/eu");
  assert.equal(r.rewrites[0].resolve("/", "", { host: "us.example.com" }), null);
  await assert.rejects(compileRules({ redirects: [{ source: "/a", destination: "/b", has: [{ type: "nope" }] }] }), /type must be/);
  await assert.rejects(compileRules({ redirects: [{ source: "/a", destination: "/b", has: [{ type: "header", key: "x", value: "(" }] }] }), /valid regular expression/);
  await assert.rejects(compileRules({ redirects: [{ source: "/a", destination: "/b", has: "x" }] }), /must be arrays/);
});

test("config.trailingSlash is validated", async () => {
  const bad = makeProject({ "nepx.config.js": "export default { trailingSlash: 'yes' }" });
  await assert.rejects(loadConfig(bad), /trailingSlash must be true or false/);
  assert.equal((await loadConfig(makeProject({ "nepx.config.js": "export default { trailingSlash: true }" }))).trailingSlash, true);
  assert.equal((await loadConfig(makeProject({}))).trailingSlash, false);
});

test("server: app/icon.png + opengraph-image.png are served and added to <head>; page metadata overrides", async () => {
  const { base } = await start({
    "app/layout.jsx": layout, "app/page.jsx": home,
    "app/icon.png": PNG, "app/favicon.ico": PNG, "app/opengraph-image.png": PNG,
    "app/own/page.jsx": "export const metadata = { openGraph: { images: ['/mine.png'] } }; export default function P(){ return <p>own</p>; }",
  });
  const img = await fetch(base + "/icon.png");
  assert.equal(img.status, 200); assert.equal(img.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
  assert.equal((await fetch(base + "/favicon.ico")).headers.get("content-type"), "image/x-icon");
  assert.equal((await fetch(base + "/apple-icon.png")).status, 404);
  const html = await (await fetch(base + "/", { headers: HTML })).text();
  assert.match(html, /<link rel="icon" href="\/favicon\.ico"/);
  assert.match(html, /<link rel="icon" href="\/icon\.png"/);
  assert.match(html, /<meta property="og:image" content="\/opengraph-image\.png"/);
  const own = await (await fetch(base + "/own", { headers: HTML })).text();
  assert.match(own, /content="\/mine\.png"/); assert.doesNotMatch(own, /opengraph-image\.png/);
  assert.match(own, /<link rel="icon" href="\/icon\.png"/); // icons are not overridden by an openGraph-only page
});

test("server: trailingSlash redirects pages (308, query kept) but not the root, files or the default setup", async () => {
  const files = { "app/layout.jsx": layout, "app/page.jsx": home, "app/about/page.jsx": home, "public/a.txt": "hi" };
  const on = await start(files, { trailingSlash: true });
  const r = await fetch(on.base + "/about?x=1", { redirect: "manual", headers: HTML });
  assert.equal(r.status, 308); assert.equal(r.headers.get("location"), "/about/?x=1");
  assert.equal((await fetch(on.base + "/about/", { headers: HTML })).status, 200);
  assert.equal((await fetch(on.base + "/", { redirect: "manual", headers: HTML })).status, 200);
  assert.equal((await fetch(on.base + "/a.txt", { redirect: "manual" })).status, 200);
  const off = await start(files);
  assert.equal((await fetch(off.base + "/about", { redirect: "manual", headers: HTML })).status, 200);
});

test("server: has/missing apply to redirects, headers and rewrites", async () => {
  const { compileRules: cr } = await import("../src/rules.js");
  const rules = await cr({
    redirects: [{ source: "/old", destination: "/about", has: [{ type: "cookie", key: "beta" }] }],
    headers: [{ source: "/about", headers: [{ key: "x-lang", value: "id" }], has: [{ type: "header", key: "accept-language", value: "id.*" }] }],
    rewrites: [{ source: "/home", destination: "/about", missing: [{ type: "query", key: "raw" }] }],
  });
  const { base } = await start({ "app/layout.jsx": layout, "app/page.jsx": home, "app/about/page.jsx": home },
    { redirects: rules.redirects, headerRules: rules.headers, rewrites: rules.rewrites });
  assert.equal((await fetch(base + "/old", { redirect: "manual", headers: { ...HTML, cookie: "beta=1" } })).status, 307);
  assert.equal((await fetch(base + "/old", { redirect: "manual", headers: HTML })).status, 404);
  assert.equal((await fetch(base + "/about", { headers: { ...HTML, "accept-language": "id-ID" } })).headers.get("x-lang"), "id");
  assert.equal((await fetch(base + "/about", { headers: { ...HTML, "accept-language": "en" } })).headers.get("x-lang"), null);
  assert.equal((await fetch(base + "/home", { headers: HTML })).status, 200);
  assert.equal((await fetch(base + "/home?raw=1", { headers: HTML })).status, 404);
});
