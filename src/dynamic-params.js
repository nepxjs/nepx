// `export const dynamicParams = false` on a page: only the params returned by generateStaticParams() are served, anything else is a 404.
import { segmentsFor } from "./match.js";
import { loadStaticParams } from "./static-paths.js";

const keyOf = (segs) => segs.map(String).join("/");

/** The set of URL paths (decoded segments joined by "/") a generateStaticParams() result stands for. Invalid entries are skipped. */
export function allowedKeys(route, list) {
  const out = new Set();
  if (!Array.isArray(list)) return out;
  for (const params of list) {
    if (!params || typeof params !== "object") continue;
    out.add(keyOf(segmentsFor(route, params)));
  }
  return out;
}

/** Per-server cache of allowed paths, one generateStaticParams() call per route (in flight calls are shared). */
export function createParamsGate(load) {
  const cache = new Map();
  return async function allowed(route, params) {
    if (route.type !== "PAGE" || (route.dynamicParams !== false && !route.staticPaths)) return true; // getStaticPaths: fallback false = 404 for unknown params
    if (!cache.has(route.file)) {
      cache.set(route.file, (async () => {
        const mod = await load(route.file);
        if (typeof mod.generateStaticParams !== "function" && typeof mod.getStaticPaths !== "function") return null;
        const { list, fallback } = await loadStaticParams(route, mod);
        return route.dynamicParams === false || fallback === false ? allowedKeys(route, list) : null; // fallback true / "blocking": render on demand
      })().catch((e) => { cache.delete(route.file); throw e; }));
    }
    const keys = await cache.get(route.file);
    return keys === null || keys.has(keyOf(segmentsFor(route, params)));
  };
}
