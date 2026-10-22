// Isomorphic: runs on the server (SSR) and in the browser. "react" is always the project's copy.
import { createContext, createElement as h, useCallback, useContext, useEffect, useState } from "react";
import { withBase, stripBase } from "./base.js";
import { withLocale, stripLocale, splitLocale } from "./i18n.js";
export { withBase, stripBase };

export const RouterContext = createContext({ pathname: "/", searchParams: new URLSearchParams(), params: {}, basePath: "" });

// basePath (nepx.config.js): the browser runtime sets it once; on the server it travels through RouterContext.
let clientBase = "";
export const setClientBasePath = (b) => { clientBase = b || ""; };
export const getClientBasePath = () => clientBase;
// config.i18n: { locales, defaultLocale, detection } set once by the browser runtime; the current locale is whatever the address bar says.
/**
 * next/link URL objects: { pathname, query, search, hash } -> string. `[id]`, `[...slug]` and `[[...slug]]` in pathname are filled from query
 * (and removed from the search string); other query keys become ?a=1&b=2 (arrays repeat the key; undefined / null are skipped).
 */
export function formatHref(href) {
  if (typeof href === "string" || href === null || typeof href !== "object") return href;
  if (typeof URL !== "undefined" && href instanceof URL) return href.href;
  const query = href.query && typeof href.query === "object" ? href.query : null;
  const used = new Set();
  const pathname = String(href.pathname ?? "").replace(/\[\[\.\.\.([^\]]+)\]\]|\[\.\.\.([^\]]+)\]|\[([^\]]+)\]/g, (m, opt, rest, one) => {
    const key = opt || rest || one, v = query ? query[key] : undefined;
    used.add(key);
    if (v === undefined || v === null || (Array.isArray(v) && !v.length)) {
      if (opt) return "";
      throw new TypeError(`Link href: missing value for "${key}" in ${href.pathname} (pass it in query)`);
    }
    return Array.isArray(v) ? v.map((x) => encodeURIComponent(String(x))).join("/") : encodeURIComponent(String(v));
  }).replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1");
  let search = "";
  if (query) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (used.has(k) || v === undefined || v === null) continue;
      for (const x of Array.isArray(v) ? v : [v]) sp.append(k, String(x));
    }
    search = sp.toString();
  } else if (typeof href.query === "string") search = href.query.replace(/^\?/, "");
  if (!search && typeof href.search === "string") search = href.search.replace(/^\?/, "");
  const hash = href.hash ? "#" + String(href.hash).replace(/^#/, "") : "";
  return pathname + (search ? "?" + search : "") + hash;
}

let clientI18n = null;
export const setClientI18n = (i) => { clientI18n = i || null; };
/** locale: undefined = keep the current one, false = href exactly as written, "id" = that locale. */
function localizeClient(href, locale) {
  if (!clientI18n || locale === false || typeof href !== "string") return href;
  if (locale !== undefined) return withLocale(stripLocale(href, clientI18n), locale, clientI18n);
  return withLocale(href, splitLocale(stripBase(clientBase, location.pathname), clientI18n).locale ?? clientI18n.defaultLocale, clientI18n);
}
const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getSnapshot = () => stripBase(clientBase, location.pathname) + location.search;
const notify = () => listeners.forEach((fn) => fn());
if (typeof window !== "undefined") window.addEventListener("popstate", notify);

/** Programmatic navigation (browser only). External URLs do a normal page load. */
let scrollNext = true;
/** True unless the navigation that just happened asked for { scroll: false } (read once by the browser runtime). */
export const consumeScroll = () => { const v = scrollNext; scrollNext = true; return v; };
export function navigate(href, { replace = false, locale, scroll = true } = {}) {
  href = formatHref(href);
  if (typeof window === "undefined") throw new Error("navigate() can only be called in the browser");
  const url = new URL(withBase(clientBase, localizeClient(href, locale)), location.href);
  if (url.origin !== location.origin) { location.assign(url.href); return; }
  const target = url.pathname + url.search + url.hash;
  if (target === location.pathname + location.search + location.hash) return;
  const started = globalThis.__NEPX_ROUTER_TRANSITION_START__; // instrumentation-client.js: onRouterTransitionStart(url, "push" | "replace")
  if (typeof started === "function") { try { started(target, replace ? "replace" : "push"); } catch (e) { console.error(e); } }
  history[replace ? "replaceState" : "pushState"](null, "", target);
  scrollNext = scroll !== false;
  notify();
}

// The browser runtime plugs in what prefetching / soft refresh actually do (nothing happens on the server).
let prefetchHook = null, refreshHook = null;
export const setRouterHooks = (hooks) => { prefetchHook = hooks.prefetch ?? null; refreshHook = hooks.refresh ?? null; };

/** Re-run middleware, getServerSideProps and generateMetadata for the current page (also what a Server Action does after revalidatePath). */
export const refresh = () => (refreshHook ? refreshHook() : location.reload());

