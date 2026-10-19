// What we know about the connection: who is calling, over what, and what they want back.

/** Client IP. X-Forwarded-For is only trusted for the configured number of proxy hops, counted from the right (not spoofable). */
export function clientIp(req, trustProxy) {
  const remote = normalizeIp(req.socket?.remoteAddress ?? "unknown");
  if (!trustProxy) return remote;
  const hops = trustProxy === true ? 1 : trustProxy;
  const list = String(req.headers["x-forwarded-for"] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return list.length ? normalizeIp(list[Math.max(0, list.length - hops)]) : remote;
}

/** "::ffff:1.2.3.4" (IPv4 over a dual-stack socket) -> "1.2.3.4". */
export const normalizeIp = (ip) => (/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1] ?? ip);

export function isSecure(req, trustProxy) {
  if (req.socket?.encrypted) return true;
  return !!trustProxy && String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim().toLowerCase() === "https";
}

/** Browsers navigating (not fetch/curl) get HTML error pages. */
export const wantsHtml = (req) => (req.method === "GET" || req.method === "HEAD") && /text\/html/.test(String(req.headers.accept ?? ""));

/** Path part of the raw request target (still percent-encoded). */
export const rawPath = (target) => String(target).split("?")[0];

/** An inbound X-Request-Id is only honoured behind a trusted proxy, and only when it is a harmless token. */
export function inboundRequestId(req, trustProxy) {
  const v = req.headers["x-request-id"];
  return trustProxy && typeof v === "string" && /^[A-Za-z0-9._-]{8,64}$/.test(v) ? v : null;
}
