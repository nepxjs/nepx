import test, { before } from "node:test";
import assert from "node:assert/strict";
import { start, HTML, rawRequest, api, LOOPBACK } from "./server-helpers.js";
import { resolveSecurity } from "../src/security/index.js";

// ---------- headers + request hardening ----------
let S;
before(async () => { S = await start(api()); });

test("security headers on every response, including errors and assets", async () => {
  for (const p of ["/api/hello", "/api/missing", "/a.txt"]) {
    const r = await fetch(S.base + p);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", p);
    assert.equal(r.headers.get("x-frame-options"), "SAMEORIGIN", p);
    assert.equal(r.headers.get("referrer-policy"), "strict-origin-when-cross-origin", p);
    assert.match(r.headers.get("permissions-policy"), /camera=\(\)/, p);
    assert.equal(r.headers.get("cross-origin-opener-policy"), "same-origin-allow-popups", p);
    await r.arrayBuffer();
  }
});
test("no HSTS / CSP by default; HSTS only on HTTPS (via trusted proxy) in production", async () => {
  const r = await fetch(S.base + "/api/hello", { headers: { "x-forwarded-proto": "https" } });
  assert.equal(r.headers.get("strict-transport-security"), null); // trustProxy is off: the header is not believed
  assert.equal(r.headers.get("content-security-policy"), null);
  const T = await start(api(), { security: resolveSecurity({ trustProxy: true, contentSecurityPolicy: true }) });
  const https = await fetch(T.base + "/api/hello", { headers: { "x-forwarded-proto": "https" } });
  assert.match(https.headers.get("strict-transport-security"), /^max-age=\d+; includeSubDomains$/);
  assert.match(https.headers.get("content-security-policy"), /default-src 'self'.*object-src 'none'.*upgrade-insecure-requests/);
  const plain = await fetch(T.base + "/api/hello");
  assert.equal(plain.headers.get("strict-transport-security"), null);
  assert.ok(!/upgrade-insecure/.test(plain.headers.get("content-security-policy")));
});
test("headers can be overridden or removed", async () => {
  const T = await start(api(), { security: resolveSecurity({ headers: { "x-frame-options": "DENY", "permissions-policy": null } }) });
  const r = await fetch(T.base + "/api/hello");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("permissions-policy"), null);
});
test("414 for an over-long address, 405 for TRACE, 501 for unknown verbs", async () => {
  const long = await fetch(S.base + "/api/hello?" + "a".repeat(9000));
  assert.equal(long.status, 414);
  const trace = await rawRequest(S.port, "TRACE /api/hello HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  assert.match(trace, /^HTTP\/1\.1 405/);
  assert.match(trace, /allow: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS/i);
  const odd = await rawRequest(S.port, "FOOBAR /api/hello HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  assert.match(odd, /^HTTP\/1\.1 501/);
});
test("parser-level failures answer with a status page: 400 bad Host, 431 headers too large, 505 bad HTTP version", async () => {
  const badHost = await rawRequest(S.port, "GET /api/hello HTTP/1.1\r\nHost: evil.com/../x\r\nConnection: close\r\n\r\n");
  assert.match(badHost, /^HTTP\/1\.1 400/);
  const T = await start(api(), { security: resolveSecurity({ maxHeaderSize: 2048 }) });
  const big = await rawRequest(T.port, `GET /api/hello HTTP/1.1\r\nHost: localhost\r\nCookie: ${"a=".padEnd(4000, "b")}\r\nConnection: close\r\n\r\n`);
  assert.match(big, /^HTTP\/1\.1 431/);
  assert.match(big, /Request headers too large/);
  const ver = await rawRequest(S.port, "GET /api/hello HTTP/9.9\r\nHost: localhost\r\n\r\n");
  assert.match(ver, /^HTTP\/1\.1 (505|400)/); // llhttp: 505 on current Node, 400 on versions that reject earlier
});
test("allowedHosts: other Host headers get 421 (and subdomain wildcard works)", async () => {
  const T = await start(api(), { security: resolveSecurity({ allowedHosts: ["example.com", ".app.test"] }) });
  const send = (host) => rawRequest(T.port, `GET /api/hello HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
  assert.match(await send("example.com"), /^HTTP\/1\.1 200/);
  assert.match(await send("example.com:8080"), /^HTTP\/1\.1 200/);
  assert.match(await send("a.app.test"), /^HTTP\/1\.1 200/);
  assert.match(await send("app.test"), /^HTTP\/1\.1 200/);
  assert.match(await send("evil.test"), /^HTTP\/1\.1 421/);
  assert.match(await send("notexample.com"), /^HTTP\/1\.1 421/);
});
test("CSRF: cross-site unsafe request with cookies is 403; same-site, cookie-less and allow-listed origins pass", async () => {
  const post = (headers) => fetch(S.base + "/api/hello", { method: "POST", headers });
  assert.equal((await post({ origin: "https://evil.example", cookie: "sid=1" })).status, 403);
  assert.equal((await post({ origin: "null", cookie: "sid=1" })).status, 403);
  assert.equal((await post({ origin: `http://localhost:${S.port}`, cookie: "sid=1" })).status, 200);
  assert.equal((await post({ origin: "https://evil.example" })).status, 200);       // no ambient credentials: nothing to forge
  assert.equal((await post({ cookie: "sid=1" })).status, 200);                      // not a browser cross-site request
  assert.equal((await fetch(S.base + "/api/hello", { headers: { origin: "https://evil.example", cookie: "sid=1" } })).status, 200); // safe method
  const T = await start(api(), { security: resolveSecurity({ allowedOrigins: ["https://app.example.com"] }) });
  assert.equal((await fetch(T.base + "/api/hello", { method: "POST", headers: { origin: "https://app.example.com", cookie: "a=b" } })).status, 200);
  const off = await start(api(), { security: resolveSecurity({ csrf: false }) });
  assert.equal((await fetch(off.base + "/api/hello", { method: "POST", headers: { origin: "https://evil.example", cookie: "a=b" } })).status, 200);
});
test("dotfiles in public/ are never served, .well-known is", async () => {
  assert.equal((await fetch(S.base + "/a.txt")).status, 200);
  assert.equal((await fetch(S.base + "/.env")).status, 404);
  assert.equal((await fetch(S.base + "/%2eenv")).status, 404);
  assert.equal((await fetch(S.base + "/.well-known/security.txt")).status, 200);
  const open = await start(api(), { security: resolveSecurity({ blockDotfiles: false }) });
  assert.equal((await fetch(open.base + "/.env")).status, 200);
});
test("rate limiting: 429 + Retry-After, per-route rules, assets exempt, JSON for fetch / HTML for browsers", async () => {
  const T = await start(api(), { security: resolveSecurity({ rateLimit: { windowMs: 60_000, max: 4, rules: [{ source: "/api/guard", max: 1 }] } }) });
  const first = await fetch(T.base + "/api/hello");
  assert.equal(first.headers.get("ratelimit-limit"), "4");
  assert.equal(first.headers.get("ratelimit-remaining"), "3");
  await first.arrayBuffer();
  assert.equal((await fetch(T.base + "/api/guard")).status, 403);   // 1st request to the strict rule: allowed through to the handler
  const strict = await fetch(T.base + "/api/guard");                  // 2nd: over its own limit
  assert.equal(strict.status, 429);
  assert.ok(Number(strict.headers.get("retry-after")) >= 1);
  assert.deepEqual(Object.keys(await strict.json()), ["error"]);
  for (let i = 0; i < 3; i++) await (await fetch(T.base + "/api/hello")).arrayBuffer(); // requests 2, 3, 4 of the 4 allowed
  const blocked = await fetch(T.base + "/api/hello");
  assert.equal(blocked.status, 429);
  await blocked.arrayBuffer();
  const browser = await fetch(T.base + "/api/hello", { headers: HTML });
  assert.equal(browser.status, 429);
  assert.match(browser.headers.get("content-type"), /application\/json/); // /api/* stays JSON even for browsers
  const page = await fetch(T.base + "/somewhere", { headers: HTML });
  assert.equal(page.status, 429);
  assert.match(page.headers.get("content-type"), /text\/html/);
  const html = await page.text();
  assert.match(html, /429/); assert.match(html, /Too many requests/);
  assert.match(page.headers.get("vary"), /(^|, )Accept(,|$)/);
  await assert.doesNotReject(fetch(T.base + "/_nepx/client.js")); // exempt from the limiter (404 here: no bundle, but not 429)
  assert.notEqual((await fetch(T.base + "/_nepx/client.js")).status, 429);
});
test("rate limiter ignores spoofed X-Forwarded-For unless trustProxy is set", async () => {
  const T = await start(api(), { security: resolveSecurity({ rateLimit: { max: 2 } }) });
  const hit = (xff) => fetch(T.base + "/api/hello", { headers: { "x-forwarded-for": xff } }).then((r) => r.status);
  assert.deepEqual([await hit("1.1.1.1"), await hit("2.2.2.2"), await hit("3.3.3.3")], [200, 200, 429]);
});
test("errors: JSON for fetch, an HTML status page for browsers, no stack or internals", async () => {
  const json = await fetch(S.base + "/missing-thing");
  assert.equal(json.status, 404);
  assert.deepEqual(await json.json(), { error: "Not found" });
  const html = await fetch(S.base + "/missing-thing", { headers: HTML });
  assert.equal(html.status, 404);
  assert.match(html.headers.get("content-type"), /text\/html/);
  assert.equal(html.headers.get("cache-control"), "no-store");
  const body = await html.text();
  assert.match(body, /404/); assert.ok(!/<script/.test(body));
  const guard = await fetch(S.base + "/api/guard", { headers: HTML });
  assert.equal(guard.status, 403);
  assert.deepEqual(await guard.json(), { error: "Admins only" });
});


// ---------- pipeline features: IP access, probes, events, CSP reports, request ids ----------
test("ipAccess: deny list, allow list behind a trusted proxy, per-path rules; refused requests never reach the handler", async () => {
  const denied = await start(api(), { security: resolveSecurity({ ipAccess: { deny: LOOPBACK } }) });
  const r = await fetch(denied.base + "/api/hello");
  assert.equal(r.status, 403); assert.deepEqual(await r.json(), { error: "Access denied" });
  const allow = await start(api(), { security: resolveSecurity({ trustProxy: true, ipAccess: { allow: ["10.0.0.0/8"] } }) });
  assert.equal((await fetch(allow.base + "/api/hello")).status, 403);
  assert.equal((await fetch(allow.base + "/api/hello", { headers: { "x-forwarded-for": "10.1.2.3" } })).status, 200);
  assert.equal((await fetch(allow.base + "/api/hello", { headers: { "x-forwarded-for": "10.1.2.3, 8.8.8.8" } })).status, 403); // right-most hop is the one our proxy saw
  const scoped = await start(api(), { security: resolveSecurity({ ipAccess: { allow: ["10.0.0.0/8"], rules: [{ source: "/api/hello", allow: LOOPBACK }] } }) });
  assert.equal((await fetch(scoped.base + "/api/hello")).status, 200);
  assert.equal((await fetch(scoped.base + "/api/guard")).status, 403);
  assert.equal((await fetch(scoped.base + "/a.txt", { headers: HTML })).status, 403);
});
test("probes: scanner paths get a cheap plain 404 (even for browsers) and a probe event; real 404s still get the page; probes: false turns it off", async () => {
  const events = [];
  const T = await start(api(), { security: resolveSecurity({ onEvent: (e) => events.push(e) }) });
  const p = await fetch(T.base + "/wp-admin/setup.php", { headers: HTML });
  assert.equal(p.status, 404);
  assert.match(p.headers.get("content-type"), /text\/plain/);
  assert.equal(await p.text(), "Not found");
  assert.equal((await fetch(T.base + "/.env", { headers: HTML })).status, 404); // dotfile in public/: blocked, then recognised as a probe
  const real = await fetch(T.base + "/nothing-here", { headers: HTML });
  assert.match(await real.text(), /Page not found/);
  assert.deepEqual(events.map((e) => e.type), ["probe", "probe"]);
  assert.equal(events[0].path, "/wp-admin/setup.php");
  const off = await start(api(), { security: resolveSecurity({ probes: false }) });
  assert.match(await (await fetch(off.base + "/wp-admin/x", { headers: HTML })).text(), /Page not found/);
  const mine = await start(api({ "public/index.php": "<?php ?>" }), { security: resolveSecurity({}) });
  assert.equal((await fetch(mine.base + "/index.php")).status, 200); // a file you actually serve is never a probe
});
test("onEvent receives every kind of refusal with the request id, ip and details; a failing hook never breaks the request", async () => {
  const events = []; let calls = 0;
  const T = await start(api(), { security: resolveSecurity({
    trustProxy: true, allowedHosts: ["localhost"], rateLimit: { max: 1000, rules: [{ source: "/api/guard", max: 1 }] },
    onEvent: (e) => { events.push(e); if (++calls === 1) throw new Error("hook exploded"); },
  }) });
  const origError = console.error; console.error = () => {};
  try {
    const first = await fetch(T.base + "/api/hello", { method: "POST", headers: { origin: "https://evil.example", cookie: "a=b", "x-forwarded-for": "7.7.7.7" } });
    assert.equal(first.status, 403); // the hook threw, the response is unaffected
    await fetch(T.base + "/api/guard"); await fetch(T.base + "/api/guard");
    await rawRequest(T.port, "TRACE /api/hello HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    await rawRequest(T.port, "GET /api/hello HTTP/1.1\r\nHost: other.test\r\nConnection: close\r\n\r\n");
  } finally { console.error = origError; }
  assert.deepEqual(events.map((e) => e.type), ["csrf", "rate-limit", "method", "host"]);
  const [csrf, limit, method, host] = events;
  assert.equal(csrf.ip, "7.7.7.7"); assert.equal(csrf.status, 403); assert.equal(csrf.origin, "https://evil.example"); assert.match(csrf.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(limit.status, 429); assert.equal(limit.rule, "r0");
  assert.equal(method.status, 405); assert.equal(method.method, "TRACE");
  assert.equal(host.status, 421); assert.equal(host.host, "other.test");
});
test("CSP: report-only header, built-in collector emits csp-report events, junk and oversized reports are handled", async () => {
  const events = [];
  const T = await start(api(), { security: resolveSecurity({ contentSecurityPolicy: "default-src 'self'", cspReportOnly: true, cspReport: true, onEvent: (e) => events.push(e) }) });
  const page = await fetch(T.base + "/api/hello");
  assert.equal(page.headers.get("content-security-policy"), null);
  assert.equal(page.headers.get("content-security-policy-report-only"), "default-src 'self'; report-uri /_nepx/csp-report");
  const send = (body, type = "application/csp-report") => fetch(T.base + "/_nepx/csp-report", { method: "POST", headers: { "content-type": type }, body });
  const ok = await send(JSON.stringify({ "csp-report": { "document-uri": T.base + "/", "blocked-uri": "https://evil.example/x.js", "violated-directive": "script-src-elem" } }));
  assert.equal(ok.status, 204);
  assert.equal((await send("not json")).status, 204); // always 204: reporters never retry on errors
  assert.equal((await send("x".repeat(20_000))).status, 413);
  assert.deepEqual(events.map((e) => e.type), ["csp-report"]);
  assert.equal(events[0].blockedUri, "https://evil.example/x.js"); assert.equal(events[0].violatedDirective, "script-src-elem");
  const off = await start(api(), { security: resolveSecurity({ contentSecurityPolicy: "default-src 'self'", cspReport: "https://r.example.com/csp" }) });
  assert.equal((await fetch(off.base + "/_nepx/csp-report", { method: "POST", body: "{}" })).status, 404); // no collector unless cspReport: true
  assert.match((await fetch(off.base + "/api/hello")).headers.get("content-security-policy"), /report-uri https:\/\/r\.example\.com\/csp$/);
});
test("X-Request-Id: honoured only behind a trusted proxy and only when it is a harmless token", async () => {
  const id = async (base, value) => (await fetch(base + "/api/hello", { headers: { "x-request-id": value } })).headers.get("x-request-id");
  assert.match(await id(S.base, "abc-12345-trace"), /^[0-9a-f-]{36}$/);   // no trusted proxy: always generated
  const T = await start(api(), { security: resolveSecurity({ trustProxy: true }) });
  assert.equal(await id(T.base, "abc-12345-trace"), "abc-12345-trace");
  assert.match(await id(T.base, "short"), /^[0-9a-f-]{36}$/);
  assert.match(await id(T.base, "bad id with spaces!!"), /^[0-9a-f-]{36}$/);
});
test("sliding-window and token-bucket limiters work end to end", async () => {
  for (const algorithm of ["sliding", "token-bucket"]) {
    const T = await start(api(), { security: resolveSecurity({ rateLimit: { windowMs: 60_000, max: 3, algorithm } }) });
    const codes = []; for (let i = 0; i < 5; i++) { const r = await fetch(T.base + "/api/hello"); codes.push(r.status); await r.arrayBuffer(); }
    assert.deepEqual(codes, [200, 200, 200, 429, 429], algorithm);
  }
});
