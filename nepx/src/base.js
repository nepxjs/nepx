// basePath helpers (no React: used by the server and by link.js).
/** "/x" -> "/docs/x" (internal absolute paths only; "//host", "http://..." and already prefixed paths stay as they are). */
export function withBase(base, href) {
  if (!base || typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) return href;
  return href === base || href.startsWith(base + "/") || href.startsWith(base + "?") || href.startsWith(base + "#") ? href : base + href;
}
/** "/docs/x" -> "/x" (the router works on paths without the base). */
export function stripBase(base, pathname) {
  if (!base) return pathname;
  if (pathname === base) return "/";
  return pathname.startsWith(base + "/") ? pathname.slice(base.length) : pathname;
}
