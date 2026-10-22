// Image optimization: GET /_nepx/image?url=/photo.jpg&w=640&q=75 -> a resized, re-encoded copy of a file from public/.
// Opt-in with `images: { optimize: true }` in nepx.config.js. Needs the optional `sharp` package; without it the original file is served unchanged.
// Only local files (public/) are optimized: remote URLs are never fetched by the server.
import path from "node:path";
import { createRequire } from "node:module";
import { readFile, realpath, stat } from "node:fs/promises";
import { NepxError } from "./errors/index.js";
import { MIME, conditionalResponse } from "./server/http-utils.js";
import { normalizePattern, matchRemote } from "./remote-match.js";
import dns from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";

export const DEFAULT_IMAGE_WIDTHS = [16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840];
const RASTER = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".tiff"]); // svg and gif (maybe animated) are served as they are
const MAX_CACHE = 100;

/** config.images -> { optimize, widths, quality, formats } (validated). */
export function resolveImages(input) {
  if (input === undefined || input === null) return { optimize: false, widths: DEFAULT_IMAGE_WIDTHS, quality: 75, formats: ["webp"], remotePatterns: [], dangerouslyAllowLocalIP: false, maxRemoteBytes: 10 * 1024 * 1024 };
  if (typeof input !== "object" || Array.isArray(input)) throw new NepxError("config.images must be an object, e.g. { optimize: true }");
  const { optimize = false, widths = DEFAULT_IMAGE_WIDTHS, quality = 75, formats = ["webp"], remotePatterns = [], domains = [], dangerouslyAllowLocalIP = false, maxRemoteBytes = 10 * 1024 * 1024 } = input;
  if (typeof optimize !== "boolean") throw new NepxError("config.images.optimize must be true or false");
  if (!Array.isArray(widths) || !widths.length || widths.some((w) => !Number.isInteger(w) || w < 1 || w > 8192)) throw new NepxError("config.images.widths must be a non-empty array of integers (1-8192)");
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new NepxError("config.images.quality must be an integer between 1 and 100");
  if (!Array.isArray(formats) || formats.some((f) => f !== "webp" && f !== "avif")) throw new NepxError('config.images.formats must be a list of "webp" and/or "avif"');
  if (!Array.isArray(remotePatterns) || !Array.isArray(domains)) throw new NepxError("config.images.remotePatterns and config.images.domains must be arrays");
  let patterns;
  try { patterns = [...domains, ...remotePatterns].map(normalizePattern); } catch (e) { throw new NepxError(`config.images: ${e.message}`); }
  if (typeof dangerouslyAllowLocalIP !== "boolean") throw new NepxError("config.images.dangerouslyAllowLocalIP must be true or false");
  if (!Number.isInteger(maxRemoteBytes) || maxRemoteBytes < 1) throw new NepxError("config.images.maxRemoteBytes must be a positive integer (bytes)");
  return { optimize, widths: [...widths].sort((a, b) => a - b), quality, formats, remotePatterns: patterns, dangerouslyAllowLocalIP, maxRemoteBytes };
}

/** What <Image> gets in its router context (also sent to the browser): sizes plus the remote patterns, so it knows which remote srcs the optimizer accepts. */
export const imageContext = (images) => (images && images.optimize ? { widths: images.widths, quality: images.quality, ...(images.remotePatterns && images.remotePatterns.length ? { remotePatterns: images.remotePatterns } : {}) } : null);

