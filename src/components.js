// next/image, next/script and next/dynamic equivalents. Isomorphic (server render + browser).
import { createElement as h, useContext, useEffect, useRef, useState, lazy, Suspense } from "react";
import { RouterContext, withBase, navigate } from "./link.js";

// ---------------------------------------------------------------------------------------------- Image
const dim = (v) => (v === undefined ? undefined : Number(v));
/**
 * <Image src alt width height> - an <img> with the performance defaults: lazy loading, async decoding, reserved space (no layout shift),
 * `priority` for the LCP image, `fill` for a parent-sized image, `placeholder="blur"` with `blurDataURL`.
 * Nepx does not resize or re-encode images (no `sharp` pipeline): `quality` and `unoptimized` are accepted and ignored.
 */
export function Image({ src, alt, width, height, fill = false, priority = false, loading, sizes, quality, placeholder = "empty", blurDataURL, unoptimized, style, className, onLoad, ref: userRef, ...rest }) {
  const base = useContext(RouterContext).basePath || "";
  const imgRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  if (src && typeof src === "object" && typeof src.src === "string") { width ??= src.width; height ??= src.height; src = src.src; }
  if (typeof src !== "string" || !src) throw new TypeError('<Image> needs a "src" string (a path under public/, an imported image or an absolute URL)');
  if (alt === undefined) throw new TypeError('<Image> needs an "alt" (use alt="" for a decorative image)');
  if (!fill && (!Number.isFinite(dim(width)) || !Number.isFinite(dim(height)))) throw new TypeError(`<Image src="${src}"> needs "width" and "height" (or the "fill" prop)`);
  if (fill && (width !== undefined || height !== undefined)) throw new TypeError(`<Image src="${src}"> cannot have both "fill" and "width"/"height"`);
  if (placeholder === "blur" && !blurDataURL) throw new TypeError(`<Image src="${src}" placeholder="blur"> needs "blurDataURL"`);
  const blur = placeholder === "blur" && !loaded ? { backgroundImage: `url(${JSON.stringify(blurDataURL)})`, backgroundSize: "cover", backgroundRepeat: "no-repeat", backgroundPosition: "center" } : null;
  const fillStyle = fill ? { position: "absolute", inset: 0, width: "100%", height: "100%" } : null;
  const setRef = (node) => {
    imgRef.current = node;
    if (typeof userRef === "function") userRef(node); else if (userRef) userRef.current = node;
    if (node && node.complete && node.naturalWidth > 0) setLoaded(true); // loaded before hydration
  };
  return h("img", {
    ...rest, ref: setRef, src: withBase(base, src), alt, sizes, className,
    width: fill ? undefined : dim(width), height: fill ? undefined : dim(height),
    loading: priority ? "eager" : loading ?? "lazy", decoding: "async", fetchPriority: priority ? "high" : undefined,
    style: { ...fillStyle, ...blur, ...style },
    onLoad(e) { setLoaded(true); if (onLoad) onLoad(e); },
  });
}

// ---------------------------------------------------------------------------------------------- Script
const scriptState = new Map(); // key -> { status: "loading" | "done" | "error", waiters: [] }
const STRATEGIES = ["beforeInteractive", "afterInteractive", "lazyOnload", "worker"];

function runScript({ src, code, key, attrs, onLoad, onError, onReady }) {
  const ready = () => { if (onReady) onReady(); };
  const st = scriptState.get(key);
  if (st) { // another <Script> already added it
    if (st.status === "done") ready();
    else if (st.status === "loading") st.waiters.push({ onLoad, onError, ready });
    return;
  }
  const state = { status: "loading", waiters: [{ onLoad, onError, ready }] };
  scriptState.set(key, state);
  const el = document.createElement("script");
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false || typeof v === "function" || typeof v === "object") continue;
    if (k in el) el[k] = v === true ? true : v; else el.setAttribute(k, v === true ? "" : String(v));
  }
  if (key) el.setAttribute("data-nepx-script", key);
  const finish = (ok, e) => { state.status = ok ? "done" : "error"; if (!ok) scriptState.delete(key); for (const w of state.waiters) { if (ok) { if (w.onLoad) w.onLoad(e); w.ready(); } else if (w.onError) w.onError(e); } state.waiters = []; };
  if (src) { el.src = src; el.async = true; el.onload = (e) => finish(true, e); el.onerror = (e) => finish(false, e); document.body.append(el); }
  else { el.textContent = code; document.body.append(el); finish(true); }
}

/**
 * <Script src="..." strategy="afterInteractive"> loads a third-party script once per page load, however many times it is rendered.
 *   beforeInteractive: part of the server HTML (runs on a full page load only; use it in the root layout)
 *   afterInteractive (default): added after hydration;  lazyOnload: added when the browser is idle after `load`.
 * Inline scripts need an `id`: <Script id="init">{`window.x = 1`}</Script>. Callbacks: onLoad (once, external scripts), onReady (every mount), onError.
 */
