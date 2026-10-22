// pages/api/** handlers: `export default function handler(req, res)` with the Node-style req / res of the Pages Router.
// `export const config = { api: { bodyParser: false } }` leaves the body unparsed (read it with req.on("data") / for await).
import { EventEmitter } from "node:events";
import { revalidatePath } from "./isr.js";

const parseCookies = (h) => { const out = {}; for (const p of (h || "").split(/;\s*/)) { const i = p.indexOf("="); if (i > 0) { try { out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); } catch { out[p.slice(0, i)] = p.slice(i + 1); } } } return out; };

export function createPagesApiHandler(handler, config, file = "pages/api") {
  if (typeof handler !== "function") return async () => { throw new TypeError(`${file}: pages/api files must default-export a function (req, res)`); };
  const parse = !(config && config.api && config.api.bodyParser === false);
  return async function pagesApi(request, ctx = {}) {
    const raw = ["GET", "HEAD"].includes(request.method) ? Buffer.alloc(0) : Buffer.from(await request.arrayBuffer());
    const url = new URL(request.url);
    const headers = Object.fromEntries(request.headers.entries());
    const query = {};
    for (const [k, v] of url.searchParams) query[k] = k in query ? [].concat(query[k], v) : v;
    Object.assign(query, ctx.params || {});
    const ct = headers["content-type"] || "";
    let body;
    if (parse) {
      const text = raw.toString("utf8");
      if (/json/i.test(ct)) { if (text) { try { body = JSON.parse(text); } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); } } }
      else if (/x-www-form-urlencoded/i.test(ct)) body = Object.fromEntries(new URLSearchParams(text));
      else body = text;
    }
    const req = Object.assign(new EventEmitter(), { method: request.method, url: url.pathname + url.search, headers, query, body, cookies: parseCookies(headers.cookie), rawBody: raw });
    req[Symbol.asyncIterator] = async function* () { if (raw.length) yield raw; };
    queueMicrotask(() => { if (!parse) { if (raw.length) req.emit("data", raw); req.emit("end"); } });

    let status = 200, sent = false, finish;
    const out = new Map(), chunks = [];
    const done = new Promise((r) => { finish = r; });
    const res = Object.assign(new EventEmitter(), {
      get statusCode() { return status; }, set statusCode(n) { status = n; },
      get headersSent() { return sent; }, get writableEnded() { return sent; },
      status(n) { status = n; return res; },
      setHeader(k, v) { out.set(String(k).toLowerCase(), v); return res; },
      getHeader: (k) => out.get(String(k).toLowerCase()),
      getHeaders: () => Object.fromEntries(out),
      hasHeader: (k) => out.has(String(k).toLowerCase()),
      removeHeader(k) { out.delete(String(k).toLowerCase()); },
      writeHead(n, h) { status = n; if (h) for (const [k, v] of Object.entries(h)) res.setHeader(k, v); return res; },
      write(c) { chunks.push(Buffer.from(c)); return true; },
      end(c) { if (sent) return res; if (c !== undefined && c !== null) chunks.push(Buffer.from(c)); sent = true; finish(); res.emit("finish"); return res; },
      json(v) { if (!res.hasHeader("content-type")) res.setHeader("content-type", "application/json; charset=utf-8"); return res.end(JSON.stringify(v)); },
      send(v) {
        if (v !== null && typeof v === "object" && !Buffer.isBuffer(v)) return res.json(v);
        if (!res.hasHeader("content-type")) res.setHeader("content-type", Buffer.isBuffer(v) ? "application/octet-stream" : "text/plain; charset=utf-8");
        return res.end(v);
      },
      redirect(a, b) { const [code, to] = typeof a === "number" ? [a, b] : [b ?? 307, a]; status = code; res.setHeader("location", to); return res.end(); },
      revalidate: async (p) => { revalidatePath(p); },
    });
    let failed = null;
    const run = Promise.resolve().then(() => handler(req, res)).then(() => { if (!sent) return Promise.race([done, new Promise((r) => setTimeout(r, 30_000).unref?.())]); }, (e) => { failed = e; finish(); });
    await run;
    if (failed) throw failed;
    if (!sent) { console.warn(`${file}: the handler returned without sending a response`); return new Response("API handler did not send a response", { status: 500 }); }
    const h = new Headers();
    for (const [k, v] of out) for (const x of [].concat(v)) h.append(k, String(x));
    const nullBody = status === 204 || status === 304 || request.method === "HEAD";
    return new Response(nullBody ? null : Buffer.concat(chunks), { status, headers: h });
  };
}
