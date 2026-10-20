import { ALGORITHMS } from "./algorithms.js";
import { MemoryStore } from "./memory-store.js";

/**
 * Rate limiter: picks the first matching rule for a path, derives a key (default: IP), runs the configured algorithm
 * against the store and reports the outcome. Requests it skips (static assets, custom `skip`) are never counted.
 */
export class RateLimiter {
  constructor(cfg) {
    this.cfg = cfg;
    this.store = cfg.store ?? new MemoryStore();
    this.ownsStore = !cfg.store;
    this.algorithm = ALGORITHMS[cfg.algorithm];
  }

  /** -> null (not limited) | { limit, remaining, reset (whole seconds), blocked, rule } */
  async check({ req, ip, pathname }, now = Date.now()) {
    const { cfg } = this;
    if (cfg.skip.test(pathname) || (cfg.skipFn && cfg.skipFn(req, pathname))) return null;
    const rule = cfg.rules.find((r) => r.match(pathname));
    const { windowMs, max, burst } = rule ?? cfg;
    const algorithm = rule ? ALGORITHMS[rule.algorithm] : this.algorithm;
    const who = cfg.keyGenerator ? cfg.keyGenerator(req, ip) : ip;
    const key = `${rule ? rule.id : "*"}|${who}`;
    const { state, ttlMs, result } = algorithm(await this.store.get(key), now, { windowMs, max, burst });
    await this.store.set(key, state, ttlMs);
    return { limit: result.limit, remaining: result.remaining, reset: Math.max(1, Math.ceil(result.resetMs / 1000)), blocked: result.blocked, rule: rule ? rule.id : "default" };
  }

  close() { if (this.ownsStore) this.store.close?.(); }
}

export { MemoryStore };
