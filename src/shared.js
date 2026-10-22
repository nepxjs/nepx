// Helpers usable from server code (getServerSideProps, route handlers, middleware) and pages.
import { HttpError } from "./errors/index.js";

/** Build a redirect Response. Works in route handlers and middleware. */
export function redirect(destination, status = 307) {
  if (typeof status === "string") status = 307; // redirect(url, RedirectType.replace): the type only matters in the browser router
  return new Response(null, { status, headers: { location: String(destination) } });
}

/** Like redirect() but permanent (308): browsers and search engines remember it. */
export function permanentRedirect(destination) { return redirect(destination, 308); }

const NOT_FOUND = "NEPX_NOT_FOUND";
export class NotFoundError extends Error {
  constructor() { super("This page could not be found."); this.name = "NotFoundError"; this.digest = NOT_FOUND; }
}
/** Stop rendering and show the nearest not-found page (status 404). Usable in pages, layouts and getServerSideProps. */
export function notFound() { throw new NotFoundError(); }
/** Digest-based so it also works across module instances (server vs. browser bundle). */
export const isNotFoundError = (e) => !!e && e.digest === NOT_FOUND;

export const DYNAMIC = "NEPX_DYNAMIC";
/** cookies()/headers() were called without a request (e.g. while prerendering). */
export const isDynamicError = (e) => !!e && e.digest === DYNAMIC;

/** Build a Response that continues the request (optionally adding response headers). Middleware only. */
export function next(init = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-nepx-continue", "1");
  return new Response(null, { status: 200, headers });
}

/** Build a Response that serves another route's content at the current URL (the URL in the browser does not change). Middleware only. */
export function rewrite(destination) {
  const d = String(destination);
  if (!d.startsWith("/") || d.startsWith("//")) throw new TypeError("rewrite(): destination must be a path starting with a single \"/\"");
  return new Response(null, { status: 200, headers: { "x-nepx-rewrite": d } });
}

/** Stop and show the 401 page (app/401.jsx or the built-in one). Usable in pages, layouts, getServerSideProps and middleware. */
export function unauthorized(message, init) { throw new HttpError(401, message, init); }
/** Stop and show the 403 page (app/403.jsx or the built-in one). */
export function forbidden(message, init) { throw new HttpError(403, message, init); }
/** Stop and show the page for any 4xx / 5xx status, e.g. httpError(429, "Slow down", { headers: { "retry-after": "30" } }). */
export function httpError(status, message, init) {
  if (!Number.isInteger(status) || status < 400 || status > 599) throw new TypeError("httpError(): status must be an integer between 400 and 599");
  throw new HttpError(status, message, init);
}

/** next/navigation's RedirectType: redirect(url, RedirectType.replace). Accepted for compatibility; every redirect is a 307 here. */
export const RedirectType = Object.freeze({ push: "push", replace: "replace" });

const READONLY = (m) => () => { throw new Error(`Method unavailable on \`ReadonlyURLSearchParams\`: ${m}() cannot change the URL's search parameters. Use router.push() / router.replace() with a new URL instead.`); };
/** next/navigation's ReadonlyURLSearchParams: a URLSearchParams whose append/delete/set/sort throw. */
export class ReadonlyURLSearchParams extends URLSearchParams {
  append = READONLY("append");
  delete = READONLY("delete");
  set = READONLY("set");
  sort = READONLY("sort");
}

/** True when pages/_app defines its own getInitialProps (the default inherited from `App` keeps the app statically optimised). */
export const isCustomAppGip = (fn) => typeof fn === "function" && fn.nepxDefault !== true;

/**
 * `searchParams` as page components and generateMetadata receive it: still a URLSearchParams (get / getAll / has / entries ...), and also a
 * plain-object view of the query, so Next.js style code works: `const { q } = await searchParams`, `searchParams.q`, `Object.keys(searchParams)`.
 * A repeated key gives an array. Not thenable, so `await searchParams` yields the same object.
 */
export function queryObject(sp) {
  if (!(sp instanceof URLSearchParams)) return sp;
  const valueOf = (k) => { const all = sp.getAll(k); return all.length > 1 ? all : all[0]; };
  return new Proxy(sp, {
    get(t, k) {
      const own = Reflect.get(t, k, t);
      if (typeof own === "function") return own.bind(t); // get, has, entries, [Symbol.iterator] ... always the URLSearchParams API
      if (typeof k === "string" && t.has(k)) return valueOf(k);
      return own; // size, [Symbol.toStringTag], undefined
    },
    has: (t, k) => (typeof k === "string" ? t.has(k) || k in t : k in t),
    ownKeys: (t) => [...new Set(t.keys())],
    getOwnPropertyDescriptor: (t, k) => (typeof k === "string" && t.has(k) ? { value: valueOf(k), enumerable: true, configurable: true, writable: false } : undefined),
  });
}
