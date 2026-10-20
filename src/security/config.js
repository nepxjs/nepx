// Validation + normalisation of `security` from nepx.config.js. Fails early with messages that name the option.
import { NepxError } from "../errors/index.js";
import { compilePattern } from "../rules.js";
import { compileAccessList } from "./access-list.js";
import { compileProbes } from "./probes.js";
import { ALGORITHMS } from "./rate-limit/algorithms.js";

export const SECURITY_DEFAULTS = Object.freeze({
  headers: true,                 // X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP, ... (false = none, object = override / remove with null)
  hsts: true,                    // Strict-Transport-Security, production + HTTPS only
  contentSecurityPolicy: false,  // true = strict preset (production only), string / object = your own policy
  cspReportOnly: false,          // send Content-Security-Policy-Report-Only instead (try a policy without breaking pages)
  cspReport: false,              // true = collect reports at /_nepx/csp-report (as "csp-report" events); a string = your own report-uri
  csrf: true,                    // block cross-site unsafe requests that carry cookies
  allowedOrigins: [],            // extra origins allowed by the CSRF check
  allowedHosts: null,            // e.g. ["example.com", ".example.com"]; null = any Host header
  ipAccess: null,                // { allow, deny, rules: [{ source, allow, deny }] } with IPs / CIDR ranges
  trustProxy: false,             // true / number of proxy hops: read client IP + protocol from X-Forwarded-*
  rateLimit: false,              // true = 120 requests / minute / IP, or { windowMs, max, algorithm, burst, store, keyGenerator, skip, rules }
  probes: true,                  // answer scanner paths (/wp-admin, *.php ...) on unmatched URLs with a cheap 404 + "probe" event
  onEvent: null,                 // (event) => void, called for every blocked request / CSP report
  maxUrlLength: 8192,            // longer request targets get 414
  maxHeaderSize: 16384,          // bytes; larger header blocks get 431
  headersTimeoutMs: 20_000,      // time allowed to send the request headers (slowloris)
  requestTimeoutMs: 60_000,      // time allowed to send the whole request
  blockDotfiles: true,           // never serve /.env, /.git/... from public/ (".well-known" stays allowed)
});

const RESOLVED = Symbol("nepx.security");
const OFF = { headers: false, hsts: false, csrf: false, blockDotfiles: false, probes: false, maxUrlLength: 0 };
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Validate + normalise `config.security` (idempotent: an already resolved object is returned as is). */
export function resolveSecurity(input = {}) {
  if (input && input[RESOLVED]) return input;
  if (input === false) input = OFF;
  if (!isObject(input)) throw new NepxError("config.security must be an object (or false to disable every protection)");
  const known = Object.keys(SECURITY_DEFAULTS);
  for (const k of Object.keys(input)) if (!known.includes(k)) throw new NepxError(`config.security.${k} is not a known option (known: ${known.join(", ")})`);

  const s = { ...SECURITY_DEFAULTS, ...input };
  for (const k of ["maxUrlLength", "maxHeaderSize", "headersTimeoutMs", "requestTimeoutMs"]) integer(s[k], `config.security.${k}`, 0);
  if (s.headersTimeoutMs && s.requestTimeoutMs && s.headersTimeoutMs > s.requestTimeoutMs) throw new NepxError("config.security.headersTimeoutMs cannot be larger than requestTimeoutMs");
  for (const k of ["csrf", "blockDotfiles", "cspReportOnly"]) if (typeof s[k] !== "boolean") throw new NepxError(`config.security.${k} must be true or false`);
  if (!(typeof s.hsts === "boolean" || isObject(s.hsts))) throw new NepxError("config.security.hsts must be true, false or { maxAge, includeSubDomains, preload }");
  if (!(s.headers === true || s.headers === false || isObject(s.headers))) throw new NepxError("config.security.headers must be true, false or an object of header overrides");
  const csp = s.contentSecurityPolicy;
  if (!(typeof csp === "boolean" || typeof csp === "string" || isObject(csp))) throw new NepxError("config.security.contentSecurityPolicy must be true, false, a string or an object of directives");
  if (!(typeof s.cspReport === "boolean" || (typeof s.cspReport === "string" && s.cspReport))) throw new NepxError("config.security.cspReport must be true, false or a report-uri string");
  if (s.cspReportOnly && !csp) throw new NepxError("config.security.cspReportOnly needs contentSecurityPolicy (true, a string or an object)");
  if (!(typeof s.probes === "boolean" || (isObject(s.probes) && (s.probes.paths === undefined || Array.isArray(s.probes.paths))))) throw new NepxError("config.security.probes must be true, false or { paths: [RegExp | string] }");
  if (s.onEvent !== null && typeof s.onEvent !== "function") throw new NepxError("config.security.onEvent must be a function");
  if (!(s.trustProxy === false || s.trustProxy === true || (Number.isInteger(s.trustProxy) && s.trustProxy > 0))) throw new NepxError("config.security.trustProxy must be true, false or a number of proxy hops");

  if (!Array.isArray(s.allowedOrigins) || s.allowedOrigins.some((o) => typeof o !== "string")) throw new NepxError("config.security.allowedOrigins must be an array of origin strings");
  s.allowedOrigins = s.allowedOrigins.map((o) => { try { return new URL(o).origin; } catch { throw new NepxError(`config.security.allowedOrigins: invalid origin ${JSON.stringify(o)}`); } });
  if (s.allowedHosts !== null && (!Array.isArray(s.allowedHosts) || s.allowedHosts.some((h) => typeof h !== "string" || !h))) throw new NepxError('config.security.allowedHosts must be an array of host names like ["example.com", ".example.com"]');

  s.ipAccess = compileAccessList(s.ipAccess);
  s.rateLimit = resolveRateLimit(s.rateLimit);
  s.isProbe = compileProbes(s.probes);
  Object.defineProperty(s, RESOLVED, { value: true });
  return s;
}

