import { statusInfo } from "./status-codes.js";

/** Digest shared by every HTTP error, so it is recognised across module instances (server vs. browser bundle). */
export const HTTP_ERROR = "NEPX_HTTP_ERROR";

/**
 * An error that maps to an HTTP status page / JSON body.
 *  - headers: extra response headers (Retry-After, WWW-Authenticate, Allow ...)
 *  - expose:  whether `message` may be shown to the client (default: true when a message was passed explicitly)
 *  - cause:   the underlying error, kept for logs, never sent
 */
export class HttpError extends Error {
  /** @param {number} status @param {string} [message] @param {{ headers?: Record<string,string>, expose?: boolean, cause?: unknown }} [init] */
  constructor(status, message, init = {}) {
    super(message ?? statusInfo(status).title, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = "HttpError";
    this.status = status;
    this.digest = HTTP_ERROR;
    this.headers = init.headers ?? {};
    this.expose = init.expose ?? message !== undefined;
  }

  /** Seconds from a Retry-After header (numeric form only), or null. */
  get retryAfter() {
    const v = Object.entries(this.headers).find(([k]) => k.toLowerCase() === "retry-after")?.[1];
    const n = Number(v);
    return v !== undefined && Number.isFinite(n) && n >= 0 ? Math.ceil(n) : null;
  }

  toJSON() { return { status: this.status, error: this.message }; }
}

export class NepxError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "NepxError";
    this.exitCode = exitCode;
  }
}

/** Anything thrown with a numeric `status` and the HttpError digest (HttpError, forbidden(), unauthorized(), httpError()). */
export const isHttpError = (e) => !!e && e.digest === HTTP_ERROR && Number.isInteger(e.status) && e.status >= 400 && e.status <= 599;

/** The text a client may see for an error: only what the code that threw it marked as safe. */
export function publicMessage(err) {
  if (!isHttpError(err) || err.expose === false) return undefined;
  return err.message && err.message !== statusInfo(err.status).title ? err.message : undefined;
}
