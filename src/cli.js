import { spawn } from "node:child_process";
import { existsSync, readFileSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NepxError } from "./errors/index.js";
import { loadConfig, normalizeBasePath } from "./config.js";
import { loadEnv } from "./env.js";
import { loadMiddleware } from "./middleware.js";
import { loadInstrumentation } from "./instrumentation.js";
import { formatRoutes } from "./router.js";
import { createNepxServer, listen } from "./server/index.js";
import { build, analyze, readManifest, readClientAssets, OUT_DIR } from "./build.js";
import { bundleClient, errorAssets, formatBuildError } from "./bundle.js";
import { createProject, validateName } from "./scaffold.js";
import { resolveTurbo, enableCompileCache, createChangeFilter, pool } from "./turbo.js";

const SELF = fileURLToPath(import.meta.url);
const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const HELP = `Nepx.js ${VERSION} - Simple to Build. Fast to Run.

Usage:
  nepx create <name> [--mode fullstack|frontend|backend]   Create a new project
  nepx dev [--port N]                   Start the development server (restarts on change)
  nepx build                            Validate routes and write .nepx/
  nepx start [--port N]                 Run the production build
  nepx routes                           List routes
  nepx --help | --version

Turbo (faster dev restarts, builds and cold starts; off by default):
  --turbo | --no-turbo                  Switch turbo on/off for dev, build, start, routes (also: NEPX_TURBO=1|0)
  --concurrency N                       Parallel route inspection / prerendering (default: CPU count, 2-8)
  nepx.config.js: turbo: true | { cache, cacheDir, compileCache, concurrency, skipUnchanged, watchIgnore, warmup }
`;

function parseArgs(args) {
  const flags = {}, rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      flags[k] = v ?? (args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true);
    } else rest.push(a);
  }
  return { flags, rest };
}

function portFrom(flags, cfg) {
  if (flags.port === undefined) return cfg.port;
  const p = Number(flags.port);
  if (!Number.isInteger(p) || p < 0 || p > 65535) throw new NepxError(`Invalid --port "${flags.port}"`);
  return p;
}

