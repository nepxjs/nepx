// Per-request context for server code: cookies() and headers() work anywhere below the request
// (pages, layouts, getServerSideProps, route handlers, middleware) without passing `request` around.
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { DYNAMIC } from "./shared.js";

export const als = new AsyncLocalStorage();
/** Active while a "use cache" function runs: { tags:Set, life } - cacheTag() and cacheLife() write into it. */
export const cacheScope = new AsyncLocalStorage();

export class DynamicUsageError extends Error {
  constructor(fn) {
    super(`${fn}() needs a request, so it cannot be used while a page is prerendered at build time. The page is rendered per request instead.`);
    this.name = "DynamicUsageError";
    this.digest = DYNAMIC;
  }
}

/** A fresh per-request store (the server creates one per request, ISR regeneration one per render). */
export function newStore(headers = new Headers(), cookies = {}) {
  return { headers, cookies, dynamic: false, setCookies: [], afterTasks: [], tags: new Set(), locale: null };
}

function store(fn) {
  const s = als.getStore();
  if (!s) throw new DynamicUsageError(fn);
  s.dynamic = true; // the response depends on the request: never cache it (ISR) or prerender it
  return s;
}

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** -> a Set-Cookie header value. Defaults: Path=/ ; sameSite "lax" | "strict" | "none" ; maxAge in seconds ; expires: Date. */
export function serializeCookie(name, value, o = {}) {
  if (typeof name !== "string" || !COOKIE_NAME.test(name)) throw new TypeError(`cookies().set(): invalid cookie name ${JSON.stringify(name)}`);
  const parts = [`${name}=${encodeURIComponent(String(value))}`, `Path=${o.path ?? "/"}`];
  if (o.domain) parts.push(`Domain=${o.domain}`);
  if (o.maxAge !== undefined) parts.push(`Max-Age=${Math.trunc(Number(o.maxAge))}`);
  if (o.expires) parts.push(`Expires=${new Date(o.expires).toUTCString()}`);
  if (o.httpOnly) parts.push("HttpOnly");
  if (o.secure) parts.push("Secure");
  if (o.sameSite) {
    const v = String(o.sameSite).toLowerCase();
    if (!["lax", "strict", "none"].includes(v)) throw new TypeError('cookies().set(): sameSite must be "lax", "strict" or "none"');
    parts.push(`SameSite=${v[0].toUpperCase()}${v.slice(1)}`);
  }
  if (/[\r\n;]/.test(String(o.path ?? "") + String(o.domain ?? ""))) throw new TypeError("cookies().set(): invalid path or domain");
  return parts.join("; ");
}

/** The request's cookies. get/getAll/has read; set/delete add a Set-Cookie header to the response (route handlers, middleware, Server Actions). */
export function cookies() {
  const st = store("cookies");
  const all = st.cookies;
  return {
    set(name, value, options) {
      if (typeof name === "object" && name) { options = name; value = name.value; name = name.name; }
      st.setCookies.push(serializeCookie(name, value, options));
      all[name] = String(value);
      return this;
    },
    delete(name, options = {}) {
      st.setCookies.push(serializeCookie(name, "", { ...options, maxAge: 0, expires: new Date(0) }));
      delete all[name];
      return this;
    },
    get: (name) => (name in all ? { name, value: all[name] } : undefined),
    getAll: () => Object.entries(all).map(([name, value]) => ({ name, value })),
    has: (name) => name in all,
    toString: () => Object.entries(all).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; "),
  };
}

/** The request's headers as a (read-only by convention) Headers object. */
export function headers() {
  return store("headers").headers;
}

// ---------------------------------------------------------------------------------------------- draftMode
const DRAFT_COOKIE = "__nepx_draft";
// Signed so a visitor cannot switch draft mode on by hand. Set NEPX_DRAFT_SECRET to share it between processes / restarts.
const DRAFT_SECRET = process.env.NEPX_DRAFT_SECRET || crypto.randomBytes(32).toString("hex");
const draftToken = () => crypto.createHmac("sha256", DRAFT_SECRET).update("nepx-draft-mode").digest("hex");
const sameToken = (a) => { const x = Buffer.from(String(a ?? "")), y = Buffer.from(draftToken()); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** True when the request carries a valid draft-mode cookie (the server uses it to skip prerendered / ISR copies). */
export const isDraftRequest = (cookieMap) => sameToken(cookieMap?.[DRAFT_COOKIE]);

/**
 * draftMode() -> { isEnabled, enable(), disable() }. Enable it from a route handler (e.g. /api/draft after checking a secret): the browser then
 * gets a signed cookie, pages are rendered per request (never prerendered / ISR-cached) and responses are `private, no-store`.
 */
export function draftMode() {
  const st = store("draftMode");
  return {
    get isEnabled() { return sameToken(st.cookies[DRAFT_COOKIE]); },
    enable() {
      const v = draftToken();
      st.setCookies.push(serializeCookie(DRAFT_COOKIE, v, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" }));
      st.cookies[DRAFT_COOKIE] = v;
    },
    disable() {
      st.setCookies.push(serializeCookie(DRAFT_COOKIE, "", { httpOnly: true, sameSite: "lax", maxAge: 0, expires: new Date(0) }));
      delete st.cookies[DRAFT_COOKIE];
    },
  };
}

// ---------------------------------------------------------------------------------------------- after / connection / noStore / cacheTag
/** Run `fn` after the response has been sent (logging, analytics, cache warming). Errors are logged and never reach the client. */
export function after(fn) {
  if (typeof fn !== "function") throw new TypeError("after() needs a function");
  const st = als.getStore();
  if (!st) throw new DynamicUsageError("after");
  st.afterTasks.push(fn);
}

/** Older name for after(). */
export const unstable_after = after;

/** `await connection()` marks the page as dynamic: it needs a real request and is never prerendered or ISR-cached. */
export async function connection() { store("connection"); }
/** Opt the current render out of prerendering / ISR caching (`unstable_noStore`). */
export function unstable_noStore() { store("unstable_noStore"); }

/** Tag the page being rendered; `revalidateTag(tag)` later drops its cached (ISR) copy. A no-op while prerendering at build time. */
export function cacheTag(...tags) {
  for (const t of tags) if (typeof t !== "string" || !t) throw new TypeError("cacheTag(): tags must be non-empty strings");
  const scope = cacheScope.getStore(); // inside a "use cache" function the tags belong to that cache entry (and reach the page through it)
  if (scope) for (const t of tags) scope.tags.add(t);
  const st = als.getStore();
  if (st) for (const t of tags) st.tags.add(t);
}

/** getLocale() - the locale of the current request (config.i18n), e.g. "id"; the default locale outside a request; null when i18n is off. */
export function getLocale() {
  return als.getStore()?.locale ?? process.env.NEPX_DEFAULT_LOCALE ?? null;
}
