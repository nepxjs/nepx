// Turbo mode: opt-in speed-ups for dev, build and start. Nothing here changes what Nepx produces, only how fast.
//
//   nepx dev --turbo        nepx build --turbo        nepx start --turbo
//   NEPX_TURBO=1            (or in nepx.config.js:  turbo: true  |  turbo: { ...options })
//
// What it does:
//   cache        - compiled JSX/TS is cached on disk (keyed by content), so a dev restart does not re-transform every file
//   compileCache - Node's V8 compile cache for Nepx itself, React and other dependencies (Node >= 22.1, ignored elsewhere)
//   concurrency  - route inspection and prerendering run in parallel instead of one by one
//   skipUnchanged- dev: a save that did not change the file's content does not restart the server
//   watchIgnore  - dev: files that can never affect the app (logs, editor swap files, tests, ...) do not restart the server
//   warmup       - start: route modules are imported right after listening, so the first request is not the slow one
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NepxError } from "./errors/index.js";

const OPTION_KEYS = new Set(["enabled", "cache", "cacheDir", "compileCache", "concurrency", "skipUnchanged", "watchIgnore", "warmup"]);

/** Paths (relative to the project, "/" separated) that never need a dev-server restart. */
export const DEFAULT_WATCH_IGNORE = [
  /\.(log|swp|swo|tmp|orig|rej)$/i,
  /(^|\/)(\.DS_Store|Thumbs\.db|\.#.*|#.*#)$/,
  /~$/,
  /(^|\/)(coverage|dist|\.vscode|\.idea)(\/|$)/,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)tests?\//,
];

const isOff = (v) => /^(0|false|off|no)$/i.test(String(v));
const isOn = (v) => v === true || /^(1|true|on|yes)$/i.test(String(v));

