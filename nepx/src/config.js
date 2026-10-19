import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NepxError } from "./errors/index.js";
import { compileRules } from "./rules.js";
import { resolveSecurity } from "./security/index.js";

export const DEFAULTS = { port: 3000, maxBodySize: 1024 * 1024, compress: true };

/** "" or a path like "/docs" (leading slash, no trailing slash). */
export function normalizeBasePath(b) {
  if (b === undefined || b === null || b === "" || b === "/") return "";
  if (typeof b !== "string" || !/^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/.test(b)) throw new NepxError('config.basePath must look like "/docs" (leading slash, no trailing slash)');
  return b;
}

export async function loadConfig(root) {
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
  if (typeof cfg.streaming !== "boolean") cfg.streaming = true;
  cfg.security = resolveSecurity(cfg.security);
  cfg.rules = await compileRules(cfg); // { redirects, headers, rewrites }
  return cfg;
}
