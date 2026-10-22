// Internationalized routing (config.i18n): /id/about is the Indonesian /about. Pure functions, shared by the server and the browser runtime.
// The default locale has no prefix; routes, usePathname() and the files in app/ never see the prefix.
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** config.i18n -> { locales, defaultLocale, detection } or null. Throws a plain Error with a readable message. */
export function resolveI18n(input) {
  if (input === undefined || input === null || input === false) return null;
  if (typeof input !== "object" || Array.isArray(input)) throw new Error('config.i18n must be an object: { locales: ["en", "id"], defaultLocale: "en" }');
  const { locales, defaultLocale, detection = true } = input;
  if (!Array.isArray(locales) || locales.length < 2 || locales.some((l) => typeof l !== "string" || !LOCALE.test(l))) throw new Error('config.i18n.locales must list at least two locale codes like "en" or "pt-BR"');
  if (new Set(locales.map((l) => l.toLowerCase())).size !== locales.length) throw new Error("config.i18n.locales has duplicates");
  if (!locales.includes(defaultLocale)) throw new Error("config.i18n.defaultLocale must be one of config.i18n.locales");
  if (typeof detection !== "boolean") throw new Error("config.i18n.detection must be true or false");
  return { locales: [...locales], defaultLocale, detection };
}

const find = (i18n, seg) => i18n.locales.find((l) => l.toLowerCase() === String(seg).toLowerCase()) ?? null;

/** "/id/about" -> { locale: "id", pathname: "/about" }; "/about" -> { locale: null, pathname: "/about" }. */
export function splitLocale(pathname, i18n) {
  if (!i18n) return { locale: null, pathname };
  const m = /^\/([^/]+)(\/.*)?$/.exec(pathname);
  const locale = m && find(i18n, m[1]);
  return locale ? { locale, pathname: m[2] || "/" } : { locale: null, pathname };
}

/** "/about" + "id" -> "/id/about" (default locale: unchanged). Only internal absolute paths; already-prefixed ones stay. */
export function withLocale(href, locale, i18n) {
  if (!i18n || typeof href !== "string" || !href.startsWith("/") || href.startsWith("//") || !locale || locale === i18n.defaultLocale) return href;
  const path = href.split(/[?#]/)[0];
  if (splitLocale(path, i18n).locale) return href;
  return "/" + locale + (href === "/" ? "" : href.startsWith("/?") || href.startsWith("/#") ? href.slice(1) : href);
}

/** Same path with no locale prefix (and no prefix for the default locale). */
export const stripLocale = (href, i18n) => {
  if (!i18n || typeof href !== "string" || !href.startsWith("/")) return href;
  const cut = href.search(/[?#]/), path = cut === -1 ? href : href.slice(0, cut);
  return splitLocale(path, i18n).pathname + (cut === -1 ? "" : href.slice(cut));
};

/** Accept-Language -> the best supported locale (exact, then language only), or null. */
export function pickLocale(header, i18n) {
  if (!i18n || !header) return null;
  const wanted = String(header).split(",").map((p) => { const [tag, ...ps] = p.trim().split(";"); const q = ps.map((x) => /^\s*q=([\d.]+)/.exec(x)).find(Boolean); return { tag: tag.trim(), q: q ? Number(q[1]) : 1 }; })
    .filter((x) => x.tag && x.tag !== "*" && x.q > 0).sort((a, b) => b.q - a.q);
  for (const { tag } of wanted) {
    const exact = find(i18n, tag);
    if (exact) return exact;
    const lang = tag.split("-")[0].toLowerCase();
    const loose = i18n.locales.find((l) => l.toLowerCase() === lang) ?? i18n.locales.find((l) => l.toLowerCase().split("-")[0] === lang);
    if (loose) return loose;
  }
  return null;
}

export const LOCALE_COOKIE = "NEPX_LOCALE";
