// File-based metadata: app/favicon.ico, app/icon.png, app/apple-icon.png, app/opengraph-image.png, app/twitter-image.png.
// Each file is served at "/<file name>" and added to <head> unless the page's own metadata sets that key.
// Generated images: app/icon.jsx, apple-icon.jsx, opengraph-image.jsx, twitter-image.jsx (.js/.ts/.tsx too) whose default export returns an
// ImageResponse (or any Response); they are served at "/icon", "/opengraph-image", ... (no extension).
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RE = /^(favicon|icon|apple-icon|opengraph-image|twitter-image)\.(ico|png|jpe?g|gif|svg|webp)$/i;
const DYNAMIC = /^(icon|apple-icon|opengraph-image|twitter-image)\.(jsx?|tsx?)$/i;
export const isDynamicIcon = (abs) => /\.(jsx?|tsx?)$/i.test(abs);
const KIND = { favicon: "icon", icon: "icon", "apple-icon": "apple", "opengraph-image": "og", "twitter-image": "twitter" };

/** Map of served file name -> absolute path, for the root of app/ only. */
export function scanIcons(appDir) {
  const out = new Map();
  let names;
  try { names = readdirSync(appDir); } catch { return out; }
  for (const n of names.sort()) {
    const dyn = DYNAMIC.test(n);
    if (!RE.test(n) && !dyn) continue;
    const abs = path.join(appDir, n);
    const served = dyn ? n.replace(/\.[^.]+$/, "") : n;
    if (dyn && out.has(served)) continue;
    try { if (statSync(abs).isFile()) out.set(served, abs); } catch { /* vanished */ }
  }
  return out;
}

/**
 * generateImageMetadata() : app/icon.jsx may export it, returning [{ id, size?: { width, height }, contentType?, alt? }].
 * Each id is served at /icon/<id> and gets its own <link> / og:image tag; the default export receives { id }.
 * -> the validated list ([] when the file has no generateImageMetadata).
 */
export async function imageVariants(abs) {
  if (!isDynamicIcon(abs)) return [];
  const mod = await import(pathToFileURL(abs).href);
  if (typeof mod.generateImageMetadata !== "function") return [];
  const list = await mod.generateImageMetadata({ params: {} });
  if (!Array.isArray(list) || !list.length) throw new Error(`${path.basename(abs)}: generateImageMetadata() must return a non-empty array of { id, size?, contentType?, alt? }`);
  const seen = new Set();
  return list.map((v, i) => {
    if (!v || (typeof v.id !== "string" && typeof v.id !== "number")) throw new Error(`${path.basename(abs)}: generateImageMetadata()[${i}] needs an "id" (string or number)`);
    const id = String(v.id);
    if (!/^[A-Za-z0-9_.~-]+$/.test(id) || seen.has(id)) throw new Error(`${path.basename(abs)}: generateImageMetadata() ids must be unique and URL-safe (got ${JSON.stringify(id)})`);
    seen.add(id);
    return { id, size: v.size, contentType: v.contentType, alt: v.alt };
  });
}

/** variants: Map served-name -> imageVariants() list (from the files that export generateImageMetadata). */
export async function loadImageVariants(files) {
  const out = new Map();
  for (const [name, abs] of files) { const v = await imageVariants(abs); if (v.length) out.set(name, v); }
  return out;
}

/** Default metadata for those files (lowest priority: layouts and pages override it). */
export function iconMetadata(files, basePath = "", variants = new Map()) {
  const m = { icons: { icon: [], apple: [] }, openGraph: { images: [] }, twitter: { images: [] } };
  for (const name of files.keys()) {
    const kind = KIND[name.split(".")[0].toLowerCase()];
    const vs = variants.get(name);
    const items = vs ? vs.map((v) => ({ url: `${basePath}/${name}/${v.id}`, ...(v.size ? { sizes: `${v.size.width}x${v.size.height}`, width: v.size.width, height: v.size.height } : {}), ...(v.contentType ? { type: v.contentType } : {}), ...(v.alt ? { alt: v.alt } : {}) })) : [`${basePath}/${name}`];
    if (kind === "icon") m.icons.icon.push(...items);
    else if (kind === "apple") m.icons.apple.push(...items);
    else if (kind === "og") m.openGraph.images.push(...items);
    else m.twitter.images.push(...items);
  }
  const out = {};
  if (m.icons.icon.length || m.icons.apple.length) out.icons = m.icons;
  if (m.openGraph.images.length) out.openGraph = m.openGraph;
  if (m.twitter.images.length) out.twitter = m.twitter;
  return out;
}
