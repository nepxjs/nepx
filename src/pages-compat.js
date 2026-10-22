// Pages-Router era modules, mapped onto Nepx: next/head, next/router (Router, withRouter, router fields), next/amp, next/error,
// next/constants, next/legacy/image. Isomorphic (server render + browser).
import { createElement as h, createContext, Component, Children, Fragment, cloneElement, isValidElement, useContext, useEffect, useId } from "react";
import { RouterContext, formatHref, useRouter as useAppRouter, navigate, prefetch, refresh as softRefresh, subscribe, getSnapshot } from "./link.js";
import { InsertedHtmlContext, useServerInsertedHTML } from "./hooks.js";
import { Image } from "./components.js";

// ---------------------------------------------------------------------------------------------- next/head
const flat = (children) => {
  const out = [];
  for (const c of Children.toArray(children)) {
    if (isValidElement(c) && c.type === Fragment) out.push(...flat(c.props.children));
    else if (isValidElement(c)) out.push(c);
  }
  return out;
};
const seen = new WeakMap(); // server: collector -> ids of the <Head>s that already added their markup (components may render twice)
const ATTR = { className: "class", htmlFor: "for", httpEquiv: "http-equiv", charSet: "charset", crossOrigin: "crossorigin", fetchPriority: "fetchpriority", hrefLang: "hreflang", referrerPolicy: "referrerpolicy", noModule: "nomodule" };
const textOf = (children) => Children.toArray(children).filter((c) => typeof c === "string" || typeof c === "number").join("");

/**
 * <Head><title>..</title><meta .../><link .../></Head> - put tags into the document <head> from any component (next/head).
 * Server: written into the page <head>. Browser: added on mount, removed on unmount; a <title> sets document.title.
 * Prefer `metadata` / `generateMetadata` for new code; <Head> is for markup those cannot express.
 */
