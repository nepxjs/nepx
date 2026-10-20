// Isomorphic: runs on the server (SSR) and in the browser. "react" is always the project's copy.
import { createContext, createElement as h, useCallback, useContext } from "react";
import { withBase, stripBase } from "./base.js";
export { withBase, stripBase };

export const RouterContext = createContext({ pathname: "/", searchParams: new URLSearchParams(), params: {}, basePath: "" });

// basePath (nepx.config.js): the browser runtime sets it once; on the server it travels through RouterContext.
let clientBase = "";
export const setClientBasePath = (b) => { clientBase = b || ""; };
export const getClientBasePath = () => clientBase;
const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getSnapshot = () => stripBase(clientBase, location.pathname) + location.search;
const notify = () => listeners.forEach((fn) => fn());
if (typeof window !== "undefined") window.addEventListener("popstate", notify);

/** Programmatic navigation (browser only). External URLs do a normal page load. */
export function navigate(href, { replace = false } = {}) {
  if (typeof window === "undefined") throw new Error("navigate() can only be called in the browser");
  const url = new URL(withBase(clientBase, href), location.href);
  if (url.origin !== location.origin) { location.assign(url.href); return; }
  const target = url.pathname + url.search + url.hash;
  if (target === location.pathname + location.search + location.hash) return;
  history[replace ? "replaceState" : "pushState"](null, "", target);
  notify();
}

// The browser runtime plugs in what prefetching / soft refresh actually do (nothing happens on the server).
let prefetchHook = null, refreshHook = null;
export const setRouterHooks = (hooks) => { prefetchHook = hooks.prefetch ?? null; refreshHook = hooks.refresh ?? null; };

/** Re-run middleware, getServerSideProps and generateMetadata for the current page (also what a Server Action does after revalidatePath). */
export const refresh = () => (refreshHook ? refreshHook() : location.reload());

/** Warm the data for a client-side navigation. Pages with getServerSideProps are only prefetched when force is true. */
export function prefetch(href, force = false) {
  if (typeof window === "undefined" || !prefetchHook) return;
  try {
    const url = new URL(withBase(clientBase, href), location.href);
    if (url.origin === location.origin) prefetchHook(stripBase(clientBase, url.pathname) + url.search, force);
  } catch { /* ignore bad hrefs */ }
}

let observer = null;
const watched = new WeakMap();
function watch(node, href, force) {
  if (typeof IntersectionObserver === "undefined") return;
  observer ??= new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { const w = watched.get(e.target); observer.unobserve(e.target); if (w) prefetch(w.href, w.force); }
  });
  watched.set(node, { href, force });
  observer.observe(node);
}

/** <a> with client-side navigation. Links prefetch on hover/focus/touch (and when visible, in production); prefetch={false} turns it off. Modifier keys, targets, downloads, external and hash-only links keep browser behavior. */
export function Link({ href: rawHref, onClick, onMouseEnter, onFocus, onTouchStart, prefetch: prefetchProp, ref: userRef, target, replace, children, ...rest }) {
  const base = useContext(RouterContext).basePath || "";
  const href = withBase(base, rawHref); // what the <a> points at (with the basePath); navigate()/prefetch() add it themselves
  const warm = () => { if (prefetchProp !== false) prefetch(rawHref, prefetchProp === true); };
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
      e.preventDefault();
      navigate(rawHref, { replace });
    },
  }, children);
}

export const usePathname = () => useContext(RouterContext).pathname;
export const useSearchParams = () => useContext(RouterContext).searchParams;
/** Route params of the current page, e.g. { id: "5" } on /users/[id]. */
export const useParams = () => useContext(RouterContext).params;
export function useRouter() {
  return {
    push: (href) => navigate(href),
    replace: (href) => navigate(href, { replace: true }),
    back: () => history.back(),
    forward: () => history.forward(),
    prefetch: (href) => prefetch(href, true),
    /** Re-run middleware, getServerSideProps and generateMetadata for the current page without a reload. */
    refresh: () => (refreshHook ? refreshHook() : location.reload()),
  };
}
