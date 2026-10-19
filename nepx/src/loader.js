// Node module-customization hooks.
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";
import { ASSET_EXT, assetUrl } from "./assets.js";
import { cssModule } from "./cssmodules.js";

const PKG_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PKG_URL = pathToFileURL(PKG_DIR + path.sep).href;
const EXTS = [".ksx", ".jsx", ".tsx", ".ts", ".js"];
const LOADERS = { ".ksx": "jsx", ".jsx": "jsx", ".tsx": "tsx", ".ts": "ts", ".js": "jsx" };

let root = process.cwd();
let projectRequire = null;
let aliasBase = root;
let basePath = "";

export function initialize(data) {
  root = data.root;
  basePath = data.basePath || "";
  projectRequire = createRequire(path.join(root, "package.json"));
  aliasBase = existsSync(path.join(root, "src", "app")) ? path.join(root, "src") : root;
}

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
function withExtension(abs) {
  if (isFile(abs)) return abs;
  for (const e of EXTS) if (isFile(abs + e)) return abs + e;
  for (const e of EXTS) if (isFile(path.join(abs, "index" + e))) return path.join(abs, "index" + e);
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "nepx") return { url: pathToFileURL(path.join(PKG_DIR, "src", "index.js")).href, shortCircuit: true };
  // Nepx's own code must share the project's React instance.
  if (/^react(-dom)?(\/|$)/.test(specifier) && context.parentURL?.startsWith(PKG_URL) && projectRequire) {
    try { return { url: pathToFileURL(projectRequire.resolve(specifier)).href, shortCircuit: true }; } catch { /* fall through */ }
  }
  let abs = null;
  if (specifier.startsWith("@/")) {
    // Inside a production build (.nepx/server) "@/" points at the copied tree, not the original sources.
    const built = path.join(root, ".nepx", "server");
    const parent = context.parentURL?.startsWith("file:") ? fileURLToPath(context.parentURL) : "";
    const base = parent.startsWith(built + path.sep) ? (existsSync(path.join(built, "src", "app")) ? path.join(built, "src") : built) : aliasBase;
    abs = path.join(base, specifier.slice(2));
  }
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    abs = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (abs) {
    const f = withExtension(abs);
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

function shouldTransform(file) {
  const ext = path.extname(file);
  if (!LOADERS[ext]) return false;
  if (file.includes(`${path.sep}node_modules${path.sep}`)) return false;
  if (ext === ".js" && (file.startsWith(PKG_DIR + path.sep))) return false; // Nepx's own files
  return true;
}

let esbuild;
async function getEsbuild() {
  if (esbuild === undefined) esbuild = await import("esbuild").catch(() => null);
  return esbuild;
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:")) return nextLoad(url, context);
  const pathname = new URL(url).pathname;
  const file = fileURLToPath(new URL(url.split("?")[0]));
  if (pathname.endsWith(".module.css")) { // same class names as the client build: the path is taken relative to the code root
    const built = path.join(root, ".nepx", "server");
    const rel = (file.startsWith(built + path.sep) ? path.relative(built, file) : path.relative(root, file)).split(path.sep).join("/");
    const { map } = cssModule(await readFile(file, "utf8"), rel);
    return { format: "module", source: `export default ${JSON.stringify(map)};`, shortCircuit: true };
  }
  if (pathname.endsWith(".css")) return { format: "module", source: "export default {};", shortCircuit: true }; // styles are bundled for the browser only
  if (ASSET_EXT.test(pathname)) return { format: "module", source: `export default ${JSON.stringify(assetUrl(file, await readFile(file), basePath))};`, shortCircuit: true };
  if (!shouldTransform(file)) return nextLoad(url, context);
  const source = await readFile(file, "utf8");
  const es = await getEsbuild();
  if (!es) {
    if (path.extname(file) === ".js") return nextLoad(url, context);
    return { format: "module", source, shortCircuit: true }; // esbuild missing: plain JS only
  }
  try {
    const out = await es.transform(source, { loader: LOADERS[path.extname(file)], jsx: "automatic", format: "esm", sourcefile: file, sourcemap: "inline", target: "node20" });
    return { format: "module", source: out.code, shortCircuit: true };
  } catch (err) {
    const e = err.errors?.[0];
    const loc = e?.location ? `${file}:${e.location.line}:${e.location.column + 1}` : file;
    throw new SyntaxError(`${loc}: ${e?.text ?? err.message}`);
  }
}
