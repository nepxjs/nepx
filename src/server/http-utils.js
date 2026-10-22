import { HttpError } from "../errors/index.js";
import { createHash } from "node:crypto";
import { MIME } from "../mime.js";

export { MIME };
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/** Paths whose errors are always JSON, even for browsers: the API and framework internals. */
export const API_PATH = /^\/(api|_nepx)(\/|$)/;

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    let v = part.slice(i + 1).trim();
    try { v = decodeURIComponent(v); } catch { /* keep raw */ }
    if (!(k in out)) out[k] = v;
  }
  return out;
}

export async function readBody(req, limit) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, "Request body too large");
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new HttpError(413, "Request body too large");
      chunks.push(chunk);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Failed to read request body");
  }
  return Buffer.concat(chunks);
}

export function decodeSegments(pathname) {
  if (pathname === "/") return [];
  const segs = pathname.split("/").slice(1);
  if (segs.length > 1 && segs[segs.length - 1] === "") segs.pop(); // single trailing slash
  return segs.map((s) => {
    let d;
    try { d = decodeURIComponent(s); } catch { throw new HttpError(400, "Malformed URL"); }
    if (d === "." || d === ".." || d.includes("/") || d.includes("\\") || d.includes("\0")) throw new HttpError(400, "Invalid path segment");
    return d;
  });
}


export function jsonResponse(status, body, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

export const htmlResponse = (status, html, extra = {}) => new Response(html, { status, headers: { "content-type": MIME[".html"], "cache-control": "no-cache", ...extra } });

/** Weak validator for a body: W/"<size>-<sha1 prefix>". */
const etagCache = new WeakMap(); // bundled assets are served over and over: hash each body once
export function etagOf(body) {
  if (typeof body === "object" && body && etagCache.has(body)) return etagCache.get(body);
  const buf = typeof body === "string" ? Buffer.from(body) : body;
  const tag = `W/"${buf.length.toString(16)}-${createHash("sha1").update(buf).digest("base64url").slice(0, 16)}"`;
  if (typeof body === "object" && body) etagCache.set(body, tag);
  return tag;
}

/** True when the request's If-None-Match matches `etag` (or is "*"). Request headers are Node-style (lower-case keys). */
export function etagMatches(reqHeaders, etag) {
  const inm = reqHeaders && reqHeaders["if-none-match"];
  if (!inm) return false;
  const strip = (t) => t.trim().replace(/^W\//, "");
  return inm.trim() === "*" || inm.split(",").some((t) => strip(t) === strip(etag));
}

/** 200 with an ETag, or a bodiless 304 when the client already has this exact body. HEAD gets headers only. */
export function conditionalResponse(req, body, headers) {
  const etag = etagOf(body);
  const h = { ...headers, etag };
  if (etagMatches(req.headers, etag)) return new Response(null, { status: 304, headers: { etag, "cache-control": h["cache-control"] } });
  return new Response(req.method === "HEAD" ? null : body, { status: 200, headers: h });
}