export function Script({ src, strategy = "afterInteractive", id, onLoad, onReady, onError, children, dangerouslySetInnerHTML, ...rest }) {
  if (!STRATEGIES.includes(strategy)) throw new TypeError(`<Script strategy="${strategy}">: use ${STRATEGIES.join(", ")}`);
  const code = dangerouslySetInnerHTML?.__html ?? (typeof children === "string" ? children : Array.isArray(children) ? children.join("") : "");
  if (!src && !code) throw new TypeError("<Script> needs a src or inline code");
  if (!src && !id) throw new TypeError("<Script> with inline code needs an id");
  const key = id || src;
  const eff = strategy === "worker" ? "afterInteractive" : strategy; // no web-worker (Partytown) support
  useEffect(() => {
    if (eff === "beforeInteractive") { // already in the HTML on a full load; on client navigation the script is added here
      if (document.querySelector(`script[data-nepx-script="${CSS.escape(key)}"]`)) { scriptState.set(key, { status: "done", waiters: [] }); if (onReady) onReady(); return; }
      if (!scriptState.has(key) && src && document.querySelector(`script[src="${CSS.escape(src)}"]`)) { scriptState.set(key, { status: "done", waiters: [] }); }
    }
    const go = () => runScript({ src, code, key, attrs: { id, ...rest }, onLoad, onError, onReady });
    if (eff === "lazyOnload") {
      let cancelled = false;
      const idle = () => { if (cancelled) return; (window.requestIdleCallback || ((f) => setTimeout(f, 1)))(go); };
      if (document.readyState === "complete") idle(); else window.addEventListener("load", idle, { once: true });
      return () => { cancelled = true; window.removeEventListener("load", idle); };
    }
    go();
  }, [key]);
  if (eff === "beforeInteractive") return h("script", { ...rest, id, src, "data-nepx-script": key, ...(src ? {} : { dangerouslySetInnerHTML: { __html: code } }) });
  return null;
}

// ---------------------------------------------------------------------------------------------- dynamic
/**
 * dynamic(() => import("./Heavy"), { ssr: true, loading: Spinner }) - a component whose code loads on first use (the browser build splits it into its own chunk).
 *   ssr: true (default): rendered on the server too (streamed); ssr: false: only in the browser, `loading` is shown first.
 */
export function dynamic(loader, { ssr = true, loading: Loading } = {}) {
  if (typeof loader !== "function") throw new TypeError("dynamic(): the first argument must be a function returning import(...)");
  const fallback = () => (Loading ? h(Loading, { isLoading: true, pastDelay: true, error: null }) : null);
  const pick = (m) => { const c = m && m.default !== undefined ? m.default : m; if (typeof c !== "function" && !(c && typeof c === "object")) throw new TypeError("dynamic(): the loaded module has no default-exported component"); return c; };
  let cached = null;
  const load = () => (cached ? Promise.resolve(cached) : Promise.resolve(loader()).then((m) => (cached = pick(m))));
  if (!ssr) {
    function DynamicClientOnly(props) {
      const [state, setState] = useState({ Comp: null, err: null });
      useEffect(() => { let on = true; load().then((Comp) => on && setState({ Comp, err: null }), (err) => on && setState({ Comp: null, err })); return () => { on = false; }; }, []);
      if (state.err) throw state.err;
      return state.Comp ? h(state.Comp, props) : fallback();
    }
    return DynamicClientOnly;
  }
  const Lazy = lazy(() => load().then((Comp) => ({ default: Comp })));
  return function Dynamic(props) { return h(Suspense, { fallback: fallback() }, h(Lazy, props)); };
}

// ---------------------------------------------------------------------------------------------- Form
/**
 * <Form action="/search"> - a GET <form> that navigates on the client (no full reload): the fields become the query string
 * (`/search?q=abc`) and the target page's data is loaded like a Link click. Without JavaScript it is a normal GET form.
 * <Form action={serverAction}> passes the function through to React (Server Actions / useActionState). `replace` swaps the history entry.
 */
export function Form({ action, replace = false, onSubmit, children, ...rest }) {
  const base = useContext(RouterContext).basePath || "";
  if (typeof action === "function") return h("form", { ...rest, action, onSubmit }, children);
  if (typeof action !== "string" || !action) throw new TypeError('<Form> needs an "action": a path like "/search" or a function (Server Action)');
  const handle = (e) => {
    if (typeof onSubmit === "function") onSubmit(e);
    if (e.defaultPrevented) return;
    const form = e.currentTarget, sub = e.nativeEvent && e.nativeEvent.submitter;
    const attr = (name) => (sub && sub.getAttribute(name)) || null;
    const method = String(attr("formmethod") || form.getAttribute("method") || "get").toLowerCase();
    const target = attr("formtarget") || form.getAttribute("target");
    if (method !== "get" || (target && target !== "_self")) return;
    const dest = attr("formaction") ? attr("formaction") : action;
    if (!dest.startsWith("/") || dest.startsWith("//")) return; // external or relative: the browser does it
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(form)) { if (typeof v !== "string") return; params.append(k, v); } // a file input: let the browser submit
    const hash = dest.includes("#") ? dest.slice(dest.indexOf("#")) : "";
    const pathOnly = dest.split(/[?#]/)[0];
    e.preventDefault();
    const q = params.toString();
    navigate(pathOnly + (q ? "?" + q : "") + hash, { replace });
  };
  return h("form", { method: "get", ...rest, action: withBase(base, action), onSubmit: handle }, children);
}
