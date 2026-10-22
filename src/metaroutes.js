// app/sitemap.js, app/robots.js, app/manifest.js -> sitemap.xml, robots.txt, manifest.webmanifest.
import { esc } from "./metadata.js";

const arr = (v) => (v === undefined || v === null ? [] : [].concat(v));
const iso = (d) => (d instanceof Date ? d.toISOString() : String(d));

export function formatSitemap(items) {
  if (!Array.isArray(items)) throw new TypeError("sitemap: the default export must return an array of { url, lastModified?, changeFrequency?, priority? }");
  const body = items.map((i, n) => {
    if (!i || typeof i.url !== "string") throw new TypeError(`sitemap[${n}]: "url" must be a string`);
    let x = `<loc>${esc(i.url)}</loc>`;
    if (i.lastModified) x += `<lastmod>${esc(iso(i.lastModified))}</lastmod>`;
    if (i.changeFrequency) x += `<changefreq>${esc(i.changeFrequency)}</changefreq>`;
    if (i.priority !== undefined) x += `<priority>${esc(i.priority)}</priority>`;
    for (const [lang, href] of Object.entries(i.alternates?.languages ?? {})) x += `<xhtml:link rel="alternate" hreflang="${esc(lang)}" href="${esc(href)}"/>`;
    for (const img of arr(i.images)) x += `<image:image><image:loc>${esc(img)}</image:loc></image:image>`;
    return `<url>${x}</url>`;
  }).join("");
  const ns = (items.some((i) => i?.alternates?.languages) ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : "") + (items.some((i) => i?.images) ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : "");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${ns}>${body}</urlset>\n`;
}

export function formatRobots(cfg) {
  if (!cfg || typeof cfg !== "object") throw new TypeError("robots: the default export must return an object { rules, sitemap?, host? }");
  const lines = [];
  for (const r of arr(cfg.rules)) {
    for (const ua of arr(r.userAgent ?? "*")) lines.push(`User-Agent: ${ua}`);
    for (const a of arr(r.allow)) lines.push(`Allow: ${a}`);
    for (const d of arr(r.disallow)) lines.push(`Disallow: ${d}`);
    if (r.crawlDelay !== undefined) lines.push(`Crawl-delay: ${r.crawlDelay}`);
    lines.push("");
  }
  for (const s of arr(cfg.sitemap)) lines.push(`Sitemap: ${s}`);
  if (cfg.host) lines.push(`Host: ${cfg.host}`);
  return lines.join("\n").trimEnd() + "\n";
}

export async function metaResponse(kind, fn) {
  const data = await fn();
  if (kind === "sitemap") return new Response(formatSitemap(data), { headers: { "content-type": "application/xml; charset=utf-8" } });
  if (kind === "robots") return new Response(formatRobots(data), { headers: { "content-type": "text/plain; charset=utf-8" } });
  if (!data || typeof data !== "object") throw new TypeError("manifest: the default export must return an object");
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/manifest+json; charset=utf-8" } });
}

/** generateSitemaps(): [{ id }, ...] -> the ids, validated (a sitemap id is a non-negative integer or a simple word). */
export async function sitemapIds(mod) {
  if (typeof mod.generateSitemaps !== "function") return null;
  const list = await mod.generateSitemaps();
  if (!Array.isArray(list)) throw new TypeError("sitemap: generateSitemaps() must return an array of { id }");
  return list.map((x, n) => {
    const id = x && typeof x === "object" ? x.id : undefined;
    if ((typeof id !== "number" && typeof id !== "string") || !/^[A-Za-z0-9_-]+$/.test(String(id))) throw new TypeError(`sitemap: generateSitemaps()[${n}].id must be a number or a simple string`);
    return String(id);
  });
}

/** <sitemapindex> listing /sitemap/<id>.xml for every id (what /sitemap.xml answers when generateSitemaps is exported). */
export function formatSitemapIndex(base, ids) {
  const body = ids.map((id) => `<sitemap><loc>${esc(`${base}/sitemap/${id}.xml`)}</loc></sitemap>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>\n`;
}

/**
 * Sitemap request with generateSitemaps: `id` undefined -> the index (/sitemap.xml), otherwise that one sitemap (/sitemap/<id>.xml).
 * Returns null when the id is unknown (the caller answers 404). Without generateSitemaps returns undefined (plain sitemap).
 */
export async function sitemapResponse(mod, { base, id } = {}) {
  const ids = await sitemapIds(mod);
  if (ids === null) return id === undefined ? undefined : null;
  const xml = { "content-type": "application/xml; charset=utf-8" };
  if (id === undefined) return new Response(formatSitemapIndex(base, ids), { headers: xml });
  if (!ids.includes(String(id))) return null;
  return new Response(formatSitemap(await mod.default({ id: /^\d+$/.test(String(id)) ? Number(id) : String(id) })), { headers: xml });
}
