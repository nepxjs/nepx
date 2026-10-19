// Request guards. Each one is (ctx) => Violation | null (or a promise of one), where
//   ctx       = { req, sec, dev, ip, pathname, limiter, headers }
//   Violation = { type, status, message, headers?, detail? }
// The pipeline runs them in order and stops at the first violation.
import { checkMethod, SAFE_METHODS } from "../methods.js";

export const urlLength = ({ req, sec }) =>
  sec.maxUrlLength && req.url.length > sec.maxUrlLength ? { type: "url-too-long", status: 414, message: "Request address is too long" } : null;

export const method = ({ req }) => {
  const bad = checkMethod(req.method);
  return bad ? { type: "method", status: bad.status, message: bad.status === 405 ? "Method not allowed" : "Method not implemented", headers: { allow: bad.allow }, detail: { method: req.method } } : null;
};

/** Host header sanity + allow-list ("example.com", ".example.com" for the domain and every subdomain). */
export const host = ({ req, sec, dev }) => {
  const value = req.headers.host;
  if (value === undefined) return null; // HTTP/1.0 clients
  if (!/^[A-Za-z0-9.\-_:[\]]+$/.test(value) || value.length > 255) return { type: "host", status: 400, message: "Invalid Host header" };
  if (!sec.allowedHosts || dev) return null;
  const name = value.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  const ok = sec.allowedHosts.some((a) => {
    const rule = a.toLowerCase().replace(/:\d+$/, "");
    return rule.startsWith(".") ? name === rule.slice(1) || name.endsWith(rule) : name === rule;
  });
  return ok ? null : { type: "host", status: 421, message: "Unknown host", detail: { host: value } };
};

export const ipAccess = ({ sec, ip, pathname }) =>
  sec.ipAccess && !sec.ipAccess.permits(ip, pathname) ? { type: "ip-denied", status: 403, message: "Access denied" } : null;

/** CSRF: an unsafe request that carries cookies must come from this site (or an allowed origin). */
export const origin = ({ req, sec }) => {
  if (!sec.csrf || SAFE_METHODS.has(req.method)) return null;
  const value = req.headers.origin;
  if (value === undefined || !req.headers.cookie) return null; // no Origin (non-browser) or no ambient credentials: nothing to forge
  if (sec.allowedOrigins.includes(value)) return null;
  const blocked = { type: "csrf", status: 403, message: "Cross-site request blocked", detail: { origin: value.slice(0, 200) } };
  let o;
  try { o = new URL(value); } catch { return blocked; }
  const expected = (sec.trustProxy && req.headers["x-forwarded-host"]) || req.headers.host;
  return expected && o.host.toLowerCase() === String(expected).split(",")[0].trim().toLowerCase() ? null : blocked;
};

export const rateLimit = async ({ req, ip, pathname, limiter, headers }) => {
  if (!limiter) return null;
  const r = await limiter.check({ req, ip, pathname });
  if (!r) return null;
  headers["ratelimit-limit"] = String(r.limit);
  headers["ratelimit-remaining"] = String(r.remaining);
  headers["ratelimit-reset"] = String(r.reset);
  return r.blocked ? { type: "rate-limit", status: 429, message: "Too many requests", headers: { "retry-after": String(r.reset) }, detail: { rule: r.rule } } : null;
};

/** Cheap checks first, anything that touches state (the limiter) last. */
export const GUARDS = [urlLength, method, host, ipAccess, origin, rateLimit];
