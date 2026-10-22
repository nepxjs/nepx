import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NepxError } from "./errors/index.js";
import { compileRules } from "./rules.js";
import { resolveSecurity } from "./security/index.js";
import { resolveTurbo } from "./turbo.js";
import { resolveImages } from "./images.js";
import { resolveI18n } from "./i18n.js";

export const DEFAULTS = { port: 3000, maxBodySize: 1024 * 1024, compress: true };

/** "" or a path like "/docs" (leading slash, no trailing slash). */
export function normalizeBasePath(b) {
  if (b === undefined || b === null || b === "" || b === "/") return "";
  if (typeof b !== "string" || !/^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/.test(b)) throw new NepxError('config.basePath must look like "/docs" (leading slash, no trailing slash)');
  return b;
}

/** pageExtensions: ["tsx", "ts"] or [".tsx", ".ts"] -> [".tsx", ".ts"] (only .ksx .jsx .tsx .ts .js are known). */
export function normalizePageExtensions(list) {
  const known = [".ksx", ".jsx", ".tsx", ".ts", ".js"];
  if (!Array.isArray(list) || !list.length) throw new NepxError(`config.pageExtensions must be a non-empty array like ["tsx", "ts"]`);
  const out = list.map((e) => (typeof e === "string" ? (e.startsWith(".") ? e : "." + e) : e));
  const bad = out.find((e) => !known.includes(e));
  if (bad !== undefined) throw new NepxError(`config.pageExtensions: unsupported extension ${JSON.stringify(bad)} (use ${known.map((k) => k.slice(1)).join(", ")})`);
  return [...new Set(out)];
}

/** distDir: one folder name inside the project (default ".nepx"). */
export function normalizeDistDir(d) {
  if (d === undefined || d === null || d === "" || d === ".nepx") return ".nepx";
  if (typeof d !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(d) || ["app", "src", "public", "node_modules", "out", "pages"].includes(d)) throw new NepxError('config.distDir must be a single folder name such as "build-output" (not app, src, public, node_modules or out)');
  return d;
}

export async function loadConfig(root, { flags = {} } = {}) {
  const file = path.join(root, "nepx.config.js");
  let user = {};
  if (existsSync(file)) {
    try {
      const mod = await import(pathToFileURL(file).href);
      user = mod.default ?? {};
    } catch (err) {
      throw new NepxError(`Failed to load nepx.config.js: ${err.message}`);
    }
  }
  const cfg = { ...DEFAULTS, ...user };
  if (!Number.isInteger(cfg.port) || cfg.port < 0 || cfg.port > 65535) throw new NepxError("config.port must be an integer between 0 and 65535");
  if (!Number.isInteger(cfg.maxBodySize) || cfg.maxBodySize < 0) throw new NepxError("config.maxBodySize must be a non-negative integer (bytes)");
  if (cfg.trailingSlash !== undefined && typeof cfg.trailingSlash !== "boolean") throw new NepxError("config.trailingSlash must be true or false");
  cfg.trailingSlash = cfg.trailingSlash === true;
  if (typeof cfg.compress !== "boolean") throw new NepxError("config.compress must be true or false");
  cfg.basePath = normalizeBasePath(cfg.basePath);
  if (cfg.env !== undefined) { // defaults for process.env: real environment variables and .env files win; NEPX_PUBLIC_* reach the browser bundle
    if (!cfg.env || typeof cfg.env !== "object" || Array.isArray(cfg.env) || Object.entries(cfg.env).some(([k, v]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== "string")) throw new NepxError("config.env must be an object of string values, e.g. { NEPX_PUBLIC_SITE: \"example.com\" }");
    for (const [k, v] of Object.entries(cfg.env)) if (!(k in process.env)) process.env[k] = v;
  }
  if (cfg.reactStrictMode !== undefined && typeof cfg.reactStrictMode !== "boolean") throw new NepxError("config.reactStrictMode must be true or false");
  cfg.reactStrictMode = cfg.reactStrictMode === true; // wraps the browser tree in <React.StrictMode>
  if (cfg.compiler !== undefined) {
    const c = cfg.compiler;
    if (!c || typeof c !== "object" || Array.isArray(c)) throw new NepxError("config.compiler must be an object, e.g. { removeConsole: true }");
    const rc = c.removeConsole;
    if (rc !== undefined && typeof rc !== "boolean" && !(rc && typeof rc === "object" && !Array.isArray(rc) && (rc.exclude === undefined || (Array.isArray(rc.exclude) && rc.exclude.every((x) => typeof x === "string"))))) throw new NepxError("config.compiler.removeConsole must be true/false or { exclude: [\"error\", \"warn\"] }");
  }
  if (cfg.pageExtensions !== undefined) cfg.pageExtensions = normalizePageExtensions(cfg.pageExtensions);
  for (const key of ["transpilePackages", "serverExternalPackages"]) { // transpilePackages: compiled like app code (loader); serverExternalPackages: accepted, the server already loads node_modules natively
    if (cfg[key] !== undefined && (!Array.isArray(cfg[key]) || cfg[key].some((x) => typeof x !== "string" || !x))) throw new NepxError(`config.${key} must be an array of package names`);
  }
  if (cfg.assetPrefix !== undefined && (typeof cfg.assetPrefix !== "string" || !/^https?:\/\/[^/\s]+(\/[\w.~-]+)*$/i.test(cfg.assetPrefix))) throw new NepxError('config.assetPrefix must be an absolute URL without a trailing slash, e.g. "https://cdn.example.com"');
  cfg.distDir = normalizeDistDir(cfg.distDir);
  if (cfg.output !== undefined && cfg.output !== "standalone" && cfg.output !== "server") throw new NepxError('config.output must be "standalone" or "server"');
  if (cfg.typedRoutes !== undefined && typeof cfg.typedRoutes !== "boolean") throw new NepxError("config.typedRoutes must be true or false");
  cfg.typedRoutes = cfg.typedRoutes === true; // writes nepx-routes.d.ts so Link/router hrefs are checked by TypeScript
  if (cfg.poweredByHeader !== undefined && typeof cfg.poweredByHeader !== "boolean") throw new NepxError("config.poweredByHeader must be true or false");
  cfg.poweredByHeader = cfg.poweredByHeader === true; // sends "X-Powered-By: Nepx" (off by default)
  if (typeof cfg.streaming !== "boolean") cfg.streaming = true;
  try { cfg.i18n = resolveI18n(cfg.i18n); } catch (e) { throw new NepxError(e.message); } // { locales, defaultLocale, detection } | null; see i18n.js
  if (cfg.i18n) process.env.NEPX_DEFAULT_LOCALE = cfg.i18n.defaultLocale; else delete process.env.NEPX_DEFAULT_LOCALE;
  cfg.images = resolveImages(cfg.images); // { optimize, widths, quality, formats }; see images.js
  cfg.security = resolveSecurity(cfg.security);
  cfg.turbo = resolveTurbo(user.turbo, { flags, root }); // { enabled, cache, concurrency, ... }; see turbo.js
  cfg.rules = await compileRules(cfg); // { redirects, headers, rewrites }
  return cfg;
}
