// Content-Security-Policy: strict preset, string / directive-object forms, report-only mode, report endpoint wiring.

export const CSP_REPORT_PATH = "/_nepx/csp-report";

export const STRICT_CSP = Object.freeze({
  "default-src": ["'self'"], "base-uri": ["'self'"], "object-src": ["'none'"], "frame-ancestors": ["'self'"], "form-action": ["'self'"],
  "script-src": ["'self'"], "style-src": ["'self'", "'unsafe-inline'"], "img-src": ["'self'", "data:", "blob:"], "font-src": ["'self'", "data:"], "connect-src": ["'self'"],
});

export function serializeCsp(value) {
  if (typeof value === "string") return value;
  return Object.entries(value).filter(([, v]) => v !== null && v !== false)
    .map(([k, v]) => (v === true || (Array.isArray(v) && !v.length) ? k : `${k} ${[].concat(v).join(" ")}`)).join("; ");
}

/**
 * -> { name, value } | null for this request.
 * The `true` preset is production-only (the dev overlay needs inline scripts); an explicit string / object always applies.
 */
export function buildCsp(sec, { dev, secure }) {
  const policy = sec.contentSecurityPolicy;
  if (!policy) return null;
  if (policy === true && dev) return null;
  const base = policy === true ? { ...STRICT_CSP, ...(secure ? { "upgrade-insecure-requests": true } : {}) } : policy;
  const reportUri = sec.cspReport === true ? CSP_REPORT_PATH : typeof sec.cspReport === "string" ? sec.cspReport : null;
  const value = typeof base === "string" ? (reportUri && !/report-uri/.test(base) ? `${base}; report-uri ${reportUri}` : base) : serializeCsp(reportUri ? { ...base, "report-uri": [reportUri] } : base);
  return { name: sec.cspReportOnly ? "content-security-policy-report-only" : "content-security-policy", value };
}

/** Reduce a browser's CSP report (legacy report-uri or Reporting API shapes) to the few fields worth logging. */
export function parseCspReport(text) {
  let body;
  try { body = JSON.parse(text); } catch { return null; }
  const r = Array.isArray(body) ? body[0]?.body : body?.["csp-report"] ?? body?.body ?? body;
  if (!r || typeof r !== "object") return null;
  const pick = (...keys) => { for (const k of keys) if (typeof r[k] === "string") return r[k].slice(0, 300); return undefined; };
  return {
    documentUri: pick("document-uri", "documentURL"), blockedUri: pick("blocked-uri", "blockedURL"),
    violatedDirective: pick("violated-directive", "effectiveDirective", "effective-directive"), sourceFile: pick("source-file", "sourceFile"),
  };
}
