// Path patterns for nepx.config.js `redirects` / `headers`: "/old/:slug", "/docs/:path*" (0+ segments), "/files/:rest+" (1+ segments).
import { NepxError } from "./errors/index.js";

const NAME = "[A-Za-z_][A-Za-z0-9_]*";

export function compilePattern(source) {
  if (typeof source !== "string" || !source.startsWith("/")) throw new NepxError(`config: "source" must be a string starting with "/" (got ${JSON.stringify(source)})`);
  const segs = source.split("/").slice(1).filter((s) => s !== "");
  let re = "";
  segs.forEach((s, i) => {
    let m;
    if ((m = new RegExp(`^:(${NAME})([*+])$`).exec(s))) {
      if (i !== segs.length - 1) throw new NepxError(`config: "${source}": :${m[1]}${m[2]} must be the last segment`);
      re += m[2] === "*" ? `(?:/(?<${m[1]}>.*))?` : `/(?<${m[1]}>.+)`;
    } else if ((m = new RegExp(`^:(${NAME})$`).exec(s))) re += `/(?<${m[1]}>[^/]+)`;
    else if (s.startsWith(":")) throw new NepxError(`config: "${source}": invalid parameter "${s}"`);
    else re += "/" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  const regex = new RegExp("^" + (re || "/") + "/?$");
  /** -> params object (values are still percent-encoded, as in the URL) or null */
  return (pathname) => {
    const m = regex.exec(pathname);
    if (!m) return null;
    return Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, v ?? ""])); // an unmatched ":x*" is ""
  };
}

function fill(template, params) {
  const q = template.indexOf("?");
  let pathPart = (q === -1 ? template : template.slice(0, q)).replace(new RegExp(`:(${NAME})[*+]?`, "g"), (all, n) => (params[n] !== undefined ? params[n] : all));
  if (pathPart.length > 1) pathPart = pathPart.replace(/\/+$/, "") || "/"; // "/docs/:path*" with nothing captured -> "/docs"
  return pathPart + (q === -1 ? "" : template.slice(q));
}

/** `has` / `missing` conditions: [{ type: "header" | "cookie" | "query" | "host", key, value? }]. value is a regex source matched against the whole value. */
function compileConds(has, missing, label) {
  const one = (c, j, kind) => {
    if (!c || !["header", "cookie", "query", "host"].includes(c.type)) throw new NepxError(`${label}.${kind}[${j}]: type must be "header", "cookie", "query" or "host"`);
    if (c.type !== "host" && (typeof c.key !== "string" || !c.key)) throw new NepxError(`${label}.${kind}[${j}]: "key" must be a non-empty string`);
    if (c.type === "host" && typeof c.value !== "string") throw new NepxError(`${label}.${kind}[${j}]: a host condition needs a "value"`);
    if (c.value !== undefined && typeof c.value !== "string") throw new NepxError(`${label}.${kind}[${j}]: "value" must be a string`);
    let re = null;
    try { if (c.value !== undefined) re = new RegExp(`^(?:${c.value})$`); } catch { throw new NepxError(`${label}.${kind}[${j}]: "value" is not a valid regular expression`); }
    return (ctx) => {
      const v = c.type === "header" ? ctx.headers?.[c.key.toLowerCase()] : c.type === "cookie" ? ctx.cookies?.[c.key] : c.type === "query" ? ctx.query?.get(c.key) : ctx.host;
      const val = Array.isArray(v) ? v.join(", ") : v;
      return val !== undefined && val !== null && (!re || re.test(String(val)));
    };
  };
  if ((has !== undefined && !Array.isArray(has)) || (missing !== undefined && !Array.isArray(missing))) throw new NepxError(`${label}: "has" and "missing" must be arrays`);
  const h = (has ?? []).map((c, j) => one(c, j, "has")), m = (missing ?? []).map((c, j) => one(c, j, "missing"));
  return (ctx = {}) => h.every((f) => f(ctx)) && !m.some((f) => f(ctx));
}

async function resolveList(value, what) {
  const v = typeof value === "function" ? await value() : value;
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new NepxError(`config.${what} must be an array (or a function returning one)`);
  return v;
}

