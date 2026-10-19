import { buildCsp } from "./csp.js";

const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()";
export const BASE_HEADERS = Object.freeze({
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": PERMISSIONS_POLICY,
  "cross-origin-opener-policy": "same-origin-allow-popups", // keeps OAuth popups working
  "x-permitted-cross-domain-policies": "none",
  "x-dns-prefetch-control": "off",
});

function hsts(option) {
  const h = option === true ? {} : option;
  return `max-age=${h.maxAge ?? 15_552_000}${h.includeSubDomains === false ? "" : "; includeSubDomains"}${h.preload ? "; preload" : ""}`;
}

/** Default response headers for a request. Project `headers` rules and route responses still override them. */
export function securityHeaders(sec, { dev, secure }) {
  const out = {};
  if (sec.headers !== false) {
    Object.assign(out, BASE_HEADERS);
    if (sec.headers && typeof sec.headers === "object") {
      for (const [k, v] of Object.entries(sec.headers)) { if (v === null || v === false) delete out[k.toLowerCase()]; else out[k.toLowerCase()] = String(v); }
    }
  }
  const csp = buildCsp(sec, { dev, secure });
  if (csp && !out[csp.name]) out[csp.name] = csp.value;
  if (sec.hsts && !dev && secure) out["strict-transport-security"] = hsts(sec.hsts);
  return out;
}
