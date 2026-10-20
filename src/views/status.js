import { STATUS_CSS } from "./styles.js";

/** "30 seconds", "2 minutes": a Retry-After value in words. */
export function formatWait(seconds) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const m = Math.ceil(seconds / 60);
  return m < 60 ? `${m} minute${m === 1 ? "" : "s"}` : `${Math.ceil(m / 60)} hour${Math.ceil(m / 60) === 1 ? "" : "s"}`;
}

/** Status-specific call to action: a plain link to the same address (no javascript: URLs, CSP + React reject them). */
export function statusAction(status, url, retryable) {
  return retryable && url ? { href: url, label: "Try again" } : null;
}

/**
 * Built-in page for every status except 404 (a project's own app/<status>.jsx always wins).
 * Props: { status, title, message, digest, url, retryable, retryAfter }.
 */
export function defaultStatusView(h, { status, title, message, digest, url, retryable = false, retryAfter = null }) {
  const action = statusAction(status, url, retryable);
  return h("main", { className: "nepx-err", role: "alert" },
    h("style", { dangerouslySetInnerHTML: { __html: STATUS_CSS } }),
    h("h1", null, String(status)),
    h("h2", null, title),
    h("p", null, message),
    retryAfter ? h("p", { className: "hint" }, `You can try again in ${formatWait(retryAfter)}.`) : null,
    digest ? h("small", null, `Reference: ${digest}`) : null,
    h("div", { className: "row" },
      action ? h("a", { href: action.href, className: "primary" }, action.label) : null,
      h("a", { href: "/", className: action ? "" : "primary" }, "Back to home")));
}
