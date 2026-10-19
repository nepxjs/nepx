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
    return `<url>${x}</url>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>\n`;
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
