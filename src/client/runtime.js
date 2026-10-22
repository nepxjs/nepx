// Browser runtime: hydration, client-side routing, data fetching for getServerSideProps pages,
// loading.jsx while navigating, nested not-found / error boundaries, prefetching, soft refresh and <head> metadata updates.
import { createElement as h, Component, StrictMode, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { splitLocale } from "../i18n.js";
import { matchRoute, matchSlot, matchIntercept, segmentsFor } from "../match.js";
import { setImageDefaults } from "../components.js";
import { RouterContext, subscribe, getSnapshot, navigate, consumeScroll, setRouterHooks, setClientBasePath, setClientI18n, withBase } from "../link.js";
import { metadataToTags } from "../metadata.js";
import { isNotFoundError, queryObject } from "../shared.js";
import { defaultNotFound } from "../views/not-found.js";

const PREFETCH_TTL = 30_000;

function toSegments(pathname) {
  if (pathname === "/") return [];
  const parts = pathname.slice(1).split("/");
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  try { return parts.map(decodeURIComponent); } catch { return null; }
}

/** Mirror the server's <head>: title + tags the server marked with data-nepx are replaced. */
function applyMetadata(m = {}) {
  document.title = m.title || "Nepx App";
  document.head.querySelectorAll("[data-nepx]").forEach((el) => el.remove());
  // The server's default viewport tag has no data-nepx: a `viewport` export replaces it, and it comes back on pages without one.
  const custom = !!m.viewport && typeof m.viewport === "object";
  if (custom) document.head.querySelectorAll('meta[name="viewport"]:not([data-nepx])').forEach((el) => el.remove());
  for (const { tag, attrs } of metadataToTags(m)) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.setAttribute("data-nepx", "");
    document.head.append(el);
  }
  if (!custom && !document.head.querySelector('meta[name="viewport"]')) {
    const el = document.createElement("meta");
    el.setAttribute("name", "viewport"); el.setAttribute("content", "width=device-width, initial-scale=1");
    document.head.append(el);
  }
}

// A boundary that forgets its error when the URL changes (so layouts around it can stay mounted).
class ResettingBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null, snap: props.snap }; }
  static getDerivedStateFromError(err) { return { err }; }
  static getDerivedStateFromProps(props, state) { return props.snap !== state.snap ? { snap: props.snap, err: null } : null; }
}

// Catches notFound() thrown while rendering in the browser and swaps in the not-found view.
class NotFoundBoundary extends ResettingBoundary {
  render() {
    if (!this.state.err) return this.props.children;
    if (!isNotFoundError(this.state.err)) throw this.state.err;
    return this.props.fallback();
  }
}

const errorInfo = (err) => ({
  message: process.env.NODE_ENV === "production" ? "An error occurred while rendering this page." : String((err && err.message) || err),
  digest: err && err.digest,
});

// error.jsx: catches render errors below it and shows the error component with a reset() to try again.
class ErrorBoundary extends ResettingBoundary {
  reset = () => this.setState({ err: null });
  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    if (isNotFoundError(err)) throw err; // handled by the NotFoundBoundary above
    return h(this.props.Comp, { error: errorInfo(err), reset: this.reset });
  }
}

// Outermost boundary (only when the project has global-error.*): whatever no error.* caught ends up here. notFound() is not an error.
class GlobalErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    if (isNotFoundError(err)) throw err;
    return this.props.render(err, () => this.setState({ err: null }));
  }
}

