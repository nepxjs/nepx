// The security pipeline: one object per server that inspects every request before routing.
import { clientIp, isSecure, rawPath, inboundRequestId } from "./client.js";
import { createEmitter } from "./events.js";
import { securityHeaders } from "./headers.js";
import { GUARDS } from "./guards/index.js";
import { RateLimiter } from "./rate-limit/index.js";

/**
 * @param sec  resolved config (resolveSecurity)
 * @returns {{ inspect(req): Promise<{ ip: string, headers: object, violation: object|null }>, emit: Function, isProbe: Function|null, close(): void }}
 */
export function createSecurity(sec, { dev = false } = {}) {
  const limiter = sec.rateLimit ? new RateLimiter(sec.rateLimit) : null;
  const emit = createEmitter(sec.onEvent);

  async function inspect(req) {
    const ip = clientIp(req, sec.trustProxy);
    const headers = securityHeaders(sec, { dev, secure: isSecure(req, sec.trustProxy) });
    let violation = null;
    if (!req.url || !req.url.startsWith("/")) violation = { type: "url-too-long", status: 400, message: "Bad request target" };
    else {
      const ctx = { req, sec, dev, ip, pathname: rawPath(req.url), limiter, headers };
      for (const guard of GUARDS) { violation = await guard(ctx); if (violation) break; }
    }
    if (violation) emit(violation.type, req, { status: violation.status, ip, ...violation.detail });
    return { ip, headers, violation };
  }

  return { inspect, emit, isProbe: sec.isProbe, requestId: (req) => inboundRequestId(req, sec.trustProxy), close() { limiter?.close(); } };
}
