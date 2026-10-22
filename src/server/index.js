import { patchFetch } from "../fetch-cache.js";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream";
import { pathToFileURL } from "node:url";
import { HttpError, isHttpError, publicMessage } from "../errors/index.js";
import { resolveSecurity, createSecurity, parseCspReport, wantsHtml, CSP_REPORT_PATH } from "../security/index.js";
import { matchRoute } from "../match.js";
import { scanIcons, isDynamicIcon, imageVariants } from "../appicons.js";
import { appDirOf } from "../router.js";
import { createParamsGate } from "../dynamic-params.js";
import { createRenderer, renderDocument, documentParts, assetRefs } from "../ssr.js";
import { scanActions, reviveArgs } from "../actions.js";
import { buildCsp } from "../security/csp.js";
import { withBase } from "../base.js";
import { als, newStore, isDraftRequest } from "../request-context.js";
import { IsrCache } from "../isr.js";
import { metaResponse, sitemapResponse } from "../metaroutes.js";
import { createImageOptimizer, imageContext } from "../images.js";
import { splitLocale, pickLocale, LOCALE_COOKIE } from "../i18n.js";
import { isNotFoundError, isDynamicError } from "../shared.js";
import { buildPayload, errorPageHtml, resolveBrowserError, terminalFrame } from "../overlay.js";
import { MIME, parseCookies, readBody, decodeSegments, jsonResponse, htmlResponse, conditionalResponse } from "./http-utils.js";
import { createCompressor } from "./compression.js";
import { createPublicFiles } from "./static-files.js";
import { createErrorResponder } from "./error-response.js";
import { handleParserErrors } from "./parser-errors.js";

/**
 * @param {object} opts
 *  root: dir with the route files; projectRoot: where node_modules lives; routes: manifest routes (API + PAGE);
 *  rootLayout/notFound: files for the 404 view; middleware: {fn, matches}; assets: Map "/_nepx/..." -> {body,type};
 *  publicDir: static files served at "/"; staticDir: prerendered pages (nepx build).
 */
