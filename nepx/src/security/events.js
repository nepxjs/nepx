// Security events: every blocked request (and CSP report) is described by one object and handed to `security.onEvent`.
// The hook is fire-and-forget: it can be async, and it can never break or slow down the request.

/** @typedef {"url-too-long"|"method"|"host"|"ip-denied"|"csrf"|"rate-limit"|"probe"|"csp-report"} SecurityEventType */

export function createEmitter(onEvent) {
  if (typeof onEvent !== "function") return () => {};
  return (type, req, extra = {}) => {
    const event = { type, at: Date.now(), requestId: req.requestId, method: req.method, path: String(req.url ?? "").split("?")[0], ...extra };
    try {
      const r = onEvent(event);
      if (r && typeof r.catch === "function") r.catch((e) => console.error("[nepx] security.onEvent failed:", e && e.message));
    } catch (e) { console.error("[nepx] security.onEvent failed:", e && e.message); }
  };
}
