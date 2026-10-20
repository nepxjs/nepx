import test from "node:test";
import assert from "node:assert/strict";
import { resolveSecurity, RateLimiter, MemoryStore, ALGORITHMS, clientIp, checkMethod, compileAccessList, compileProbes, buildCsp, parseCspReport, createEmitter, normalizeIp } from "../src/security/index.js";
import { statusInfo, PAGE_STATUSES, plainStatusHtml, isHttpError, HttpError, publicMessage } from "../src/errors/index.js";
import { formatWait } from "../src/views/index.js";

const limiter = (over = {}, rules) => new RateLimiter(resolveSecurity({ rateLimit: { windowMs: 1000, max: 2, ...over, ...(rules ? { rules } : {}) } }).rateLimit);
const hit = (l, ip, pathname, now) => l.check({ req: { headers: {} }, ip, pathname }, now);

// ---------- errors ----------
test("statusInfo covers the statuses Nepx has pages for, flags retryable ones, with a generic fallback", () => {
  for (const s of [400, 401, 403, 405, 408, 413, 414, 421, 429, 431, 500, 501, 502, 503, 504, 505]) assert.ok(PAGE_STATUSES.includes(s), `status ${s}`);
  assert.equal(statusInfo(429).title, "Too many requests");
  assert.equal(statusInfo(429).retryable, true);
  assert.equal(statusInfo(403).retryable, false);
  assert.equal(statusInfo(499).title, "Request error");
  assert.equal(statusInfo(599).kind, "server");
  assert.ok(!PAGE_STATUSES.includes(404)); // 404 is not-found.jsx
});
test("plainStatusHtml escapes the message", () => {
  const html = plainStatusHtml(400, '<img src=x onerror="alert(1)">');
  assert.ok(!html.includes("<img"));
  assert.match(html, /&lt;img/);
});
test("HttpError: digest-based detection, Retry-After parsing, expose rules, cause kept out of JSON", () => {
  assert.ok(isHttpError(new HttpError(403)));
  assert.ok(isHttpError({ digest: "NEPX_HTTP_ERROR", status: 503 }));
  assert.ok(!isHttpError({ digest: "NEPX_HTTP_ERROR", status: 200 }));
  assert.ok(!isHttpError(new Error("x")));
  assert.equal(new HttpError(429, "x", { headers: { "Retry-After": "30" } }).retryAfter, 30);
  assert.equal(new HttpError(503, "x", { headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" } }).retryAfter, null); // date form is not turned into a countdown
  assert.equal(new HttpError(429).retryAfter, null);
  assert.equal(publicMessage(new HttpError(403, "Admins only")), "Admins only");
  assert.equal(publicMessage(new HttpError(403)), undefined);                          // default title: nothing extra to say
  assert.equal(publicMessage(new HttpError(500, "db down", { expose: false })), undefined);
  assert.equal(publicMessage(new Error("boom")), undefined);
  const e = new HttpError(502, "upstream", { cause: new Error("secret") });
  assert.equal(e.cause.message, "secret");
  assert.deepEqual(e.toJSON(), { status: 502, error: "upstream" });
});
test("formatWait speaks in seconds, minutes, hours", () => {
  assert.equal(formatWait(1), "1 second"); assert.equal(formatWait(30), "30 seconds");
  assert.equal(formatWait(61), "2 minutes"); assert.equal(formatWait(3600), "1 hour"); assert.equal(formatWait(3000), "50 minutes"); assert.equal(formatWait(7200), "2 hours");
});

// ---------- config ----------
test("resolveSecurity validates options, rejects unknown keys and is idempotent", () => {
  const ok = resolveSecurity({ rateLimit: { max: 5, rules: [{ source: "/api/login", max: 2 }] }, allowedOrigins: ["https://a.example.com/path"] });
  assert.deepEqual(ok.allowedOrigins, ["https://a.example.com"]);
  assert.equal(resolveSecurity(ok), ok);
  assert.throws(() => resolveSecurity({ nope: 1 }), /not a known option/);
  assert.throws(() => resolveSecurity({ rateLimit: { max: 0 } }), /max must be a positive integer/);
  assert.throws(() => resolveSecurity({ rateLimit: { algorithm: "leaky" } }), /algorithm must be one of: fixed, sliding, token-bucket/);
  assert.throws(() => resolveSecurity({ rateLimit: { store: {} } }), /get\(key\) and set/);
  assert.throws(() => resolveSecurity({ rateLimit: { keyGenerator: "ip" } }), /keyGenerator must be a function/);
  assert.throws(() => resolveSecurity({ rateLimit: { burst: 0 } }), /burst/);
  assert.throws(() => resolveSecurity({ allowedHosts: "example.com" }), /allowedHosts/);
  assert.throws(() => resolveSecurity({ trustProxy: "yes" }), /trustProxy/);
  assert.throws(() => resolveSecurity({ headersTimeoutMs: 9000, requestTimeoutMs: 1000 }), /headersTimeoutMs/);
  assert.throws(() => resolveSecurity({ onEvent: "log" }), /onEvent must be a function/);
  assert.throws(() => resolveSecurity({ cspReportOnly: true }), /needs contentSecurityPolicy/);
  assert.throws(() => resolveSecurity({ cspReport: 5 }), /cspReport/);
  assert.throws(() => resolveSecurity({ probes: "yes" }), /probes/);
  assert.throws(() => resolveSecurity({ ipAccess: { allow: ["not-an-ip"] } }), /not an IP address or CIDR/);
  assert.throws(() => resolveSecurity({ ipAccess: { deny: ["10.0.0.0/40"] } }), /invalid prefix length/);
  assert.throws(() => resolveSecurity({ ipAccess: { rules: [{ allow: [] }] } }), /needs a "source"/);
  assert.equal(resolveSecurity(false).maxUrlLength, 0);
  assert.equal(resolveSecurity(false).isProbe, null);
});

// ---------- client + methods ----------
test("clientIp only trusts X-Forwarded-For for the configured number of hops; IPv4-mapped IPv6 is normalised", () => {
  const req = { socket: { remoteAddress: "10.0.0.1" }, headers: { "x-forwarded-for": "6.6.6.6, 1.2.3.4" } };
  assert.equal(clientIp(req, false), "10.0.0.1");
  assert.equal(clientIp(req, true), "1.2.3.4"); // right-most entry: what our own proxy appended, not what the client claimed
  assert.equal(clientIp(req, 2), "6.6.6.6");
  assert.equal(normalizeIp("::ffff:192.168.1.5"), "192.168.1.5");
  assert.equal(clientIp({ socket: { remoteAddress: "::ffff:127.0.0.1" }, headers: {} }, false), "127.0.0.1");
});
test("checkMethod: TRACE / CONNECT are 405, unknown verbs 501", () => {
  assert.equal(checkMethod("GET"), null);
  assert.equal(checkMethod("TRACE").status, 405);
  assert.equal(checkMethod("CONNECT").status, 405);
  assert.equal(checkMethod("FOOBAR").status, 501);
});

// ---------- rate limiting ----------
test("fixed window: per IP, per rule, assets skipped, new window resets", async () => {
  const l = limiter({}, [{ source: "/api/login", max: 1 }]);
  assert.equal((await hit(l, "a", "/x", 0)).blocked, false);
  assert.equal((await hit(l, "a", "/x", 1)).blocked, false);
  assert.equal((await hit(l, "a", "/x", 2)).blocked, true);
  assert.equal((await hit(l, "b", "/x", 3)).blocked, false);           // other IP
  assert.equal((await hit(l, "a", "/api/login", 4)).blocked, false);   // separate bucket
  const r = await hit(l, "a", "/api/login", 5);
  assert.equal(r.blocked, true); assert.equal(r.rule, "r0"); assert.equal(r.reset, 1);
  assert.equal(await hit(l, "a", "/_nepx/client.js", 6), null);        // never limited
  assert.equal((await hit(l, "a", "/x", 1500)).blocked, false);        // new window
  l.close();
});
test("sliding window: the previous window still counts, so the boundary burst is smoothed", async () => {
  const { sliding } = ALGORITHMS;
  const cfg = { windowMs: 1000, max: 4 };
  let st; for (let i = 0; i < 4; i++) st = sliding(st, 100, cfg).state;
  assert.equal(sliding(st, 100, cfg).result.blocked, true);
  let late = sliding(st, 1100, cfg);                      // 10% into the next window: 90% of the old 4 hits still weigh
  assert.equal(late.result.blocked, false);
  assert.equal(late.result.remaining, 0);
  assert.equal(sliding(late.state, 1100, cfg).result.blocked, true);
  assert.equal(sliding(st, 2100, cfg).result.remaining, 3); // two windows later: history is gone
});
test("token bucket: refills continuously, burst sets the bucket size", async () => {
  const l = limiter({ algorithm: "token-bucket", burst: 3 });
  const outcomes = []; for (let i = 0; i < 4; i++) outcomes.push((await hit(l, "a", "/x", 0)).blocked);
  assert.deepEqual(outcomes, [false, false, false, true]);
  const wait = await hit(l, "a", "/x", 0);
  assert.equal(wait.reset, 1);                                   // 2 tokens / second: next one in 500ms, reported rounded up
  assert.equal((await hit(l, "a", "/x", 600)).blocked, false);    // one token came back
  assert.equal((await hit(l, "a", "/x", 600)).blocked, true);
  l.close();
});
test("limiter: custom key, skip function, and a custom async store (not closed by the limiter)", async () => {
  const data = new Map(); let closed = false;
  const store = { async get(k) { return data.get(k); }, async set(k, v) { data.set(k, v); }, close() { closed = true; } };
  const l = limiter({ store, keyGenerator: (req, ip) => req.headers["x-api-key"] ?? ip, skip: (req, p) => p === "/health" });
  const call = (key, p = "/x") => l.check({ req: { headers: key ? { "x-api-key": key } : {} }, ip: "1.1.1.1", pathname: p }, 0);
  assert.equal((await call("k1")).blocked, false); await call("k1");
  assert.equal((await call("k1")).blocked, true);
  assert.equal((await call("k2")).blocked, false);                // same IP, other key: separate bucket
  assert.equal(await call("k1", "/health"), null);
  assert.ok([...data.keys()].every((k) => k.startsWith("*|")));
  l.close(); assert.equal(closed, false);
});
test("MemoryStore expires entries and caps its size (address spraying)", () => {
  const s = new MemoryStore({ maxKeys: 10, sweepMs: 60_000 });
  s.set("old", 1, 10, 0);
  assert.equal(s.get("old", 5), 1); assert.equal(s.get("old", 11), undefined);
  for (let i = 0; i < 40; i++) s.set(`k${i}`, i, 60_000, 100);
  assert.ok(s.size <= 10, `size ${s.size}`);
  s.close();
});

// ---------- IP access ----------
test("ipAccess: CIDR v4 / v6, deny wins, allow restricts, per-path rules replace the global lists", () => {
  const a = compileAccessList({ deny: ["203.0.113.0/24", "2001:db8::/32"], rules: [{ source: "/admin/:path*", allow: ["10.0.0.0/8"] }] });
  assert.equal(a.permits("8.8.8.8", "/"), true);
  assert.equal(a.permits("203.0.113.77", "/"), false);
  assert.equal(a.permits("2001:db8::1", "/"), false);
  assert.equal(a.permits("2001:db9::1", "/"), true);
  assert.equal(a.permits("10.2.3.4", "/admin/users"), true);
  assert.equal(a.permits("8.8.8.8", "/admin/users"), false);      // the rule's allow list applies, the global one does not
  const both = compileAccessList({ allow: ["10.0.0.0/8"], deny: ["10.9.9.9"] });
  assert.equal(both.permits("10.1.1.1", "/"), true);
  assert.equal(both.permits("10.9.9.9", "/"), false);             // deny beats allow
  assert.equal(both.permits("1.1.1.1", "/"), false);
  assert.equal(both.permits("garbage", "/"), false);
  assert.equal(compileAccessList({}), null);
});

// ---------- probes ----------
test("probe detection: scanner paths match (even percent-encoded), real pages do not, custom paths extend", () => {
  const p = compileProbes(true);
  for (const x of ["/wp-admin/setup.php", "/wp-login.php", "/.git/config", "/%2egit/config", "/.env", "/phpmyadmin/", "/index.php", "/backup.sql", "/cgi-bin/x"]) assert.ok(p(x), x);
  for (const x of ["/", "/about", "/blog/php-guide", "/docs/environment", "/api/hello"]) assert.ok(!p(x), x);
  const custom = compileProbes({ paths: [/^\/secret-admin/, "^/internal-"] });
  assert.ok(custom("/secret-admin/x")); assert.ok(custom("/internal-tools"));
  assert.equal(compileProbes(false), null);
});

// ---------- CSP ----------
test("buildCsp: preset is production-only and adds upgrade-insecure-requests on HTTPS; strings, objects and report modes", () => {
  const s = (o) => resolveSecurity(o);
  assert.equal(buildCsp(s({}), { dev: false, secure: true }), null);
  assert.equal(buildCsp(s({ contentSecurityPolicy: true }), { dev: true, secure: false }), null);
  const prod = buildCsp(s({ contentSecurityPolicy: true }), { dev: false, secure: true });
  assert.equal(prod.name, "content-security-policy");
  assert.match(prod.value, /default-src 'self'; .*object-src 'none'.*upgrade-insecure-requests/);
  assert.ok(!/upgrade-insecure/.test(buildCsp(s({ contentSecurityPolicy: true }), { dev: false, secure: false }).value));
  assert.equal(buildCsp(s({ contentSecurityPolicy: "default-src 'none'" }), { dev: true, secure: false }).value, "default-src 'none'"); // explicit policy applies in dev too
  assert.equal(buildCsp(s({ contentSecurityPolicy: { "default-src": ["'self'"], "img-src": null, "upgrade-insecure-requests": true } }), { dev: false, secure: false }).value, "default-src 'self'; upgrade-insecure-requests");
  const ro = buildCsp(s({ contentSecurityPolicy: "default-src 'self'", cspReportOnly: true, cspReport: true }), { dev: false, secure: false });
  assert.equal(ro.name, "content-security-policy-report-only");
  assert.equal(ro.value, "default-src 'self'; report-uri /_nepx/csp-report");
  assert.match(buildCsp(s({ contentSecurityPolicy: true, cspReport: "https://r.example.com/csp" }), { dev: false, secure: false }).value, /report-uri https:\/\/r\.example\.com\/csp$/);
});
test("parseCspReport understands the legacy and the Reporting API shapes, and refuses junk", () => {
  const legacy = parseCspReport(JSON.stringify({ "csp-report": { "document-uri": "https://x/", "blocked-uri": "https://evil/x.js", "violated-directive": "script-src 'self'" } }));
  assert.deepEqual(legacy, { documentUri: "https://x/", blockedUri: "https://evil/x.js", violatedDirective: "script-src 'self'", sourceFile: undefined });
  const modern = parseCspReport(JSON.stringify([{ type: "csp-violation", body: { documentURL: "https://x/", blockedURL: "inline", effectiveDirective: "script-src-elem" } }]));
  assert.equal(modern.blockedUri, "inline"); assert.equal(modern.violatedDirective, "script-src-elem");
  assert.equal(parseCspReport("not json"), null);
  assert.equal(parseCspReport("42"), null);
  assert.equal(parseCspReport(JSON.stringify({ "csp-report": { "blocked-uri": "x".repeat(1000) } })).blockedUri.length, 300);
});

// ---------- events ----------
test("event emitter: describes the request, never throws, handles async failures", async () => {
  const seen = [];
  const emit = createEmitter((e) => { seen.push(e); });
  emit("csrf", { requestId: "r1", method: "POST", url: "/api/x?y=1" }, { status: 403, ip: "9.9.9.9" });
  assert.equal(seen[0].type, "csrf"); assert.equal(seen[0].path, "/api/x"); assert.equal(seen[0].ip, "9.9.9.9"); assert.equal(seen[0].requestId, "r1"); assert.ok(seen[0].at > 0);
  const origError = console.error; const logged = []; console.error = (...a) => logged.push(a.join(" "));
  try {
    createEmitter(() => { throw new Error("sync boom"); })("host", { url: "/" });
    createEmitter(async () => { throw new Error("async boom"); })("host", { url: "/" });
    await new Promise((r) => setImmediate(r));
  } finally { console.error = origError; }
  assert.equal(logged.length, 2);
  assert.doesNotThrow(() => createEmitter(null)("host", { url: "/" }));
});
