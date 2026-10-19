import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NepxError } from "./errors/index.js";
import { baseDir, EXTS } from "./router.js";
import { stripServerExports } from "./strip.js";
import { publicEnv } from "./env.js";
import { ASSET_EXT, assetUrl } from "./assets.js";
import { cssModule } from "./cssmodules.js";
import { MIME } from "./mime.js";
import { buildPayload } from "./overlay.js";
import { moduleKind, clientStub, findInlineDirective } from "./actions.js";

const CLIENT_INDEX = fileURLToPath(new URL("./client/index.js", import.meta.url));
const typeOf = (file) => MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
const MEDIA_LOADERS = Object.fromEntries([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".webm", ".mp3", ".pdf"].map((e) => [e, "file"]));

function resolveFromProject(root, id) {
  try { return path.dirname(createRequire(path.join(root, "package.json")).resolve(`${id}/package.json`)); }
  catch { throw new NepxError(`Cannot find "${id}" in ${root}. Run "npm install react react-dom" in your project.`); }
}

function entrySource(root, scan) {
  const { pages, rootLayout, notFound, errorPage, templates = {}, slots = [] } = scan;
  const imports = new Map(); // file -> identifier
  const imp = (file) => { if (!imports.has(file)) imports.set(file, `M${imports.size}`); return imports.get(file); };
  const wrappers = []; // a template is a layout module that also carries the URL depth that decides when it remounts
  const tpl = (file) => { const m = imp(file), id = `T${wrappers.length}`; wrappers.push(`const ${id} = { default: ${m}.default, template: ${templates[file]} };`); return id; };
  const lay = (file) => (templates[file] !== undefined ? tpl(file) : imp(file));
  const abs = (f) => JSON.stringify(path.join(root, f));
  // loading.* / not-found.* scopes: the component module plus the layouts that wrap it
  const scope = (s) => (s ? `{ mod: ${imp(s.file)}, layouts: [${s.layouts.map(lay).join(", ")}] }` : "undefined");
  const table = pages.map((p) =>
    `{ segments: ${JSON.stringify(p.segments)}, hasData: ${!!p.hasData}, page: ${imp(p.file)}, layouts: [${p.layouts.map(lay).join(", ")}], slots: ${JSON.stringify(p.slots ?? [])}, loading: ${scope(p.loading)}, notFound: ${scope(p.notFound)}, errorScope: ${scope(p.errorScope)} }`);
  const slotEntry = (r) => `{ segments: ${JSON.stringify(r.segments)}, mod: ${imp(r.file)} }`;
  const slotTable = slots.map((sl) => `${JSON.stringify(sl.key)}: { routes: [${sl.routes.map(slotEntry).join(", ")}], intercepts: [${sl.intercepts.map(slotEntry).join(", ")}], default: ${sl.default ? imp(sl.default) : "null"} }`);
  const rl = rootLayout ? imp(rootLayout) : "undefined";
  const nf = notFound ? imp(notFound) : "undefined";
  const ep = errorPage ? imp(errorPage) : "undefined";
  const lines = [`import { mountNepx } from "nepx";`];
  const body = `mountNepx({ routes: [\n  ${table.join(",\n  ")}\n], slotTable: { ${slotTable.join(", ")} }, rootLayout: ${rl}, NotFound: ${nf} && ${nf}.default, ErrorPage: ${ep} && ${ep}.default });`;
  for (const [file, id] of imports) lines.push(`import * as ${id} from ${abs(file)};`);
  lines.push(...wrappers, body);
  return lines.join("\n");
}

export function formatBuildError(err) {
  const msgs = err.errors ?? [];
  if (!msgs.length) return err.message;
  return msgs.map((m) => (m.location ? `${m.location.file}:${m.location.line}:${m.location.column + 1}: ${m.text}` : m.text)).join("\n");
}