/** "src/**\/*.snap" style pattern -> RegExp ("*" stays inside one segment, "**" crosses segments). */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; }
      else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$|^${re}/`);
}

function defaultConcurrency() {
  const n = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(2, Math.min(8, n));
}

/**
 * Normalise every way of switching turbo on or off into one object.
 * Precedence: --no-turbo > --turbo[=value] > NEPX_TURBO > nepx.config.js `turbo` > off.
 * `turbo: true` uses the defaults; `turbo: { ... }` turns it on and tunes it (add `enabled: false` to keep options but switch it off).
 */
export function resolveTurbo(input, { flags = {}, env = process.env, root = process.cwd() } = {}) {
  if (input !== undefined && input !== null && typeof input !== "boolean" && (typeof input !== "object" || Array.isArray(input))) {
    throw new NepxError("config.turbo must be true, false or an options object");
  }
  const opts = input && typeof input === "object" ? input : {};
  for (const k of Object.keys(opts)) if (!OPTION_KEYS.has(k)) throw new NepxError(`config.turbo: unknown option "${k}" (known: ${[...OPTION_KEYS].join(", ")})`);
  for (const k of ["enabled", "cache", "compileCache", "skipUnchanged", "warmup"]) {
    if (opts[k] !== undefined && typeof opts[k] !== "boolean") throw new NepxError(`config.turbo.${k} must be true or false`);
  }
  if (opts.cacheDir !== undefined && (typeof opts.cacheDir !== "string" || !opts.cacheDir)) throw new NepxError("config.turbo.cacheDir must be a non-empty path");
  if (opts.concurrency !== undefined && (!Number.isInteger(opts.concurrency) || opts.concurrency < 1 || opts.concurrency > 64)) throw new NepxError("config.turbo.concurrency must be an integer between 1 and 64");
  if (opts.watchIgnore !== undefined && (!Array.isArray(opts.watchIgnore) || opts.watchIgnore.some((p) => typeof p !== "string" && !(p instanceof RegExp)))) throw new NepxError("config.turbo.watchIgnore must be an array of glob strings or RegExps");

  let enabled = input === true || (input && typeof input === "object" && opts.enabled !== false);
  if (env.NEPX_TURBO !== undefined && env.NEPX_TURBO !== "") enabled = isOn(env.NEPX_TURBO) ? true : isOff(env.NEPX_TURBO) ? false : enabled;
  if (flags.turbo !== undefined) {
    if (flags.turbo !== true && !isOn(flags.turbo) && !isOff(flags.turbo)) throw new NepxError(`Invalid --turbo "${flags.turbo}" (use --turbo or --turbo=false)`);
    enabled = flags.turbo === true || isOn(flags.turbo);
  }
  if (flags["no-turbo"]) enabled = false;

  let concurrency = opts.concurrency ?? defaultConcurrency();
  if (flags.concurrency !== undefined) {
    const n = Number(flags.concurrency);
    if (!Number.isInteger(n) || n < 1 || n > 64) throw new NepxError(`Invalid --concurrency "${flags.concurrency}" (an integer between 1 and 64)`);
    concurrency = n;
  }
  if (!enabled) return { enabled: false, cache: false, cacheDir: null, compileCache: false, concurrency: 1, skipUnchanged: false, watchIgnore: [], warmup: false };

  const cacheDir = path.resolve(root, env.NEPX_TURBO_CACHE_DIR || opts.cacheDir || defaultCacheDir(root));
  return {
    enabled: true,
    cache: opts.cache !== false,
    cacheDir,
    compileCache: opts.compileCache !== false,
    concurrency,
    skipUnchanged: opts.skipUnchanged !== false,
    watchIgnore: [...DEFAULT_WATCH_IGNORE, ...(opts.watchIgnore ?? []).map((p) => (typeof p === "string" ? globToRegExp(p.replace(/^\.\//, "")) : p))],
    warmup: opts.warmup !== false,
  };
}

/** node_modules/.cache/nepx when the project has node_modules (the usual home for tool caches), otherwise a per-project folder in the OS temp dir. */
export function defaultCacheDir(root) {
  if (existsSync(path.join(root, "node_modules"))) return path.join(root, "node_modules", ".cache", "nepx");
  return path.join(os.tmpdir(), "nepx-cache-" + createHash("sha1").update(path.resolve(root)).digest("hex").slice(0, 12));
}

/** Enable Node's on-disk V8 compile cache (Node >= 22.1). Returns true when it is active. */
export function enableCompileCache(turbo) {
  if (!turbo.enabled || !turbo.compileCache) return false;
  try {
    const dir = path.join(turbo.cacheDir, "v8");
    mkdirSync(dir, { recursive: true });
    return enableViaModule(dir);
  } catch { return false; }
}

function enableViaModule(dir) {
  // module.enableCompileCache is looked up lazily so Node 20 (no such function) simply skips it
  const m = process.getBuiltinModule?.("node:module");
  if (!m || typeof m.enableCompileCache !== "function") return false;
  const r = m.enableCompileCache(dir);
  return r?.status === m.constants?.compileCacheStatus?.ENABLED || r?.status === m.constants?.compileCacheStatus?.ALREADY_ENABLED;
}

/**
 * Content-addressed cache of transformed source. get() returns null on any miss or damage; set() never throws.
 * The key mixes in everything that changes the output (file path, loader, compiler version), so a stale hit is not possible.
 */
export function createTransformCache(dir) {
  let ready = false;
  const keyOf = (parts) => createHash("sha1").update(parts.join("\0")).digest("hex");
  const fileOf = (key) => path.join(dir, key.slice(0, 2), key.slice(2) + ".js");
  const stats = { hits: 0, misses: 0 };
  return {
    stats,
    key: keyOf,
    get(key) {
      try { const code = readFileSync(fileOf(key), "utf8"); stats.hits++; return code; }
      catch { stats.misses++; return null; }
    },
    set(key, code) {
      try {
        const file = fileOf(key);
        if (!ready) ready = true;
        mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(tmp, code);
        renameSync(tmp, file); // atomic: a reader never sees half a file, two processes can write the same key
      } catch { /* a cache that cannot be written is just a cache miss next time */ }
    },
  };
}

/** Like Promise.all(items.map(fn)) but runs at most `limit` at a time. Results keep the input order; the first rejection wins. */
export async function pool(items, limit, fn) {
  const list = [...items];
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= list.length) return;
      results[i] = await fn(list[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, worker));
  return results;
}

/** Dev watcher filter + change detector. `check(relPath, absPath)` is true when the server should restart. */
export function createChangeFilter(turbo, { read = (f) => readFileSync(f) } = {}) {
  const seen = new Map(); // abs path -> content hash of the version the running server was started with / last restarted for
  return {
    check(rel, abs) {
      const norm = String(rel ?? "").split(path.sep).join("/");
      if (turbo.watchIgnore.some((re) => re.test(norm))) return false;
      if (!turbo.skipUnchanged || !abs) return true;
      let hash = null;
      try { hash = createHash("sha1").update(read(abs)).digest("hex"); } catch { /* deleted or unreadable: that is a change */ }
      if (hash !== null && seen.get(abs) === hash) return false;
      if (hash === null) seen.delete(abs); else seen.set(abs, hash);
      return true;
    },
  };
}