function PageHead({ children }) {
  const id = useId();
  const collector = useContext(InsertedHtmlContext);
  useServerInsertedHTML(() => {
    const done = seen.get(collector) ?? seen.set(collector, new Set()).get(collector);
    if (done.has(id)) return null;
    done.add(id);
    return h(Fragment, null, flat(children).map((el, i) => cloneElement(el, { key: i, "data-nepx-head": id })));
  });
  const sig = flat(children).map((el) => el.type + JSON.stringify(el.props, (k, v) => (k === "children" && typeof v !== "string" ? undefined : v))).join("|") + textOf(flat(children).map((e) => e.props.children));
  useEffect(() => {
    document.head.querySelectorAll(`[data-nepx-head="${CSS.escape(id)}"]`).forEach((n) => n.remove()); // the server-rendered copy
    const added = [];
    let prevTitle = null;
    for (const el of flat(children)) {
      if (el.type === "title") { prevTitle ??= document.title; document.title = textOf(el.props.children); continue; }
      if (typeof el.type !== "string") continue;
      const node = document.createElement(el.type);
      for (const [k, v] of Object.entries(el.props)) {
        if (k === "children" || k === "key" || v === undefined || v === false || typeof v === "function") continue;
        if (k === "dangerouslySetInnerHTML") { node.innerHTML = v.__html; continue; }
        node.setAttribute(ATTR[k] ?? k, v === true ? "" : String(v));
      }
      const text = textOf(el.props.children);
      if (text) node.textContent = text;
      node.setAttribute("data-nepx-head", id);
      document.head.appendChild(node); added.push(node);
    }
    return () => { added.forEach((n) => n.remove()); if (prevTitle !== null) document.title = prevTitle; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Inside pages/_document, <Head> is the document <head>; everywhere else it adds tags to the page head (see PageHead). */
export const DocumentContext = createContext(false);
export function Head(props) { return useContext(DocumentContext) ? h("head", null, props.children) : h(PageHead, props); }
// next/document: placeholders, the real markup is assembled by pages-document.js
export const Html = ({ children, ...rest }) => h("html", rest, children);
export const Main = () => h("nepx-main");
export const NextScript = () => h("nepx-script");
export class Document extends Component { render() { return h(Html, null, h(Head), h("body", null, h(Main), h(NextScript))); } }

/** next/app: `class MyApp extends App` (or the default getInitialProps) - the base of pages/_app. */
export class App extends Component {
  static async getInitialProps({ Component: Page, ctx }) {
    return { pageProps: Page && typeof Page.getInitialProps === "function" ? (await Page.getInitialProps(ctx)) ?? {} : {} };
  }
  render() { const { Component: Page, pageProps } = this.props; return h(Page, pageProps); }
}
App.getInitialProps.nepxDefault = true; // the inherited default does not make pages/_app "custom" (see isCustomAppGip in router.js / ssr.js)

// ---------------------------------------------------------------------------------------------- next/amp
/** AMP is not supported: always false (kept so `useAmp()` calls from older code keep working). */
export const useAmp = () => false;
export const isInAmpMode = () => false;

// ---------------------------------------------------------------------------------------------- next/router
const events = (() => {
  const map = new Map();
  return {
    on(name, fn) { (map.get(name) ?? map.set(name, new Set()).get(name)).add(fn); },
    off(name, fn) { map.get(name)?.delete(fn); },
    emit(name, ...args) { for (const fn of [...(map.get(name) ?? [])]) { try { fn(...args); } catch (e) { console.error(e); } } },
  };
})();
if (typeof window !== "undefined") {
  let last = getSnapshot();
  subscribe(() => { const now = getSnapshot(); if (now !== last) { events.emit("routeChangeStart", now, { shallow: false }); last = now; events.emit("routeChangeComplete", now, { shallow: false }); } });
}
const queryOf = (params, searchParams) => {
  const q = {};
  for (const k of new Set(searchParams.keys())) { const all = searchParams.getAll(k); q[k] = all.length > 1 ? all : all[0]; }
  return { ...q, ...params };
};
const urlOf = (url) => formatHref(url);

/**
 * useRouter() - the App Router object (push, replace, back, forward, refresh, prefetch, locale) plus the Pages Router fields
 * `pathname`, `query` (route params + search params), `asPath`, `isReady`, `route` and `events`.
 */
export function useRouter() {
  const ctx = useContext(RouterContext);
  const r = useAppRouter();
  const search = ctx.searchParams.toString();
  return {
    ...r,
    pathname: ctx.pathname, route: ctx.pathname, query: queryOf(ctx.params ?? {}, ctx.searchParams), asPath: ctx.pathname + (search ? "?" + search : ""),
    basePath: ctx.basePath || "", isReady: true, isFallback: false, isPreview: false, events,
    push: (url, as, opts) => r.push(urlOf(as && typeof as === "string" ? as : url), opts ?? (as && typeof as === "object" ? as : undefined)),
    replace: (url, as, opts) => r.replace(urlOf(as && typeof as === "string" ? as : url), opts ?? (as && typeof as === "object" ? as : undefined)),
    reload: () => location.reload(),
    beforePopState: () => {},
  };
}

const noRouter = () => { throw new Error('No router instance found: the singleton "Router" only works in the browser. On the server use the hooks (useRouter) or redirect().'); };
/** The singleton router (browser only): Router.push("/x"), Router.replace, Router.back, Router.reload, Router.prefetch, Router.events, Router.pathname ... */
export const Router = {
  push: (url, as, opts) => { if (typeof window === "undefined") noRouter(); navigate(urlOf(typeof as === "string" ? as : url), typeof as === "object" ? as : opts); return Promise.resolve(true); },
  replace: (url, as, opts) => { if (typeof window === "undefined") noRouter(); navigate(urlOf(typeof as === "string" ? as : url), { replace: true, ...(typeof as === "object" ? as : opts) }); return Promise.resolve(true); },
  back: () => { if (typeof window === "undefined") noRouter(); history.back(); },
  forward: () => { if (typeof window === "undefined") noRouter(); history.forward(); },
  reload: () => { if (typeof window === "undefined") noRouter(); location.reload(); },
  refresh: () => { if (typeof window === "undefined") noRouter(); return softRefresh(); },
  prefetch: (url) => { if (typeof window !== "undefined") prefetch(urlOf(url), true); return Promise.resolve(); },
  events,
  get pathname() { if (typeof window === "undefined") noRouter(); return location.pathname; },
  get asPath() { if (typeof window === "undefined") noRouter(); return location.pathname + location.search + location.hash; },
  get query() { if (typeof window === "undefined") noRouter(); return queryOf({}, new URLSearchParams(location.search)); },
};

/** withRouter(Component) - gives a component the `router` prop (what useRouter() returns). */
export function withRouter(Component) {
  const Wrapped = (props) => h(Component, { ...props, router: useRouter() });
  Wrapped.displayName = `withRouter(${Component.displayName || Component.name || "Component"})`;
  return Wrapped;
}

// ---------------------------------------------------------------------------------------------- next/error
const STATUS_TEXT = { 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "This page could not be found", 405: "Method Not Allowed", 408: "Request Timeout", 429: "Too Many Requests", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout" };
/** <ErrorPage statusCode={404} /> - the plain status page (next/error's default export). Use it inside error.jsx / not-found.jsx. */
export function ErrorPage({ statusCode, title, withDarkMode = true }) {
  const text = title ?? STATUS_TEXT[statusCode] ?? (statusCode ? "An unexpected error has occurred" : "Application error");
  const dark = withDarkMode ? "@media (prefers-color-scheme: dark){.nepx-err{color:#fff;background:#000}.nepx-err h1{border-color:rgba(255,255,255,.3)!important}}" : "";
  return h("div", { className: "nepx-err", style: { fontFamily: 'system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif', height: "100vh", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" } },
    h("style", { dangerouslySetInnerHTML: { __html: dark } }),
    h("div", null,
      statusCode ? h("h1", { style: { display: "inline-block", margin: "0 20px 0 0", padding: "0 23px 0 0", fontSize: 24, fontWeight: 500, verticalAlign: "top", lineHeight: "49px", borderRight: "1px solid rgba(0,0,0,.3)" } }, statusCode) : null,
      h("div", { style: { display: "inline-block" } }, h("h2", { style: { fontSize: 14, fontWeight: 400, lineHeight: "49px", margin: 0 } }, text, "."))));
}

// ---------------------------------------------------------------------------------------------- next/constants, next/legacy/image
export const PHASE_EXPORT = "phase-export";
export const PHASE_PRODUCTION_BUILD = "phase-production-build";
export const PHASE_PRODUCTION_SERVER = "phase-production-server";
export const PHASE_DEVELOPMENT_SERVER = "phase-development-server";
export const PHASE_TEST = "phase-test";
/** The phase the process is in (what `nepx.config.js` receives in function-style config). */
export const currentPhase = () => {
  const env = typeof process !== "undefined" && process.env ? process.env : {};
  return env.NEPX_PHASE ?? (env.NODE_ENV === "production" ? PHASE_PRODUCTION_SERVER : env.NODE_ENV === "test" ? PHASE_TEST : PHASE_DEVELOPMENT_SERVER);
};

/** next/legacy/image: layout-based props mapped onto <Image> (layout="fill" -> fill, "responsive"/"intrinsic"/"fixed" -> width/height). */
export function LegacyImage({ layout, objectFit, objectPosition, lazyBoundary, lazyRoot, style, ...rest }) {
  const fill = layout === "fill";
  return h(Image, { ...rest, fill, style: { ...(objectFit ? { objectFit } : null), ...(objectPosition ? { objectPosition } : null), ...(layout === "responsive" ? { width: "100%", height: "auto" } : null), ...style } });
}
