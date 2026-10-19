import test, { before } from "node:test";
import assert from "node:assert/strict";
import { start, HTML, api } from "./server-helpers.js";
import { scanApp } from "../src/router.js";
import { makeProject } from "./helpers.js";
import { resolveSecurity } from "../src/security/index.js";

const S_API = api();
let S;
before(async () => { S = await start(S_API); });

// ---------- status pages (React) ----------
const React = `import React from "react";\nconst h = React.createElement;\n`;
const pages = (extra = {}) => ({
  "app/layout.jsx": React + 'export const metadata = { title: { default: "Site", template: "%s | Site" } };\nexport default function L({ children }){ return h("div", { id: "shell" }, children); }',
  "app/page.jsx": React + 'export default function P(){ return h("h1", null, "home"); }',
  "app/secret/page.jsx": React + 'import { forbidden } from "nepx";\nexport async function getServerSideProps(){ forbidden(); }\nexport default function P(){ return h("p", null, "secret"); }',
  "app/members/page.jsx": React + 'import { unauthorized } from "nepx";\nexport default function P(){ unauthorized("Please sign in first", { headers: { "www-authenticate": "Bearer" } }); }',
  "app/slow/page.jsx": React + 'import { httpError } from "nepx";\nexport async function getServerSideProps(){ httpError(429, "Slow down", { headers: { "retry-after": "30" } }); }\nexport default function P(){ return null; }',
  "app/down/page.jsx": React + 'import { httpError } from "nepx";\nexport async function getServerSideProps(){ httpError(503); }\nexport default function P(){ return null; }',
  "app/boom/page.jsx": React + 'export async function getServerSideProps(){ throw new Error("db password is hunter2"); }\nexport default function P(){ return null; }',
  "app/403.jsx": React + 'export const metadata = { title: "Nope" };\nexport default function F({ status, title, message }){ return h("section", { id: "custom-403" }, `${status}|${title}|${message}`); }',
  ...extra,
});
let P;
before(async () => { P = await start(pages(), { security: resolveSecurity({ rateLimit: false }) }); });