function installShutdown(server) {
  const stop = () => { server.close(() => process.exit(0)); server.closeAllConnections?.(); setTimeout(() => process.exit(0), 2000).unref(); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

export async function main(argv, { cwd = process.cwd() } = {}) {
  const { flags, rest } = parseArgs(argv);
  const cmd = rest[0];
  process.env.NODE_ENV ??= cmd === "dev" || cmd === "__serve" || cmd === "routes" ? "development" : "production";
  if (flags.version || flags.v) return console.log(VERSION);
  let turbo = resolveTurbo(undefined, { flags: { "no-turbo": true } }); // off
  if (["routes", "build", "start", "__serve", "dev"].includes(cmd)) {
    // the loader hooks need basePath (asset URLs carry it) and the turbo cache dir, so both are read before they are registered
    let userCfg = {};
    try { userCfg = (await import(pathToFileURL(path.join(cwd, "nepx.config.js")).href)).default ?? {}; } catch { /* reported by loadConfig later */ }
    if (cmd !== "dev") { try { process.env.NEPX_BASE_PATH = normalizeBasePath(userCfg.basePath); } catch { /* reported by loadConfig later */ } }
    turbo = resolveTurbo(userCfg.turbo, { flags, root: cwd });
    if (turbo.enabled && turbo.cache) process.env.NEPX_TURBO_CACHE = path.join(turbo.cacheDir, "transform");
    else delete process.env.NEPX_TURBO_CACHE;
    enableCompileCache(turbo);
  }
  if (cmd !== "dev" && cmd !== "create") await import("./register.js");
  if (!cmd || flags.help || flags.h || cmd === "help") return console.log(HELP);

  switch (cmd) {
    case "create": {
      validateName(rest[1]);
      const dir = createProject(cwd, rest[1], { mode: flags.mode === true ? undefined : flags.mode });
      console.log(`Created ${path.relative(cwd, dir) || "."}\n\nNext steps:\n  cd ${rest[1]}\n  npm install\n  npm run dev`);
      return;
    }
    case "routes": {
      loadEnv(cwd, "development");
      const a = await analyze(cwd, { concurrency: turbo.concurrency });
      const slotRows = a.slots.flatMap((sl) => [...sl.routes, ...sl.intercepts].map((r) => ({ type: "SLOT", methods: ["GET"], path: r.path + ` (@${sl.name}${sl.intercepts.includes(r) ? ", intercepts" : ""})`, file: r.file })));
      console.log(a.routes.length ? formatRoutes([...a.routes, ...slotRows]) : "No routes found (create app/page.jsx or app/api/<name>/route.js).");
      for (const e of a.errors) console.error(`error: ${e}`);
      if (a.errors.length) process.exitCode = 1;
      return;
    }
    case "build": {
      loadEnv(cwd, "production");
      const cfg = await loadConfig(cwd, { flags });
      const t0 = Date.now();
      const { routes, prerendered } = await build(cwd, { basePath: cfg.basePath, concurrency: cfg.turbo.concurrency });
      console.log(`Build OK: ${routes.length} route(s), ${prerendered} page(s) prerendered -> ${OUT_DIR}/${cfg.turbo.enabled ? `  [turbo x${cfg.turbo.concurrency}, ${Date.now() - t0}ms]` : ""}`);
      return;
    }
    case "start": {
      loadEnv(cwd, "production");
      const cfg = await loadConfig(cwd, { flags });
      const manifest = readManifest(cwd);
      const serverRoot = path.join(cwd, OUT_DIR, "server");
      const instrumentation = await loadInstrumentation(serverRoot);
      const server = createNepxServer({
        instrumentation, root: serverRoot, projectRoot: cwd, routes: manifest.routes, maxBodySize: cfg.maxBodySize,
        publicDir: path.join(cwd, OUT_DIR, "public"), staticDir: path.join(cwd, OUT_DIR, "static"), assets: readClientAssets(cwd),
        middleware: await loadMiddleware(serverRoot, manifest.middleware), rootLayout: manifest.rootLayout, notFound: manifest.notFound, errorPage: manifest.errorPage, statusPages: manifest.statusPages,
        redirects: cfg.rules.redirects, rewrites: cfg.rules.rewrites, headerRules: cfg.rules.headers, trailingSlash: cfg.trailingSlash, compress: cfg.compress, security: cfg.security,
        basePath: cfg.basePath, templates: manifest.templates, slots: manifest.slots, streaming: cfg.streaming,
      });
      const port = await listen(server, portFrom(flags, cfg));
      console.log(`Nepx production server: http://localhost:${port}${cfg.turbo.enabled ? "  (turbo)" : ""}`);
      installShutdown(server);
      if (cfg.turbo.enabled && cfg.turbo.warmup) warmup(serverRoot, manifest, cfg.turbo.concurrency); // not awaited: the server already accepts requests
      return;
    }
    case "dev": return runDevSupervisor(cwd, flags, turbo);
    case "__serve": return runDevServer(cwd, flags); // internal: child process of "nepx dev"
    default:
      throw new NepxError(`Unknown command "${cmd}". Run "nepx --help".`);
  }
}

async function runDevServer(cwd, flags) {
  process.setSourceMapsEnabled?.(true); // stack traces (terminal + error overlay) point at the original .jsx/.ts lines
  loadEnv(cwd, "development");
  const cfg = await loadConfig(cwd, { flags });
  const a = await analyze(cwd, { concurrency: cfg.turbo.concurrency });
  for (const e of a.errors) console.error(`error: ${e}`);
  const bundling = async () => {
    if (!(a.pages.length || a.notFound || a.errorPage)) return new Map();
    try { return await bundleClient(cwd, { pages: a.pages, rootLayout: a.rootLayout, notFound: a.notFound, errorPage: a.errorPage, templates: a.templates, slots: a.slots }, { dev: true, basePath: cfg.basePath }); }
    catch (err) { console.error(`error: ${err.message}`); return errorAssets(err, cwd); }
  };
  const loadingMiddleware = async () => { try { return await loadMiddleware(cwd, a.middleware); } catch (err) { console.error(`error: ${err.message}`); return null; } };
  const loadingInstrumentation = async () => { try { return await loadInstrumentation(cwd); } catch (err) { console.error(`error: ${err.message}`); return null; } };
  let assets, middleware, instrumentation;
  if (cfg.turbo.enabled) [assets, middleware, instrumentation] = await Promise.all([bundling(), loadingMiddleware(), loadingInstrumentation()]); // independent of each other
  else { assets = await bundling(); middleware = await loadingMiddleware(); instrumentation = await loadingInstrumentation(); }
  // Routes with compile errors stay registered so the request shows the error.
  const served = a.routes.map((r) => (r.error && r.type === "API" ? { ...r, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] } : r));
  const server = createNepxServer({
    instrumentation, root: cwd, projectRoot: cwd, routes: served, maxBodySize: cfg.maxBodySize, dev: true, publicDir: path.join(cwd, "public"),
    assets, middleware, rootLayout: a.rootLayout, notFound: a.notFound, errorPage: a.errorPage, statusPages: a.statusPages,
    redirects: cfg.rules.redirects, rewrites: cfg.rules.rewrites, headerRules: cfg.rules.headers, trailingSlash: cfg.trailingSlash, compress: cfg.compress, security: cfg.security,
    basePath: cfg.basePath, templates: a.templates, slots: a.slots, streaming: cfg.streaming,
  });
  const port = await listen(server, portFrom(flags, cfg), { fallback: 10 });
  console.log(`Nepx dev server: http://localhost:${port}  (${a.routes.length} route(s))${cfg.turbo.enabled ? "  turbo" : ""}`);
  installShutdown(server);
}

function runDevSupervisor(cwd, flags, turbo) {
  // the child resolves turbo itself from the same flags + config, so the choice is passed on explicitly
  const passThrough = [...(flags.port ? ["--port", String(flags.port)] : []), ...(flags.turbo !== undefined ? [`--turbo=${flags.turbo}`] : []), ...(flags["no-turbo"] ? ["--no-turbo"] : []), ...(flags.concurrency !== undefined ? ["--concurrency", String(flags.concurrency)] : [])];
  const args = [SELF.replace(/cli\.js$/, "../bin/nepx.js"), "__serve", ...passThrough];
  const env = { ...process.env, ...(turbo.enabled && turbo.compileCache ? { NODE_COMPILE_CACHE: path.join(turbo.cacheDir, "v8") } : {}) }; // V8 compile cache from the child's very first line
  const filter = turbo.enabled ? createChangeFilter(turbo) : null;
  let child = null, timer = null, stopping = false;
  const start = () => {
    child = spawn(process.execPath, args, { cwd, env, stdio: "inherit" });
    child.on("exit", (code) => { if (!stopping && code) console.error(`[nepx] server exited (code ${code}); waiting for changes...`); });
  };
  const restart = () => {
    if (!child || child.exitCode !== null) return start();
    child.once("exit", start);
    child.kill("SIGTERM");
  };
  start();
  const IGNORED = /^(node_modules|\.nepx|\.git)([\\/]|$)/;
  const watchers = [watch(cwd, { recursive: true }, (_e, f) => {
    if (f && IGNORED.test(f)) return;
    if (filter && f && !filter.check(f, path.join(cwd, f))) return; // turbo: ignored path, or the content did not change
    clearTimeout(timer);
    timer = setTimeout(() => { console.log(`[nepx] change detected${f ? ` (${f})` : ""}, restarting...`); restart(); }, filter ? 50 : 100);
  })];
  const stop = () => { stopping = true; watchers.forEach((w) => w.close()); child?.kill("SIGTERM"); setTimeout(() => process.exit(0), 300); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return new Promise(() => {});
}

/** turbo: import every route module in the background so the first request does not pay for the compile. Never throws. */
async function warmup(serverRoot, manifest, concurrency) {
  const t0 = Date.now();
  const files = new Set();
  const add = (f) => { if (typeof f === "string") files.add(f); else if (f && typeof f.file === "string") files.add(f.file); };
  for (const r of manifest.routes) { add(r.file); (r.layouts ?? []).forEach(add); add(r.loading); add(r.notFound); add(r.errorScope); }
  add(manifest.rootLayout); add(manifest.notFound); add(manifest.errorPage);
  Object.values(manifest.statusPages ?? {}).forEach(add);
  let ok = 0;
  await pool(files, concurrency, async (f) => {
    try { await import(pathToFileURL(path.join(serverRoot, f)).href); ok++; } catch { /* a broken module reports itself on the request that needs it */ }
  });
  console.log(`[turbo] warmed ${ok}/${files.size} module(s) in ${Date.now() - t0}ms`);
}
