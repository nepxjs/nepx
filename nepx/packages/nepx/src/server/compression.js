import zlib from "node:zlib";
import { promisify } from "node:util";

const brotli = promisify(zlib.brotliCompress), gzip = promisify(zlib.gzip);
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg\+xml)/;
const MIN_SIZE = 1024;

/** Best supported encoding from Accept-Encoding (br > gzip), honouring q=0. */
export function pickEncoding(header) {
  if (!header) return null;
  const ok = new Set(header.split(",").map((p) => p.trim().split(";")).filter(([, q]) => !q || Number(q.trim().replace(/^q=/, "")) > 0).map(([n]) => n.trim().toLowerCase()));
  return ok.has("br") ? "br" : ok.has("gzip") ? "gzip" : null;
}

/**
 * Response compression. Immutable assets are compressed once at a higher quality and cached; everything else per request.
 * `apply(req, out, body)` returns the (possibly compressed) body and updates the headers in `out`.
 */
export function createCompressor({ enabled = true } = {}) {
  const cache = new Map(); // "path|encoding" -> Buffer
  async function apply(req, out, body) {
    if (!enabled || !COMPRESSIBLE.test(String(out["content-type"] ?? "")) || out["content-encoding"]) return body;
    out.vary = out.vary ? out.vary + ", Accept-Encoding" : "Accept-Encoding";
    const enc = pickEncoding(req.headers["accept-encoding"]);
    if (!enc || !body || body.length < MIN_SIZE) return body;
    const key = /immutable/.test(String(out["cache-control"])) ? `${req.url.split("?")[0]}|${enc}` : null;
    let zipped = key && cache.get(key);
    if (!zipped) {
      zipped = enc === "br" ? await brotli(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: key ? 9 : 4 } }) : await gzip(body);
      if (key) cache.set(key, zipped);
    }
    out["content-encoding"] = enc;
    return zipped;
  }
  /** Transform for a streamed response (flushes after every chunk so the browser gets pieces as they are written), or null. */
  function streaming(req, out) {
    if (!enabled || out["content-encoding"] || !COMPRESSIBLE.test(String(out["content-type"] ?? ""))) return null;
    out.vary = out.vary ? out.vary + ", Accept-Encoding" : "Accept-Encoding";
    const enc = pickEncoding(req.headers["accept-encoding"]);
    if (!enc) return null;
    out["content-encoding"] = enc;
    return enc === "br"
      ? zlib.createBrotliCompress({ flush: zlib.constants.BROTLI_OPERATION_FLUSH, params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })
      : zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH });
  }
  return { apply, streaming };
}
