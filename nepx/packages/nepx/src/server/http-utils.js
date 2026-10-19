import { HttpError } from "../errors/index.js";
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
