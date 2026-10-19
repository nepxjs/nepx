import http from "node:http";
import { plainStatusHtml } from "../errors/index.js";
import { renderDocument } from "../ssr.js";
import { wantsHtml } from "../security/index.js";
import { API_PATH, MIME, jsonResponse } from "./http-utils.js";

/**
 * Error responses with content negotiation: browsers (Accept: text/html) get the status page, everything else
 * (fetch, curl, /api/*, /_nepx/*) gets JSON. Without a renderer (API-only server) or when rendering fails, the
 * dependency-free page is used, so an error page can never itself fail.
 *
 *   respond(req, url, status, { json, message, digest, retryAfter, extra })
 *     json:    the `error` string for JSON clients (default: the reason phrase)
 *     message: text safe to show on the page (already filtered by publicMessage)
 *     digest:  request id, shown on 5xx pages and returned as `requestId`
 *     extra:   response headers (Retry-After, Allow, WWW-Authenticate ...)
 */
export function createErrorResponder({ renderer, refs, dev, basePath = "" }) {
  return async function respond(req, url, status, { json, message, digest, retryAfter = null, extra = {} } = {}) {
    const vary = { vary: "Accept" };
    if (!wantsHtml(req) || API_PATH.test(url.pathname)) {
      return jsonResponse(status, { error: json ?? message ?? http.STATUS_CODES[status] ?? "Error", ...(digest ? { requestId: digest } : {}) }, { ...vary, ...extra });
    }
    let html = null;
    if (renderer) {
      try {
        const v = await renderer.renderStatus(status, url, { message, digest, retryAfter });
        html = renderDocument({ html: v.html, metadata: v.metadata, boot: null, refs, dev, basePath });
      } catch (e) { console.error(`[${digest ?? req.requestId}] status page ${status} failed:`, e && e.message); }
    }
    return new Response(html ?? plainStatusHtml(status, message), { status, headers: { "content-type": MIME[".html"], "cache-control": "no-store", ...vary, ...extra } });
  };
}
