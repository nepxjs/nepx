// Isomorphic metadata helpers: merge `metadata` objects from layouts + page, and turn them into <head> tags.
// Used by the server (renderDocument) and by the browser runtime (client-side navigation).

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Merge metadata objects ordered root layout -> page. Later values win.
 * title may be a string, or { default, template: "%s | Site", absolute }:
 *   a layout's `template` applies to the titles of segments below it (not to its own), `default` is the fallback title.
 */
export function mergeMetadata(items) {
  const out = {};
  let template = null, title;
  for (const m of items) {
    if (!isObj(m)) continue;
    for (const [k, v] of Object.entries(m)) if (k !== "title") out[k] = k === "viewport" && isObj(v) && isObj(out[k]) ? { ...out[k], ...v } : v; // viewport fields merge across layouts and page
    const t = m.title;
    if (typeof t === "string") title = template ? template.replace("%s", t) : t;
    else if (isObj(t)) {
      if (t.absolute !== undefined) title = String(t.absolute);
      else if (t.default !== undefined) title = String(t.default);
      if (typeof t.template === "string") template = t.template;
    }
  }
  if (title !== undefined) out.title = title;
  return out;
}

const list = (v) => (v === undefined || v === null ? [] : [].concat(v));
const url = (i) => (typeof i === "string" ? i : i && i.url);

const VIEWPORT_KEYS = [["width", "width"], ["height", "height"], ["initialScale", "initial-scale"], ["minimumScale", "minimum-scale"], ["maximumScale", "maximum-scale"], ["viewportFit", "viewport-fit"], ["interactiveWidget", "interactive-widget"]];
/** `viewport` export: { width, initialScale, maximumScale, userScalable, viewportFit, themeColor: string | [{ media, color }], colorScheme }. */
function viewportTags(v, meta, tags) {
  const parts = [];
  const w = v.width === undefined ? "device-width" : v.width; // like Next.js: device-width / scale 1 unless said otherwise
  for (const [key, name] of VIEWPORT_KEYS) {
    const val = key === "width" ? w : v[key];
    if (val !== undefined && val !== null && val !== "") parts.push(`${name}=${val}`);
  }
  if (v.initialScale === undefined) parts.splice(1, 0, "initial-scale=1");
  if (v.userScalable !== undefined) parts.push(`user-scalable=${v.userScalable ? "yes" : "no"}`);
  meta("viewport", parts.join(", "));
  for (const t of list(v.themeColor)) {
    if (typeof t === "string") meta("theme-color", t);
    else if (isObj(t) && t.color) tags.push({ tag: "meta", attrs: { name: "theme-color", content: String(t.color), ...(t.media ? { media: String(t.media) } : {}) } });
  }
  if (v.colorScheme) meta("color-scheme", v.colorScheme);
}

/** -> [{ tag: "meta" | "link", attrs }] for everything except <title>. */
export function metadataToTags(m = {}) {
  const tags = [];
  const meta = (key, value, attr = "name") => { if (value !== undefined && value !== null && value !== "") tags.push({ tag: "meta", attrs: { [attr]: key, content: String(value) } }); };
  const link = (rel, href, extra = {}) => { if (href) tags.push({ tag: "link", attrs: { rel, href: String(href), ...extra } }); };
  meta("description", m.description);
  if (m.keywords) meta("keywords", list(m.keywords).join(", "));
  if (typeof m.robots === "string") meta("robots", m.robots);
  else if (isObj(m.robots)) meta("robots", [m.robots.index === false ? "noindex" : "index", m.robots.follow === false ? "nofollow" : "follow"].join(", "));
  meta("theme-color", m.themeColor);
  if (isObj(m.viewport)) viewportTags(m.viewport, meta, tags);
  if (isObj(m.alternates)) link("canonical", m.alternates.canonical);
  if (typeof m.icons === "string") link("icon", m.icons);
  else if (isObj(m.icons)) {
    for (const i of list(m.icons.icon)) link("icon", url(i));
    for (const i of list(m.icons.apple)) link("apple-touch-icon", url(i));
  }
  const og = m.openGraph;
  if (isObj(og)) {
    for (const k of ["title", "description", "url", "siteName", "type", "locale"]) meta("og:" + k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()), og[k], "property");
    for (const i of list(og.images)) { meta("og:image", url(i), "property"); if (isObj(i)) { meta("og:image:width", i.width, "property"); meta("og:image:height", i.height, "property"); meta("og:image:alt", i.alt, "property"); } }
  }
  const tw = m.twitter;
  if (isObj(tw)) {
    for (const k of ["card", "title", "description", "site", "creator"]) meta("twitter:" + k, tw[k]);
    for (const i of list(tw.images)) meta("twitter:image", url(i));
  }
  return tags;
}

export function tagsToHtml(tags) {
  return tags.map(({ tag, attrs }) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")} data-nepx>`).join("");
}
