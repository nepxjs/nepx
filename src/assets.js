// Files imported from code (images, fonts, ...) become content-hashed URLs under /_nepx/.
import { createHash } from "node:crypto";
import path from "node:path";

export const ASSET_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp4|webm|mp3|pdf)$/i;

/** Prefix for /_nepx asset URLs: config.assetPrefix (a CDN origin, via NEPX_ASSET_PREFIX) when set, else the basePath. */
export const assetBase = (basePath = "") => process.env.NEPX_ASSET_PREFIX || basePath;

export function assetUrl(file, body, base = "") {
  const ext = path.extname(file).toLowerCase();
  const stem = path.basename(file, path.extname(file)).replace(/[^\w-]/g, "-").slice(0, 40) || "asset";
  return `${base}/_nepx/m-${stem}.${createHash("sha256").update(body).digest("hex").slice(0, 8)}${ext}`;
}
