// Pure functions: (previous state, now, { windowMs, max, burst }) -> { state, ttlMs, result }.
// `result` = { limit, remaining, resetMs, blocked }. State is plain JSON so any store can keep it.

/** Fixed window: simple and cheap; allows up to 2x max around a window boundary. */
function fixed(prev, now, { windowMs, max }) {
  const state = prev && prev.reset > now ? { count: prev.count + 1, reset: prev.reset } : { count: 1, reset: now + windowMs };
  return { state, ttlMs: state.reset - now, result: { limit: max, remaining: Math.max(0, max - state.count), resetMs: state.reset - now, blocked: state.count > max } };
}

/** Sliding window counter: weighs the previous window by how much of it still overlaps. Smooths the boundary burst. */
function sliding(prev, now, { windowMs, max }) {
  const start = now - (now % windowMs);
  let state = prev;
  if (!state || state.start + 2 * windowMs <= now) state = { start, cur: 0, prev: 0 };
  else if (state.start + windowMs <= now) state = { start, cur: 0, prev: state.start + windowMs === start ? state.cur : 0 };
  state = { ...state, cur: state.cur + 1 };
  const weight = 1 - (now - start) / windowMs;
  const used = state.cur + Math.floor(state.prev * weight);
  return { state, ttlMs: 2 * windowMs, result: { limit: max, remaining: Math.max(0, max - used), resetMs: start + windowMs - now, blocked: used > max } };
}

/** Token bucket: `max` tokens per window refilled continuously; `burst` (default max) is the bucket size. */
function tokenBucket(prev, now, { windowMs, max, burst }) {
  const capacity = burst ?? max, rate = max / windowMs; // tokens per ms
  const tokens = prev ? Math.min(capacity, prev.tokens + (now - prev.at) * rate) : capacity;
  const blocked = tokens < 1;
  const state = { tokens: blocked ? tokens : tokens - 1, at: now };
  const wait = blocked ? Math.ceil((1 - tokens) / rate) : Math.ceil((capacity - state.tokens) / rate);
  return { state, ttlMs: Math.max(1000, Math.ceil(capacity / rate)), result: { limit: capacity, remaining: Math.floor(state.tokens), resetMs: Math.max(1, wait), blocked } };
}

export const ALGORITHMS = Object.freeze({ fixed, sliding, "token-bucket": tokenBucket });
