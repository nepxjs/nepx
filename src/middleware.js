import path from "node:path";
import { pathToFileURL } from "node:url";
import { NepxError } from "./errors/index.js";

/** Compile Nepx matcher strings: "/admin", "/blog/:slug", "/dashboard/:path*". */
export function compileMatcher(patterns) {
  const regs = patterns.map((p) => {
    if (typeof p !== "string" || !p.startsWith("/")) throw new NepxError(`middleware config.matcher entries must be strings starting with "/" (got ${JSON.stringify(p)})`);
    const segs = p.split("/").slice(1).filter((s) => s !== "");
    let src = "";
    segs.forEach((s, i) => {
      if (/^:[A-Za-z_]\w*\*$/.test(s) && i === segs.length - 1) src += "(?:/.*)?";
      else if (/^:[A-Za-z_]\w*$/.test(s)) src += "/[^/]+";
      else src += "/" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
    return new RegExp("^" + (src || "/") + "/?$");
  });
  return (pathname) => regs.some((r) => r.test(pathname));
}

export async function loadMiddleware(root, file) {
  if (!file) return null;
  const mod = await import(pathToFileURL(path.join(root, file)).href);
  const fn = mod.default ?? mod.middleware ?? mod.proxy; // proxy.js is an alias of middleware.js
  if (typeof fn !== "function") throw new NepxError(`${file}: must export a function (default export, "middleware" or "proxy")`);
  const matcher = mod.config?.matcher;
  const matches = matcher ? compileMatcher([].concat(matcher)) : () => true;
  return { fn, matches, file };
}
