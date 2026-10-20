// Shared by the security / status-page tests: boot a real Nepx server on a temp project, and speak raw TCP.
import { after } from "node:test";
import net from "node:net";
import path from "node:path";
import { makeProject, linkDeps } from "./helpers.js";
import { scanApp, inspectRoutes } from "../src/router.js";
import { createNepxServer, listen } from "../src/server/index.js";
import { loadMiddleware } from "../src/middleware.js";

const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections(); s.close(); } });

export async function start(files, opts = {}) {
  const root = makeProject(files);
  linkDeps(root);
  const scan = scanApp(root);
  const info = await inspectRoutes(root, scan);
  const mwFile = files["middleware.js"] ? "middleware.js" : null;
  const server = createNepxServer({
    root, routes: info.routes, rootLayout: info.rootLayout, notFound: info.notFound, errorPage: info.errorPage, statusPages: info.statusPages,
    publicDir: path.join(root, "public"), middleware: mwFile ? await loadMiddleware(root, mwFile) : null, ...opts,
  });
  servers.push(server);
  const port = await listen(server, 0);
  return { port, base: `http://localhost:${port}`, root, server };
}

export const HTML = { accept: "text/html,application/xhtml+xml" };

/** Raw TCP: lets us send what fetch() refuses to (bad versions, huge headers, odd Host headers). */
export const rawRequest = (port, text) => new Promise((resolve, reject) => {
  const s = net.connect(port, "127.0.0.1", () => s.write(text));
  let out = "";
  s.on("data", (c) => { out += c; });
  s.on("close", () => resolve(out));
  s.on("error", reject);
  setTimeout(() => { s.destroy(); resolve(out); }, 1500).unref();
});

export const LOOPBACK = ["127.0.0.0/8", "::1"];

export const api = (extra = {}) => ({
  "app/api/hello/route.js": 'export async function GET(){ return Response.json({ ok: true }); }\nexport async function POST(){ return Response.json({ posted: true }); }',
  "app/api/guard/route.js": 'import { forbidden } from "nepx";\nexport async function GET(){ forbidden("Admins only"); }',
  "public/a.txt": "hello", "public/.env": "SECRET=1", "public/.well-known/security.txt": "Contact: x",
  ...extra,
});
