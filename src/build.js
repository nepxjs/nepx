import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, lstatSync } from "node:fs";
import path from "node:path";
import { NepxError } from "./errors/index.js";
import { scanApp, inspectRoutes, findMiddleware, appDirOf } from "./router.js";
import { bundleClient } from "./bundle.js";
import { scanActions } from "./actions.js";
import { createRenderer, renderDocument, assetRefs } from "./ssr.js";
import { imageContext } from "./images.js";
import { isDynamicError } from "./shared.js";
import { MIME } from "./mime.js";
import { als, newStore } from "./request-context.js";
import { pool } from "./turbo.js";
import { pagesDirOf } from "./pages-dir.js";
import { loadStaticParams } from "./static-paths.js";

/** Build output folder inside the project: ".nepx", or config.distDir (a single folder name; set through setDistDir / NEPX_DIST_DIR before anything is built). */
export let OUT_DIR = process.env.NEPX_DIST_DIR || ".nepx";
export function setDistDir(name) { OUT_DIR = name || ".nepx"; if (name && name !== ".nepx") process.env.NEPX_DIST_DIR = name; else delete process.env.NEPX_DIST_DIR; }

export function toManifest({ routes, rootLayout, notFound, errorPage, globalError, statusPages, middleware, templates, slots }, hasClient) {
  return {
    version: 8, client: hasClient, rootLayout, notFound, errorPage, globalError: globalError ?? null, statusPages: statusPages ?? {}, middleware, templates: templates ?? {}, slots: slots ?? [],
    routes: routes.map(({ type, path, file, params, methods, segments, layouts, notFound, loading, errorScope, meta, revalidate, hasData, staticProps, staticPaths, ssg, slots, dynamic, dynamicParams, tags, pagesApp }) => ({ type, path, file, params, methods, segments, layouts, slots: slots ?? [], notFound: notFound ?? null, loading: loading ?? null, errorScope: errorScope ?? null, meta: meta ?? null, revalidate: revalidate ?? null, hasData: !!hasData, staticProps: !!staticProps, staticPaths: !!staticPaths, ssg: !!ssg, dynamic: dynamic ?? null, dynamicParams: dynamicParams === false ? false : true, tags: tags ?? [], ...(pagesApp ? { pagesApp } : {}) })),
  };
}

/** Scan + import everything. Returns { routes, pages, api, rootLayout, notFound, middleware, errors }. */
export async function analyze(root, { concurrency = 1 } = {}) {
  if (!existsSync(appDirOf(root)) && !existsSync(pagesDirOf(root))) throw new NepxError(`No app/ or pages/ directory found in ${root}`);
  const scan = scanApp(root);
  const info = await inspectRoutes(root, scan, { concurrency });
  const errors = [...info.routes.filter((r) => r.error).map((r) => r.error), ...info.extraErrors];
  try { scanActions(root); } catch (e) { errors.push(e.message); } // inline "use server" anywhere in the project
  return {
    routes: info.routes, pages: info.routes.filter((r) => r.type === "PAGE"), api: info.routes.filter((r) => r.type === "API"),
    rootLayout: info.rootLayout, notFound: info.notFound, errorPage: info.errorPage, globalError: info.globalError, statusPages: info.statusPages, templates: info.templates, slots: info.slots, middleware: findMiddleware(root), errors,
  };
}

const SKIP_AT_ROOT = new Set(["node_modules", "public", ".git"]);

function copyProject(root, dest) {
  for (const name of readdirSync(root)) {
    if (SKIP_AT_ROOT.has(name) || name === OUT_DIR || (name.startsWith(".") && name !== ".nepx-pages")) continue; // .env files are read from the project dir at runtime
    const abs = path.join(root, name);
    if (lstatSync(abs).isSymbolicLink()) continue;
    cpSync(abs, path.join(dest, name), { recursive: true, filter: (src) => !lstatSync(src).isSymbolicLink() && path.basename(src) !== "node_modules" });
  }
}

/** Static paths for a page that can be prerendered, or null when it must render per request. */
async function staticPaths(route, renderer) {
  if ((route.hasData && !route.staticProps) || route.dynamic === "force-dynamic") return null;
  const dynamic = route.segments.some((s) => s.param || s.catchall || s.optional);
  if (!dynamic) return [[]].map(() => ({ params: {}, segs: route.segments.map((s) => s.static) }));
  if (!route.staticParams) return null;
  const mod = await renderer.load(route.file);
  const { list } = await loadStaticParams(route, mod);
  if (!Array.isArray(list)) throw new NepxError(`${route.file}: generateStaticParams must return an array of param objects`);
  return list.map((params) => {
    const segs = [];
    for (const s of route.segments) {
      if (s.static !== undefined) { segs.push(s.static); continue; }
      const name = s.catchall || s.optional;
      const v = params?.[name ?? s.param];
      if (s.optional && (v === undefined || (Array.isArray(v) && v.length === 0))) continue; // [[...x]] with no value = the parent path
      const vals = name ? (Array.isArray(v) ? v.map(String) : null) : (v === undefined || v === null ? null : [String(v)]);
      if (!vals || !vals.length || vals.some((x) => !x || x === "." || x === ".." || /[\/\\\0]/.test(x))) throw new NepxError(`${route.file}: generateStaticParams returned invalid params ${JSON.stringify(params)}`);
      segs.push(...vals);
    }
    return { params, segs };
  });
}

