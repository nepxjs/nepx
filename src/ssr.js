import { assetBase } from "./assets.js";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scanIcons, iconMetadata, loadImageVariants } from "./appicons.js";
import { appDirOf } from "./router.js";
import { mergeMetadata, metadataToTags, tagsToHtml, esc } from "./metadata.js";
import { isNotFoundError, isCustomAppGip, queryObject } from "./shared.js";
import { matchSlot, segmentsFor } from "./match.js";
import { fontHead } from "./fonts.js";
import { PassThrough } from "node:stream";
import { defaultNotFound, defaultStatusView } from "./views/index.js";
import { statusInfo } from "./errors/index.js";
import { als } from "./request-context.js";
import { devScripts, LIVE_RELOAD } from "./overlay.js";
import { findDocument } from "./pages-dir.js";
import { EXTS } from "./router.js";

let docTpl = null; // pages/_document, rendered once (see pages-document.js)

export const serializeData = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** URLs of the client bundle inside an assets Map (production names carry a content hash). */
export function assetRefs(assets) {
  const refs = { js: "/_nepx/client.js", css: null };
  for (const k of assets.keys()) {
    if (/^\/_nepx\/client(\.[0-9a-f]{8})?\.js$/.test(k)) refs.js = k;
    else if (/^\/_nepx\/client(\.[0-9a-f]{8})?\.css$/.test(k)) refs.css = k;
  }
  return refs;
}

/** The HTML around the app: `head` ends with the opening of #root, `tail` starts with its end. Streaming writes head, then the React stream, then tail. */
export function documentParts({ metadata = {}, boot, refs = { js: "/_nepx/client.js", css: null }, dev, devError = null, basePath = "", stream = false, headExtra = "" }) {
  const title = metadata.title ? esc(metadata.title) : "Nepx App";
  // boot === null: a static status page (401, 403, 429, 503 ...). It is plain server markup: no data block, no client script, nothing to hydrate.
  const data = boot ? `<script id="__NEPX_DATA__" type="application/json">${serializeData(basePath ? { ...boot, basePath } : boot)}</script>` : "";
  const client = boot ? `<script type="module" src="${esc(assetBase(basePath) + refs.js)}"></script>` : "";
  const preload = stream && boot ? `<link rel="modulepreload" href="${esc(assetBase(basePath) + refs.js)}">` : ""; // the download starts while the page streams
  const lang = boot && boot.i18n ? esc(boot.i18n.locale) : "en";
  const htmlAttrs = docTpl && docTpl.htmlAttrs ? (/\blang="/.test(docTpl.htmlAttrs) && !(boot && boot.i18n) ? docTpl.htmlAttrs : ` lang="${lang}"` + docTpl.htmlAttrs.replace(/\s*\blang="[^"]*"/, "")) : ` lang="${lang}"`;
  if (docTpl) headExtra += docTpl.head;
  const head = `<!doctype html>\n<html${htmlAttrs}><head><meta charset="utf-8">${metadata.viewport && typeof metadata.viewport === "object" ? "" : '<meta name="viewport" content="width=device-width, initial-scale=1">'}${/<title[\s>]/.test(headExtra) ? "" : `<title>${title}</title>`}${tagsToHtml(metadataToTags(metadata))}${fontHead()}${refs.css ? `<link rel="stylesheet" href="${esc(assetBase(basePath) + refs.css)}">` : ""}${preload}${headExtra}</head><body${docTpl ? docTpl.bodyAttrs : ""}>${docTpl ? docTpl.pre : ""}<div id="root" tabindex="-1">`;
  const tail = `</div>${docTpl ? docTpl.post : ""}${data}${dev ? devScripts(devError) : ""}${client}${dev ? LIVE_RELOAD : ""}</body></html>\n`;
  return { head, tail };
}

export function renderDocument(opts) {
  const { head, tail } = documentParts(opts);
  return head + opts.html + tail;
}

