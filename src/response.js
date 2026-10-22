// NepxResponse: the familiar Response helpers on top of the standard Response (route handlers, middleware).
import { serializeCookie } from "./request-context.js";
import { next as nextResponse, rewrite as rewriteResponse } from "./shared.js";
import { parseCookies } from "./server/http-utils.js";

const JSON_TYPE = "application/json; charset=utf-8";

class ResponseCookies {
  #headers;
  constructor(headers) { this.#headers = headers; }
  /** Add a Set-Cookie header. Default: Path=/. Returns the jar so calls chain. */
  set(name, value, options) { this.#headers.append("set-cookie", serializeCookie(name, value, options)); return this; }
  /** Expire a cookie in the browser. */
  delete(name, options) { this.#headers.append("set-cookie", serializeCookie(name, "", { ...options, maxAge: 0, expires: new Date(0) })); return this; }
}

export class NepxResponse extends Response {
  #cookies;
  /** Cookies this response sets: res.cookies.set("theme", "dark", { maxAge: 3600 }). */
  get cookies() { return (this.#cookies ??= new ResponseCookies(this.headers)); }

  /** JSON body with the right content-type: NepxResponse.json({ ok: true }, { status: 201 }). */
  static json(data, init = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("content-type")) headers.set("content-type", JSON_TYPE);
    const body = JSON.stringify(data);
    if (body === undefined) throw new TypeError("NepxResponse.json(): value is not JSON-serializable");
    return new NepxResponse(body, { ...init, headers });
  }

  /** Redirect to an absolute URL or a path (unlike Response.redirect, relative paths are fine). Default status 307. */
  static redirect(destination, init = 307) {
    const opts = typeof init === "number" ? { status: init } : init;
    const status = opts.status ?? 307;
    if (![301, 302, 303, 307, 308].includes(status)) throw new RangeError("NepxResponse.redirect(): status must be 301, 302, 303, 307 or 308");
    const headers = new Headers(opts.headers);
    headers.set("location", String(destination));
    return new NepxResponse(null, { ...opts, status, headers });
  }

  /** Continue the request, optionally adding response headers. Middleware only. */
  static next(init) { return nextResponse(init); }

  /** Serve another route at the current URL. Middleware only. */
  static rewrite(destination) { return rewriteResponse(destination); }
}

/**
 * NepxRequest (legacy alias: NextRequest): a Request with `nepxUrl` and `cookies` - handy for unit-testing route handlers and
 * middleware (`new NepxRequest("http://x/a?b=1", { headers: { cookie: "a=1" } })`). The server hands handlers the same shape.
 */
export class NepxRequest extends Request {
  #url; #jar;
  constructor(input, init) {
    super(input, init);
    this.#url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  }
  /** The parsed URL: request.nepxUrl.searchParams.get("q"). */
  get nepxUrl() { return this.#url; }
  /** @deprecated legacy name of `nepxUrl`. */
  get nextUrl() { return this.#url; }
  get cookies() {
    if (!this.#jar) {
      const all = parseCookies(this.headers.get("cookie"));
      this.#jar = {
        get: (n) => (Object.hasOwn(all, n) ? { name: n, value: all[n] } : undefined),
        getAll: () => Object.entries(all).map(([name, value]) => ({ name, value })),
        has: (n) => Object.hasOwn(all, n),
      };
    }
    return this.#jar;
  }
}
