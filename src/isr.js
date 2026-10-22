// Incremental static regeneration: pages that export `revalidate = N` are rendered once, served from memory,
// and re-rendered in the background when older than N seconds (stale-while-revalidate).
import { als } from "./request-context.js";
const registry = new Set();

export class IsrCache {
  constructor() { this.entries = new Map(); this.inflight = new Map(); this.skipStatic = new Set(); this.skipTags = new Set(); registry.add(this); }
  close() { registry.delete(this); }
  get(key) { return this.entries.get(key); }
  set(key, entry) { this.entries.set(key, entry); }
  invalidate(path, type = "page") {
    const norm = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
    const target = norm(path);
    const hit = (k) => (type === "layout" ? k === target || target === "/" || k.startsWith(target + "/") : k === target);
    for (const k of [...this.entries.keys()]) if (hit(k)) this.entries.delete(k);
    this.skipStatic.add(JSON.stringify([target, type]));
  }
  /** Drop every cached page carrying `tag`; pages that declare the tag are no longer seeded from the build-time copy. */
  invalidateTag(tag) {
    for (const [k, e] of [...this.entries]) if (e.tags && e.tags.includes(tag)) this.entries.delete(k);
    this.skipTags.add(tag);
  }
  isTagSkipped(tags = []) { return tags.some((t) => this.skipTags.has(t)); }
  isStaticSkipped(key) {
    for (const s of this.skipStatic) {
      const [t, type] = JSON.parse(s);
      if (type === "layout" ? key === t || t === "/" || key.startsWith(t + "/") : key === t) return true;
    }
    return false;
  }
  /** Fresh -> serve; stale -> serve and refresh in the background; missing -> null. */
  lookup(key, seconds, now = Date.now()) {
    const e = this.entries.get(key);
    if (!e) return null;
    const s = e.seconds ?? seconds; // an entry can carry its own interval (getStaticProps -> { revalidate })
    return { entry: e, stale: Number.isFinite(s) && now - e.at >= s * 1000 };
  }
  refresh(key, produce) {
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = Promise.resolve().then(produce).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}

/** Drop the cached copy of a page so the next request renders it again. type "layout" also drops everything below the path. */
export function revalidatePath(path, type = "page") {
  if (typeof path !== "string" || !path.startsWith("/")) throw new TypeError('revalidatePath(): path must be a string starting with "/"');
  if (type !== "page" && type !== "layout") throw new TypeError('revalidatePath(): type must be "page" or "layout"');
  for (const c of registry) c.invalidate(path, type);
  const st = als.getStore();
  if (st) st.revalidated = true; // a Server Action tells the browser to refresh the current page
}

/** Tag-based invalidation of every ISR cache (see revalidateTag in cache.js). */
export function revalidateIsrTag(tag) { for (const c of registry) c.invalidateTag(tag); }
