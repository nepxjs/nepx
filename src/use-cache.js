// The "use cache" directive + cacheLife(): the Cache Components model on top of the in-memory data cache (cache.js).
//   "use cache" at the top of a file  -> every exported async function is cached
//   "use cache" first in an async function declaration / `const f = async () => {}` -> that function is cached
//   "use cache: private" / "use cache: remote" are accepted (all variants share the process memory cache here).
// The cache key is the function id + its arguments (primitives, arrays, plain objects, Dates). Arguments that cannot be keyed
// (promises, functions, class instances) skip the cache and call the function directly. Entries live until cacheLife().revalidate
// seconds pass or a cacheTag() tag is revalidated with revalidateTag().
import { als, cacheScope } from "./request-context.js";
import { _cacheGet, _cacheSet } from "./cache.js";
import { skipBalanced } from "./strip.js";

/** Built-in profiles (seconds). `stale` is client-side only and kept for compatibility; `revalidate` is how long an entry is served. */
export const CACHE_PROFILES = {
  default: { stale: 300, revalidate: 900, expire: Infinity },
  seconds: { stale: 30, revalidate: 1, expire: 60 },
  minutes: { stale: 300, revalidate: 60, expire: 3600 },
  hours: { stale: 300, revalidate: 3600, expire: 86400 },
  days: { stale: 300, revalidate: 86400, expire: 604800 },
  weeks: { stale: 300, revalidate: 604800, expire: 2592000 },
  max: { stale: 300, revalidate: 2592000, expire: 31536000 },
};

/**
 * cacheLife("hours") / cacheLife({ stale, revalidate, expire }) - how long the surrounding "use cache" result may be reused.
 * Called more than once, the shortest lifetime wins. Only valid inside a "use cache" function.
 */
export function cacheLife(profile = "default") {
  const scope = cacheScope.getStore();
  if (!scope) throw new Error('cacheLife() can only be called inside a "use cache" function');
  let life;
  if (typeof profile === "string") {
    life = CACHE_PROFILES[profile];
    if (!life) throw new TypeError(`cacheLife(): unknown profile "${profile}" (use ${Object.keys(CACHE_PROFILES).join(", ")} or an object)`);
  } else if (profile && typeof profile === "object") {
    life = { ...CACHE_PROFILES.default, ...profile };
    for (const k of ["stale", "revalidate", "expire"]) {
      if (profile[k] !== undefined && !(typeof profile[k] === "number" && profile[k] >= 0)) throw new TypeError(`cacheLife(): "${k}" must be a number of seconds >= 0`);
    }
  } else throw new TypeError("cacheLife(): pass a profile name or { stale, revalidate, expire }");
  if (!scope.life || life.revalidate < scope.life.revalidate) scope.life = life;
}
export const unstable_cacheLife = cacheLife;