/** Loopback, private, link-local, CGNAT, multicast and reserved addresses (IPv4 and IPv6): the optimizer never connects to them unless dangerouslyAllowLocalIP. */
export function isPrivateAddress(addr) {
  const fam = net.isIP(addr);
  if (fam === 4) {
    const [a, b, c] = addr.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (fam === 6) {
    const l = addr.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
    if (mapped) return isPrivateAddress(mapped[1]);
    const first = parseInt(l.split(":")[0] || "0", 16);
    return l === "::" || l === "::1" || (first & 0xffc0) === 0xfe80 || (first & 0xfe00) === 0xfc00 || (first & 0xff00) === 0xff00 || l.startsWith("64:ff9b:") || l.startsWith("2001:db8");
  }
  return true; // not an IP at all
}

/** GET a remote image: validated DNS answer is the one used to connect (no rebinding), no redirects, size and time limits. -> { body, type } */
export function fetchRemoteImage(href, { allowLocal = false, maxBytes, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(href);
    const fail = (status, message) => reject(Object.assign(new Error(message), { status }));
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, "")) && !allowLocal && isPrivateAddress(u.hostname.replace(/^\[|\]$/g, ""))) return fail(400, "Blocked address");
    const lookup = (host, opts, cb) => dns.lookup(host, { all: true }, (err, addrs) => {
      if (err) return cb(err);
      const ok = addrs.filter((a) => allowLocal || !isPrivateAddress(a.address));
      if (!ok.length) return cb(Object.assign(new Error("Blocked address"), { code: "NEPX_BLOCKED" }));
      return opts && opts.all ? cb(null, ok) : cb(null, ok[0].address, ok[0].family);
    });
    const r = (u.protocol === "https:" ? https : http).get(u, { lookup, timeout: timeoutMs, headers: { accept: "image/*", "user-agent": "nepx-image-optimizer" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); return fail(502, "Remote image redirects are not followed"); }
      if (res.statusCode !== 200) { res.resume(); return fail(res.statusCode === 404 ? 404 : 502, `Remote image answered ${res.statusCode}`); }
      const type = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (!/^image\/(jpeg|png|webp|avif|gif|tiff)$/.test(type)) { res.resume(); return fail(400, "Remote file is not a supported raster image"); }
      if (Number(res.headers["content-length"]) > maxBytes) { res.resume(); return fail(413, "Remote image is too large"); }
      const chunks = []; let size = 0;
      res.on("data", (c) => { size += c.length; if (size > maxBytes) { r.destroy(); fail(413, "Remote image is too large"); } else chunks.push(c); });
      res.on("end", () => resolve({ body: Buffer.concat(chunks), type }));
      res.on("error", () => fail(502, "Remote image failed"));
    });
    r.on("timeout", () => { r.destroy(); fail(504, "Remote image timed out"); });
    r.on("error", (e) => fail(e.code === "NEPX_BLOCKED" ? 400 : 502, e.code === "NEPX_BLOCKED" ? "Blocked address" : "Remote image could not be fetched"));
  });
}

/** The extension tells whether <Image> should route this src through the optimizer. */
export const isOptimizable = (src) => typeof src === "string" && src.startsWith("/") && !src.startsWith("//") && RASTER.has(path.extname(src.split("?")[0]).toLowerCase());

