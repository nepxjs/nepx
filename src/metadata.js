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
  const w = v.width === undefined ? "device-width" : v.width; // default: device-width / scale 1 unless said otherwise
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

/** Resolve a (possibly relative) URL against `metadataBase`; without a base, or for absolute URLs, the value is returned unchanged. */
function resolveUrl(base, value) {
  if (value === undefined || value === null || value === "") return value;
  const v = value instanceof URL ? value.href : String(value);
  if (!base || /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith("//")) return v;
  try { return new URL(v, base instanceof URL ? base : String(base)).href; } catch { return v; }
}

const ROBOTS_FLAGS = [["noarchive", "noarchive"], ["nosnippet", "nosnippet"], ["noimageindex", "noimageindex"], ["notranslate", "notranslate"], ["nocache", "nocache"]];
function robotsString(r) {
  if (typeof r === "string") return r;
  if (!isObj(r)) return "";
  const parts = [r.index === false ? "noindex" : "index", r.follow === false ? "nofollow" : "follow"];
  for (const [k, v] of ROBOTS_FLAGS) if (r[k] === true) parts.push(v);
  if (r.maxSnippet !== undefined) parts.push(`max-snippet:${r.maxSnippet}`);
  if (r.maxImagePreview !== undefined) parts.push(`max-image-preview:${r.maxImagePreview}`);
  if (r.maxVideoPreview !== undefined) parts.push(`max-video-preview:${r.maxVideoPreview}`);
  return parts.join(", ");
}