export function mountNepx({ routes, slotTable = {}, NotFound, ErrorPage, GlobalError, rootLayout, strictMode = false }) {
  const rootEl = document.getElementById("root");
  let boot = null;
  try { boot = JSON.parse(document.getElementById("__NEPX_DATA__")?.textContent || "null"); } catch { /* ignore */ }
  const base = (boot && boot.basePath) || "";
  setClientBasePath(base);
  setImageDefaults({ basePath: base, images: (boot && boot.images) || null }); // getImageProps() outside a component
  const i18n = boot && boot.i18n ? { locales: boot.i18n.locales, defaultLocale: boot.i18n.defaultLocale, detection: true } : null; // config.i18n
  setClientI18n(i18n);
  const noLoc = (p) => (i18n ? splitLocale(p, i18n).pathname : p);

  // `resolved` is set when a rewrite serves another route's content at this URL.
  const resolve = (snap, resolved) => {
    const url = new URL(snap, location.origin);
    const segs = toSegments(resolved || noLoc(url.pathname));
    const found = segs && matchRoute(routes, segs);
    return { url, found };
  };

  // layouts wrap the element; the optional error boundary sits inside the layouts above error.jsx.
  // `ex` (main page only): { segs, slotProps, loading } -> templates remount when URL segment `template` changes, slots arrive as props,
  // loading.jsx is a Suspense boundary (the same tree the server renders).
  const wrap = (el, layouts, params, snap, err, ex = {}) => {
    const segs = ex.segs ?? toSegments(noLoc(new URL(snap, location.origin).pathname)) ?? [];
    for (let i = layouts.length; i >= 0; i--) {
      if (ex.loading && i === ex.loading.layouts.length) el = h(Suspense, { fallback: h(ex.loading.mod.default) }, el);
      if (err && i === err.layouts.length) el = h(ErrorBoundary, { snap, Comp: err.Comp }, el);
      if (i > 0) {
        const L = layouts[i - 1];
        el = L.template !== undefined ? h(L.default, { params, key: segs[L.template] ?? "" }, el) : h(L.default, { params, ...((ex.slotProps && ex.slotProps[i - 1]) || {}) }, el);
      }
    }
    return el;
  };
  // parallel routes: the element of every @slot of this page for the current URL (or the intercepting page). null = a slot without page and default.* -> not found
  const slotPropsFor = (found, segs, url, intercept) => {
    const out = {};
    for (const s of found.route.slots || []) {
      const def = slotTable[s.key];
      if (!def) continue;
      let mod, params = found.params;
      if (intercept && intercept.key === s.key) { mod = intercept.mod; params = intercept.params; }
      else { const m = matchSlot(def, segs); if (m) { mod = m.route.mod; params = m.params; } else mod = def.default; }
      if (!mod) return null;
      (out[s.layoutIndex] ??= {})[s.name] = h(mod.default, { params, searchParams: queryObject(url.searchParams) });
    }
    return out;
  };
  // Intercepting routes: a client-side navigation to `snap` that an @slot of the page on screen intercepts -> { key, mod, params }.
  const findIntercept = (mainSnap, resolved, snap) => {
    const cur = resolve(mainSnap, resolved).found;
    if (!cur || !cur.route.slots || !cur.route.slots.length) return null;
    const segs = toSegments(noLoc(new URL(snap, location.origin).pathname));
    if (!segs) return null;
    for (const s of cur.route.slots) {
      const m = slotTable[s.key] && matchIntercept(slotTable[s.key], segs);
      if (m) return { key: s.key, mod: m.route.mod, params: m.params };
    }
    return null;
  };

  // The not-found view for a route: nearest not-found.jsx inside the layouts around it (falls back to the root one).
  const notFoundTree = (found, snap) => {
    const s = found && found.route.notFound;
    const Comp = s ? s.mod.default : NotFound;
    const layouts = s ? s.layouts : rootLayout ? [rootLayout] : [];
    return wrap(Comp ? h(Comp) : defaultNotFound(h), layouts, found ? found.params : {}, snap, null);
  };
  const errorScopeFor = (found) => {
    const s = found && found.route.errorScope;
    if (s) return { Comp: s.mod.default, layouts: s.layouts };
    return ErrorPage ? { Comp: ErrorPage, layouts: rootLayout ? [rootLayout] : [] } : null;
  };

  // ---- data for client-side navigation: prefetched copies live for 30s and are used once ----
  const prefetched = new Map(); // snap -> { at, promise }
  // static export (nepx export): there is no server to ask, so every navigation is a normal page load
  const request = (snap) => (boot && boot.static ? Promise.reject(new Error("static export")) : fetch(base + "/_nepx/data?path=" + encodeURIComponent(snap)).then((r) => r.json()));
  const takeData = (snap) => {
    const hit = prefetched.get(snap);
    prefetched.delete(snap);
    return hit && Date.now() - hit.at < PREFETCH_TTL ? hit.promise : request(snap);
  };
  let bump = () => {};
  setRouterHooks({
    prefetch(snap, force) {
      if (snap === getSnapshot()) return;
      const hit = prefetched.get(snap);
      if (hit && Date.now() - hit.at < PREFETCH_TTL) return;
      const { found } = resolve(snap);
      if (found && found.route.hasData && !force) return; // never run getServerSideProps just because a link was hovered
      const promise = request(snap);
      prefetched.set(snap, { at: Date.now(), promise });
      promise.catch(() => prefetched.delete(snap));
    },
    refresh: () => bump(),
  });

  function App() {
    const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [view, setView] = useState(() => ({ snap: getSnapshot(), mainSnap: null, intercept: null, props: boot?.props ?? null, notFound: !!boot?.notFound, error: boot?.error ?? null, metadata: boot?.metadata ?? {}, resolved: boot?.resolved ?? null }));
    const [tick, setTick] = useState(0);
    const token = useRef(0);
    const seenTick = useRef(0);
    const first = useRef(true);
    const firstMeta = useRef(true);
    bump = () => setTick((t) => t + 1);

    useEffect(() => {
      const refreshing = tick !== seenTick.current;
      seenTick.current = tick;
      if (snap === view.snap && !refreshing) return;
      const my = ++token.current;
      const mainSnap = view.mainSnap ?? view.snap;
      if (!refreshing) { // the page on screen stays, the @slot shows the intercepting page (a reload of this URL shows the full page)
        const ic = findIntercept(mainSnap, view.resolved, snap);
        if (ic) { setView((v) => ({ ...v, snap, mainSnap, intercept: ic })); return; }
      }
      // Every navigation asks the server (middleware may redirect/deny, getServerSideProps may supply data).
      (refreshing ? request(mainSnap) : takeData(snap))
        .then((res) => {
          if (my !== token.current) return;
          if (res.redirect) { navigate(res.redirect.destination, { replace: true }); return; }
          if (res.reload || res.error) { location.assign(withBase(base, snap)); return; }
          const keep = refreshing && view.intercept; // router.refresh() while an intercepting page is open refreshes the page behind it
          setView({ snap: keep ? view.snap : snap, mainSnap: keep ? mainSnap : null, intercept: keep ? view.intercept : null, props: res.props ?? null, notFound: !!res.notFound, error: null, metadata: res.metadata ?? {}, resolved: res.resolved ?? null });
        })
        .catch(() => { if (my === token.current) location.assign(withBase(base, snap)); });
    }, [snap, tick]);

    const { found } = resolve(view.mainSnap ?? view.snap, view.resolved); // the page on screen (behind an intercepting @slot page it is the previous one)
    const url = new URL(view.snap, location.origin);
    const errScope = errorScopeFor(found);
    const showError = !!(view.error && errScope);
    const segs = found ? segmentsFor(found.route, found.params) : [];
    const slotProps = !showError && !view.notFound && found && found.route.slots && found.route.slots.length ? slotPropsFor(found, segs, url, view.intercept) : {};
    const isNotFound = !showError && (view.notFound || !found || slotProps === null);

    useEffect(() => {
      if (first.current) { first.current = false; return; }
      if (view.intercept) return; // an intercepting page opens over the current one: keep the scroll position
      const doScroll = consumeScroll(); // router.push(href, { scroll: false }) / <Link scroll={false}> keep the position
      if (!location.hash && doScroll) window.scrollTo(0, 0);
      rootEl.focus({ preventScroll: true });
    }, [view.snap]);
    useEffect(() => {
      if (firstMeta.current) { firstMeta.current = false; return; }
      applyMetadata(view.metadata);
    }, [view.metadata]);

    const ctx = useMemo(() => ({ pathname: noLoc(url.pathname), i18n: i18n ? { locale: splitLocale(url.pathname, i18n).locale ?? i18n.defaultLocale, locales: i18n.locales, defaultLocale: i18n.defaultLocale } : undefined, searchParams: url.searchParams, params: isNotFound || showError || !found ? {} : found.params, basePath: base, images: (boot && boot.images) || null }), [view.snap, isNotFound, showError]);

    // While the next page loads, show the nearest loading.jsx of the target route inside the layouts that stay mounted.
    const target = snap !== view.snap && !findIntercept(view.mainSnap ?? view.snap, view.resolved, snap) ? resolve(snap) : null;
    const loading = target && target.found && target.found.route.loading;

    let tree;
    if (loading) tree = wrap(h(loading.mod.default), loading.layouts, target.found.params, view.snap, null);
    else if (showError) tree = wrap(h(errScope.Comp, { error: view.error, reset: () => bump() }), errScope.layouts, found ? found.params : {}, view.snap, null);
    else if (isNotFound) tree = notFoundTree(found, view.snap);
    else tree = wrap(h(found.route.page.default, { params: found.params, searchParams: queryObject(url.searchParams), ...(view.props || {}) }), found.route.layouts, found.params, view.snap, errScope, { segs, slotProps, loading: found.route.loading });
    return h(RouterContext.Provider, { value: ctx }, h(NotFoundBoundary, { snap: view.snap, fallback: () => notFoundTree(found, view.snap) }, tree));
  }

  // notFound() is control flow, not a bug: keep it out of the console.
  // In development, errors caught by an error.jsx boundary also go to the Nepx error overlay (as the collapsed badge: the
  // app's own error UI is showing). Uncaught errors and hydration mismatches reach it through the window "error" event.
  const opts = {
    onCaughtError: (err, info) => {
      if (isNotFoundError(err)) return;
      console.error(err, info && info.componentStack);
      if (process.env.NODE_ENV !== "production" && window.__nepxOverlay) window.__nepxOverlay.report(err, { kind: "Runtime Error", handled: true, componentStack: info && info.componentStack });
    },
  };
  // global-error.*: the server rendered it (boot.globalError), or an error escaped every error.* boundary in the browser.
  const globalView = (err, reset) => h(GlobalError, { error: errorInfo(err), reset });
  const tree = !GlobalError ? h(App)
    : boot && boot.globalError ? h(GlobalError, { error: boot.error, reset: () => location.reload() })
    : h(GlobalErrorBoundary, { render: globalView }, h(App));
  const root = strictMode ? h(StrictMode, null, tree) : tree; // config.reactStrictMode
  if (rootEl.hasChildNodes()) hydrateRoot(rootEl, root, opts);
  else createRoot(rootEl, opts).render(root);
}