export function createImageOptimizer({ publicDir, config, projectRoot, dev = false }) {
  const cache = new Map(); // key -> { body, type }
  let sharp; // undefined = not tried, null = not installed
  async function getSharp() {
    if (sharp !== undefined) return sharp;
    try { sharp = createRequire(path.join(projectRoot, "package.json"))("sharp"); }
    catch { try { sharp = (await import("sharp")).default; } catch { sharp = null; } }
    return sharp;
  }
  const bad = (status, message) => new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

  const remoteCache = new Map();
  async function serveRemote(url, req, src) {
    const w = Number(url.searchParams.get("w")), q = url.searchParams.has("q") ? Number(url.searchParams.get("q")) : config.quality;
    if (!Number.isInteger(w) || !config.widths.includes(w)) return bad(400, `w must be one of ${config.widths.join(", ")}`);
    if (!Number.isInteger(q) || q < 1 || q > 100) return bad(400, "q must be an integer between 1 and 100");
    if (!matchRemote(src, config.remotePatterns)) return bad(400, "Remote host is not allowed (config.images.remotePatterns)");
    const lib = await getSharp();
    const accept = req.headers.accept ?? "";
    const format = config.formats.includes("avif") && /image\/avif/.test(accept) ? "avif" : config.formats.includes("webp") && /image\/webp/.test(accept) ? "webp" : null;
    const key = `${src}|${w}|${q}|${format}`;
    let hit = remoteCache.get(key);
    if (!hit) {
      let got;
      try { got = await fetchRemoteImage(src, { allowLocal: config.dangerouslyAllowLocalIP, maxBytes: config.maxRemoteBytes }); }
      catch (e) { return bad(e.status ?? 502, e.message); }
      hit = { body: got.body, type: got.type };
      if (lib && got.type !== "image/gif") {
        const out = format ?? (got.type === "image/png" ? "png" : got.type === "image/webp" ? "webp" : got.type === "image/avif" ? "avif" : got.type === "image/tiff" ? "jpeg" : "jpeg");
        try { hit = { body: await lib(got.body).rotate().resize({ width: w, withoutEnlargement: true })[out]({ quality: q }).toBuffer(), type: `image/${out}` }; } catch { /* sharp cannot read it: served unchanged */ }
      }
      if (remoteCache.size >= MAX_CACHE) remoteCache.delete(remoteCache.keys().next().value);
      remoteCache.set(key, hit);
    }
    return conditionalResponse(req, hit.body, { "content-type": hit.type, vary: "Accept", "cache-control": dev ? "no-cache" : "public, max-age=60, stale-while-revalidate=300", "x-nepx-image": "optimized-remote" });
  }

  return async function serveImage(url, req) {
    const src = url.searchParams.get("url") ?? "";
    if (/^https?:\/\//i.test(src)) return serveRemote(url, req, src);
    if (!publicDir) return bad(404, "No public folder");
    const w = Number(url.searchParams.get("w")), q = url.searchParams.has("q") ? Number(url.searchParams.get("q")) : config.quality;
    if (!src.startsWith("/") || src.startsWith("//") || src.includes("\\") || src.includes("\0") || src.split("/").some((s) => s === ".." || (s.startsWith(".") && s !== ""))) return bad(400, "Invalid url");
    if (!Number.isInteger(w) || !config.widths.includes(w)) return bad(400, `w must be one of ${config.widths.join(", ")}`);
    if (!Number.isInteger(q) || q < 1 || q > 100) return bad(400, "q must be an integer between 1 and 100");
    let file;
    try {
      const real = await realpath(path.join(publicDir, ...src.split("/").filter(Boolean))), base = await realpath(publicDir);
      if (!real.startsWith(base + path.sep) || !(await stat(real)).isFile()) return bad(404, "Not found");
      file = real;
    } catch { return bad(404, "Not found"); }
    const ext = path.extname(file).toLowerCase();
    const original = async () => conditionalResponse(req, await readFile(file), { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": dev ? "no-cache" : "public, max-age=3600", "x-nepx-image": "passthrough" });
    const lib = RASTER.has(ext) ? await getSharp() : null;
    if (!lib) return original();
    const accept = req.headers.accept ?? "";
    const format = config.formats.includes("avif") && /image\/avif/.test(accept) ? "avif" : config.formats.includes("webp") && /image\/webp/.test(accept) ? "webp" : ext === ".png" ? "png" : ext === ".webp" ? "webp" : ext === ".avif" ? "avif" : "jpeg";
    const key = `${file}|${w}|${q}|${format}`;
    let hit = cache.get(key);
    if (!hit) {
      try {
        const body = await lib(file).rotate().resize({ width: w, withoutEnlargement: true })[format]({ quality: q }).toBuffer();
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
        hit = { body, type: `image/${format}` };
        cache.set(key, hit);
      } catch { return original(); } // a file sharp cannot read is served unchanged
    }
    return conditionalResponse(req, hit.body, { "content-type": hit.type, vary: "Accept", "cache-control": dev ? "no-cache" : "public, max-age=60, stale-while-revalidate=300", "x-nepx-image": "optimized" });
  };
}
