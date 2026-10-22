// next/image, next/script and next/dynamic equivalents. Isomorphic (server render + browser).
import { createElement as h, useContext, useEffect, useRef, useState, lazy, Suspense } from "react";
import { RouterContext, withBase, navigate } from "./link.js";
import { matchRemote } from "./remote-match.js";

// ---------------------------------------------------------------------------------------------- Image
const dim = (v) => (v === undefined ? undefined : Number(v));

// What getImageProps() uses when it is called outside a component (no router context): the server renderer and the browser runtime set it.
let imageDefaults = { basePath: "", images: null };
export const setImageDefaults = (d) => { imageDefaults = { basePath: (d && d.basePath) || "", images: (d && d.images) || null }; };

/** The pure part of <Image>: validates the props and works out src / srcSet / sizes / dimensions / loading hints. */
function buildImage({ src, alt, width, height, fill = false, priority = false, loading, sizes, quality, placeholder = "empty", blurDataURL, unoptimized }, base, opt) {
  if (src && typeof src === "object" && typeof src.src === "string") { width ??= src.width; height ??= src.height; src = src.src; }
  if (typeof src !== "string" || !src) throw new TypeError('<Image> needs a "src" string (a path under public/, an imported image or an absolute URL)');
  if (alt === undefined) throw new TypeError('<Image> needs an "alt" (use alt="" for a decorative image)');
  if (!fill && (!Number.isFinite(dim(width)) || !Number.isFinite(dim(height)))) throw new TypeError(`<Image src="${src}"> needs "width" and "height" (or the "fill" prop)`);
  if (fill && (width !== undefined || height !== undefined)) throw new TypeError(`<Image src="${src}"> cannot have both "fill" and "width"/"height"`);
  if (placeholder === "blur" && !blurDataURL) throw new TypeError(`<Image src="${src}" placeholder="blur"> needs "blurDataURL"`);
  // config.images.optimize: local raster images go through /_nepx/image (resized, webp/avif); the router context carries { widths, quality }
  let imgSrc = withBase(base, src), srcSet;
  const remoteOk = !!opt && !unoptimized && /^https?:\/\//i.test(src) && matchRemote(src, opt.remotePatterns); // config.images.remotePatterns / domains: fetched and resized by the server
  if (opt && !unoptimized && (remoteOk || (src.startsWith("/") && !src.startsWith("//") && /\.(jpe?g|png|webp|avif|tiff)$/i.test(src.split("?")[0])))) {
    const q = quality === undefined ? opt.quality : quality;
    if (!Number.isInteger(q) || q < 1 || q > 100) throw new TypeError(`<Image src="${src}"> quality must be an integer between 1 and 100`);
    const u = (w) => withBase(base, `/_nepx/image?url=${encodeURIComponent(src)}&w=${w}&q=${q}`);
    const widths = opt.widths, biggest = widths[widths.length - 1];
    const atLeast = (n) => widths.find((x) => x >= n) ?? biggest;
    if (fill || sizes) { srcSet = widths.map((w) => `${u(w)} ${w}w`).join(", "); imgSrc = u(biggest); }
    else { const w1 = atLeast(dim(width)), w2 = atLeast(dim(width) * 2); srcSet = `${u(w1)} 1x, ${u(w2)} 2x`; imgSrc = u(w2); }
  }
  return {
    src: imgSrc, srcSet, alt, sizes,
    width: fill ? undefined : dim(width), height: fill ? undefined : dim(height),
    loading: priority ? "eager" : loading ?? "lazy", decoding: "async", fetchPriority: priority ? "high" : undefined,
    style: fill ? { position: "absolute", inset: 0, width: "100%", height: "100%" } : undefined,
    blur: placeholder === "blur" ? blurDataURL : null,
  };
}

/**
 * <Image src alt width height> - an <img> with the performance defaults: lazy loading, async decoding, reserved space (no layout shift),
 * `priority` for the LCP image, `fill` for a parent-sized image, `placeholder="blur"` with `blurDataURL`.
 * With `images: { optimize: true }` in nepx.config.js, local raster images are served resized (webp/avif) from /_nepx/image with a srcSet;
 * `quality` (1-100) tunes that and `unoptimized` skips it. Without the option the file is used as it is.
 */
export function Image({ src, alt, width, height, fill = false, priority = false, loading, sizes, quality, placeholder = "empty", blurDataURL, unoptimized, style, className, onLoad, ref: userRef, ...rest }) {
  const ctx = useContext(RouterContext);
  const imgRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const { blur: blurSrc, style: fillStyle, ...img } = buildImage({ src, alt, width, height, fill, priority, loading, sizes, quality, placeholder, blurDataURL, unoptimized }, ctx.basePath || "", ctx.images);
  const blur = blurSrc && !loaded ? { backgroundImage: `url(${JSON.stringify(blurSrc)})`, backgroundSize: "cover", backgroundRepeat: "no-repeat", backgroundPosition: "center" } : null;
  const setRef = (node) => {
    imgRef.current = node;
    if (typeof userRef === "function") userRef(node); else if (userRef) userRef.current = node;
    if (node && node.complete && node.naturalWidth > 0) setLoaded(true); // loaded before hydration
  };
  return h("img", {
    ...rest, ref: setRef, ...img, className,
    style: { ...fillStyle, ...blur, ...style },
    onLoad(e) { setLoaded(true); if (onLoad) onLoad(e); },
  });
}

/**
 * getImageProps(props, { basePath?, images? }) - next/image's escape hatch: the props <Image> would put on its <img>
 * ({ src, srcSet, sizes, width, height, loading, decoding, fetchPriority, style, alt }), for <picture>, background images or meta tags.
 * Returns { props }. Uses the app's basePath / images config; the optional 2nd argument overrides them.
 */
export function getImageProps(input, ctx = {}) {
  const { src, alt, width, height, fill, priority, loading, sizes, quality, placeholder, blurDataURL, unoptimized, style, className, onLoad, ref, ...rest } = input || {};
  const { blur, style: fillStyle, ...img } = buildImage({ src, alt, width, height, fill, priority, loading, sizes, quality, placeholder, blurDataURL, unoptimized }, ctx.basePath ?? imageDefaults.basePath, "images" in ctx ? ctx.images : imageDefaults.images);
  const blurStyle = blur ? { backgroundImage: `url(${JSON.stringify(blur)})`, backgroundSize: "cover", backgroundRepeat: "no-repeat", backgroundPosition: "center" } : null;
  const out = { ...rest, ...img, className, style: { ...fillStyle, ...blurStyle, ...style } };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return { props: out };
}
/** Older name for getImageProps. */
export const unstable_getImgProps = getImageProps;

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