// Arguments -> stable string, or null when something cannot be keyed.
function keyOf(v, depth = 0) {
  if (depth > 8) return null;
  if (v === null || typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : `n:${v}`;
  if (typeof v === "bigint") return `${v}n`;
  if (v === undefined) return "u";
  if (v instanceof Date) return `d:${v.getTime()}`;
  if (Array.isArray(v)) { const parts = v.map((x) => keyOf(x, depth + 1)); return parts.includes(null) ? null : `[${parts.join(",")}]`; }
  if (typeof v === "object" && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
    const parts = [];
    for (const k of Object.keys(v).sort()) { const x = keyOf(v[k], depth + 1); if (x === null) return null; parts.push(`${JSON.stringify(k)}:${x}`); }
    return `{${parts.join(",")}}`;
  }
  return null; // promise, function, symbol, class instance (React elements too)
}

const inflight = new Map();

/** Runtime for the code the loader generates; also usable by hand: `const get = useCache("my-id", async (x) => ...)`. */
export function useCache(id, fn, variant = "default") {
  if (typeof fn !== "function") throw new TypeError("useCache(): needs a function");
  const wrapped = async function (...args) {
    const argKey = keyOf(args);
    if (argKey === null) return fn.apply(this, args);
    const key = `use-cache\0${variant}\0${id}\0${argKey}`;
    const st = als.getStore();
    const hit = _cacheGet(key);
    if (hit) { if (st) for (const t of hit.tags) st.tags.add(t); return hit.value; }
    if (inflight.has(key)) { const r = await inflight.get(key); if (st) for (const t of r.tags) st.tags.add(t); return r.value; }
    const scope = { tags: new Set(), life: null };
    const p = Promise.resolve().then(() => cacheScope.run(scope, () => fn.apply(this, args))).then((value) => {
      const life = scope.life ?? CACHE_PROFILES.default;
      if (life.revalidate > 0 && life.expire > 0) _cacheSet(key, value, scope.tags, Math.min(life.revalidate, life.expire));
      return { value, tags: [...scope.tags] };
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
    const r = await p;
    if (st) for (const t of r.tags) st.tags.add(t);
    return r.value;
  };
  Object.defineProperty(wrapped, "name", { value: fn.name || id.split("#")[1] || "cached" });
  return wrapped;
}

// ---------------------------------------------------------------------------------------------- source transform
const FILE_DIRECTIVE = /^\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)\s*)*(["'])use cache(?::\s*([\w-]+))?\1\s*;?/;
const BODY_DIRECTIVE = /^\s*(["'])use cache(?::\s*([\w-]+))?\1\s*;?/;
const MODULE = import.meta.url; // already a valid file:// URL on every OS (Windows: file:///D:/...)
const ws = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";
const variantOf = (v) => (v === "private" || v === "remote" ? v : "default");

/** True when the source mentions the directive at all (cheap check before the real transform). */
export const mentionsUseCache = (src) => /["']use cache/.test(src);

/**
 * Rewrite a module so its "use cache" functions go through useCache(). `id` is a stable name for the file (its path).
 * Throws a SyntaxError (with a plain-language message) for forms that cannot be cached safely.
 */
export function transformUseCache(src, id) {
  if (!mentionsUseCache(src)) return src;
  const head = `import { useCache as __nepx_uc } from ${JSON.stringify(MODULE)};\n`;
  const fileMatch = FILE_DIRECTIVE.exec(src);
  if (fileMatch) return head + wrapFile(src, id, variantOf(fileMatch[2]));
  const out = wrapInline(src, id);
  return out === src ? src : head + out;
}

function wrapFile(src, id, variant) {
  const tail = [];
  const add = (name, local, isDefault) => tail.push(isDefault ? `export default __nepx_uc(${JSON.stringify(`${id}#default`)}, ${local}, ${JSON.stringify(variant)});` : `export const ${name} = __nepx_uc(${JSON.stringify(`${id}#${name}`)}, ${local}, ${JSON.stringify(variant)});`);
  let out = src.replace(/(^|\n)([ \t]*)export\s+default\s+async\s+function\s*\*?\s*([\w$]*)\s*\(/g, (m, nl, ind, name) => {
    const local = `__nepx_uc_${name || "default"}`;
    add(name, local, true);
    return `${nl}${ind}async function ${local}(`;
  });
  out = out.replace(/(^|\n)([ \t]*)export\s+async\s+function\s*([\w$]+)\s*(?=[(<])/g, (m, nl, ind, name) => {
    add(name, `__nepx_uc_${name}`, false);
    return `${nl}${ind}async function __nepx_uc_${name}`;
  });
  out = out.replace(/(^|\n)([ \t]*)export\s+const\s+([\w$]+)\s*(:[^=\n]+)?=\s*(?=async\b)/g, (m, nl, ind, name, type) => {
    add(name, `__nepx_uc_${name}`, false);
    return `${nl}${ind}const __nepx_uc_${name}${type ?? ""} = `;
  });
  // Anything else exported from a "use cache" file would silently stay uncached (or break): refuse it.
  const bad = /(^|\n)[ \t]*export\s+(?!default\b)(?!async\s+function)(?!const\s+[\w$]+\s*(?::[^=\n]+)?=\s*async\b)(?:(?:const|let|var|function|class)\s+([\w$]+)|(\{[^}]*\})|\*)/.exec(out)
    ?? /(^|\n)[ \t]*export\s+default\s+(?!__nepx)(?!async\s+function)/.exec(out);
  if (bad) throw new SyntaxError(`a "use cache" file can only export async functions (\`export async function x\` or \`export const x = async ...\`)${bad[1] && bad[1] !== "\n" && bad[1] !== "" ? ` - found "${bad[1]}"` : ""}`);
  return out + "\n" + tail.join("\n") + "\n";
}

function wrapInline(src, id) {
  const edits = []; // { start, end, text }
  const fn = /(^|[^\w$.])((?:export\s+(default\s+)?)?)async\s+function\s*\*?\s*([\w$]*)\s*(<[^>(]*>)?\s*\(/g;
  let m;
  while ((m = fn.exec(src))) {
    const open = m.index + m[0].length - 1;
    let afterParams;
    try { afterParams = skipBalanced(src, open, "(", ")"); } catch { continue; }
    const brace = src.indexOf("{", afterParams);
    if (brace === -1 || /[;=]/.test(src.slice(afterParams, brace).replace(/=>/g, ""))) continue;
    const d = BODY_DIRECTIVE.exec(src.slice(brace + 1));
    if (!d) continue;
    const end = skipBalanced(src, brace, "{", "}");
    const name = m[4];
    const start = m.index + m[1].length;
    const fnText = src.slice(start + m[2].length, end);
    const isDefault = !!m[3], isExport = !!m[2];
    if (!name && !isDefault) throw new SyntaxError('an anonymous async function with "use cache" must be a default export or assigned to a const');
    const local = name || "__nepx_uc_default";
    const wrapped = `__nepx_uc(${JSON.stringify(`${id}#${local}`)}, ${fnText}, ${JSON.stringify(variantOf(d[2]))})`;
    const text = isDefault ? `const ${local} = ${wrapped};\nexport default ${local};` : `${isExport ? "export " : ""}const ${local} = ${wrapped};`;
    edits.push({ start, end, text });
    fn.lastIndex = end;
  }
  const arrow = /(^|[^\w$.])((?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*(?::[^=\n]+)?=\s*)(async\s*(?:\(|[\w$]+\s*=>))/g;
  while ((m = arrow.exec(src))) {
    const exprStart = m.index + m[1].length + m[2].length;
    if (edits.some((e) => exprStart >= e.start && exprStart < e.end)) continue;
    let i = exprStart + 5;
    while (ws(src[i])) i++;
    try { if (src[i] === "(") i = skipBalanced(src, i, "(", ")"); else { while (/[\w$]/.test(src[i])) i++; } } catch { continue; }
    while (ws(src[i])) i++;
    if (src[i] === ":") { const arrowAt = src.indexOf("=>", i); if (arrowAt === -1) continue; i = arrowAt; } // return type annotation
    if (src.slice(i, i + 2) !== "=>") continue;
    i += 2;
    while (ws(src[i])) i++;
    if (src[i] !== "{") continue;
    const d = BODY_DIRECTIVE.exec(src.slice(i + 1));
    if (!d) continue;
    const end = skipBalanced(src, i, "{", "}");
    const name = m[3];
    edits.push({ start: exprStart, end, text: `__nepx_uc(${JSON.stringify(`${id}#${name}`)}, ${src.slice(exprStart, end)}, ${JSON.stringify(variantOf(d[2]))})` });
    arrow.lastIndex = end;
  }
  if (!edits.length) return src;
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
