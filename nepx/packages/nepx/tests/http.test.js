import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeProject } from "./helpers.js";
import { scanApp, inspectRoutes } from "../src/router.js";
import { createNepxServer, listen } from "../src/server/index.js";

let server, base, port;
before(async () => {
  const root = makeProject({
    "app/api/hello/route.js": 'export async function GET(){ return Response.json({ message: "Hello from Nepx!" }); }',
    "app/api/users/route.js": `export async function GET(request, { url }){ return Response.json({ search: url.searchParams.get("search") }); }
export async function POST(request){ const data = await request.json(); return Response.json({ data }, { status: 201 }); }
export async function PUT(){ return new Response("put"); }
export async function PATCH(){ return new Response("patch"); }
export async function DELETE(){ return new Response(null, { status: 204 }); }`,
    "app/api/users/[id]/route.js": "export async function GET(request, { params, url }){ return Response.json({ id: params.id, q: url.searchParams.get('id') }); }",
    "app/api/files/[...path]/route.js": "export async function GET(request, { params }){ return Response.json(params); }",
    "app/api/cookie/route.js": "export async function GET(request, { cookies }){ return new Response(cookies.a, { headers: { 'set-cookie': 'x=1; Path=/' } }); }",
    "app/api/boom/route.js": "export async function GET(){ throw new Error('secret internals'); }",
    "app/api/bad/route.js": "export async function GET(){ return 'not a response'; }",
    "middleware.js": `import { redirect } from "nepx";
export const config = { matcher: ["/mw/:path*"] };
export default function middleware(request) {
  const u = new URL(request.url);
  if (u.pathname === "/mw/go") return redirect("/api/hello", 308);
  if (u.pathname === "/mw/deny") return new Response("denied", { status: 403 });
}`,
  });
  const info = await inspectRoutes(root, scanApp(root));
  const { loadMiddleware } = await import("../src/middleware.js");
  server = createNepxServer({ root, routes: info.routes, maxBodySize: 100, middleware: await loadMiddleware(root, "middleware.js") });
  port = await listen(server, 0);
  base = `http://localhost:${port}`;
});
after(() => { server.closeAllConnections(); server.close(); });
const j = (r) => r.json();
const raw = (p) => new Promise((resolve, reject) => http.get({ host: "localhost", port, path: p }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject));

test("GET", async () => { const r = await fetch(base + "/api/hello"); assert.equal(r.status, 200); assert.deepEqual(await j(r), { message: "Hello from Nepx!" }); assert.ok(r.headers.get("x-request-id")); });
test("POST json", async () => {
  const r = await fetch(base + "/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: '{"a":1}' });
  assert.equal(r.status, 201); assert.deepEqual(await j(r), { data: { a: 1 } });
});
test("PUT PATCH DELETE", async () => {
  assert.equal(await (await fetch(base + "/api/users", { method: "PUT" })).text(), "put");
  assert.equal(await (await fetch(base + "/api/users", { method: "PATCH" })).text(), "patch");
  assert.equal((await fetch(base + "/api/users", { method: "DELETE" })).status, 204);
});
test("bad bodies are 4xx not 500", async () => {
  const h = { "content-type": "application/json" };
  assert.equal((await fetch(base + "/api/users", { method: "POST", headers: h, body: "{oops" })).status, 400);
  assert.equal((await fetch(base + "/api/users", { method: "POST", headers: h })).status, 400);
  assert.equal((await fetch(base + "/api/users", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" })).status, 415);
  assert.equal((await fetch(base + "/api/users", { method: "POST", headers: h, body: JSON.stringify({ a: "x".repeat(500) }) })).status, 413);
});
test("405 with Allow, OPTIONS, HEAD", async () => {
  const r = await fetch(base + "/api/hello", { method: "POST" });
  assert.equal(r.status, 405); assert.equal(r.headers.get("allow"), "GET, HEAD, OPTIONS");
  const o = await fetch(base + "/api/users", { method: "OPTIONS" });
  assert.equal(o.status, 204); assert.match(o.headers.get("allow"), /POST/);
  const h = await fetch(base + "/api/hello", { method: "HEAD" });
  assert.equal(h.status, 200); assert.equal(await h.text(), "");
});
test("404 (JSON, no pages), trailing slash", async () => {
  const r = await fetch(base + "/api/nope");
  assert.equal(r.status, 404); assert.match(r.headers.get("content-type"), /json/);
  assert.equal((await fetch(base + "/")).status, 404);
  assert.equal((await fetch(base + "/api/hello/")).status, 200);
});
test("dynamic and catch-all params", async () => {
  assert.deepEqual(await j(await fetch(base + "/api/users/123?id=q")), { id: "123", q: "q" });
  assert.deepEqual(await j(await fetch(base + "/api/users/a%20b")), { id: "a b", q: null });
  assert.deepEqual(await j(await fetch(base + "/api/files/a/b%20c/d")), { path: ["a", "b c", "d"] });
  assert.deepEqual(await j(await fetch(base + "/api/users?search=keyboard")), { search: "keyboard" });
});
test("malformed URL and traversal attempts", async () => {
  assert.equal(await raw("/api/users/%E0%A4%A"), 400);
  assert.equal(await raw("/api/users/%2e%2e"), 404); // WHATWG URL resolves it to /api/ before routing
  assert.equal(await raw("/api/users/a%2fb"), 400);
  assert.equal(await raw("/api/users/a%5cb"), 400);
  assert.equal(await raw("/api/users/a%00b"), 400);
});
test("cookies in, set-cookie out", async () => {
  const r = await fetch(base + "/api/cookie", { headers: { cookie: "a=hey" } });
  assert.equal(await r.text(), "hey"); assert.match(r.headers.get("set-cookie"), /x=1/);
});
test("errors do not leak internals in production mode", async () => {
  const r = await fetch(base + "/api/boom"); const body = await r.text();
  assert.equal(r.status, 500); assert.ok(!body.includes("secret internals"));
  assert.equal((await fetch(base + "/api/bad")).status, 500);
});
test("middleware: matcher, redirect, short-circuit, pass-through", async () => {
  const r = await fetch(base + "/mw/go", { redirect: "manual" });
  assert.equal(r.status, 308); assert.equal(r.headers.get("location"), "/api/hello");
  const d = await fetch(base + "/mw/deny"); assert.equal(d.status, 403); assert.equal(await d.text(), "denied");
  assert.equal((await fetch(base + "/mw/other")).status, 404); // passes through to normal 404
  assert.equal((await fetch(base + "/api/hello")).status, 200); // not matched
});
