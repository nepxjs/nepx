// File-based metadata (like Next.js): app/favicon.ico, app/icon.png, app/apple-icon.png, app/opengraph-image.png, app/twitter-image.png.
// Each file is served at "/<file name>" and added to <head> unless the page's own metadata sets that key.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const RE = /^(favicon|icon|apple-icon|opengraph-image|twitter-image)\.(ico|png|jpe?g|gif|svg|webp)$/i;
const KIND = { favicon: "icon", icon: "icon", "apple-icon": "apple", "opengraph-image": "og", "twitter-image": "twitter" };

/** Map of served file name -> absolute path, for the root of app/ only. */
export function scanIcons(appDir) {
  const out = new Map();
  let names;
  try { names = readdirSync(appDir); } catch { return out; }
  for (const n of names.sort()) {
    if (!RE.test(n)) continue;
    const abs = path.join(appDir, n);
    try { if (statSync(abs).isFile()) out.set(n, abs); } catch { /* vanished */ }
  }
  return out;
}

/** Default metadata for those files (lowest priority: layouts and pages override it). */
export function iconMetadata(files, basePath = "") {
  const m = { icons: { icon: [], apple: [] }, openGraph: { images: [] }, twitter: { images: [] } };
  for (const name of files.keys()) {
    const href = `${basePath}/${name}`;
    const kind = KIND[name.split(".")[0].toLowerCase()];
    if (kind === "icon") m.icons.icon.push(href);
    else if (kind === "apple") m.icons.apple.push(href);
    else if (kind === "og") m.openGraph.images.push(href);
    else m.twitter.images.push(href);
  }
  const out = {};
  if (m.icons.icon.length || m.icons.apple.length) out.icons = m.icons;
  if (m.openGraph.images.length) out.openGraph = m.openGraph;
  if (m.twitter.images.length) out.twitter = m.twitter;
  return out;
}