function integer(v, name, min) { if (!Number.isInteger(v) || v < min) throw new NepxError(`${name} must be an integer >= ${min}`); }
function positive(v, name) { if (!Number.isInteger(v) || v < 1) throw new NepxError(`${name} must be a positive integer`); }

function resolveRateLimit(v) {
  if (!v) return null;
  const base = v === true ? {} : v;
  if (!isObject(base)) throw new NepxError("config.security.rateLimit must be true, false or an object");
  const cfg = { windowMs: 60_000, max: 120, algorithm: "fixed", ...base };
  const where = "config.security.rateLimit";
  positive(cfg.windowMs, `${where}.windowMs`); positive(cfg.max, `${where}.max`);
  if (!(cfg.algorithm in ALGORITHMS)) throw new NepxError(`${where}.algorithm must be one of: ${Object.keys(ALGORITHMS).join(", ")}`);
  if (cfg.burst !== undefined) positive(cfg.burst, `${where}.burst`);
  if (cfg.store !== undefined && (typeof cfg.store?.get !== "function" || typeof cfg.store?.set !== "function")) throw new NepxError(`${where}.store needs get(key) and set(key, state, ttlMs) methods`);
  for (const fn of ["keyGenerator", "skip"]) if (cfg[fn] !== undefined && typeof cfg[fn] !== "function") throw new NepxError(`${where}.${fn} must be a function`);
  const rules = (cfg.rules ?? []).map((r, i) => {
    const at = `${where}.rules[${i}]`;
    if (!r || typeof r.source !== "string") throw new NepxError(`${at} needs a "source" path pattern`);
    const rule = { windowMs: cfg.windowMs, max: cfg.max, algorithm: cfg.algorithm, burst: cfg.burst, ...r };
    positive(rule.windowMs, `${at}.windowMs`); positive(rule.max, `${at}.max`);
    if (!(rule.algorithm in ALGORITHMS)) throw new NepxError(`${at}.algorithm must be one of: ${Object.keys(ALGORITHMS).join(", ")}`);
    return { match: compilePattern(r.source), windowMs: rule.windowMs, max: rule.max, algorithm: rule.algorithm, burst: rule.burst, id: `r${i}` };
  });
  return { windowMs: cfg.windowMs, max: cfg.max, algorithm: cfg.algorithm, burst: cfg.burst, store: cfg.store, keyGenerator: cfg.keyGenerator, skipFn: cfg.skip, rules, skip: /^\/_nepx(\/|$)/ };
}
