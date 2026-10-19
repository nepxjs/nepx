/**
 * In-memory store (per process). A custom store only needs { get(key), set(key, state, ttlMs), close?() }; both may be async,
 * so Redis / a database can back the limiter when several processes share the load.
 */
export class MemoryStore {
  constructor({ maxKeys = 50_000, sweepMs = 30_000 } = {}) {
    this.maxKeys = maxKeys;
    this.map = new Map(); // key -> { state, expires }
    this.timer = setInterval(() => this.sweep(), sweepMs).unref();
  }
  get(key, now = Date.now()) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expires <= now) { this.map.delete(key); return undefined; }
    return e.state;
  }
  set(key, state, ttlMs, now = Date.now()) {
    if (!this.map.has(key) && this.map.size >= this.maxKeys) { // address-spraying guard: drop expired, then oldest-first
      this.sweep(now);
      if (this.map.size >= this.maxKeys) for (const k of this.map.keys()) { this.map.delete(k); if (this.map.size < this.maxKeys * 0.9) break; }
    }
    this.map.set(key, { state, expires: now + ttlMs });
  }
  sweep(now = Date.now()) { for (const [k, v] of this.map) if (v.expires <= now) this.map.delete(k); }
  get size() { return this.map.size; }
  close() { clearInterval(this.timer); this.map.clear(); }
}