/** Bundle all pages into client.js (+ client.css). Returns Map<urlPath,{body,type}>. Throws NepxError on failure. */
export async function bundleClient(root, scan, { dev = false, basePath = "" } = {}) {
  let esbuild;
  try { esbuild = await import("esbuild"); } catch { throw new NepxError('esbuild is required to build pages. Run "npm install".'); }
  const { pages } = scan;
  const pageFiles = new Set(pages.map((p) => path.join(root, p.file)));
  const base = path.join(root, baseDir(root));
  const alias = { nepx: CLIENT_INDEX, react: resolveFromProject(root, "react"), "react-dom": resolveFromProject(root, "react-dom") };
  const define = { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"), "process.env": "{}" };
  for (const [k, v] of Object.entries(publicEnv())) define[`process.env.${k}`] = JSON.stringify(v);

  const media = new Map();
  const plugin = {
    name: "nepx",
    setup(b) {
      b.onResolve({ filter: /^@\// }, (args) => b.resolve("./" + args.path.slice(2), { resolveDir: base, kind: args.kind, importer: args.importer }));
      // import logo from "./logo.png" -> "/_nepx/m-logo.<hash>.png"  (url(...) inside CSS goes through esbuild's file loader)
      const viaPlugin = (args) => !args.pluginData?.nepx && args.kind !== "url-token" && args.kind !== "import-rule";
      const resolveFile = async (args) => {
        const r = await b.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, importer: args.importer, pluginData: { nepx: true } });
        return r;
      };
      b.onResolve({ filter: ASSET_EXT }, async (args) => {
        if (!viaPlugin(args)) return null;
        const r = await resolveFile(args);
        return r.errors.length ? r : { path: r.path, namespace: "nepx-asset" };
      });
      b.onLoad({ filter: /.*/, namespace: "nepx-asset" }, (args) => {
        const body = readFileSync(args.path), url = assetUrl(args.path, body, basePath);
        media.set(url, { body, type: typeOf(args.path) });
        return { contents: `export default ${JSON.stringify(url)};`, loader: "js" };
      });
      b.onResolve({ filter: /^nepx-css:/ }, (args) => ({ path: args.path.slice("nepx-css:".length), namespace: "nepx-css" }));
      // CSS Modules: import styles from "./x.module.css" -> { local: "x_local_<hash>" } + the renamed CSS in client.css
      b.onResolve({ filter: /\.module\.css$/ }, async (args) => {
        if (!viaPlugin(args)) return null;
        const r = await resolveFile(args);
        return r.errors.length ? r : { path: r.path, namespace: "nepx-cssmod" };
      });
      const relOf = (file) => path.relative(root, file).split(path.sep).join("/");
      b.onLoad({ filter: /.*/, namespace: "nepx-cssmod" }, (args) => {
        const { map } = cssModule(readFileSync(args.path, "utf8"), relOf(args.path));
        return { contents: `import ${JSON.stringify("nepx-css:" + args.path)};\nexport default ${JSON.stringify(map)};`, loader: "js", resolveDir: path.dirname(args.path) };
      });
      b.onLoad({ filter: /.*/, namespace: "nepx-css" }, (args) => ({ contents: cssModule(readFileSync(args.path, "utf8"), relOf(args.path)).css, loader: "css", resolveDir: path.dirname(args.path) }));
      // "use server" files: the browser gets stubs that call the server (see actions.js); an inline "use server" is an error
      b.onLoad({ filter: /\.(jsx?|tsx?|ksx)$/ }, (args) => {
        if (args.path.includes(`${path.sep}node_modules${path.sep}`)) return null;
        let src;
        try { src = readFileSync(args.path, "utf8"); } catch { return null; }
        const rel = relOf(args.path);
        if (!/use (server|func)/.test(src) && !/\.action\.(jsx?|tsx?|ksx)$/.test(rel)) return null;
        const kind = moduleKind(src, rel);
        if (!kind || kind === "client") {
          const line = findInlineDirective(src);
          return line ? { errors: [{ text: `an inline "use server" inside a function is not supported. Move the function into a file that starts with "use server".`, location: { file: rel, line, column: 0, lineText: src.split("\n")[line - 1] } }] } : null;
        }
        if (pageFiles.has(args.path)) return { errors: [{ text: `${rel}: a page cannot be a "use server" / "use func" module` }] };
        return { contents: clientStub(src, rel, kind), loader: "js", resolveDir: path.dirname(args.path) };
      });
      b.onLoad({ filter: /.*/ }, (args) => {
        if (!pageFiles.has(args.path)) return null;
        let src;
        try { src = stripServerExports(readFileSync(args.path, "utf8")); } catch (e) { return { errors: [{ text: e.message }] }; }
        // "tsx" mode drops imports that are no longer used (server-only imports of the stripped functions).
        return { contents: src, loader: "tsx", resolveDir: path.dirname(args.path) };
      });
    },
  };
  let result;
  try {
    result = await esbuild.build({
      stdin: { contents: entrySource(root, scan), resolveDir: root, sourcefile: "nepx-entry.js", loader: "js" },
      bundle: true, write: false, outdir: path.join(root, ".nepx-out"), entryNames: "client", chunkNames: "chunk.[hash]", splitting: true, format: "esm", target: "es2020", // dynamic() imports become their own chunks
      jsx: "automatic", alias, define, minify: !dev, sourcemap: dev ? "inline" : false, logLevel: "silent", plugins: [plugin],
      resolveExtensions: [".tsx", ".ts", ".jsx", ".ksx", ".js", ".css", ".json"],
      loader: { ".ksx": "jsx", ...MEDIA_LOADERS }, assetNames: "m-[name].[hash]", publicPath: basePath + "/_nepx",
    });
  } catch (err) {
    const e = new NepxError(`Client build failed:\n${formatBuildError(err)}`);
    // structured locations: the dev overlay shows a code frame for each one (column is 1-based)
    e.details = (err.errors ?? []).map((m) => ({ text: m.text, file: m.location?.file, line: m.location?.line, column: m.location ? m.location.column + 1 : undefined }));
    throw e;
  }
  const assets = new Map(media);
  for (const f of result.outputFiles) {
    const body = Buffer.from(f.contents);
    let name = path.basename(f.path);
    // Production files carry a content hash (client.3fa9c1d2.js) so they can be cached forever.
    if (!dev) name = name.replace(/^(client)(\.\w+)$/, (_m, base, ext) => `${base}.${createHash("sha256").update(body).digest("hex").slice(0, 8)}${ext}`);
    assets.set("/_nepx/" + name, { body, type: typeOf(f.path) });
  }
  return assets;
}

/** Dev fallback: a client script that shows the compile error in the Nepx error overlay (plain text when the overlay is missing). */
export function errorAssets(err, root = process.cwd()) {
  const error = typeof err === "string" ? new NepxError(err) : err;
  const payload = buildPayload(error, { projectRoot: root, kind: "Build Error" });
  const js = `var P=${JSON.stringify(payload)};if(window.__nepxOverlay){window.__nepxOverlay.show(P);}else{var p=document.createElement("pre");p.style.cssText="color:#b00;white-space:pre-wrap;padding:1rem";p.textContent=P.message;document.body.append(p);}`;
  return new Map([["/_nepx/client.js", { body: Buffer.from(js), type: MIME[".js"] }]]);
}
