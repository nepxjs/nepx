import { lstatSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NepxError, PAGE_STATUSES } from "./errors/index.js";

export const EXTS = [".ksx", ".jsx", ".tsx", ".ts", ".js"];
export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const DYNAMIC = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/;
const CATCHALL = /^\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]$/;
const OPTIONAL = /^\[\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]\]$/;
const GROUP = /^\((.+)\)$/;
const STATIC = /^[A-Za-z0-9._~-]+$/;
/** app/sitemap.js, app/robots.js, app/manifest.js (root only): generated files, like the Next.js metadata routes. */
export const META_ROUTES = { sitemap: "sitemap.xml", robots: "robots.txt", manifest: "manifest.webmanifest" };

/** "src" when the project keeps its code in src/app, otherwise "" (app/ at the project root). */
export const baseDir = (root) => (existsSync(path.join(root, "src", "app")) ? "src" : "");
export const appDirOf = (root) => path.join(root, baseDir(root), "app");

const splitExt = (name) => {
  const ext = EXTS.find((e) => name.endsWith(e));
  return ext ? [name.slice(0, -ext.length), ext] : null;
};

function walk(dir, base = "") {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name.startsWith("_") && !splitExt(name)) continue; // private folders: _name
    const abs = path.join(dir, name);
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) continue; // never follow symlinks out of the project
    const rel = base ? `${base}/${name}` : name;
    if (st.isDirectory()) out.push(...walk(abs, rel));
    else if (splitExt(name)) out.push(rel);
  }
  return out;
}

const INTERCEPT = /^(\(\.\)|(?:\(\.\.\))+|\(\.\.\.\))(.+)$/;
const SLOT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** One directory name -> a route segment ({ static } | { param } | { catchall } | { optional }); null for (group) folders. */
function parseOne(p) {
  if (GROUP.test(p)) return null; // (group) folders do not appear in the URL
  let m;
  if ((m = OPTIONAL.exec(p))) return { optional: m[1] };
  if ((m = CATCHALL.exec(p))) return { catchall: m[1] };
  if ((m = DYNAMIC.exec(p))) return { param: m[1] };
  if (p.startsWith("[")) throw new NepxError(`Invalid route segment "${p}" (use [name], [...name] or [[...name]])`);
  if (!STATIC.test(p)) throw new NepxError(`Invalid route segment "${p}" (allowed: letters, digits, . _ ~ -)`);
  return { static: p };
}

/**
 * Directory names -> route segments. `start` are the segments the parts continue from (a @slot's parent URL).
 * With allowIntercept, (.)name / (..)name / (..)(..)name / (...)name climb that many ROUTE segments (not folders) before adding name.
 */
function parseDirSegments(parts, { start = [], allowIntercept = false } = {}) {
  const segs = [...start];
  let intercept = false;
  for (const p of parts) {
    const im = INTERCEPT.exec(p);
    if (im && !GROUP.test(p)) {
      if (!allowIntercept) throw new NepxError(`Intercepting route "${p}" is only supported inside a @slot folder`);
      const up = im[1] === "(.)" ? 0 : im[1] === "(...)" ? Infinity : im[1].length / 4;
      if (up > segs.length && up !== Infinity) throw new NepxError(`Intercepting route "${p}" climbs above the root`);
      segs.length = up === Infinity ? 0 : segs.length - up;
      const one = parseOne(im[2]);
      if (one) segs.push(one);
      intercept = true;
      continue;
    }
    const one = parseOne(p);
    if (one) segs.push(one);
  }
  const ci = segs.findIndex((s) => s.catchall || s.optional);
  if (ci !== -1 && ci !== segs.length - 1) throw new NepxError(`Catch-all segment [...${segs[ci].catchall || segs[ci].optional}] must be the last segment`);
  return { segs, intercept };
}
const urlPathOf = (segs) => (segs.length ? segs.map((s) => "/" + (s.optional ? ":" + s.optional + "*?" : s.catchall ? ":" + s.catchall + "*" : s.param ? ":" + s.param : s.static)).join("") : "/");

