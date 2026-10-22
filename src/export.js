// `nepx export`: build, then write a folder of plain files (HTML, assets, public/) that any static host can serve.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NepxError } from "./errors/index.js";
import { build, OUT_DIR, readManifest } from "./build.js";

const BIN = fileURLToPath(new URL("../bin/nepx.js", import.meta.url));
const DATA_TAG = '<script id="__NEPX_DATA__" type="application/json">{';

/** Why a route cannot be exported (null = it can). */
export function exportBlocker(route) {
  if (route.type === "API" && !route.meta) return `${route.path} (${route.file}): API route handlers need a server`;
  if (route.type === "PAGE" && !route.ssg) {
    const why = route.hasData && !route.staticProps ? "uses getServerSideProps" : route.revalidate ? "uses revalidate (ISR)" : route.dynamic === "force-dynamic" ? "is force-dynamic" : route.segments.some((s) => s.param || s.catchall || s.optional) && !route.staticParams ? "is dynamic and has no generateStaticParams" : "renders per request (cookies()/headers())";
    return `${route.path} (${route.file}): ${why}`;
  }
  return null;
}

/** Mark an exported page so the browser runtime does full page loads instead of asking a server for data. */
export const markStatic = (html) => html.replace(DATA_TAG, DATA_TAG + '"static":true,');

function walk(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join("/")]));
}

async function withProductionServer(cwd, fn) {
  const child = spawn(process.execPath, [BIN, "start", "--port", "0"], { cwd, env: { ...process.env, NEPX_EXPORTING: "1" } });
  let out = "";
  const port = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new NepxError("export: the production server did not start in time\n" + out)), 20000);
    const on = (c) => { out += c; const m = /localhost:(\d+)/.exec(out); if (m) { clearTimeout(t); resolve(Number(m[1])); } };
    child.stdout.on("data", on); child.stderr.on("data", on);
    child.on("exit", (code) => { clearTimeout(t); reject(new NepxError(`export: the production server exited (code ${code})\n${out}`)); });
  });
  try { return await fn(`http://localhost:${port}`); } finally { child.removeAllListeners("exit"); child.kill("SIGTERM"); }
}

/**
 * Build and write the static site to <root>/<outDir>. Throws NepxError (listing every offending route) when the app needs a server.
 * -> { files, pages, outDir, warnings }
 */
export async function exportStatic(root, { basePath = "", concurrency = 1, outDir = "out", strictMode = false, removeConsole = false } = {}) {
  const outAbs = path.resolve(root, outDir);
  if (path.dirname(outAbs) !== path.resolve(root) && !outAbs.startsWith(path.resolve(root) + path.sep)) throw new NepxError("export: --out must be a folder inside the project");
  if ([OUT_DIR, "app", "public", "node_modules", ".git"].includes(path.relative(root, outAbs))) throw new NepxError(`export: refusing to use "${outDir}" as the output folder`);

  await build(root, { basePath, concurrency, strictMode, removeConsole });
  const manifest = readManifest(root);
  const blockers = manifest.routes.map(exportBlocker).filter(Boolean);
  if (blockers.length) throw new NepxError(`Cannot export: these routes need a server:\n${blockers.map((b) => `  - ${b}`).join("\n")}\nUse "nepx build" + "nepx start", or make them static (generateStaticParams, no getServerSideProps / revalidate).`);

  const warnings = [];
  if (manifest.middleware) warnings.push("middleware does not run in a static export");
  const target = path.join(outAbs, basePath); // a site served under /docs lives in out/docs/
  rmSync(outAbs, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });

  const write = (rel, body) => { const f = path.join(target, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, body); };
  const staticDir = path.join(root, OUT_DIR, "static");
  let pages = 0;
  if (existsSync(staticDir)) for (const rel of walk(staticDir)) { write(rel, markStatic(readFileSync(path.join(staticDir, rel), "utf8"))); pages++; }
  const clientDir = path.join(root, OUT_DIR, "client");
  if (existsSync(clientDir)) cpSync(clientDir, path.join(target, "_nepx"), { recursive: true });
  const publicDir = path.join(root, OUT_DIR, "public");
  if (existsSync(publicDir)) cpSync(publicDir, target, { recursive: true });

  const metaRoutes = manifest.routes.filter((r) => r.meta);
  await withProductionServer(root, async (origin) => {
    for (const r of metaRoutes) { // sitemap.xml, robots.txt, manifest.webmanifest: rendered by the real server, saved as files
      const res = await fetch(origin + basePath + r.path);
      if (res.status !== 200) throw new NepxError(`export: ${r.path} answered ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      write(r.path.replace(/^\//, ""), body);
      if (r.meta === "sitemap" && body.includes("<sitemapindex")) { // generateSitemaps: also save every /sitemap/<id>.xml
        for (const m of body.toString("utf8").matchAll(/<loc>[^<]*?(\/sitemap\/[A-Za-z0-9_-]+\.xml)<\/loc>/g)) {
          const part = await fetch(origin + basePath + m[1]);
          if (part.status !== 200) throw new NepxError(`export: ${m[1]} answered ${part.status}`);
          write(m[1].replace(/^\//, ""), Buffer.from(await part.arrayBuffer()));
        }
        warnings.push("sitemap index lists the local server's address: serve it from your real domain or replace the host in out/sitemap.xml");
      }
    }
    const miss = await fetch(origin + basePath + "/__nepx_not_found__", { headers: { accept: "text/html" } });
    if (miss.status === 404 && /text\/html/.test(miss.headers.get("content-type") ?? "")) write("404.html", markStatic(await miss.text()));
    else warnings.push("no 404.html written (the server did not answer the unknown URL with an HTML 404)");
  });

  return { files: walk(outAbs).length, pages, outDir: path.relative(root, outAbs) || ".", warnings };
}
