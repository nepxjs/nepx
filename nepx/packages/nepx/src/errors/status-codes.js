/** Human copy for every status Nepx can show a page for: [short title, what happened / what to do]. */
const COPY = {
  400: ["Bad request", "The request could not be understood. Check the address and try again."],
  401: ["Sign in required", "You need to sign in to see this page."],
  402: ["Payment required", "This content requires a payment or an active plan."],
  403: ["Access denied", "You do not have permission to open this page."],
  404: ["Page not found", "This page could not be found."],
  405: ["Method not allowed", "This address does not accept that kind of request."],
  406: ["Not acceptable", "This address cannot respond in a format your browser accepts."],
  408: ["Request timeout", "The request took too long to arrive. Please try again."],
  409: ["Conflict", "The request conflicts with the current state of this page. Reload and try again."],
  410: ["Gone", "This page has been permanently removed."],
  411: ["Length required", "The request must declare the size of its body."],
  413: ["Request too large", "The data you sent is larger than this server accepts."],
  414: ["Address too long", "The address you opened is too long to process."],
  415: ["Unsupported media type", "The server does not accept this kind of content."],
  421: ["Misdirected request", "This server is not set up to answer for that host name."],
  422: ["Unprocessable request", "The request was understood, but the data in it is not valid."],
  423: ["Locked", "This resource is locked right now."],
  429: ["Too many requests", "You are sending requests too quickly. Wait a moment and try again."],
  431: ["Request headers too large", "The request headers are too large. Clearing your cookies may help."],
  451: ["Unavailable for legal reasons", "This content is not available for legal reasons."],
  500: ["Something went wrong", "An unexpected error occurred on the server. Please try again."],
  501: ["Not implemented", "The server does not support what this request asks for."],
  502: ["Bad gateway", "The server received an invalid answer from an upstream service."],
  503: ["Service unavailable", "The service is temporarily unavailable. Please try again shortly."],
  504: ["Gateway timeout", "An upstream service took too long to answer. Please try again."],
  505: ["HTTP version not supported", "The server does not support the HTTP version of this request."],
  507: ["Insufficient storage", "The server has no room left to complete this request."],
  508: ["Loop detected", "The server stopped a request that kept repeating itself."],
};

/** Statuses where trying the same request again later can succeed. */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/** -> { status, title, message, kind, retryable } (unknown codes fall back to a generic client / server error). */
export function statusInfo(status) {
  const kind = status >= 500 ? "server" : "client";
  const hit = COPY[status];
  if (hit) return { status, title: hit[0], message: hit[1], kind, retryable: RETRYABLE.has(status) };
  return kind === "server"
    ? { status, title: "Server error", message: "The server could not complete this request.", kind, retryable: false }
    : { status, title: "Request error", message: "The request could not be completed.", kind, retryable: false };
}

/** Statuses that may be provided as app/<status>.jsx (404 is not-found.jsx). */
export const PAGE_STATUSES = Object.keys(COPY).map(Number).filter((s) => s !== 404);
export const isPageStatus = (s) => PAGE_STATUSES.includes(s);
