// images.remotePatterns matching (next/image style). Pure, no Node imports: used by the server and the browser bundle.
// { protocol: "https", hostname: "**.example.com", port: "", pathname: "/photos/**", search: "" }
//   hostname: `*` = one subdomain label, `**` = any number of labels. pathname: `*` = one segment, `**` = any depth. Unset fields match anything
//   (except `port`: unset = default port only).
const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
const globToRe = (glob, kind) => {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === "*") {
      const dbl = glob[i + 1] === "*";
      if (dbl) i++;
      out += kind === "host" ? (dbl ? ".+" : "[^.]+") : dbl ? ".*" : "[^/]*";
    } else out += esc(glob[i]);
  }
  return new RegExp(`^${out}$`, "i");
};

/** Turns a pattern (or a bare hostname from `domains`) into a plain, serialisable matcher spec. */
export function normalizePattern(p) {
  if (typeof p === "string") p = { hostname: p };
  if (!p || typeof p !== "object" || typeof p.hostname !== "string" || !p.hostname) throw new Error("each remotePatterns entry needs a hostname, e.g. { protocol: \"https\", hostname: \"cdn.example.com\" }");
  if (p.protocol !== undefined && p.protocol !== "http" && p.protocol !== "https") throw new Error('remotePatterns protocol must be "http" or "https"');
  if (p.port !== undefined && (typeof p.port !== "string" || !/^\d{0,5}$/.test(p.port))) throw new Error('remotePatterns port must be a string of digits (or "")');
  for (const k of ["pathname", "search"]) if (p[k] !== undefined && typeof p[k] !== "string") throw new Error(`remotePatterns ${k} must be a string`);
  if (/[/\s]/.test(p.hostname)) throw new Error(`remotePatterns hostname "${p.hostname}" must be a bare host name (no scheme or path)`);
  return { protocol: p.protocol, hostname: p.hostname, port: p.port ?? "", pathname: p.pathname, search: p.search };
}

/** Does this absolute http(s) URL match one of the patterns? */
export function matchRemote(href, patterns) {
  if (!patterns || !patterns.length) return false;
  let u;
  try { u = new URL(href); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  return patterns.some((p) => {
    if (p.protocol && p.protocol + ":" !== u.protocol) return false;
    if (!globToRe(p.hostname, "host").test(u.hostname)) return false;
    if ((p.port ?? "") !== u.port) return false;
    if (p.pathname !== undefined && !globToRe(p.pathname, "path").test(u.pathname)) return false;
    if (p.search !== undefined && p.search !== u.search && p.search !== "*") return false;
    return true;
  });
}