/**
 * Server-side renderer. root = directory holding the route files; projectRoot = where react is installed.
 * Page contract: default export component; optional getServerSideProps(ctx) -> {props}|{notFound}|{redirect};
 * optional `metadata` object or `generateMetadata({ params, searchParams, props })`; layouts default-export components taking {children, params}.
 * Calling notFound() anywhere during data loading, metadata or rendering shows the nearest not-found page (404).
 */
export function createRenderer({ projectRoot, root, rootLayout = null, notFound = null, errorPage = null, globalError = null, statusPages = {}, templates = {}, slots = [], basePath = "", images = null, i18n = null, streamTimeoutMs = 15_000 }) {
  const projectRequire = createRequire(path.join(projectRoot, "package.json"));
  const modules = new Map();
  const load = (file) => {
    if (!modules.has(file)) modules.set(file, import(pathToFileURL(path.join(root, file)).href));
    return modules.get(file);
  };
  const slotsByKey = new Map(slots.map((sl) => [sl.key, sl]));
  const iconFileMap = scanIcons(appDirOf(root));
  let fileMetaP = null; // app/icon.png, opengraph-image.png, ...; generateImageMetadata() files are imported on first use
  const getFileMeta = () => (fileMetaP ??= loadImageVariants(iconFileMap).then((v) => iconMetadata(iconFileMap, basePath, v)).catch((e) => { fileMetaP = null; throw e; }));
  const i18nOf = () => ({ locale: als.getStore()?.locale ?? i18n.defaultLocale, locales: i18n.locales, defaultLocale: i18n.defaultLocale });
  const routerValue = (url, params) => ({ pathname: url.pathname, searchParams: url.searchParams, params, basePath, ...(images ? { images } : {}), ...(i18n ? { i18n: i18nOf() } : {}) });
  const toSegs = (pathname) => { try { return pathname.split("/").filter(Boolean).map(decodeURIComponent); } catch { return []; } };
  let libs;
  async function getLibs() {
    if (!libs) {
      let React, server;
      try { React = projectRequire("react"); server = projectRequire("react-dom/server"); }
      catch { throw new Error('Cannot load "react" / "react-dom" from the project. Run "npm install react react-dom".'); }
      libs = { React, server, link: await import("./link.js") };
      const docFile = findDocument(root, EXTS);
      if (docFile) { try { docTpl = (await import("./pages-document.js")).documentTemplate(React, server, (await import(pathToFileURL(docFile).href)).default); } catch (e) { throw new Error(`pages/_document: ${e.message}`); } }
      (await import("./components.js")).setImageDefaults({ basePath, images }); // getImageProps() outside a component
    }
    return libs;
  }
  const roundTrip = (props, file) => {
    try { return JSON.parse(JSON.stringify(props ?? {})); }
    catch (e) { throw new TypeError(`${file}: getServerSideProps props must be JSON-serializable (${e.message})`); }
  };

  /** Pages-Router `getInitialProps`: `Page.getInitialProps(ctx)` or a custom `_app`'s `App.getInitialProps({ Component, ctx, router })`. Runs on the server (also for client-side navigation); the props travel like getServerSideProps props. */
  async function getInitialData(route, mod, params, url, ctx) {
    const Page = mod.default;
    const AppC = route.pagesApp ? (await load(route.pagesApp)).default : null;
    const customApp = isCustomAppGip(AppC?.getInitialProps);
    if (typeof Page?.getInitialProps !== "function" && !customApp) return { props: null };
    const query = {};
    for (const k of new Set(url.searchParams.keys())) { const all = url.searchParams.getAll(k); query[k] = all.length > 1 ? all : all[0]; }
    Object.assign(query, params);
    const pathname = "/" + (route.segments ?? []).map((s) => (s.static !== undefined ? s.static : s.param ? `[${s.param}]` : s.catchall ? `[...${s.catchall}]` : `[[...${s.optional}]]`)).join("/");
    const locale = als.getStore()?.locale;
    const gctx = { pathname: pathname.replace(/\/$/, "") || "/", query, asPath: url.pathname + url.search, req: ctx.request, ...(locale ? { locale, locales: i18n?.locales, defaultLocale: i18n?.defaultLocale } : {}) };
    let r;
    try {
      r = customApp
        ? await AppC.getInitialProps({ Component: Page, ctx: gctx, router: { pathname: gctx.pathname, route: gctx.pathname, query, asPath: gctx.asPath, locale } })
        : await Page.getInitialProps(gctx);
    } catch (e) { if (isNotFoundError(e)) return { notFound: true }; throw e; }
    const who = customApp ? route.pagesApp : route.file;
    if (!r || typeof r !== "object" || Array.isArray(r)) throw new TypeError(`${who}: getInitialProps must resolve to an object${customApp ? " ({ pageProps })" : ""}`);
    if (!customApp) return { props: roundTrip(r, who) };
    const { pageProps, ...rest } = r;
    if (pageProps !== undefined && (!pageProps || typeof pageProps !== "object")) throw new TypeError(`${who}: getInitialProps must return pageProps as an object`);
    return { props: roundTrip({ ...(pageProps ?? {}), ...(Object.keys(rest).length ? { __nepxApp: rest } : {}) }, who) };
  }

  /** -> {redirect:{destination,status}} | {notFound:true} | {props} */
  async function getData(route, params, url, ctx) {
    const mod = await load(route.file);
    const isStatic = typeof mod.getServerSideProps !== "function" && typeof mod.getStaticProps === "function";
    if (typeof mod.getServerSideProps !== "function" && !isStatic) return getInitialData(route, mod, params, url, ctx);
    const fnName = isStatic ? "getStaticProps" : "getServerSideProps";
    let r;
    try {
      r = isStatic
        ? await mod.getStaticProps({ params, locale: als.getStore()?.locale, draftMode: false })
        : await mod.getServerSideProps({ params, searchParams: queryObject(url.searchParams), request: ctx.request, cookies: ctx.cookies, requestId: ctx.requestId });
    } catch (e) { if (isNotFoundError(e)) return { notFound: true }; throw e; }
    if (!r || typeof r !== "object") throw new TypeError(`${route.file}: ${fnName} must return { props }, { notFound: true } or { redirect }`);
    if (r.redirect) {
      const d = r.redirect;
      if (!d || typeof d.destination !== "string") throw new TypeError(`${route.file}: redirect.destination must be a string`);
      return { redirect: { destination: d.destination, status: d.statusCode ?? (d.permanent ? 308 : 307) } };
    }
    if (r.notFound) return { notFound: true };
    if (isStatic && r.revalidate !== undefined) { // getStaticProps -> { revalidate: seconds | false }: how long the prerendered page stays fresh
      if (r.revalidate !== false && !(Number.isFinite(r.revalidate) && r.revalidate > 0)) throw new TypeError(`${route.file}: getStaticProps revalidate must be a positive number of seconds (or false)`);
      const secs = r.revalidate === false ? Infinity : r.revalidate;
      ctx.onRevalidate?.(secs);
      const st = als.getStore();
      if (st) st.revalidateHint = Math.min(st.revalidateHint ?? Infinity, secs);
    }
    return { props: roundTrip(r.props, route.file) };
  }

  /** Static `metadata` or `generateMetadata()` of every module, root layout first, page last. */
  async function collectMetadata(entries, args) {
    const list = [];
    for (const { mod, isPage } of entries) {
      const a = isPage ? { ...args, searchParams: queryObject(args.searchParams) } : { params: args.params, searchParams: queryObject(args.searchParams), request: args.request, cookies: args.cookies };
      if (typeof mod.generateMetadata === "function") list.push(await mod.generateMetadata(a));
      else list.push(mod.metadata);
      // viewport / generateViewport (14+): its own export, merged into the metadata under `viewport`
      if (typeof mod.generateViewport === "function") list.push({ viewport: await mod.generateViewport(a) });
      else if (mod.viewport !== undefined) list.push({ viewport: mod.viewport });
    }
    return mergeMetadata([await getFileMeta(), ...list]);
  }

  async function resolveNotFound(route, params, url, ctx) {
    const scope = (route && route.notFound) || { file: notFound, layouts: rootLayout ? [rootLayout] : [] };
    const layoutMods = await Promise.all(scope.layouts.map(load));
    const nfMod = scope.file ? await load(scope.file) : null;
    if (nfMod && typeof nfMod.default !== "function") throw new TypeError(`${scope.file}: must default-export a React component`);
    const p = route ? params : {};
    const entries = [...layoutMods.map((mod) => ({ mod })), ...(nfMod ? [{ mod: nfMod }] : [])];
    let metadata;
    try { metadata = await collectMetadata(entries, { params: p, searchParams: url.searchParams, request: ctx?.request, cookies: ctx?.cookies }); }
    catch (e) { if (!isNotFoundError(e)) throw e; metadata = {}; }
    return { notFound: true, layoutMods, layoutFiles: scope.layouts, nfMod, params: p, segments: toSegs(url.pathname), metadata };
  }

  /** Everything needed to render (or describe) a request, without touching React. route === null -> 404. */
  async function resolve(route, params, url, ctx) {
    if (!route) return resolveNotFound(null, {}, url, ctx);
    try {
      const data = await getData(route, params, url, ctx);
      if (data.redirect) return { redirect: data.redirect };
      if (data.notFound) return await resolveNotFound(route, params, url, ctx);
      const pageMod = await load(route.file);
      if (typeof pageMod.default !== "function") throw new TypeError(`${route.file}: must default-export a React component`);
      const layoutMods = await Promise.all(route.layouts.map(load));
      for (let i = 0; i < layoutMods.length; i++) if (typeof layoutMods[i].default !== "function") throw new TypeError(`${route.layouts[i]}: must default-export a React component`);
      const metadata = await collectMetadata([...layoutMods.map((mod) => ({ mod })), { mod: pageMod, isPage: true }], { params, searchParams: url.searchParams, request: ctx.request, cookies: ctx.cookies, props: data.props || {} });
      // parallel routes: each @slot shows its page for this URL, else its default.*; with neither the URL is a 404
      const segments = segmentsFor(route, params), slotMods = [];
      for (const s of route.slots ?? []) {
        const def = slotsByKey.get(s.key);
        if (!def) continue;
        const m = matchSlot(def, segments);
        const file = m ? m.route.file : def.default;
        if (!file) return await resolveNotFound(route, params, url, ctx);
        slotMods.push({ name: s.name, layoutIndex: s.layoutIndex, mod: await load(file), params: m ? m.params : params });
      }
      let loading = null;
      if (route.loading) {
        const lm = await load(route.loading.file);
        if (typeof lm.default !== "function") throw new TypeError(`${route.loading.file}: must default-export a React component`);
        loading = { mod: lm, depth: route.loading.layouts.length };
      }
      return { props: data.props ?? null, pageMod, layoutMods, layoutFiles: route.layouts, params, segments, slotMods, loading, metadata };
    } catch (err) {
      if (isNotFoundError(err)) return resolveNotFound(route, params, url, ctx);
      throw err;
    }
  }

  /** Layouts / templates / slot props / the Suspense boundary of loading.jsx around the page element (the browser runtime builds the same tree). */
  function applyLayers(React, el, r, url) {
    const slotProps = {};
    for (const s of r.slotMods ?? []) (slotProps[s.layoutIndex] ??= {})[s.name] = React.createElement(s.mod.default, { params: s.params, searchParams: queryObject(url.searchParams) });
    for (let i = r.layoutMods.length; i >= 0; i--) {
      if (r.loading && i === r.loading.depth) el = React.createElement(React.Suspense, { fallback: React.createElement(r.loading.mod.default) }, el);
      if (i === 0) continue;
      const Comp = r.layoutMods[i - 1].default, depth = templates[r.layoutFiles?.[i - 1]];
      el = depth !== undefined
        ? React.createElement(Comp, { params: r.params, key: r.segments?.[depth] ?? "" }, el) // template: remounts when URL segment `depth` changes
        : React.createElement(Comp, { params: r.params, ...(slotProps[i - 1] || {}) }, el);
    }
    return el;
  }

  /**
   * React -> HTML. Waits until every Suspense boundary is done ({ html }); with `stream` it resolves as soon as the shell is ready and
   * hands back `start(writable)` so the rest can follow while the response is being written. Errors in the shell reject (before anything is sent).
   */
  function renderElement(server, el, stream) {
    return new Promise((resolve, reject) => {
      const early = [];
      let shell = false;
      const report = (e) => { if (!isNotFoundError(e)) console.error(e && e.stack ? e.stack : e); }; // notFound() in a boundary: the browser shows the not-found view
      let timer = null;
      const pipeable = server.renderToPipeableStream(el, {
        onShellReady() {
          shell = true; early.splice(0).forEach(report);
          if (!stream) return;
          resolve({ stream: { start(w) { pipeable.pipe(w); w.once("close", () => clearTimeout(timer)); }, abort: () => { clearTimeout(timer); pipeable.abort(); } } });
        },
        onShellError(e) { clearTimeout(timer); reject(e); },
        onAllReady() {
          if (stream) return;
          const chunks = [], sink = new PassThrough();
          sink.on("data", (c) => chunks.push(c));
          sink.on("end", () => { clearTimeout(timer); resolve({ html: Buffer.concat(chunks).toString("utf8") }); });
          pipeable.pipe(sink);
        },
        onError(e) { if (shell) report(e); else early.push(e); },
      });
      timer = setTimeout(() => pipeable.abort(new Error(`Rendering took longer than ${streamTimeoutMs}ms`)), streamTimeoutMs);
      timer.unref?.();
    });
  }

  async function renderView(r, url, { stream = false } = {}) {
    const { React, server, link } = await getLibs();
    const hooks = await import("./hooks.js"), inserted = [];
    let el;
    if (r.notFound) {
      const nf = r.nfMod && r.nfMod.default;
      el = nf ? React.createElement(nf) : defaultNotFound(React.createElement);
    } else el = React.createElement(r.pageMod.default, { params: r.params, searchParams: queryObject(url.searchParams), ...(r.props || {}) });
    el = applyLayers(React, el, r, url);
    el = React.createElement(link.RouterContext.Provider, { value: routerValue(url, r.params) }, el);
    el = React.createElement(hooks.InsertedHtmlContext.Provider, { value: inserted }, el);
    const out = await renderElement(server, el, stream);
    let headHtml = ""; // useServerInsertedHTML(): the callbacks the shell registered (everything, when not streaming)
    for (const cb of inserted.splice(0)) { const n = cb(); if (n !== null && n !== undefined && n !== false) headHtml += typeof n === "string" ? n : server.renderToStaticMarkup(n); }
    return { status: r.notFound ? 404 : 200, ...out, headHtml, metadata: r.metadata, boot: { props: r.props ?? null, notFound: !!r.notFound, metadata: r.metadata, ...(images ? { images } : {}), ...(i18n ? { i18n: i18nOf() } : {}) } };
  }

  /** route === null renders the 404 page. -> {status, html | stream, metadata, boot} | {redirect}. With `stream` the result carries `stream.start(writable)` instead of `html`. */
  async function render(route, params, url, ctx, { stream = false } = {}) {
    const r = await resolve(route, params, url, ctx);
    if (r.redirect) return { redirect: r.redirect };
    try { return await renderView(r, url, { stream }); }
    catch (err) {
      // notFound() called from a component while rendering
      if (isNotFoundError(err) && !r.notFound) return renderView(await resolveNotFound(route, params, url, ctx), url, { stream });
      throw err;
    }
  }

  /** What client-side navigation needs: -> {redirect} | {notFound:true, metadata} | {props, metadata} */
  async function getView(route, params, url, ctx) {
    const r = await resolve(route, params, url, ctx);
    if (r.redirect) return { redirect: r.redirect };
    if (r.notFound) return { notFound: true, metadata: r.metadata };
    return { props: r.props, metadata: r.metadata };
  }

  /** Render the nearest error.* (route scope, else the root one) for a failed render. Production hides the message. -> {status, html, metadata, boot} | null */
  async function renderError(url, err, ctx, dev, route = null, params = {}) {
    let view = null;
    try { view = await renderScopedError(url, err, ctx, dev, route, params); }
    catch (inner) { if (!globalError) throw inner; } // error.* (or a layout around it) failed too: global-error.* takes over
    return view ?? (globalError ? renderGlobalError(url, err, ctx, dev) : null);
  }

  /** global-error.*: shown instead of the root layout + page when nothing else can render the failure (no error.*, or it threw). */
  async function renderGlobalError(url, err, ctx, dev) {
    const { React, server, link } = await getLibs();
    const Err = (await load(globalError)).default;
    if (typeof Err !== "function") return null;
    const info = { message: dev ? String(err && err.message ? err.message : err) : "Internal Server Error", digest: ctx.requestId };
    const el = React.createElement(link.RouterContext.Provider, { value: { pathname: url.pathname, searchParams: url.searchParams, params: {} } }, React.createElement(Err, { error: info, reset: () => {} }));
    const metadata = { title: "Error" };
    return { status: 500, html: server.renderToString(el), metadata, boot: { props: null, notFound: false, error: info, globalError: true, metadata } };
  }

  async function renderScopedError(url, err, ctx, dev, route, params) {
    const scope = (route && route.errorScope) || (errorPage ? { file: errorPage, layouts: rootLayout ? [rootLayout] : [] } : null);
    if (!scope) return null;
    const { React, server, link } = await getLibs();
    const Err = (await load(scope.file)).default;
    if (typeof Err !== "function") return null;
    const info = { message: dev ? String(err && err.message ? err.message : err) : "Internal Server Error", digest: ctx.requestId };
    let el = React.createElement(Err, { error: info, reset: () => {} });
    const layoutMods = await Promise.all(scope.layouts.map(load));
    for (let i = layoutMods.length - 1; i >= 0; i--) el = React.createElement(layoutMods[i].default, { params }, el);
    el = React.createElement(link.RouterContext.Provider, { value: { pathname: url.pathname, searchParams: url.searchParams, params: {} } }, el);
    let metadata = {};
    try { metadata = mergeMetadata(layoutMods.map((m) => m.metadata)); } catch { /* keep defaults */ }
    return { status: 500, html: server.renderToString(el), metadata, boot: { props: null, notFound: false, error: info, metadata } };
  }

  /**
   * Static page for any 4xx / 5xx status: app/<status>.jsx when the project has one, else the built-in view, inside the root layout.
   * Props for the component: { status, title, message, digest, url, retryable, retryAfter }. -> {status, html, metadata, boot: null}
   */
  async function renderStatus(status, url, { message, digest, retryAfter = null } = {}) {
    const { React, server, link } = await getLibs();
    const info = statusInfo(status);
    const props = { status, title: info.title, message: message || info.message, digest: digest || undefined, url: url.pathname + url.search, retryable: info.retryable, retryAfter };
    const file = statusPages[status];
    const mod = file ? await load(file) : null;
    if (mod && typeof mod.default !== "function") throw new TypeError(`${file}: must default-export a React component`);
    let el = mod ? React.createElement(mod.default, props) : defaultStatusView(React.createElement, props);
    const layoutMods = await Promise.all((rootLayout ? [rootLayout] : []).map(load));
    for (let i = layoutMods.length - 1; i >= 0; i--) el = React.createElement(layoutMods[i].default, { params: {} }, el);
    el = React.createElement(link.RouterContext.Provider, { value: { pathname: url.pathname, searchParams: url.searchParams, params: {} } }, el);
    let metadata = {};
    const own = mod && mod.metadata && mod.metadata.title ? mod.metadata : { ...((mod && mod.metadata) || {}), title: `${status} - ${info.title}` }; // the status page's own title wins, else "<status> - <name>"
    try { metadata = mergeMetadata([...layoutMods.map((m) => m.metadata), own]); } catch { /* keep defaults */ }
    metadata = { ...metadata, robots: { index: false, follow: false } };
    return { status, html: server.renderToString(el), metadata, boot: null };
  }

  return { render, renderError, renderStatus, getData, getView, load };
}