/** Warm the data for a client-side navigation. Pages with getServerSideProps are only prefetched when force is true. */
export function prefetch(href, force = false, locale) {
  href = formatHref(href);
  if (typeof window === "undefined" || !prefetchHook) return;
  try {
    const url = new URL(withBase(clientBase, localizeClient(href, locale)), location.href);
    if (url.origin === location.origin) prefetchHook(stripBase(clientBase, url.pathname) + url.search, force);
  } catch { /* ignore bad hrefs */ }
}

let observer = null;
const watched = new WeakMap();
function watch(node, href, force) {
  if (typeof IntersectionObserver === "undefined") return;
  observer ??= new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { const w = watched.get(e.target); observer.unobserve(e.target); if (w) prefetch(w.href, w.force, false); }
  });
  watched.set(node, { href, force });
  observer.observe(node);
}

const IDLE = { pending: false }, PENDING = { pending: true };
const LinkStatusContext = createContext(IDLE);
/** Inside a <Link>'s children: { pending } is true from the click until the next page has loaded (use it for a spinner). Outside a Link it is always false. */
export const useLinkStatus = () => useContext(LinkStatusContext);

/** <a> with client-side navigation. Links prefetch on hover/focus/touch (and when visible, in production); prefetch={false} turns it off. Modifier keys, targets, downloads, external and hash-only links keep browser behavior. */
export function Link({ href: hrefObj, locale: localeProp, onClick, onMouseEnter, onFocus, onTouchStart, prefetch: prefetchProp, ref: userRef, target, replace, scroll = true, onNavigate, children, ...rest }) {
  const hrefProp = formatHref(hrefObj);
  const router = useContext(RouterContext);
  const base = router.basePath || "";
  const i18n = router.i18n; // config.i18n: links keep the current locale; locale="id" switches, locale={false} leaves href alone
  const rawHref = !i18n || localeProp === false || typeof hrefProp !== "string" ? hrefProp : withLocale(localeProp !== undefined ? stripLocale(hrefProp, i18n) : hrefProp, localeProp ?? i18n.locale, i18n);
  const href = withBase(base, rawHref);
  const [pending, setPending] = useState(false);
  const here = router.pathname + "?" + router.searchParams + (i18n ? "#" + i18n.locale : ""); // changes when a navigation has committed
  useEffect(() => { setPending(false); }, [here]); // what the <a> points at (with the basePath); navigate()/prefetch() add it themselves
  const warm = () => { if (prefetchProp !== false) prefetch(rawHref, prefetchProp === true, false); };
  const setRef = useCallback((node) => {
    if (typeof userRef === "function") userRef(node); else if (userRef) userRef.current = node;
    if (node && prefetchProp !== false && process.env.NODE_ENV === "production") {
      watch(node, rawHref, prefetchProp === true);
      return () => { observer && observer.unobserve(node); };
    }
  }, [rawHref, prefetchProp, userRef]);
  return h("a", {
    ...rest, href, target, ref: setRef,
    onMouseEnter(e) { if (onMouseEnter) onMouseEnter(e); warm(); },
    onFocus(e) { if (onFocus) onFocus(e); warm(); },
    onTouchStart(e) { if (onTouchStart) onTouchStart(e); warm(); },
    onClick(e) {
      if (onClick) onClick(e);
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if ((target && target !== "_self") || rest.download != null) return;
      let url;
      try { url = new URL(href, location.href); } catch { return; }
      if (url.origin !== location.origin) return;
      if (url.hash && url.pathname === location.pathname && url.search === location.search) return;
      if (typeof onNavigate === "function") { // onNavigate: runs before a client-side navigation and can cancel it
        let stop = false;
        onNavigate({ preventDefault() { stop = true; } });
        if (stop) { e.preventDefault(); return; }
      }
      e.preventDefault();
      if (url.pathname + url.search !== location.pathname + location.search) setPending(true);
      navigate(rawHref, { replace, locale: false, scroll });
    },
  }, h(LinkStatusContext.Provider, { value: pending ? PENDING : IDLE }, children));
}

export const usePathname = () => useContext(RouterContext).pathname;
export const useSearchParams = () => useContext(RouterContext).searchParams;
/** Route params of the current page, e.g. { id: "5" } on /users/[id]. */
export const useParams = () => useContext(RouterContext).params;
export function useRouter() {
  const i18n = useContext(RouterContext).i18n;
  return {
    /** Current locale and the configured ones (config.i18n), else null. */
    locale: i18n ? i18n.locale : null, locales: i18n ? i18n.locales : null, defaultLocale: i18n ? i18n.defaultLocale : null,
    push: (href, opts) => navigate(href, { locale: opts && opts.locale, scroll: opts ? opts.scroll : undefined }),
    replace: (href, opts) => navigate(href, { replace: true, locale: opts && opts.locale, scroll: opts ? opts.scroll : undefined }),
    back: () => history.back(),
    forward: () => history.forward(),
    prefetch: (href) => prefetch(href, true),
    /** Re-run middleware, getServerSideProps and generateMetadata for the current page without a reload. */
    refresh: () => (refreshHook ? refreshHook() : location.reload()),
  };
}

/** The current locale (config.i18n), e.g. "id"; null when i18n is off. */
export const useLocale = () => { const i = useContext(RouterContext).i18n; return i ? i.locale : null; };