const rank = (s) => (s.optional ? 3 : s.catchall ? 2 : s.param ? 1 : 0);
function compareRoutes(a, b) {
  const n = Math.min(a.segments.length, b.segments.length);
  for (let i = 0; i < n; i++) {
    const d = rank(a.segments[i]) - rank(b.segments[i]);
    if (d) return d; // static before dynamic before catch-all
  }
  if (a.segments.length !== b.segments.length) return a.segments.length - b.segments.length;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * Scan app/ (Next.js App Router conventions):
 *   page.* -> PAGE, route.* -> API (named exports GET/POST/...), layout.* wraps everything below it, template.* is a layout that remounts when the next URL segment changes,
 *   not-found.* / loading.* / error.* (nearest wins), (group) folders, [id], [...slug], _private folders,
 *   @slot folders (parallel routes: page.* + default.*, rendered as a prop of the layout next to them) and (.)name / (..)name / (...)name folders inside a @slot (intercepting routes).
 */
export function scanApp(root) {
  const appDir = appDirOf(root);
  const prefix = path.posix.join(baseDir(root), "app");
  const files = walk(appDir);
  const layouts = new Map(); // dir ("" = root) -> rel file
  const templatesByDir = new Map(); // template.*: like a layout, but remounted when the next URL segment changes
  const notFounds = new Map(); // not-found.* may exist at any level (nearest one wins)
  const loadings = new Map(); // loading.*: shown during client-side navigation
  const errors = new Map(); // error.* may exist at any level (nearest one wins, inside its own layouts)
  const statusPages = {}; // app/<status>.* (root only): 401.jsx, 403.jsx, 429.jsx, 503.jsx ... rendered inside the root layout
  const entries = [];
  const slotEntries = []; // page.* inside @slot folders
  const slotDefaults = new Map(); // "<dir>|<name>" -> file
  const single = (map, dir, file, what) => {
    if (map.has(dir)) throw new NepxError(`Multiple ${what} in ${prefix}/${dir}: ${map.get(dir)} and ${file}`);
    map.set(dir, file);
  };
  for (const rel of files) {
    const dir = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
    const [stem] = splitExt(path.posix.basename(rel));
    const file = `${prefix}/${rel}`;
    const dparts = dir ? dir.split("/") : [];
    const at = dparts.findIndex((p) => p.startsWith("@"));
    if (at !== -1) { // ---- parallel route: <dir>/@name/...
      if (dparts.slice(at + 1).some((p) => p.startsWith("@"))) throw new NepxError(`${file}: nested @slot folders are not supported`);
      const name = dparts[at].slice(1);
      if (!SLOT_NAME.test(name)) throw new NepxError(`${file}: invalid slot name "@${name}" (letters, digits and _; the first one not a digit)`);
      if (name === "children") throw new NepxError(`${file}: "children" is the implicit slot, do not name a folder @children`);
      const baseDirPath = dparts.slice(0, at).join("/"), relParts = dparts.slice(at + 1);
      if (["layout", "template", "loading", "error", "not-found"].includes(stem)) throw new NepxError(`${file}: ${stem}.* inside a @slot folder is not supported (put it in the parent folder)`);
      if (stem === "route" || META_ROUTES[stem] && dir === "") throw new NepxError(`${file}: route handlers cannot live inside a @slot folder`);
      if (stem === "default") {
        if (relParts.length) throw new NepxError(`${file}: default.* is only supported at the root of a @slot folder`);
        slotDefaults.set(`${baseDirPath}|${name}`, file);
      } else if (stem === "page") slotEntries.push({ rel, file, baseDirPath, name, relParts, baseParts: dparts.slice(0, at) });
      continue;
    }
    if (stem === "layout") single(layouts, dir, file, "layouts");
    else if (stem === "template") single(templatesByDir, dir, file, "templates");
    else if (stem === "not-found") single(notFounds, dir, file, "not-found files");
    else if (stem === "loading") single(loadings, dir, file, "loading files");
    else if (stem === "error") single(errors, dir, file, "error files");
    else if (dir === "" && /^[45]\d\d$/.test(stem)) {
      const code = Number(stem);
      if (code === 404) throw new NepxError(`${file}: use not-found.* for the 404 page`);
      if (!PAGE_STATUSES.includes(code)) throw new NepxError(`${file}: no page for status ${code} (supported: ${PAGE_STATUSES.join(", ")})`);
      if (statusPages[code]) throw new NepxError(`Multiple ${code} pages in ${prefix}: ${statusPages[code]} and ${file}`);
      statusPages[code] = file;
    }
    else if (stem === "page" || stem === "route") entries.push({ rel, dir, stem, file });
    else if (dir === "" && META_ROUTES[stem]) entries.push({ rel, dir, stem, file, meta: stem });
  }
  const notFound = notFounds.get("") ?? null;
  const errorPage = errors.get("") ?? null;
  // template depth = number of URL segments above it: the template remounts when URL segment number `depth` changes
  const templates = {};
  for (const [d, f] of templatesByDir) {
    try { templates[f] = parseDirSegments(d ? d.split("/") : []).segs.length; } catch (err) { throw new NepxError(`${f}: ${err.message}`); }
  }
  const chainFor = (parts) => { // layouts (and templates) from the root down to (and including) this directory
    const chain = [];
    for (let k = 0; k <= parts.length; k++) {
      const key = parts.slice(0, k).join("/");
      const l = layouts.get(key); if (l) chain.push(l);
      const t = templatesByDir.get(key); if (t) chain.push(t);
    }
    return chain;
  };
  const nearest = (map, parts) => { // deepest special file at or above this directory, with the layouts that wrap it
    for (let k = parts.length; k >= 0; k--) {
      const f = map.get(parts.slice(0, k).join("/"));
      if (f) return { file: f, layouts: chainFor(parts.slice(0, k)) };
    }
    return null;
  };
  const shapeOf = (ss) => (ss.length ? ss.map((s) => "/" + (s.catchall || s.optional ? "**" : s.param ? ":" : s.static)).join("") : "/");
  const conflictKeys = (segs) => { // [[...x]] also claims its parent path, so it conflicts with a page there
    const last = segs[segs.length - 1];
    if (last && last.optional) { const parent = shapeOf(segs.slice(0, -1)); return [parent, parent === "/" ? "/**" : parent + "/**"]; }
    return [shapeOf(segs)];
  };
  const namesOf = (segs, file) => {
    const names = segs.map((s) => s.param || s.catchall || s.optional).filter(Boolean);
    if (new Set(names).size !== names.length) throw new NepxError(`${file}: duplicate parameter name`);
    return names;
  };

  // ---- parallel routes: group the @slot pages by (directory, name)
  const slotMap = new Map(); // key -> { key, dir, name, layout, routes: [], intercepts: [], default }
  const slotsByDir = new Map();
  const slotFor = (dir, name, file) => {
    const key = `${dir}|${name}`;
    if (!slotMap.has(key)) {
      const layout = layouts.get(dir);
      if (!layout) throw new NepxError(`${file}: the @${name} slot needs a layout.* in ${prefix}${dir ? "/" + dir : ""} to receive it as a prop`);
      const slot = { key, dir, name, layout, routes: [], intercepts: [], default: slotDefaults.get(key) ?? null, seen: new Map(), seenIntercept: new Map() };
      slotMap.set(key, slot);
      if (!slotsByDir.has(dir)) slotsByDir.set(dir, []);
      slotsByDir.get(dir).push(slot);
    }
    return slotMap.get(key);
  };
  for (const key of slotDefaults.keys()) { const [d, n] = [key.slice(0, key.lastIndexOf("|")), key.slice(key.lastIndexOf("|") + 1)]; slotFor(d, n, slotDefaults.get(key)); }
  for (const e of slotEntries) {
    const slot = slotFor(e.baseDirPath, e.name, e.file);
    let parsed;
    try {
      const start = parseDirSegments(e.baseParts).segs;
      parsed = parseDirSegments(e.relParts, { start, allowIntercept: true });
    } catch (err) { throw new NepxError(`${e.file}: ${err.message}`); }
    const keys = conflictKeys(parsed.segs), seen = parsed.intercept ? slot.seenIntercept : slot.seen;
    for (const k of keys) if (seen.has(k)) throw new NepxError(`Route conflict in @${e.name}: ${e.file} and ${seen.get(k)} both map to ${urlPathOf(parsed.segs)}`);
    for (const k of keys) seen.set(k, e.file);
    (parsed.intercept ? slot.intercepts : slot.routes).push({ file: e.file, path: urlPathOf(parsed.segs), segments: parsed.segs, params: namesOf(parsed.segs, e.file) });
  }
  for (const slot of slotMap.values()) { slot.routes.sort(compareRoutes); slot.intercepts.sort(compareRoutes); delete slot.seen; delete slot.seenIntercept; }

  const seen = new Map();
  const routes = [];
  for (const e of entries) {
    const parts = e.dir ? e.dir.split("/") : [];
    let segs;
    try { segs = parseDirSegments(parts).segs; } catch (err) { throw new NepxError(`${e.file}: ${err.message}`); }
    if (e.meta) segs = [...segs, { static: META_ROUTES[e.meta] }];
    const urlPath = urlPathOf(segs);
    const keys = conflictKeys(segs);
    for (const k of keys) if (seen.has(k)) throw new NepxError(`Route conflict: ${e.file} and ${seen.get(k)} both map to ${urlPath}`);
    for (const k of keys) seen.set(k, e.file);
    const names = namesOf(segs, e.file);
    const isPage = e.stem === "page";
    const chain = isPage ? chainFor(parts) : [];
    const mySlots = [];
    if (isPage) for (let k = 0; k <= parts.length; k++) for (const sl of slotsByDir.get(parts.slice(0, k).join("/")) ?? []) mySlots.push({ key: sl.key, name: sl.name, layoutIndex: chain.indexOf(sl.layout) });
    routes.push({
      type: isPage ? "PAGE" : "API", path: urlPath, file: e.file, segments: segs, params: names,
      methods: isPage || e.meta ? ["GET"] : [], layouts: chain, meta: e.meta ?? null,
      notFound: isPage ? nearest(notFounds, parts) : null, loading: isPage ? nearest(loadings, parts) : null, errorScope: isPage ? nearest(errors, parts) : null,
      slots: mySlots,
    });
  }
  routes.sort(compareRoutes);
  const slots = [...slotMap.values()].map(({ key, dir, name, layout, routes: r, intercepts, default: d }) => ({ key, dir, name, layout, routes: r, intercepts, default: d }));
  return { routes, rootLayout: layouts.get("") ?? null, notFound, errorPage, statusPages, templates, slots };
}

export const scanPages = (root) => scanApp(root).routes.filter((r) => r.type === "PAGE");
export const scanApi = (root) => scanApp(root).routes.filter((r) => r.type === "API");

/** Locate middleware.* next to app/ (or in src/). */
export function findMiddleware(root) {
  for (const ext of EXTS) {
    const rel = path.posix.join(baseDir(root), "middleware" + ext);
    if (existsSync(path.join(root, rel))) return rel;
  }
  return null;
}

/** Locate instrumentation.* next to app/ (or in src/): its register() runs once at server start. */
export function findInstrumentation(root) {
  for (const ext of EXTS) {
    const rel = path.posix.join(baseDir(root), "instrumentation" + ext);
    if (existsSync(path.join(root, rel))) return rel;
  }
  return null;
}

const DYNAMIC_MODES = ["auto", "force-dynamic", "force-static"];

/** Import every route module once to learn methods / data functions, and to surface compile errors early. */
export async function inspectRoutes(root, scan) {
  const load = (file) => import(pathToFileURL(path.join(root, file)).href);
  const layoutErr = new Map();
  const special = (r) => [r.notFound?.file, r.loading?.file, r.errorScope?.file].filter(Boolean);
  for (const f of new Set([...scan.routes.flatMap((r) => [...r.layouts, ...special(r)]), ...(scan.rootLayout ? [scan.rootLayout] : []), ...(scan.notFound ? [scan.notFound] : []), ...(scan.errorPage ? [scan.errorPage] : []), ...Object.values(scan.statusPages ?? {})])) {
    try {
      const m = await load(f);
      if (typeof m.default !== "function") layoutErr.set(f, `${f}: must default-export a React component`);
    } catch (err) { layoutErr.set(f, `${f}: ${err.message.split("\n")[0]}`); }
  }
  const out = [];
  for (const r of scan.routes) {
    const entry = { ...r, error: null };
    try {
      const mod = await load(r.file);
      if (r.meta) {
        if (typeof mod.default !== "function") entry.error = `${r.file}: must default-export a function returning the ${r.meta} data`;
      } else if (r.type === "API") {
        entry.methods = METHODS.filter((m) => typeof mod[m] === "function");
        if (!entry.methods.length) entry.error = `${r.file}: no HTTP handler exported (export GET, POST, PUT, PATCH, DELETE or OPTIONS)`;
      } else {
        if (typeof mod.default !== "function") entry.error = `${r.file}: must default-export a React component`;
        entry.hasData = typeof mod.getServerSideProps === "function";
        entry.staticParams = typeof mod.generateStaticParams === "function";
        if (mod.dynamic !== undefined && !DYNAMIC_MODES.includes(mod.dynamic)) entry.error = `${r.file}: dynamic must be "auto", "force-dynamic" or "force-static"`;
        else if (mod.dynamic && mod.dynamic !== "auto") entry.dynamic = mod.dynamic;
        if (mod.dynamicParams !== undefined) {
          if (typeof mod.dynamicParams !== "boolean") entry.error = `${r.file}: dynamicParams must be true or false`;
          else if (mod.dynamicParams === false) {
            if (!entry.staticParams) entry.error = `${r.file}: dynamicParams = false needs generateStaticParams`;
            else entry.dynamicParams = false;
          }
        }
        if (mod.tags !== undefined) {
          if (!Array.isArray(mod.tags) || mod.tags.some((t) => typeof t !== "string" || !t)) entry.error = `${r.file}: tags must be an array of non-empty strings`;
          else entry.tags = mod.tags;
        }
        if (mod.revalidate !== undefined) {
          if (mod.revalidate !== false && !(Number.isFinite(mod.revalidate) && mod.revalidate > 0)) entry.error = `${r.file}: revalidate must be a positive number of seconds (or false)`;
          else if (mod.revalidate !== false && entry.hasData) entry.error = `${r.file}: a page cannot export both revalidate and getServerSideProps`;
          else if (mod.revalidate !== false && entry.dynamic === "force-dynamic") entry.error = `${r.file}: a force-dynamic page cannot export revalidate (it is never cached)`;
          else if (mod.revalidate !== false) entry.revalidate = mod.revalidate;
        }
      }
    } catch (err) { entry.error = `${r.file}: ${err.message.split("\n")[0]}`; }
    const bad = [...r.layouts, ...special(r)].find((l) => layoutErr.has(l));
    if (!entry.error && bad) entry.error = layoutErr.get(bad);
    out.push(entry);
  }
  const extra = [];
  // parallel routes: every slot page / default.* must default-export a component and cannot have data functions
  const slots = [];
  for (const sl of scan.slots ?? []) {
    const check = async (file) => {
      try {
        const m = await load(file);
        if (typeof m.default !== "function") return `${file}: must default-export a React component`;
        if (typeof m.getServerSideProps === "function") return `${file}: getServerSideProps is not supported in @${sl.name} slot pages (load data in the parent page or in the component)`;
        if (typeof m.generateStaticParams === "function") return `${file}: generateStaticParams is not supported in @${sl.name} slot pages`;
      } catch (err) { return `${file}: ${err.message.split("\n")[0]}`; }
      return null;
    };
    for (const f of [...sl.routes, ...sl.intercepts].map((r) => r.file).concat(sl.default ? [sl.default] : [])) { const e = await check(f); if (e) extra.push(e); }
    slots.push(sl);
  }
  if (scan.rootLayout && layoutErr.has(scan.rootLayout)) extra.push(layoutErr.get(scan.rootLayout));
  if (scan.notFound && layoutErr.has(scan.notFound)) extra.push(layoutErr.get(scan.notFound));
  if (scan.errorPage && layoutErr.has(scan.errorPage)) extra.push(layoutErr.get(scan.errorPage));
  for (const f of Object.values(scan.statusPages ?? {})) if (layoutErr.has(f)) extra.push(layoutErr.get(f));
  return { routes: out, rootLayout: scan.rootLayout, notFound: scan.notFound, errorPage: scan.errorPage, statusPages: scan.statusPages ?? {}, templates: scan.templates ?? {}, slots, extraErrors: extra };
}

export { matchRoute } from "./match.js";

export function formatRoutes(routes) {
  const rows = [["TYPE", "METHOD", "PATH", "FILE"]];
  for (const r of routes) {
    if (r.error) rows.push([r.type, "ERROR", r.path, r.file]);
    else for (const m of r.methods) rows.push([r.type, m, r.path, r.file]);
  }
  const w = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i].length)) + 2);
  return rows.map((r) => r[0].padEnd(w[0]) + r[1].padEnd(w[1]) + r[2].padEnd(w[2]) + r[3]).join("\n");
}
