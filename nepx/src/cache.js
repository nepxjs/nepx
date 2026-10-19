// Data cache + tag revalidation: unstable_cache() memoizes an async function, revalidateTag() drops tagged entries
// (and the ISR copies of tagged pages). Memory only: per server process, like the ISR cache.
import { als } from "./request-context.js";
import { revalidateIsrTag } from "./isr.js";

const entries = new Map(); // key -> { value, at, tags, revalidate }
const inflight = new Map();
const MAX_ENTRIES = 1000;

/**
 * unstable_cache(fn, keyParts, { revalidate, tags }) -> a cached version of fn. The key is keyParts + the call's (JSON) arguments.
 * `revalidate` seconds (omit = until revalidateTag). Errors are never cached. The tags are also added to the page being rendered.
 */
export function unstable_cache(fn, keyParts = [], options = {}) {
  if (typeof fn !== "function") throw new TypeError("unstable_cache(): first argument must be a function");
  const { revalidate, tags = [] } = options;
  if (revalidate !== undefined && revalidate !== false && !(Number.isFinite(revalidate) && revalidate > 0)) throw new TypeError("unstable_cache(): revalidate must be a positive number of seconds or false");
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string" || !t)) throw new TypeError("unstable_cache(): tags must be an array of non-empty strings");
  const prefix = JSON.stringify(keyParts);
  return async (...args) => {
    const st = als.getStore();
    if (st) for (const t of tags) st.tags.add(t);
    let key;
    try { key = prefix + JSON.stringify(args); } catch { throw new TypeError("unstable_cache(): arguments must be JSON-serializable"); }
    const hit = entries.get(key);
    if (hit && !(typeof hit.revalidate === "number" && Date.now() - hit.at >= hit.revalidate * 1000)) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const p = Promise.resolve().then(() => fn(...args)).then((value) => {
      if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
      entries.set(key, { value, at: Date.now(), tags, revalidate: typeof revalidate === "number" ? revalidate : null });
      return value;
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}

/** Drop every unstable_cache entry and every ISR page carrying `tag` (page `export const tags = [...]` or cacheTag()). */
export function revalidateTag(tag) {
  if (typeof tag !== "string" || !tag) throw new TypeError("revalidateTag(): tag must be a non-empty string");
  for (const [k, e] of entries) if (e.tags.includes(tag)) entries.delete(k);
  revalidateIsrTag(tag);
  const st = als.getStore();
  if (st) st.revalidated = true; // inside a Server Action the browser refreshes the current page
}

export const _cacheSize = () => entries.size;