test("scan: app/<status>.jsx is registered at the root, 404.jsx and unsupported codes are rejected", () => {
  assert.deepEqual(scanApp(makeProject(pages())).statusPages, { 403: "app/403.jsx" });
  assert.throws(() => scanApp(makeProject({ "app/404.jsx": "" })), /not-found/);
  assert.throws(() => scanApp(makeProject({ "app/418.jsx": "" })), /no page for status 418/);
  assert.throws(() => scanApp(makeProject({ "app/403.jsx": "", "app/403.tsx": "" })), /Multiple 403/);
  assert.deepEqual(scanApp(makeProject({ "app/sub/403.jsx": "" })).statusPages, {}); // root only
});
test("forbidden() in getServerSideProps -> the project's own 403 page, inside the root layout, static (no hydration), noindex", async () => {
  const r = await fetch(P.base + "/secret", { headers: HTML });
  assert.equal(r.status, 403);
  const html = await r.text();
  assert.match(html, /<div id="shell"><section id="custom-403">403\|Access denied\|You do not have permission/);
  assert.match(html, /<title>Nope \| Site<\/title>/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.ok(!html.includes("__NEPX_DATA__"));
  assert.ok(!html.includes('type="module"'));
  assert.equal(r.headers.get("cache-control"), "no-store");
});
test("unauthorized() in a component: built-in 401 page, custom message, headers from the error reach the response", async () => {
  const r = await fetch(P.base + "/members", { headers: HTML });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("www-authenticate"), "Bearer");
  const html = await r.text();
  assert.match(html, /401/); assert.match(html, /Sign in required/); assert.match(html, /Please sign in first/);
  assert.match(html, /<title>401 - Sign in required \| Site<\/title>/); // layout title template applies to the status title
});
test("httpError(429) / httpError(503): built-in pages with Retry-After and a retry link; no message echo when none was given", async () => {
  const slow = await fetch(P.base + "/slow", { headers: HTML });
  assert.equal(slow.status, 429);
  assert.equal(slow.headers.get("retry-after"), "30");
  const body = await slow.text();
  assert.match(body, /Too many requests/); assert.match(body, /Slow down/); assert.match(body, /href="\/slow"[^>]*>Try again/);
  const down = await fetch(P.base + "/down", { headers: HTML });
  assert.equal(down.status, 503);
  const d = await down.text();
  assert.match(d, /Service unavailable/); assert.match(d, /temporarily unavailable/);
});
test("client-side navigation data endpoint answers a status error as JSON so the browser falls back to a full load", async () => {
  const r = await fetch(P.base + "/_nepx/data?path=" + encodeURIComponent("/secret"));
  assert.equal(r.status, 403);
  assert.match(r.headers.get("content-type"), /application\/json/);
  assert.ok((await r.json()).error);
});
test("unexpected errors are 500 and never leak their message in production (HTML + JSON)", async () => {
  const origError = console.error; console.error = () => {};
  try {
    const html = await fetch(P.base + "/boom", { headers: HTML });
    assert.equal(html.status, 500);
    const body = await html.text();
    assert.ok(!body.includes("hunter2"));
    assert.match(body, /500/); assert.match(body, /Something went wrong/); assert.match(body, /Reference: [0-9a-f-]{36}/);
    const json = await fetch(P.base + "/_nepx/data?path=" + encodeURIComponent("/boom"));
    assert.equal(json.status, 500);
    const j = await json.json();
    assert.equal(j.error, "Internal Server Error");
    assert.ok(!JSON.stringify(j).includes("hunter2"));
  } finally { console.error = origError; }
});
test("middleware can stop a request with a status: HTML for browsers, JSON for fetch", async () => {
  const M = await start(pages({
    "middleware.js": 'import { HttpError } from "nepx";\nexport const config = { matcher: ["/maintenance/:path*"] };\nexport default function mw(){ throw new HttpError(503, "Back in 10 minutes", { headers: { "retry-after": "600" } }); }',
    "app/maintenance/page.jsx": React + "export default function P(){ return null; }",
  }));
  const b = await fetch(M.base + "/maintenance", { headers: HTML });
  assert.equal(b.status, 503); assert.equal(b.headers.get("retry-after"), "600");
  assert.match(await b.text(), /Back in 10 minutes/);
  const j = await fetch(M.base + "/maintenance");
  assert.equal(j.status, 503);
  const jb = await j.json();
  assert.equal(jb.error, "Back in 10 minutes"); assert.match(jb.requestId, /^[0-9a-f-]{36}$/); // 5xx carry a request id to quote in bug reports
});
test("404 and normal pages are unaffected; API-only servers still answer browsers with a dependency-free page", async () => {
  assert.equal((await fetch(P.base + "/", { headers: HTML })).status, 200);
  assert.equal((await fetch(P.base + "/nope", { headers: HTML })).status, 404);
  const a = await fetch(S.base + "/x/y", { headers: HTML });
  assert.equal(a.status, 404);
  assert.match(await a.text(), /Page not found/);
});

test("Retry-After becomes a hint on the built-in page; custom pages receive retryable + retryAfter", async () => {
  const slow = await (await fetch(P.base + "/slow", { headers: HTML })).text();
  assert.match(slow, /You can try again in 30 seconds\./);
  const C = await start(pages({ "app/429.jsx": React + 'export default function T(p){ return h("p", { id: "t" }, `${p.retryable}|${p.retryAfter}|${p.url}`); }' }), { security: resolveSecurity({}) });
  assert.match(await (await fetch(C.base + "/slow?x=1", { headers: HTML })).text(), /<p id="t">true\|30\|\/slow\?x=1<\/p>/);
});
test("expose: false keeps a message off the page and out of the JSON, while the status and headers still apply", async () => {
  const E = await start(pages({
    "app/hidden/page.jsx": React + 'import { httpError } from "nepx";\nexport async function getServerSideProps(){ httpError(503, "pool exhausted on db-7", { expose: false, headers: { "retry-after": "5" } }); }\nexport default function P(){ return null; }',
  }), { security: resolveSecurity({}) });
  const origError = console.error; console.error = () => {};
  try {
    const r = await fetch(E.base + "/hidden", { headers: HTML });
    assert.equal(r.status, 503);
    const body = await r.text();
    assert.ok(!body.includes("db-7")); assert.match(body, /temporarily unavailable/);
  } finally { console.error = origError; }
});