export function createNepxServer({ root, projectRoot = root, routes, maxBodySize, dev = false, publicDir = null, staticDir = null, assets = new Map(), middleware = null, rootLayout = null, notFound = null, errorPage = null, globalError = null, redirects = [], rewrites = [], headerRules = [], trailingSlash = false, compress = true, log = dev, statusPages = {}, security = null, basePath = "", templates = {}, slots = [], streaming = true, instrumentation = null, images = null, i18n = null, poweredByHeader = false, fallbackRewrites = [] }) {
  patchFetch(); // fetch(url, { cache, nepx: { revalidate, tags } })
  const sec = resolveSecurity(security ?? {});
  const guard = createSecurity(sec, { dev });
  const modules = new Map();
  const isr = new IsrCache();
  const dynamicPages = new Set(); // revalidate pages that turned out to read cookies()/headers(): never cached
  const pageRoutes = routes.filter((r) => r.type === "PAGE");
  const hasPages = pageRoutes.length > 0 || !!notFound || !!errorPage || Object.keys(statusPages).length > 0;
  const renderer = hasPages ? createRenderer({ projectRoot, root, rootLayout, notFound, errorPage, globalError, statusPages, templates, slots, basePath, images: imageContext(images), i18n }) : null;
  const serveImage = images && images.optimize ? createImageOptimizer({ publicDir, config: images, projectRoot, dev }) : null;
  const refs = assetRefs(assets);
  const iconFiles = scanIcons(appDirOf(root));
  const paramsGate = createParamsGate((file) => renderer.load(file));
  const compressor = createCompressor({ enabled: compress });
  const loadModule = async (route) => {
    if (!modules.has(route.file)) modules.set(route.file, import(pathToFileURL(path.join(root, route.file)).href));
    return modules.get(route.file);
  };

  const servePublic = createPublicFiles({ publicDir, blockDotfiles: sec.blockDotfiles, dev });
  const errorResponse = createErrorResponder({ renderer, refs, dev, basePath });
  const STREAM = Symbol("nepx.stream");
  const BOT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|lighthouse|headless|pingdom/i;
  // Streaming sends the shell first and fills Suspense boundaries with inline scripts, which a Content-Security-Policy would block: then pages are sent complete.
  const streamAllowed = streaming && !buildCsp(sec, { dev, secure: false });
  const canStream = (req) => streamAllowed && req.method === "GET" && !BOT.test(String(req.headers["user-agent"] ?? ""));
  let actionMap = null; // id -> { file, name } of every "use server" export (scanned on first use)

  function toRequest(req, url, { body, reqHeaders } = {}) {
    const headers = reqHeaders ?? new Headers();
    if (!reqHeaders) for (const [k, v] of Object.entries(req.headers)) {
      try { headers.set(k, Array.isArray(v) ? v.join(", ") : v); } catch { throw new HttpError(400, "Invalid header"); }
    }
    const hasBody = body && body.length;
    return { headers, request: new Request(url, { method: req.method, headers, body: hasBody ? body : undefined }) };
  }

  /** instrumentation.js onRequestError(err, request, context): fire-and-forget, never throws, never slows the response. */
  function reportError(err, req, routeType) {
    if (!instrumentation || typeof instrumentation.onRequestError !== "function") return;
    const info = req.nepxRoute ?? {};
    const request = { path: req.originalUrl ?? req.url, method: req.method, headers: Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)])) };
    Promise.resolve().then(() => instrumentation.onRequestError(err, request, { routerKind: "App Router", routePath: info.path ?? null, routeType: info.type ?? routeType, requestId: req.requestId })).catch((e) => console.error("instrumentation onRequestError failed:", e && e.message));
  }

  /** Config rewrite to an absolute URL: forward the request (cookies included) and send the upstream answer back. The body is buffered. */
  const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length", "accept-encoding", "content-encoding"]);
  async function proxy(req, url, target) {
    const out = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && !k.startsWith("x-nepx-")) { try { out.set(k, Array.isArray(v) ? v.join(", ") : v); } catch { /* skip */ } }
    out.set("x-forwarded-host", String(req.headers.host ?? "")); out.set("x-forwarded-proto", req.socket?.encrypted ? "https" : "http");
    const prior = req.headers["x-forwarded-for"];
    out.set("x-forwarded-for", [prior, req.socket?.remoteAddress].filter(Boolean).join(", "));
    const hasBody = !["GET", "HEAD"].includes(req.method);
    const body = hasBody ? await readBody(req, maxBodySize) : null;
    let up;
    try { up = await fetch(target, { method: req.method, headers: out, body: body && body.length ? body : undefined, redirect: "manual", signal: AbortSignal.timeout(30_000) }); }
    catch (e) { throw new HttpError(e && e.name === "TimeoutError" ? 504 : 502, "Upstream request failed"); }
    const headers = new Headers();
    for (const [k, v] of up.headers) if (!HOP.has(k) && k !== "set-cookie") headers.set(k, v);
    for (const c of up.headers.getSetCookie?.() ?? []) headers.append("set-cookie", c);
    const noBody = req.method === "HEAD" || [204, 205, 304].includes(up.status);
    return new Response(noBody ? null : Buffer.from(await up.arrayBuffer()), { status: up.status, headers });
  }
  const isExternal = (target, url) => target && target.origin !== url.origin;

  async function handleApi(req, url, { route, params }) {
    const allowed = new Set(route.methods);
    if (allowed.has("GET")) allowed.add("HEAD");
    allowed.add("OPTIONS");
    const allow = [...allowed].sort().join(", ");
    let method = req.method;
    if (method === "HEAD") method = "GET";
    if (method === "OPTIONS" && !route.methods.includes("OPTIONS")) return new Response(null, { status: 204, headers: { allow } });
    if (!route.methods.includes(method)) return jsonResponse(405, { error: "Method not allowed" }, { allow });
    const hasBody = !["GET", "HEAD"].includes(req.method);
    const body = hasBody ? await readBody(req, maxBodySize) : null;
    const { headers, request } = toRequest(req, url, { body });
    request.json = async () => {
      const ct = headers.get("content-type");
      if (ct && !/json/i.test(ct)) throw new HttpError(415, "Content-Type must be application/json");
      if (!body || body.length === 0) throw new HttpError(400, "Request body is empty");
      try { return JSON.parse(body.toString("utf8")); } catch { throw new HttpError(400, "Invalid JSON body"); }
    };
    const cookieMap = parseCookies(headers.get("cookie"));
    Object.defineProperties(request, { // Request conveniences
      nepxUrl: { value: url, enumerable: true },
      nextUrl: { value: url, enumerable: true }, // legacy name
      cookies: { value: { get: (n) => (Object.hasOwn(cookieMap, n) ? { name: n, value: cookieMap[n] } : undefined), getAll: () => Object.entries(cookieMap).map(([name, value]) => ({ name, value })), has: (n) => Object.hasOwn(cookieMap, n) }, enumerable: true },
    });
    const mod = await loadModule(route);
    if (route.meta === "sitemap") { const sm = await sitemapResponse(mod, { base: url.origin + basePath }); if (sm) return sm; } // generateSitemaps: /sitemap.xml is the index
    if (route.meta) return metaResponse(route.meta, () => mod.default());
    let result;
    try { result = await mod[method](request, { params, url, cookies: parseCookies(headers.get("cookie")), requestId: req.requestId }); }
    catch (err) { if (isNotFoundError(err)) return jsonResponse(404, { error: "Not found" }); throw err; }
    if (!(result instanceof Response)) throw new TypeError(`${route.file}: ${method}() must return a Response (got ${result === null ? "null" : typeof result})`);
    return result;
  }

  const redirectResponse = (r) => new Response(null, { status: r.status, headers: { location: r.destination } });

  /** -> { redirect } | { status, html } for a page request (or the 404 view when found is null). */
  async function produce(req, url, found, resolvedPath, { stream = false } = {}) {
    const { request, headers } = toRequest(req, url);
    const ctx = { request, cookies: parseCookies(headers.get("cookie")), requestId: req.requestId };
    let view, devError = null;
    try { view = await renderer.render(found ? found.route : null, found ? found.params : {}, url, ctx, { stream }); }
    catch (err) {
      if (isHttpError(err)) { // forbidden() / unauthorized() / httpError(): the status page, not error.jsx
        if (err.status >= 500) console.error(`[${req.requestId}]`, err.stack ?? err);
        const sv = await renderer.renderStatus(err.status, url, { message: publicMessage(err), digest: err.status >= 500 ? req.requestId : undefined, retryAfter: err.retryAfter });
        return { status: sv.status, headers: err.headers, html: renderDocument({ html: sv.html, metadata: sv.metadata, boot: null, refs, dev, basePath }) };
      }
      const ev = await renderer.renderError(url, err, ctx, dev, found ? found.route : null, found ? found.params : {}).catch(() => null);
      if (!ev) throw err;
      console.error(`[${req.requestId}]`, err && err.stack ? err.stack : err);
      reportError(err, req, "render");
      if (dev) { // the project's error.jsx is shown; the overlay is the collapsed "1 error" badge with the details
        devError = buildPayload(err, { projectRoot, kind: "Server Error", method: req.method, url: req.url, requestId: req.requestId, handled: true });
        process.stderr.write(terminalFrame(devError));
      }
      view = ev;
    }
    if (view.redirect) return { redirect: view.redirect };
    const boot = resolvedPath && resolvedPath !== url.pathname ? { ...view.boot, resolved: resolvedPath } : view.boot;
    if (view.stream) return { status: view.status, stream: view.stream, parts: documentParts({ metadata: view.metadata, boot, refs, dev, devError, basePath, stream: true, headExtra: view.headHtml }) };
    return { status: view.status, html: renderDocument({ html: view.html, metadata: view.metadata, boot, refs, dev, devError, basePath, headExtra: view.headHtml }) };
  }

  /** The page as it is written: head, then React's stream (shell now, Suspense boundaries as they finish), then the tail. */
  function streamResponse(r) {
    const out = new PassThrough(), inner = new PassThrough();
    out.write(r.parts.head);
    inner.on("data", (c) => out.write(c));
    inner.on("end", () => out.end(r.parts.tail));
    inner.on("error", () => out.destroy());
    r.stream.start(inner);
    const response = new Response(null, { status: r.status, headers: { "content-type": MIME[".html"], "cache-control": r.status === 200 ? "no-cache" : "no-store", "x-accel-buffering": "no" } });
    response[STREAM] = { readable: out, abort: r.stream.abort };
    return response;
  }

  async function renderPage(req, url, found, resolvedPath) {
    const r = await produce(req, url, found, resolvedPath, { stream: canStream(req) });
    if (r.redirect) return redirectResponse(r.redirect);
    if (r.stream) return streamResponse(r);
    return htmlResponse(r.status, r.html, r.status === 200 ? {} : { "cache-control": "no-store", ...r.headers });
  }

  const blankStore = () => newStore();
  const isrResponse = (entry, state, seconds) => new Response(entry.html, { status: 200, headers: { "content-type": MIME[".html"], "cache-control": `public, s-maxage=${seconds}, stale-while-revalidate`, "x-nepx-cache": state } });

  /** Pages with `export const revalidate = N`: served from memory, regenerated in the background when stale. */
  async function renderRevalidated(req, url, found, resolvedPath, segments) {
    const seconds = found.route.revalidate ?? 31_536_000; // getStaticProps without revalidate: kept until revalidatePath / revalidateTag
    const key = "/" + segments.join("/");
    if (staticDir && !isr.get(key) && !isr.isStaticSkipped(key) && !isr.isTagSkipped(found.route.tags)) {
      try { // seed from the page prerendered at build time
        const file = path.join(staticDir, ...segments, "index.html");
        isr.set(key, { html: await readFile(file), at: (await stat(file)).mtimeMs });
      } catch { /* not prerendered */ }
    }
    const hit = isr.lookup(key, seconds);
    const u = new URL(url.pathname, url.origin); // cached pages are rendered without a query string
    const regenerate = () => isr.refresh(key, () => als.run(blankStore(), async () => {
      const store = als.getStore();
      const r = await produce({ ...req, method: "GET", headers: {}, requestId: req.requestId }, u, found, resolvedPath);
      if (r.redirect || r.status !== 200 || store.dynamic) { isr.entries.delete(key); return null; }
      const entry = { html: Buffer.from(r.html), at: Date.now(), seconds: store.revalidateHint, tags: [...new Set([...(found.route.tags ?? []), ...store.tags])] };
      isr.set(key, entry);
      return entry;
    }));
    if (hit) {
      if (hit.stale) regenerate().catch((e) => console.error(`[${req.requestId}] revalidate ${key} failed:`, e && e.message));
      return isrResponse(hit.entry, hit.stale ? "STALE" : "HIT", hit.entry.seconds ?? seconds);
    }
    const store = als.getStore();
    const r = await produce(req, u, found, resolvedPath);
    if (r.redirect) return redirectResponse(r.redirect);
    if (r.status !== 200) return htmlResponse(r.status, r.html, { "cache-control": "no-store", ...r.headers });
    if (store && store.dynamic) { dynamicPages.add(found.route.file); return htmlResponse(200, r.html); }
    const entry = { html: Buffer.from(r.html), at: Date.now(), seconds: store?.revalidateHint, tags: [...new Set([...(found.route.tags ?? []), ...(store?.tags ?? [])])] };
    isr.set(key, entry);
    return isrResponse(entry, "MISS", entry.seconds ?? seconds);
  }

  /** -> null (no middleware / continue) | { response } | { rewrite, headers } | { headers } */
  async function runMiddleware(req, url) {
    if (!middleware || !middleware.matches(url.pathname)) return null;
    const { request, headers } = toRequest(req, url, { reqHeaders: undefined });
    const event = { waitUntil: (p) => { Promise.resolve(p).catch((e) => console.error(`[${req.requestId}] middleware waitUntil() failed:`, e && e.stack ? e.stack : e)); } };
    const r = await middleware.fn(request, { url, cookies: parseCookies(headers.get("cookie")), requestId: req.requestId, waitUntil: event.waitUntil });
    if (r === undefined || r === null) return null;
    if (!(r instanceof Response)) throw new TypeError(`${middleware.file}: middleware must return a Response or nothing`);
    const rw = r.headers.get("x-nepx-rewrite");
    const cont = rw || r.headers.get("x-nepx-continue");
    if (!cont) return { response: r };
    const extra = {};
    for (const [k, v] of r.headers) if (!k.startsWith("x-nepx-")) extra[k] = v;
    return { rewrite: rw || null, headers: extra };
  }

  /** Config rewrites: the first matching rule wins -> a path (+ query) or null. */
  const ctxOf = (req, url) => ({ headers: req.headers, cookies: parseCookies(req.headers.cookie), query: url.searchParams, host: String(req.headers.host ?? "").replace(/:\d+$/, "") });
  function applyRewrites(url, req) {
    const ctx = ctxOf(req, url);
    for (const rule of rewrites) {
      const dest = rule.resolve(url.pathname, url.search, ctx);
      if (dest) return new URL(dest, url.origin);
    }
    return null;
  }

  /** GET /_nepx/data?path=/x?y=1 -> JSON for client-side navigation (middleware, rewrites, getServerSideProps, metadata). */
  async function handleData(req, url) {
    let target = url.searchParams.get("path") ?? "";
    if (!target.startsWith("/") || target.startsWith("//")) throw new HttpError(400, "Invalid path");
    let tUrl;
    try { tUrl = new URL(target, url.origin); } catch { throw new HttpError(400, "Invalid path"); }
    if (tUrl.origin !== url.origin) throw new HttpError(400, "Invalid path");
    if (i18n) { // the browser sends the address-bar path (/id/about): same locale handling as a page request
      const sp = splitLocale(tUrl.pathname, i18n);
      if (sp.locale) { tUrl = new URL(tUrl); tUrl.pathname = sp.pathname; }
      const st0 = als.getStore();
      if (st0) st0.locale = sp.locale ?? i18n.defaultLocale;
      target = tUrl.pathname + tUrl.search;
    }
    const noStore = { "cache-control": "no-store" };
    const mw = await runMiddleware({ method: "GET", url: target, headers: req.headers, requestId: req.requestId }, tUrl);
    let rUrl = tUrl;
    if (mw && mw.response) {
      const loc = mw.response.headers.get("location");
      return jsonResponse(200, loc && mw.response.status >= 300 && mw.response.status < 400 ? { redirect: { destination: loc, status: mw.response.status } } : { reload: true }, noStore);
    }
    if (mw && mw.rewrite) rUrl = new URL(mw.rewrite, url.origin);
    else { const rw = applyRewrites(tUrl, req); if (rw) { if (isExternal(rw, url)) return jsonResponse(200, { reload: true }, noStore); rUrl = rw; } }
    let found = matchRoute(pageRoutes, decodeSegments(rUrl.pathname));
    if (found && !(await paramsGate(found.route, found.params))) found = null; // dynamicParams = false
    const { request, headers } = toRequest({ method: "GET", headers: req.headers }, tUrl);
    const resolved = rUrl.pathname !== tUrl.pathname ? { resolved: rUrl.pathname } : {};
    const view = await renderer.getView(found ? found.route : null, found ? found.params : {}, tUrl, { request, cookies: parseCookies(headers.get("cookie")), requestId: req.requestId });
    if (view.redirect) return jsonResponse(200, { redirect: view.redirect }, noStore);
    if (view.notFound) return jsonResponse(200, { notFound: true, metadata: view.metadata, ...resolved }, noStore);
    return jsonResponse(200, { props: view.props, metadata: view.metadata, ...resolved }, noStore);
  }

  /**
   * POST /_nepx/action  { args: [...] } with the header x-nepx-action: <id>  ->  { result?, redirect?, refresh? }
   * Runs an exported function of a "use server" file. The custom header (and JSON content type) cannot be sent by a cross-site form, so
   * together with the CSRF origin guard only your own pages can call it. Middleware does NOT run for actions: check the user inside the action.
   */
  async function handleAction(req) {
    const id = String(req.headers["x-nepx-action"] ?? "");
    if (!id) throw new HttpError(400, "Missing x-nepx-action header");
    if (!/json/i.test(String(req.headers["content-type"] ?? ""))) throw new HttpError(415, "Content-Type must be application/json");
    actionMap ??= scanActions(root);
    const entry = actionMap.get(id);
    if (!entry || entry.kind === "func") throw new HttpError(404, "Unknown action");
    let args;
    try { args = reviveArgs(JSON.parse((await readBody(req, maxBodySize)).toString("utf8")).args); }
    catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, "Invalid action arguments"); }
    const mod = await import(pathToFileURL(path.join(root, entry.file)).href);
    const fn = Object.hasOwn(mod, entry.name) ? mod[entry.name] : undefined;
    if (typeof fn !== "function") throw new HttpError(404, "Unknown action");
    let result;
    try { result = await fn(...args); }
    catch (err) { if (isNotFoundError(err)) throw new HttpError(404, "Not found"); throw err; }
    const store = als.getStore();
    const extra = { "cache-control": "no-store" };
    if (result instanceof Response) {
      const loc = result.headers.get("location");
      if (loc && result.status >= 300 && result.status < 400) return jsonResponse(200, { redirect: loc, ...(store?.revalidated ? { refresh: true } : {}) }, extra);
      throw new TypeError(`${entry.file}: ${entry.name}() returned a Response; actions return JSON-serializable data (or redirect(...))`);
    }
    let text;
    try { text = JSON.stringify({ ...(result === undefined ? {} : { result }), ...(store?.revalidated ? { refresh: true } : {}) }); }
    catch { throw new TypeError(`${entry.file}: ${entry.name}() returned something that is not JSON-serializable`); }
    return new Response(text, { status: 200, headers: { "content-type": "application/json; charset=utf-8", ...extra } });
  }

  /**
   * GET /_nepx/func?args=<json array> with the header x-nepx-func: <id>  ->  { result }
   * Runs an exported function of a "use func" file: a read-only server function (no redirect, never cached). The custom header keeps cross-site pages out.
   */
  async function handleFunc(req, url) {
    const id = String(req.headers["x-nepx-func"] ?? "");
    if (!id) throw new HttpError(400, "Missing x-nepx-func header");
    actionMap ??= scanActions(root);
    const entry = actionMap.get(id);
    if (!entry || entry.kind !== "func") throw new HttpError(404, "Unknown function");
    const raw = url.searchParams.get("args") ?? "[]";
    if (raw.length > 8192) throw new HttpError(414, "Arguments too long: use a \"use server\" action for large payloads");
    let args;
    try { args = JSON.parse(raw); if (!Array.isArray(args) || args.length > 50) throw 0; } catch { throw new HttpError(400, "Invalid function arguments"); }
    const mod = await import(pathToFileURL(path.join(root, entry.file)).href);
    const fn = Object.hasOwn(mod, entry.name) ? mod[entry.name] : undefined;
    if (typeof fn !== "function") throw new HttpError(404, "Unknown function");
    let result;
    try { result = await fn(...args); }
    catch (err) { if (isNotFoundError(err)) throw new HttpError(404, "Not found"); throw err; }
    if (result instanceof Response) throw new TypeError(`${entry.file}: ${entry.name}() returned a Response; "use func" functions return JSON-serializable data`);
    let text;
    try { text = JSON.stringify(result === undefined ? {} : { result }); } catch { throw new TypeError(`${entry.file}: ${entry.name}() returned something that is not JSON-serializable`); }
    return new Response(text, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }

  /** POST /_nepx/overlay/resolve (dev only): map a browser error's stack back to the source files + a code frame. */
  async function handleOverlayResolve(req) {
    let body;
    try { body = JSON.parse((await readBody(req, 128 * 1024)).toString("utf8")); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, "Invalid JSON body"); }
    return jsonResponse(200, resolveBrowserError(body, { assets, projectRoot }), { "cache-control": "no-store" });
  }

  /** POST /_nepx/csp-report (security.cspReport: true): browsers send CSP violations here; each becomes a "csp-report" event. */
  async function handleCspReport(req, ip) {
    const raw = await readBody(req, 16 * 1024);
    const report = parseCspReport(raw.toString("utf8"));
    if (report) guard.emit("csp-report", req, { ip, ...report });
    return new Response(null, { status: 204 });
  }

  async function route(req, url, headers, ip) {
    let locale = null;
    if (i18n && !url.pathname.startsWith("/_nepx")) { // config.i18n: /id/about is /about in Indonesian; the default locale has no prefix
      const sp = splitLocale(url.pathname, i18n), read = req.method === "GET" || req.method === "HEAD";
      if (sp.locale === i18n.defaultLocale && read) return new Response(null, { status: 308, headers: { location: sp.pathname + url.search } });
      if (sp.locale) { const u = new URL(url); u.pathname = sp.pathname; url = u; locale = sp.locale; }
      else {
        locale = i18n.defaultLocale;
        if (read && url.pathname === "/" && i18n.detection && /text\/html/.test(String(req.headers.accept ?? ""))) { // first visit: the cookie, else the browser's language
          const c = parseCookies(req.headers.cookie)[LOCALE_COOKIE];
          const want = i18n.locales.includes(c) ? c : pickLocale(req.headers["accept-language"], i18n);
          if (want && want !== i18n.defaultLocale) return new Response(null, { status: 307, headers: { location: "/" + want + url.search, vary: "Accept-Language, Cookie" } });
        }
      }
      const st0 = als.getStore();
      if (st0) st0.locale = locale;
    }
    let segments = decodeSegments(url.pathname);
    const isRead = req.method === "GET" || req.method === "HEAD";
    const rctx = ctxOf(req, url);
    for (const rule of headerRules) if (rule.match(url.pathname, rctx)) for (const [k, v] of rule.headers) headers[k] = v;
    if (segments[0] !== "_nepx") {
      for (const rule of redirects) {
        const dest = rule.resolve(url.pathname, url.search, rctx);
        if (dest) return new Response(null, { status: rule.status, headers: { location: dest } });
      }
      // trailingSlash: true -> "/about" is redirected to "/about/" (not "/", not files with an extension, not other methods)
      if (trailingSlash && isRead && url.pathname !== "/" && !url.pathname.endsWith("/") && !/\.[A-Za-z0-9]+$/.test(url.pathname.split("/").pop())) {
        return new Response(null, { status: 308, headers: { location: url.pathname + "/" + url.search } });
      }
    }
    if (segments[0] === "_nepx") {
      if (segments[1] === "data" && segments.length === 2 && renderer && isRead) return handleData(req, url);
      if (segments[1] === "image" && segments.length === 2 && isRead && serveImage) return serveImage(url, req);
      if (segments[1] === "action" && segments.length === 2 && req.method === "POST") return handleAction(req);
      if (segments[1] === "func" && segments.length === 2 && isRead && req.method === "GET") return handleFunc(req, url);
      if (sec.cspReport === true && url.pathname === CSP_REPORT_PATH && req.method === "POST") return handleCspReport(req, ip);
      if (dev && segments[1] === "overlay" && segments[2] === "resolve" && segments.length === 3 && req.method === "POST") return handleOverlayResolve(req);
      const asset = isRead ? assets.get("/" + segments.join("/")) : null;
      if (!asset) throw new HttpError(404, "Not found");
      const hashed = !dev && /^\/_nepx\/[\w-]+\.[0-9a-zA-Z]{8}\.\w+$/.test(url.pathname);
      return conditionalResponse(req, asset.body, { "content-type": asset.type, "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache" });
    }
    const mw = await runMiddleware(req, url);
    if (mw && mw.response) return mw.response;
    if (mw && mw.headers) for (const [k, v] of Object.entries(mw.headers)) headers[k] = v;
    let target = url; // the URL the router matches (a rewrite changes it, the browser's URL stays)
    if (mw && mw.rewrite) target = new URL(mw.rewrite, url.origin);
    else { const rw = applyRewrites(url, req); if (rw) target = rw; }
    if (isExternal(target, url)) return proxy(req, url, target);
    if (target !== url) segments = decodeSegments(target.pathname);
    const resolvedPath = target !== url ? target.pathname : null;

    let found = matchRoute(routes, segments);
    if (found && !(await paramsGate(found.route, found.params))) found = null; // dynamicParams = false: unknown params are a 404
    if (found) req.nepxRoute = { path: found.route.path, type: found.route.type === "API" ? "route" : "render" };
    if (found && found.route.type === "API") return handleApi(req, url, found);
    if (!found && isRead && segments.length === 2 && segments[0] === "sitemap" && /^[A-Za-z0-9_-]+\.xml$/.test(segments[1])) { // generateSitemaps: /sitemap/<id>.xml
      const smRoute = routes.find((r) => r.meta === "sitemap");
      if (smRoute) {
        const sm = await sitemapResponse(await loadModule(smRoute), { base: url.origin + basePath, id: segments[1].slice(0, -4) });
        if (sm) return sm;
      }
    }
    if (found) {
      if (!isRead) return jsonResponse(405, { error: "Method not allowed" }, { allow: "GET, HEAD" });
      const st = als.getStore();
      if (st && isDraftRequest(st.cookies)) { // draft mode: always a fresh render, never a shared copy
        const res = await renderPage(req, url, found, resolvedPath);
        res.headers.set("cache-control", "private, no-store");
        return res;
      }
      if ((found.route.revalidate || found.route.staticProps) && !dynamicPages.has(found.route.file) && (!i18n || locale === i18n.defaultLocale)) return renderRevalidated(req, url, found, resolvedPath, segments);
      if (staticDir && found.route.ssg && (!i18n || locale === i18n.defaultLocale)) { // prerendered pages are in the default locale
        try { return htmlResponse(200, await readFile(path.join(staticDir, ...segments, "index.html"))); } catch { /* not prerendered: render on demand */ }
      }
      return renderPage(req, url, found, resolvedPath);
    }
    if (!isRead || segments[0] === "api") throw new HttpError(404, "Not found");
    if (segments.length === 2 && iconFiles.has(segments[0]) && isDynamicIcon(iconFiles.get(segments[0]))) { // generateImageMetadata(): /icon/<id>
      const abs = iconFiles.get(segments[0]);
      const variant = (await imageVariants(abs)).find((v) => v.id === segments[1]);
      if (!variant) throw new HttpError(404, "Not found");
      const mod = await import(pathToFileURL(abs).href);
      const out = await mod.default({ params: {}, id: variant.id });
      if (!(out instanceof Response)) throw new Error(`${path.basename(abs)} must return an ImageResponse (or a Response)`);
      return out;
    }
    if (segments.length === 1 && iconFiles.has(segments[0])) { // app/icon.png etc.
      const abs = iconFiles.get(segments[0]);
      if (isDynamicIcon(abs)) { // app/opengraph-image.jsx: the default export returns an ImageResponse
        const mod = await import(pathToFileURL(abs).href);
        const gen = mod.default;
        if (typeof gen !== "function") throw new Error(`${path.basename(abs)} must export a default function that returns an ImageResponse`);
        const out = await gen({ params: {}, id: "default" });
        if (!(out instanceof Response)) throw new Error(`${path.basename(abs)} must return an ImageResponse (or a Response)`);
        return out;
      }
      return conditionalResponse(req, await readFile(abs), { "content-type": MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream", "cache-control": dev ? "no-cache" : "public, max-age=3600" });
    }
    const pub = await servePublic(segments, req);
    if (pub) return pub;
    if (fallbackRewrites.length && target === url) { // rewrites.fallback: only when no page, API route or public file matched
      const fctx = ctxOf(req, url);
      for (const rule of fallbackRewrites) {
        const dest = rule.resolve(url.pathname, url.search, fctx);
        if (!dest) continue;
        const fb = new URL(dest, url.origin);
        if (isExternal(fb, url)) return proxy(req, url, fb);
        const fsegs = decodeSegments(fb.pathname);
        const f2 = matchRoute(routes, fsegs);
        if (f2 && (await paramsGate(f2.route, f2.params))) return f2.route.type === "API" ? handleApi(req, url, f2) : renderPage(req, url, f2, fb.pathname);
        const pub2 = await servePublic(fsegs, req);
        if (pub2) return pub2;
        break; // the first matching rule decides
      }
    }
    if (guard.isProbe?.(url.pathname)) { guard.emit("probe", req, { status: 404, ip }); return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }); }
    if (!hasPages) throw new HttpError(404, "Not found");
    return renderPage(req, url, null, resolvedPath);
  }

  async function handle(req) {
    const requestId = guard.requestId(req) ?? crypto.randomUUID();
    req.requestId = requestId;
    let headers = { "x-request-id": requestId, "x-content-type-options": "nosniff", ...(poweredByHeader ? { "x-powered-by": "Nepx" } : {}) };
    let response, url = null, store = null;
    try {
      if (!req.url || !req.url.startsWith("/")) throw new HttpError(400, "Bad request target");
      if (basePath) { // everything below works on paths without the base; dev tooling endpoints are reachable without it
        req.originalUrl = req.url;
        const q = req.url.indexOf("?"), pn = q === -1 ? req.url : req.url.slice(0, q), search = q === -1 ? "" : req.url.slice(q);
        if (pn === basePath || pn.startsWith(basePath + "/")) req.url = (pn.slice(basePath.length) || "/") + search;
        else if (!(dev && pn.startsWith("/_nepx/overlay/")) && pn !== "/_nepx/csp-report") throw new HttpError(404, "Not found");
      }
      try { url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`); }
      catch { url = new URL(req.url, "http://localhost"); } // even a refused request needs its path (JSON for /api, a page for browsers)
      const verdict = await guard.inspect(req);   // URL length, method, Host, IP lists, CSRF origin, rate limit
      Object.assign(headers, verdict.headers);
      if (verdict.violation) { const v = verdict.violation; throw new HttpError(v.status, v.message, { headers: v.headers }); }
      const reqHeaders = new Headers();
      for (const [k, v] of Object.entries(req.headers)) { try { reqHeaders.set(k, Array.isArray(v) ? v.join(", ") : v); } catch { /* skip invalid */ } }
      store = newStore(reqHeaders, parseCookies(reqHeaders.get("cookie")));
      response = await als.run(store, () => route(req, url, headers, verdict.ip));
      if (basePath && response.status >= 300 && response.status < 400) { // redirects to "/x" stay inside the app: "/docs/x"
        const loc = response.headers.get("location");
        if (loc && loc.startsWith("/") && !loc.startsWith("//")) { const hh = new Headers(response.headers); hh.set("location", withBase(basePath, loc)); response = new Response(null, { status: response.status, headers: hh }); }
      }
    } catch (err) {
      url ??= new URL("/", "http://localhost");
      if (isHttpError(err)) {
        if (err.status >= 500) console.error(`[${requestId}]`, err.stack ?? err);
        response = await errorResponse(req, url, err.status, { json: err.message, message: publicMessage(err), digest: err.status >= 500 ? requestId : undefined, retryAfter: err.retryAfter, extra: err.headers });
      } else {
        console.error(`[${requestId}]`, err && err.stack ? err.stack : err);
        reportError(err, req, "render");
        if (!dev) response = await errorResponse(req, url, 500, { json: "Internal Server Error", digest: requestId });
        else {
          const payload = buildPayload(err, { projectRoot, kind: "Server Error", method: req.method, url: req.url, requestId });
          process.stderr.write(terminalFrame(payload));
          // Browsers get the overlay page; fetch()/curl keep getting JSON (now with the stack to debug from).
          response = wantsHtml(req) ? htmlResponse(500, errorPageHtml(payload)) : jsonResponse(500, { error: String(err && err.message), requestId, stack: payload.stack });
        }
      }
    }
    return { response, headers, store };
  }

  const sse = new Set();
  const server = http.createServer({
    ...(sec.maxHeaderSize ? { maxHeaderSize: sec.maxHeaderSize } : {}),
    headersTimeout: sec.headersTimeoutMs, requestTimeout: sec.requestTimeoutMs, // slow clients get 408 / the socket closed (slowloris)
  }, async (req, res) => {
    if (dev && req.url === "/_nepx/livereload") {
      if (req.method === "HEAD") { res.writeHead(200); return res.end(); }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(": connected\n\n");
      sse.add(res); res.on("close", () => sse.delete(res));
      return;
    }
    const t0 = process.hrtime.bigint();
    const { response, headers, store } = await handle(req);
    if (store && store.afterTasks.length) res.once("close", () => { // after(): runs once the response is gone, errors are only logged
      for (const fn of store.afterTasks) als.run(store, () => Promise.resolve().then(fn)).catch((e) => console.error(`[${req.requestId}] after() callback failed:`, e && e.stack ? e.stack : e));
    });
    if (log && !String(req.url).startsWith("/_nepx/")) res.on("finish", () => console.log(`${req.method} ${req.originalUrl ?? req.url} ${res.statusCode} ${Number(process.hrtime.bigint() - t0) / 1e6 | 0}ms`));
    try {
      const out = { ...headers };
      for (const [k, v] of response.headers) if (k !== "set-cookie") out[k] = v;
      const cookies = [...(response.headers.getSetCookie?.() ?? []), ...(store ? store.setCookies : [])];
      if (cookies.length) out["set-cookie"] = cookies;
      const live = response[STREAM];
      if (live) { // streamed page: no Content-Length, compressed on the fly
        const zip = compressor.streaming(req, out);
        res.writeHead(response.status, out);
        res.on("close", () => { if (!res.writableFinished) live.abort(); }); // client went away: stop rendering
        pipeline(...(zip ? [live.readable, zip, res] : [live.readable, res]), (e) => { if (e && e.code !== "ERR_STREAM_PREMATURE_CLOSE") console.error("Failed to stream response:", e); });
        return;
      }
      const noBody = req.method === "HEAD" || response.status === 204 || response.status === 304;
      let body = noBody ? null : Buffer.from(await response.arrayBuffer());
      body = await compressor.apply(req, out, body);
      res.writeHead(response.status, out);
      if (noBody) return res.end();
      res.end(body);
    } catch (err) {
      console.error("Failed to send response:", err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  handleParserErrors(server);
  server.renderer = renderer;
  server.isr = isr;
  server.on("close", () => { isr.close(); guard.close(); });
  return server;
}

export function listen(server, port, { fallback = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let p = port, tries = 0;
    const onError = (err) => {
      if (err.code === "EADDRINUSE" && tries < fallback) { tries++; p++; server.listen(p); }
      else reject(err.code === "EADDRINUSE" ? new Error(`Port ${p} is already in use`) : err);
    };
    server.on("error", onError);
    server.once("listening", () => { server.off("error", onError); resolve(server.address().port); });
    server.listen(p);
  });
}
