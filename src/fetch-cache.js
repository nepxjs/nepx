// Extended server-side fetch(): `fetch(url, { cache, nepx: { revalidate, tags } })`.
//   cache: "force-cache"            -> cached until revalidateTag() (or `nepx.revalidate` seconds)
//   nepx: { revalidate: 60 }        -> cached for 60s;  revalidate: false -> cached until revalidateTag();  revalidate: 0 -> never cached
//   cache: "no-store" | "no-cache"  -> never cached (default: a plain fetch() is not cached)
//   nepx: { tags: ["posts"] }       -> revalidateTag("posts") drops the entry (and ISR pages that rendered with it)
// Only successful (2xx) GET/HEAD responses are cached, in process memory, shared with unstable_cache() / "use cache".
import { als, cacheScope } from "./request-context.js";
import { _cacheGet, _cacheSet } from "./cache.js";

const ORIGINAL = Symbol.for("nepx.fetch.original");
const inflight = new Map();

/** The per-call cache options object: `nepx` (preferred); the legacy `next` key still works. */
const optsOf = (init) => init?.nepx ?? init?.next;

function validate(init) {
  const next = optsOf(init);
  const key = init?.nepx !== undefined ? "nepx" : "next";
  if (next === undefined) return;
  if (!next || typeof next !== "object" || Array.isArray(next)) throw new TypeError("fetch(): `" + key + "` must be an object like { revalidate: 60, tags: [\"posts\"] }");
  const { revalidate, tags } = next;
  if (revalidate !== undefined && revalidate !== false && !(Number.isFinite(revalidate) && revalidate >= 0)) throw new TypeError("fetch(): " + key + ".revalidate must be false or a number of seconds (0 = never cache)");
  if (tags !== undefined && (!Array.isArray(tags) || tags.some((t) => typeof t !== "string" || !t))) throw new TypeError("fetch(): " + key + ".tags must be an array of non-empty strings");
}

/** -> { revalidate: number|null, tags } when the call should be cached, else null. */
export function cachePlan(input, init) {
  const method = String(init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  const mode = init?.cache ?? (input instanceof Request ? input.cache : undefined);
  if (mode === "no-store" || mode === "no-cache" || mode === "reload") return null;
  const rev = optsOf(init)?.revalidate;
  if (rev === 0) return null;
  const wants = mode === "force-cache" || mode === "only-if-cached" || typeof rev === "number" || rev === false;
  if (!wants) return null;
  return { revalidate: typeof rev === "number" ? rev : null, tags: optsOf(init)?.tags ?? [] };
}

function keyOf(input, init) {
  const req = input instanceof Request ? input : null;
  const url = req ? req.url : String(input instanceof URL ? input.href : input);
  const h = new Headers(init?.headers ?? req?.headers ?? undefined);
  const hs = [...h.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return "fetch:" + JSON.stringify([String(init?.method ?? req?.method ?? "GET").toUpperCase(), url, hs]);
}

const rebuild = (e) => new Response(e.status === 204 || e.status === 304 ? null : e.body, { status: e.status, statusText: e.statusText, headers: e.headers });

/** Install the extended fetch once (idempotent). Safe to call from the server and from tests. */
export function patchFetch() {
  const current = globalThis.fetch;
  if (typeof current !== "function" || current[ORIGINAL]) return;
  const original = current;
  const cachedFetch = async function fetch(input, init) {
    validate(init);
    const plan = cachePlan(input, init);
    if (!plan) return original(input, init);
    const st = als.getStore(), scope = cacheScope.getStore();
    for (const t of plan.tags) { st?.tags.add(t); scope?.tags.add(t); } // the page / "use cache" entry that used this data carries its tags
    const key = keyOf(input, init);
    const hit = _cacheGet(key);
    if (hit) return rebuild(hit.value);
    if (inflight.has(key)) return rebuild(await inflight.get(key));
    const run = (async () => {
      const res = await original(input, init);
      const body = Buffer.from(await res.arrayBuffer());
      const headers = [...res.headers.entries()].filter(([k]) => k !== "set-cookie");
      const entry = { status: res.status, statusText: res.statusText, headers, body };
      if (res.ok) _cacheSet(key, entry, plan.tags, plan.revalidate);
      return entry;
    })().finally(() => inflight.delete(key));
    inflight.set(key, run);
    return rebuild(await run);
  };
  cachedFetch[ORIGINAL] = original;
  globalThis.fetch = cachedFetch;
}

/** Test helper: put the platform fetch back. */
export function unpatchFetch() {
  const f = globalThis.fetch;
  if (f && f[ORIGINAL]) globalThis.fetch = f[ORIGINAL];
}
