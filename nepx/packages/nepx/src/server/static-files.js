import path from "node:path";
import { readFile, stat, realpath } from "node:fs/promises";
import { MIME } from "./http-utils.js";

/**
 * Files from public/, served at "/". Refuses symlinks that leave the folder, and (blockDotfiles) every dot-segment
 * except ".well-known", so /.env, /.git/config, /.htpasswd are never reachable.
 */
export function createPublicFiles({ publicDir, blockDotfiles = true, dev = false }) {
  return async function servePublic(segments, method) {
    if (!publicDir || segments.length === 0) return null;
    if (blockDotfiles && segments.some((s) => s.startsWith(".") && s !== ".well-known")) return null;
    const file = path.join(publicDir, ...segments);
    try {
      const real = await realpath(file), base = await realpath(publicDir);
      if (!real.startsWith(base + path.sep)) return null; // symlink escape
      if (!(await stat(real)).isFile()) return null;
      const type = MIME[path.extname(real).toLowerCase()] ?? "application/octet-stream";
      const body = method === "HEAD" ? null : await readFile(real);
      return new Response(body, { status: 200, headers: { "content-type": type, "cache-control": dev ? "no-cache" : "public, max-age=3600" } });
    } catch { return null; }
  };
}