/** Validate + compile config.redirects / config.headers into matcher rules. */
export async function compileRules(cfg) {
  const redirects = (await resolveList(cfg.redirects, "redirects")).map((r, i) => {
    if (!r || typeof r.source !== "string" || typeof r.destination !== "string") throw new NepxError(`config.redirects[${i}] needs "source" and "destination" strings`);
    const status = r.statusCode ?? (r.permanent ? 308 : 307);
    if (![301, 302, 303, 307, 308].includes(status)) throw new NepxError(`config.redirects[${i}]: statusCode must be 301, 302, 303, 307 or 308`);
    const match = compilePattern(r.source), when = compileConds(r.has, r.missing, `config.redirects[${i}]`);
    return {
      match, status,
      resolve(pathname, search, ctx) {
        const params = match(pathname);
        if (!params || !when(ctx)) return null;
        const dest = fill(r.destination, params);
        return dest.includes("?") ? dest : dest + search;
      },
    };
  });
  const headers = (await resolveList(cfg.headers, "headers")).map((r, i) => {
    if (!r || typeof r.source !== "string" || !Array.isArray(r.headers)) throw new NepxError(`config.headers[${i}] needs "source" and a "headers" array of { key, value }`);
    const list = r.headers.map((x, j) => {
      if (!x || typeof x.key !== "string" || typeof x.value !== "string") throw new NepxError(`config.headers[${i}].headers[${j}] needs string "key" and "value"`);
      return [x.key.toLowerCase(), x.value];
    });
    const base = compilePattern(r.source), when = compileConds(r.has, r.missing, `config.headers[${i}]`);
    return { match: (pathname, ctx) => !!base(pathname) && when(ctx), headers: list };
  });
  const compileRewrite = (r, i, label) => {
    if (!r || typeof r.source !== "string" || typeof r.destination !== "string") throw new NepxError(`${label}[${i}] needs "source" and "destination" strings`);
    const external = /^https?:\/\//i.test(r.destination);
    // external: "https://api.example.com/:path*" proxies the request. The origin must be literal (no :params) so a visitor can never choose the host.
    if (external && !/^https?:\/\/[^/:?#@\s]+(:\d+)?(?=[/?#]|$)/i.test(r.destination)) throw new NepxError(`${label}[${i}]: external destination must look like "https://host[:port]/path" (no credentials, no :params in the host)`);
    if (!external && (!r.destination.startsWith("/") || r.destination.startsWith("//"))) throw new NepxError(`${label}[${i}]: destination must be a path starting with a single "/" or an absolute http(s) URL`);
    const match = compilePattern(r.source), when = compileConds(r.has, r.missing, `${label}[${i}]`);
    return {
      match,
      resolve(pathname, search, ctx) {
        const params = match(pathname);
        if (!params || !when(ctx)) return null;
        const dest = fill(r.destination, params);
        return dest.includes("?") ? dest : dest + search;
      },
    };
  };
  // rewrites: an array (applied before routes), or the { beforeFiles, afterFiles, fallback }:
  // beforeFiles + afterFiles run before routes match, fallback only when nothing else (page, public file) matches.
  const raw = typeof cfg.rewrites === "function" ? await cfg.rewrites() : cfg.rewrites;
  let rewrites, fallbackRewrites = [];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const unknown = Object.keys(raw).filter((k) => !["beforeFiles", "afterFiles", "fallback"].includes(k));
    if (unknown.length) throw new NepxError(`config.rewrites: unknown key "${unknown[0]}" (use beforeFiles, afterFiles, fallback)`);
    const part = async (k) => (await resolveList(raw[k], `rewrites.${k}`)).map((r, i) => compileRewrite(r, i, `config.rewrites.${k}`));
    rewrites = [...(await part("beforeFiles")), ...(await part("afterFiles"))];
    fallbackRewrites = await part("fallback");
  } else rewrites = (await resolveList(raw, "rewrites")).map((r, i) => compileRewrite(r, i, "config.rewrites"));
  return { redirects, headers, rewrites, fallbackRewrites };
}
