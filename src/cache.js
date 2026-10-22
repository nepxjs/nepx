// Data cache + tag revalidation: unstable_cache() memoizes an async function, revalidateTag() drops tagged entries
// (and the ISR copies of tagged pages). Memory only: per server process, like the ISR cache.
import { als } from "./request-context.js";
import { revalidateIsrTag, revalidatePath } from "./isr.js";

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
export function revalidateTag(tag, _profile) { // 2nd argument (cache profile) is accepted and ignored: entries are dropped immediately
  if (typeof tag !== "string" || !tag) throw new TypeError("revalidateTag(): tag must be a non-empty string");
  for (const [k, e] of entries) if (e.tags.includes(tag)) entries.delete(k);
  revalidateIsrTag(tag);
  const st = als.getStore();
  if (st) st.revalidated = true; // inside a Server Action the browser refreshes the current page
}

/** updateTag(tag) - like revalidateTag, for Server Actions that must read their own write: the next render sees fresh data. */
export function updateTag(tag) {
  if (typeof tag !== "string" || !tag) throw new TypeError("updateTag(): tag must be a non-empty string");
  revalidateTag(tag);
}

/** refresh() - inside a Server Action, ask the browser to re-render the current page (no cache entries are dropped). */
export function refresh() {
  const st = als.getStore();
  if (!st) throw new Error("refresh() can only be called inside a Server Action");
  st.revalidated = true;
}

/** Internal: shared store for "use cache" (see use-cache.js). */
export function _cacheGet(key) {
  const hit = entries.get(key);
  if (!hit) return undefined;
  if (typeof hit.revalidate === "number" && Date.now() - hit.at >= hit.revalidate * 1000) { entries.delete(key); return undefined; }
  return hit;
}
export function _cacheSet(key, value, tags, revalidate) {
  if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
  entries.set(key, { value, at: Date.now(), tags: [...tags], revalidate: typeof revalidate === "number" ? revalidate : null });
}

export const _cacheSize = () => entries.size;

/** unstable_expireTag / unstable_expirePath: same effect as revalidateTag / revalidatePath here (entries are dropped immediately). */
export const unstable_expireTag = (...tags) => { for (const t of tags) revalidateTag(t); };
export const unstable_expirePath = (path, type) => revalidatePath(path, type);
