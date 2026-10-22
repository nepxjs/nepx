// Update notice for the CLI: tells you when a newer `nepxjs` is published.
//   - never blocks: the registry lookup runs in the background (3s timeout) and is cached for 24h;
//     the notice for a result shows on the next run
//   - silent in CI, non-interactive output, tests, and when switched off:
//     NEPX_NO_UPDATE_CHECK=1, `--no-update-check`, or NO_UPDATE_NOTIFIER=1
//   - only talks to the public npm registry, sends no project data
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PACKAGE = "nepxjs";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 3000;

/** "1.9.0" -> [1, 9, 0]; null when it is not a plain release version (pre-releases are ignored). */
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** true when `latest` is a newer release than `current`. */
export function isNewer(latest, current) {
  const a = parseVersion(latest), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Whether the update check should run at all in this environment. */
export function shouldCheck({ env = process.env, flags = {}, isTTY = process.stderr.isTTY } = {}) {
  if (flags["no-update-check"]) return false;
  if (env.NEPX_NO_UPDATE_CHECK || env.NO_UPDATE_NOTIFIER || env.CI || env.NODE_ENV === "test") return false;
  return Boolean(isTTY);
}

export function formatNotice(current, latest) {
  const lines = [
    `Update available: ${PACKAGE} ${current} -> ${latest}`,
    `Run: npm i -g ${PACKAGE}@latest   (or update the dependency in package.json)`,
    "Turn this off: NEPX_NO_UPDATE_CHECK=1",
  ];
  const width = Math.max(...lines.map((l) => l.length));
  const bar = "-".repeat(width + 4);
  return [bar, ...lines.map((l) => `| ${l.padEnd(width)} |`), bar].join("\n");
}

function readCache(file) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null; } catch { return null; }
}

/**
 * Returns the notice text to print now (from the cached result of an earlier run), or null.
 * Starts a background refresh when the cache is missing or older than 24h. Never throws, never awaits the network.
 */
export function updateNotice(current, { env = process.env, flags = {}, isTTY, cacheFile = path.join(os.tmpdir(), "nepx-update-check.json"), fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  try {
    if (!shouldCheck({ env, flags, ...(isTTY === undefined ? {} : { isTTY }) })) return null;
    const cache = readCache(cacheFile);
    if (!cache || !Number.isFinite(cache.checkedAt) || now - cache.checkedAt > INTERVAL_MS) {
      if (typeof fetchImpl === "function") {
        fetchImpl(REGISTRY_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => { if (j && typeof j.version === "string" && parseVersion(j.version)) writeFileSync(cacheFile, JSON.stringify({ latest: j.version, checkedAt: Date.now() })); })
          .catch(() => { /* offline or registry down: stay silent */ });
      }
    }
    return cache && isNewer(cache.latest, current) ? formatNotice(current, cache.latest) : null;
  } catch { return null; }
}