export async function build(root, { basePath = "", concurrency = 1, images = null, i18n = null, strictMode = false, removeConsole = false } = {}) {
  const a = await analyze(root, { concurrency });
  if (a.errors.length) throw new NepxError(`Build failed:\n` + a.errors.map((e) => `  - ${e}`).join("\n"));
  const hasPages = a.pages.length > 0 || !!a.notFound || !!a.errorPage;
  const assets = hasPages ? await bundleClient(root, { pages: a.pages, rootLayout: a.rootLayout, notFound: a.notFound, errorPage: a.errorPage, globalError: a.globalError, templates: a.templates, slots: a.slots }, { dev: false, basePath, strictMode, removeConsole }) : new Map();

  const out = path.join(root, OUT_DIR);
  if (path.basename(out) !== OUT_DIR || path.dirname(out) !== path.resolve(root)) throw new NepxError("Refusing to clean unexpected output path");
  rmSync(out, { recursive: true, force: true }); // only ever removes <root>/.nepx
  mkdirSync(path.join(out, "server"), { recursive: true });
  copyProject(root, path.join(out, "server"));
  if (existsSync(path.join(root, "public"))) cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
  if (assets.size) {
    mkdirSync(path.join(out, "client"), { recursive: true });
    for (const [url, asset] of assets) writeFileSync(path.join(out, "client", path.basename(url)), asset.body);
  }

  // Static generation: pages without getServerSideProps are prerendered to .nepx/static.
  let prerendered = 0;
  const refs = assetRefs(assets);
  if (a.pages.length) {
    const renderer = createRenderer({ projectRoot: root, root, rootLayout: a.rootLayout, notFound: a.notFound, errorPage: a.errorPage, globalError: a.globalError, statusPages: a.statusPages, templates: a.templates, slots: a.slots, basePath, images: imageContext(images), i18n });
    await pool(a.pages, concurrency, async (route) => { // turbo: several pages are prerendered at the same time
      let list;
      try { list = await staticPaths(route, renderer); } catch (e) { throw e instanceof NepxError ? e : new NepxError(`${route.file}: ${e.message}`); }
      if (!list) return;
      const pending = [];
      let dynamic = false, hint;
      for (const { params, segs } of list) {
        const urlPath = "/" + segs.map(encodeURIComponent).join("/");
        const url = new URL("http://localhost" + urlPath);
        let view;
        // force-static: cookies() / headers() are empty while prerendering instead of making the page dynamic
        const render = () => renderer.render(route, params, url, { request: new Request(url), cookies: {}, requestId: "build", onRevalidate: (s) => { hint = Math.min(hint ?? Infinity, s); } });
        try { view = await (route.dynamic === "force-static" ? als.run(newStore(), render) : render()); }
        catch (e) {
          if (isDynamicError(e)) { dynamic = true; break; } // cookies()/headers(): this page needs a request, so it renders per request
          throw new NepxError(`Prerender failed for ${urlPath}: ${e.message}`);
        }
        if (view.redirect || view.status !== 200) continue;
        pending.push({ segs, html: renderDocument({ html: view.html, metadata: view.metadata, boot: view.boot, refs, dev: false, basePath, headExtra: view.headHtml }) });
      }
      if (dynamic) return;
      route.ssg = true;
      if (route.staticProps && route.revalidate === undefined && Number.isFinite(hint)) route.revalidate = hint; // getStaticProps -> { revalidate }
      for (const { segs, html } of pending) {
        const file = path.join(out, "static", ...segs, "index.html");
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, html);
        prerendered++;
      }
    });
  }
  writeFileSync(path.join(out, "manifest.json"), JSON.stringify(toManifest(a, assets.size > 0), null, 2) + "\n");
  return { routes: a.routes, prerendered };
}

export function readManifest(root) {
  const file = path.join(root, OUT_DIR, "manifest.json");
  if (!existsSync(file)) throw new NepxError('No production build found. Run "nepx build" first.');
  const m = JSON.parse(readFileSync(file, "utf8"));
  if (m.version !== 8) throw new NepxError('The build in .nepx/ is from an older Nepx version. Run "nepx build" again.');
  return m;
}

export function readClientAssets(root) {
  const dir = path.join(root, OUT_DIR, "client");
  const assets = new Map();
  if (!existsSync(dir)) return assets;
  for (const f of readdirSync(dir)) {
    assets.set("/_nepx/" + f, { body: readFileSync(path.join(dir, f)), type: MIME[path.extname(f).toLowerCase()] ?? "application/octet-stream" });
  }
  return assets;
}
