import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const PUBLIC_PREFIX = "NEPX_PUBLIC_";

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"')) { const e = v.indexOf('"', 1); v = (e === -1 ? v.slice(1) : v.slice(1, e)).replace(/\\n/g, "\n").replace(/\\"/g, '"'); }
    else if (v.startsWith("'")) { const e = v.indexOf("'", 1); v = e === -1 ? v.slice(1) : v.slice(1, e); }
    else v = v.replace(/\s+#.*$/, "").trim();
    out[m[1]] = v;
  }
  return out;
}

/**
 * Load .env files (low -> high priority): .env, .env.<mode>, .env.local, .env.<mode>.local.
 * Variables already present in the real environment always win. Returns the values that were loaded.
 */
export function loadEnv(root, mode) {
  const initial = new Set(Object.keys(process.env));
  const loaded = {};
  for (const name of [".env", `.env.${mode}`, ".env.local", `.env.${mode}.local`]) {
    const file = path.join(root, name);
    if (existsSync(file)) Object.assign(loaded, parseEnv(readFileSync(file, "utf8")));
  }
  for (const [k, v] of Object.entries(loaded)) if (!initial.has(k)) process.env[k] = v;
  return loaded;
}

/** Variables the browser bundle may see: only NEPX_PUBLIC_* (from the process env, including real env). */
export function publicEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith(PUBLIC_PREFIX)));
}