/** -> [{ tag: "meta" | "link", attrs }] for everything except <title>. */
export function metadataToTags(m = {}) {
  const tags = [];
  const base = m.metadataBase;
  const abs = (u) => resolveUrl(base, u);
  const meta = (key, value, attr = "name") => { if (value !== undefined && value !== null && value !== "") tags.push({ tag: "meta", attrs: { [attr]: key, content: String(value) } }); };
  const link = (rel, href, extra = {}) => { if (href) tags.push({ tag: "link", attrs: { rel, href: String(href), ...extra } }); };
  const iconLink = (rel, i) => {
    if (!i) return;
    if (typeof i === "string" || i instanceof URL) return link(rel, abs(i));
    if (!isObj(i) || !i.url) return;
    link(i.rel || rel, abs(i.url), { ...(i.type ? { type: i.type } : {}), ...(i.sizes ? { sizes: i.sizes } : {}), ...(i.media ? { media: i.media } : {}), ...(i.color ? { color: i.color } : {}) });
  };
  meta("application-name", m.applicationName);
  meta("description", m.description);
  if (m.keywords) meta("keywords", list(m.keywords).join(", "));
  for (const a of list(m.authors)) {
    if (!a) continue;
    if (typeof a === "string") { meta("author", a); continue; }
    meta("author", a.name);
    if (a.url) link("author", abs(a.url));
  }
  meta("creator", m.creator);
  meta("publisher", m.publisher);
  meta("generator", m.generator);
  meta("referrer", m.referrer);
  meta("category", m.category);
  meta("classification", m.classification);
  const robots = robotsString(m.robots);
  if (robots) meta("robots", robots);
  if (isObj(m.robots) && m.robots.googleBot !== undefined) meta("googlebot", robotsString(m.robots.googleBot));
  if (isObj(m.formatDetection)) {
    const fd = Object.entries(m.formatDetection).filter(([, v]) => typeof v === "boolean").map(([k, v]) => `${k}=${v ? "yes" : "no"}`);
    if (fd.length) meta("format-detection", fd.join(", "));
  }
  meta("theme-color", m.themeColor);
  if (isObj(m.viewport)) viewportTags(m.viewport, meta, tags);
  if (isObj(m.verification)) {
    const v = m.verification;
    for (const x of list(v.google)) meta("google-site-verification", x);
    for (const x of list(v.yahoo)) meta("y_key", x);
    for (const x of list(v.yandex)) meta("yandex-verification", x);
    for (const x of list(v.me)) meta("me", x);
    if (isObj(v.other)) for (const [k, val] of Object.entries(v.other)) for (const x of list(val)) meta(k, x);
  }
  if (m.manifest) link("manifest", abs(m.manifest));
  if (isObj(m.alternates)) {
    const a = m.alternates;
    link("canonical", abs(a.canonical));
    if (isObj(a.languages)) for (const [lang, href] of Object.entries(a.languages)) link("alternate", abs(url(href)), { hreflang: lang });
    if (isObj(a.media)) for (const [media, href] of Object.entries(a.media)) link("alternate", abs(url(href)), { media });
    if (isObj(a.types)) for (const [type, href] of Object.entries(a.types)) for (const h of list(href)) link("alternate", abs(url(h)), { type });
  }
  if (typeof m.icons === "string" || m.icons instanceof URL) link("icon", abs(m.icons));
  else if (Array.isArray(m.icons)) for (const i of m.icons) iconLink("icon", i);
  else if (isObj(m.icons)) {
    for (const i of list(m.icons.icon)) iconLink("icon", i);
    for (const i of list(m.icons.shortcut)) iconLink("shortcut icon", i);
    for (const i of list(m.icons.apple)) iconLink("apple-touch-icon", i);
    for (const i of list(m.icons.other)) iconLink("icon", i);
  }
  for (const [key, rel] of [["bookmarks", "bookmarks"], ["archives", "archives"], ["assets", "assets"]]) for (const h of list(m[key])) link(rel, abs(h));
  if (isObj(m.itunes) && m.itunes.appId) meta("apple-itunes-app", `app-id=${m.itunes.appId}${m.itunes.appArgument ? `, app-argument=${m.itunes.appArgument}` : ""}`);
  const aw = m.appleWebApp;
  if (aw) {
    const o = aw === true ? {} : isObj(aw) ? aw : {};
    if (aw === true || o.capable !== false) meta("mobile-web-app-capable", "yes");
    meta("apple-mobile-web-app-title", o.title);
    meta("apple-mobile-web-app-status-bar-style", o.statusBarStyle);
    for (const i of list(o.startupImage)) { const u = url(i); if (u) link("apple-touch-startup-image", abs(u), isObj(i) && i.media ? { media: i.media } : {}); }
  }
  if (isObj(m.appLinks)) {
    for (const [platform, items] of Object.entries(m.appLinks)) {
      for (const it of list(items)) {
        if (!isObj(it)) continue;
        for (const [k, v] of Object.entries(it)) meta(`al:${platform}:${k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())}`, v, "property");
      }
    }
  }
  const og = m.openGraph;
  if (isObj(og)) {
    for (const k of ["title", "description", "siteName", "type", "locale"]) meta("og:" + k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()), og[k], "property");
    meta("og:url", abs(og.url), "property");
    for (const l of list(og.alternateLocale)) meta("og:locale:alternate", l, "property");
    for (const i of list(og.images)) { meta("og:image", abs(url(i)), "property"); if (isObj(i)) { meta("og:image:width", i.width, "property"); meta("og:image:height", i.height, "property"); meta("og:image:alt", i.alt, "property"); meta("og:image:type", i.type, "property"); } }
    for (const v of list(og.videos)) { meta("og:video", abs(url(v)), "property"); if (isObj(v)) { meta("og:video:width", v.width, "property"); meta("og:video:height", v.height, "property"); meta("og:video:type", v.type, "property"); } }
    for (const a of list(og.audio)) meta("og:audio", abs(url(a)), "property");
    if (og.type === "article") {
      meta("article:published_time", og.publishedTime, "property");
      meta("article:modified_time", og.modifiedTime, "property");
      meta("article:expiration_time", og.expirationTime, "property");
      meta("article:section", og.section, "property");
      for (const a of list(og.authors)) meta("article:author", a, "property");
      for (const t of list(og.tags)) meta("article:tag", t, "property");
    }
  }
  const tw = m.twitter;
  if (isObj(tw)) {
    for (const k of ["card", "title", "description", "site", "creator", "siteId", "creatorId"]) meta("twitter:" + k.replace(/[A-Z]/g, (c) => ":" + c.toLowerCase()), tw[k]);
    for (const i of list(tw.images)) { meta("twitter:image", abs(url(i))); if (isObj(i) && i.alt) meta("twitter:image:alt", i.alt); }
  }
  if (isObj(m.other)) for (const [k, v] of Object.entries(m.other)) for (const x of list(v)) meta(k, x);
  return tags;
}

export function tagsToHtml(tags) {
  return tags.map(({ tag, attrs }) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")} data-nepx>`).join("");
}
