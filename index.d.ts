// Type declarations for "nepx" (TypeScript is compiled by Nepx, not type-checked).
import type { AnchorHTMLAttributes, ReactNode, Ref } from "react";

/** Filled by the generated nepx-routes.d.ts when `typedRoutes: true`; empty means any string is accepted. */
export interface NepxTypedRoutes {}
type RouteKeys = Extract<keyof NepxTypedRoutes, string>;
/** A route of your app (when typedRoutes is on), plus ?query / #hash and external URLs. Any string otherwise. */
export type Route = [RouteKeys] extends [never] ? string : RouteKeys;
export type HrefString = [RouteKeys] extends [never] ? string : RouteKeys | `${RouteKeys}?${string}` | `${RouteKeys}#${string}` | `#${string}` | `?${string}` | `http://${string}` | `https://${string}` | `mailto:${string}` | `tel:${string}`;
/** next/link URL object: `[id]` / `[...slug]` in pathname are filled from query; other query keys become the search string. */
export interface UrlObject { pathname?: string; query?: string | Record<string, string | number | boolean | readonly (string | number | boolean)[] | null | undefined>; search?: string; hash?: string }
export type Href = HrefString | UrlObject;
export function formatHref(href: Href | URL): string;
export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: Href;
  /** Replace the history entry instead of pushing a new one. */
  replace?: boolean;
  /** Links prefetch on hover/focus/touch (and when visible in production). `false` turns it off; `true` also prefetches pages that use getServerSideProps. */
  prefetch?: boolean;
  /** config.i18n: switch to this locale ("id"), or `false` to leave the href exactly as written. Default: keep the current locale. */
  locale?: string | false;
  /** `false` keeps the scroll position after the navigation (default: scroll to the top). */
  scroll?: boolean;
  /** Runs before a client-side navigation; call `e.preventDefault()` to cancel it. */
  onNavigate?: (e: { preventDefault(): void }) => void;
  ref?: Ref<HTMLAnchorElement>;
  children?: ReactNode;
}
export function Link(props: LinkProps): JSX.Element;
export function navigate(href: Href, options?: { replace?: boolean; locale?: string | false; scroll?: boolean }): void;
export function usePathname(): string;
export function useSearchParams(): URLSearchParams;
export function useParams<T extends Record<string, string | string[]> = Record<string, string | string[]>>(): T;
export interface Router {
  /** config.i18n: the current locale, the configured ones and the default (all null when i18n is off). */
  locale: string | null;
  locales: string[] | null;
  defaultLocale: string | null;
  push(href: Href, options?: { locale?: string | false; scroll?: boolean }): void;
  replace(href: Href, options?: { locale?: string | false; scroll?: boolean }): void;
  back(): void;
  forward(): void;
  /** Warm the data of a page (also runs getServerSideProps). */
  prefetch(href: Href): void;
  /** Re-run middleware, getServerSideProps and generateMetadata for the current page without a reload. */
  refresh(): void;
  /** Pages-Router style fields (next/router). `query` = route params + search params. */
  pathname: string;
  route: string;
  query: Record<string, string | string[] | undefined>;
  asPath: string;
  basePath: string;
  isReady: boolean;
  isFallback: boolean;
  isPreview: boolean;
  events: RouterEvents;
  reload(): void;
  beforePopState(cb: unknown): void;
}
export interface RouterEvents {
  on(event: "routeChangeStart" | "routeChangeComplete" | "routeChangeError" | "hashChangeStart" | "hashChangeComplete", handler: (url: string, info?: { shallow: boolean }) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
}
type UrlObject = string | { pathname?: string; query?: Record<string, string | number | string[]>; hash?: string };
export function useRouter(): Router;
/** The singleton router (next/router `Router`); browser only - on the server it throws. */
export const Router: {
  push(url: UrlObject, as?: string | { scroll?: boolean; locale?: string | false }, options?: { scroll?: boolean; locale?: string | false }): Promise<boolean>;
  replace(url: UrlObject, as?: string | { scroll?: boolean; locale?: string | false }, options?: { scroll?: boolean; locale?: string | false }): Promise<boolean>;
  back(): void; forward(): void; reload(): void; refresh(): void;
  prefetch(url: string): Promise<void>;
  events: RouterEvents;
  readonly pathname: string; readonly asPath: string; readonly query: Record<string, string | string[] | undefined>;
};
/** Gives a component the `router` prop (what useRouter() returns). */
export function withRouter<P extends object>(Component: (props: P & { router: Router }) => ReactNode | Promise<ReactNode>): (props: Omit<P, "router">) => ReactNode;
/** next/head: tags written into the document <head> from any component (server: in the HTML; browser: added on mount, removed on unmount). */
export function Head(props: { children?: ReactNode }): null;
/** AMP is not supported: always false. */
export function useAmp(): false;
export function isInAmpMode(): false;
/** next/error: the plain status page. */
export function ErrorPage(props: { statusCode?: number; title?: string; withDarkMode?: boolean }): ReactNode;
/** @deprecated use ErrorPage. */
export { ErrorPage as NextError };
/** next/legacy/image: `layout` / `objectFit` props mapped onto <Image>. */
export function LegacyImage(props: ImageProps & { layout?: "fill" | "fixed" | "intrinsic" | "responsive"; objectFit?: string; objectPosition?: string; lazyBoundary?: string; lazyRoot?: unknown }): ReactNode;
/** next/constants */
export const PHASE_EXPORT: "phase-export";
export const PHASE_PRODUCTION_BUILD: "phase-production-build";
export const PHASE_PRODUCTION_SERVER: "phase-production-server";
export const PHASE_DEVELOPMENT_SERVER: "phase-development-server";
export const PHASE_TEST: "phase-test";
/** The phase this process is in (`NEPX_PHASE`, else derived from NODE_ENV). */
export function currentPhase(): string;
/** Inside a <Link>'s children: `pending` is true from the click until the next page has loaded. Outside a Link it is always false. */
export function useLinkStatus(): { pending: boolean };
/** config.i18n: the current locale, e.g. "id" (null when i18n is off). Works while rendering on the server and in the browser. */
export function useLocale(): string | null;
/** config.i18n, server only (route handlers, middleware, server rendering): the locale of the current request; the default locale outside a request. */
export function getLocale(): string | null;
/** Add markup to the <head> of the server-rendered page (CSS-in-JS, inline scripts). Runs once the shell has rendered; does nothing in the browser. Guard against duplicates: components can render more than once. */
export function useServerInsertedHTML(callback: () => ReactNode): void;

export interface ResponseCookieOptions {
  path?: string; domain?: string; maxAge?: number; expires?: Date;
  httpOnly?: boolean; secure?: boolean; sameSite?: "lax" | "strict" | "none";
}
export interface ResponseCookies {
  /** Add a Set-Cookie header. Returns the jar so calls chain. */
  set(name: string, value: string, options?: ResponseCookieOptions): ResponseCookies;
  /** Expire a cookie in the browser. */
  delete(name: string, options?: Pick<ResponseCookieOptions, "path" | "domain">): ResponseCookies;
}
/** A Response with Response helpers (route handlers, middleware). */
export class NepxResponse extends Response {
  readonly cookies: ResponseCookies;
  static json(data: unknown, init?: ResponseInit): NepxResponse;
  /** Absolute URL or path. Default status 307. */
  static redirect(destination: string | URL, init?: number | ResponseInit): NepxResponse;
  /** Continue the request, optionally adding response headers. Middleware only. */
  static next(init?: { headers?: HeadersInit }): Response;
  /** Serve another route at the current URL. Middleware only. */
  static rewrite(destination: string): Response;
}

/** A redirect Response (route handlers, middleware). The second argument may also be a `RedirectType` (accepted for Next.js compatibility; always 307). */
export function redirect(destination: string | URL, status?: 301 | 302 | 303 | 307 | 308 | RedirectType): Response;
/** next/navigation's RedirectType. */
export type RedirectType = "push" | "replace";
export const RedirectType: { readonly push: "push"; readonly replace: "replace" };
/** next/navigation's ReadonlyURLSearchParams: append / delete / set / sort throw. */
export class ReadonlyURLSearchParams extends URLSearchParams {}
/** @deprecated use NepxResponse. */
export const NextResponse: typeof NepxResponse;
/** A Request with `nepxUrl` and `cookies` (e.g. to unit-test route handlers and middleware). */
export class NepxRequest extends Request {
  constructor(input: string | URL | Request, init?: RequestInit);
  readonly nepxUrl: URL;
  /** @deprecated use `nepxUrl`. */
  readonly nextUrl: URL;
  readonly cookies: { get(name: string): { name: string; value: string } | undefined; getAll(): Array<{ name: string; value: string }>; has(name: string): boolean };
}
/** @deprecated use NepxRequest. */
export const NextRequest: typeof NepxRequest;
/** Next.js' older name for after(). */
export function unstable_after(fn: () => void | Promise<void>): void;
/** Like revalidateTag / revalidatePath (entries are dropped immediately). */
export function unstable_expireTag(...tags: string[]): void;
export function unstable_expirePath(path: string, type?: "page" | "layout"): void;
/** Stop rendering and show the nearest not-found page (404). Also works in route handlers (JSON 404). */
export function notFound(): never;
/** Middleware: continue to the route, optionally adding response headers. */
export function next(init?: { headers?: HeadersInit }): Response;
/** Middleware: serve another route's content at the current URL. */
export function rewrite(destination: string): Response;

export interface RequestCookie { name: string; value: string }
/** Cookies of the current request. Server only; makes the page dynamic (never prerendered or cached). */
export interface CookieOptions { path?: string; domain?: string; maxAge?: number; expires?: Date | number | string; httpOnly?: boolean; secure?: boolean; sameSite?: "lax" | "strict" | "none" }
export interface RequestCookies {
  get(name: string): RequestCookie | undefined; getAll(): RequestCookie[]; has(name: string): boolean; toString(): string;
  /** Add a Set-Cookie header to the response (route handlers, middleware, Server Actions). Defaults: Path=/. */
  set(name: string, value: string, options?: CookieOptions): RequestCookies;
  set(cookie: { name: string; value: string } & CookieOptions): RequestCookies;
  /** Expire a cookie in the browser. */
  delete(name: string, options?: Pick<CookieOptions, "path" | "domain">): RequestCookies;
}
export function cookies(): RequestCookies;
/** Headers of the current request. Server only; makes the page dynamic (never prerendered or cached). */
export function headers(): Headers;
/** Drop the cached copy of a page that uses `export const revalidate`. type "layout" also drops everything below the path. */
export function revalidatePath(path: string, type?: "page" | "layout"): void;
/** Drop every `unstable_cache` entry and every ISR page carrying the tag (page `export const tags = [...]` or `cacheTag()`). Memory only: per process. */
export function revalidateTag(tag: string, profile?: unknown): void;
/** Like revalidateTag, for Server Actions that must read their own write. */
export function updateTag(tag: string): void;
/** Inside a Server Action: re-render the current page in the browser without dropping any cache. */
export function refresh(): void;
/** Memoize an async function. Key = keyParts + JSON arguments; `revalidate` in seconds (omit: until revalidateTag); errors are not cached. */
export function unstable_cache<A extends unknown[], R>(fn: (...args: A) => Promise<R> | R, keyParts?: string[], options?: { revalidate?: number | false; tags?: string[] }): (...args: A) => Promise<R>;
/** Tag the page being rendered so `revalidateTag(tag)` drops its ISR copy. No-op while prerendering. */
export function cacheTag(...tags: string[]): void;
/** Same as `cacheTag` (Next.js' `unstable_cacheTag`). Inside a "use cache" function the tags belong to the cache entry. */
export function unstable_cacheTag(...tags: string[]): void;
/**
 * Lifetime of the surrounding "use cache" result: a profile name or `{ stale, revalidate, expire }` in seconds (the shortest call wins).
 * Profiles: default (15m), seconds, minutes, hours, days, weeks, max. Only valid inside a "use cache" function.
 *
 * The "use cache" directive: at the top of a file every exported async function is cached; as the first statement of an `async function`
 * or `const f = async () => {}` that function is. Key = function + arguments (primitives, arrays, plain objects, Dates; other arguments skip the cache).
 */
export function cacheLife(profile?: "default" | "seconds" | "minutes" | "hours" | "days" | "weeks" | "max" | { stale?: number; revalidate?: number; expire?: number }): void;
export const unstable_cacheLife: typeof cacheLife;
/** next/og: a JSX tree rendered to an image. Return it from a route handler or from app/opengraph-image.jsx, icon.jsx, apple-icon.jsx, twitter-image.jsx. */
export class ImageResponse extends Response {
  constructor(element: ReactNode, options?: { width?: number; height?: number; format?: "png" | "jpeg" | "webp" | "svg"; fonts?: { name: string; data: ArrayBuffer | Buffer; weight?: number; style?: "normal" | "italic" }[]; fontFamily?: string; debug?: boolean; status?: number; statusText?: string; headers?: HeadersInit });
}
/** Draft mode: a signed cookie makes pages render per request (never prerendered / ISR-cached, `private, no-store`). Set NEPX_DRAFT_SECRET to share the signature between processes. */
export function draftMode(): { readonly isEnabled: boolean; enable(): void; disable(): void };
/** Run a callback after the response has been sent. Errors are logged only. */
export function after(fn: () => void | Promise<void>): void;
/** `await connection()` makes the page dynamic (never prerendered or ISR-cached). */
export function connection(): Promise<void>;
/** Opt the current render out of prerendering / ISR caching. */
export function unstable_noStore(): void;
/** A 308 redirect Response (route handlers, middleware). */
export function permanentRedirect(destination: string | URL): Response;

/** instrumentation.js (next to app/ or in src/). */
export interface InstrumentationRequest { path: string; method: string; headers: Record<string, string> }
export interface InstrumentationContext { routerKind: "App Router"; routePath: string | null; routeType: "render" | "route" | "middleware" | "action"; requestId: string }
export type OnRequestError = (error: unknown, request: InstrumentationRequest, context: InstrumentationContext) => void | Promise<void>;

/** Route segment config exported from a page. */
export type DynamicMode = "auto" | "force-dynamic" | "force-static";
/** Page export `dynamicParams`: `false` serves only the params returned by `generateStaticParams` (everything else is a 404). Default `true`. */
export type DynamicParams = boolean;
export interface Viewport {
  width?: string | number; height?: string | number; initialScale?: number; minimumScale?: number; maximumScale?: number; userScalable?: boolean;
  viewportFit?: "auto" | "cover" | "contain"; interactiveWidget?: "resizes-visual" | "resizes-content" | "overlays-content";
  themeColor?: string | Array<string | { color: string; media?: string }>; colorScheme?: string;
}

export class HttpError extends Error {
  status: number;
  /** Extra response headers (Retry-After, WWW-Authenticate, ...). */
  headers: Record<string, string>;
  /** May `message` be shown to the client? */
  expose: boolean;
  /** Seconds from a numeric Retry-After header, else null. */
  readonly retryAfter: number | null;
  constructor(status: number, message?: string, init?: StatusInit);
  toJSON(): { status: number; error: string };
}
export interface StatusInit {
  /** Extra response headers (Retry-After, WWW-Authenticate ...). */
  headers?: Record<string, string>;
  /** Show `message` to the client? Default: true when a message was passed. */
  expose?: boolean;
  /** The underlying error: kept for logs, never sent. */
  cause?: unknown;
}
/** Stop and show the 401 page (app/401.jsx or the built-in one). Pages, layouts, getServerSideProps, middleware, route handlers (JSON). */
export function unauthorized(message?: string, init?: StatusInit): never;
/** Stop and show the 403 page (app/403.jsx or the built-in one). */
export function forbidden(message?: string, init?: StatusInit): never;
/** Stop and show the page for any 4xx / 5xx status, e.g. httpError(429, "Slow down", { headers: { "retry-after": "30" } }). */
export function httpError(status: number, message?: string, init?: StatusInit): never;
/** Props of app/<status>.jsx (401, 403, 429, 503 ...): default-export a component that takes these. */
export interface StatusPageProps { status: number; title: string; message: string; /** request id, only for 5xx */ digest?: string; /** the address that failed, e.g. "/x?y=1" */ url: string; /** trying again later can work (408, 429, 5xx gateway errors) */ retryable: boolean; /** seconds, from a numeric Retry-After header */ retryAfter: number | null }

// ---- shapes of what your files export ----
type MetaUrl = string | URL;
type MetaIcon = MetaUrl | { url: MetaUrl; type?: string; sizes?: string; media?: string; rel?: string; color?: string };
export interface RobotsInfo { index?: boolean; follow?: boolean; noarchive?: boolean; nosnippet?: boolean; noimageindex?: boolean; notranslate?: boolean; nocache?: boolean; maxSnippet?: number; maxImagePreview?: "none" | "standard" | "large"; maxVideoPreview?: number | string; googleBot?: string | RobotsInfo }
export interface Metadata {
  title?: string | { default?: string; template?: string; absolute?: string };
  description?: string;
  /** Relative URLs in canonical, alternates, icons, manifest, openGraph and twitter are resolved against this. */
  metadataBase?: MetaUrl | null;
  applicationName?: string;
  authors?: string | { name?: string; url?: MetaUrl } | Array<string | { name?: string; url?: MetaUrl }>;
  creator?: string; publisher?: string; generator?: string; referrer?: string; category?: string; classification?: string;
  keywords?: string | string[];
  robots?: string | RobotsInfo;
  themeColor?: string;
  manifest?: MetaUrl;
  formatDetection?: { telephone?: boolean; date?: boolean; address?: boolean; email?: boolean; url?: boolean };
  verification?: { google?: string | string[]; yahoo?: string | string[]; yandex?: string | string[]; me?: string | string[]; other?: Record<string, string | string[]> };
  alternates?: { canonical?: MetaUrl; languages?: Record<string, MetaUrl>; media?: Record<string, MetaUrl>; types?: Record<string, MetaUrl | MetaUrl[]> };
  icons?: MetaUrl | MetaIcon[] | { icon?: MetaIcon | MetaIcon[]; shortcut?: MetaIcon | MetaIcon[]; apple?: MetaIcon | MetaIcon[]; other?: MetaIcon | MetaIcon[] };
  bookmarks?: MetaUrl | MetaUrl[]; archives?: MetaUrl | MetaUrl[]; assets?: MetaUrl | MetaUrl[];
  itunes?: { appId: string; appArgument?: string };
  appleWebApp?: boolean | { capable?: boolean; title?: string; statusBarStyle?: "default" | "black" | "black-translucent"; startupImage?: MetaUrl | Array<MetaUrl | { url: MetaUrl; media?: string }> };
  appLinks?: Record<string, Record<string, unknown> | Array<Record<string, unknown>>>;
  openGraph?: Record<string, unknown>;
  twitter?: Record<string, unknown>;
  /** Any other <meta name="..."> tag: { "my-tag": "value" } (arrays repeat the tag). */
  other?: Record<string, string | number | Array<string | number>>;
}
/** `searchParams` is a URLSearchParams that is also a plain-object view of the query (`const { q } = await searchParams`; a repeated key gives an array). */
export type SearchParams = URLSearchParams & { [key: string]: any };
export interface PageProps<P extends Record<string, string | string[]> = Record<string, string | string[]>> { params: P; searchParams: SearchParams }
export interface ErrorProps { error: { message: string; digest?: string }; reset: () => void }
export interface RouteContext { params: Record<string, string | string[]>; url: URL; cookies: Record<string, string>; requestId: string }
/** The request a route handler receives: a standard Request plus Request conveniences. */
export interface NepxRequest extends Request {
  json(): Promise<any>;
  /** The parsed URL (same as ctx.url): request.nepxUrl.searchParams.get("q"). */
  readonly nepxUrl: URL;
  /** @deprecated use `nepxUrl`. */
  readonly nextUrl: URL;
  readonly cookies: {
    get(name: string): { name: string; value: string } | undefined;
    getAll(): Array<{ name: string; value: string }>;
    has(name: string): boolean;
  };
}
export type RouteHandler = (request: NepxRequest, ctx: RouteContext) => Response | Promise<Response>;
export interface GetServerSidePropsContext { params: Record<string, string | string[]>; searchParams: URLSearchParams; request: Request; cookies: Record<string, string>; requestId: string }
/** Page export `getStaticProps` (Pages-Router style): the page is prerendered at build time; props reach the component like getServerSideProps. Use `export const revalidate = N` for ISR. */
export interface GetStaticPropsContext { params: Record<string, string | string[]>; locale?: string; draftMode: boolean }
export type GetStaticPropsResult<P> = ({ props: P } | { notFound: true } | { redirect: { destination: string; permanent?: boolean; statusCode?: number } }) & { /** seconds the prerendered page stays fresh, or false = until revalidated */ revalidate?: number | false };
export type GetStaticProps<P = Record<string, unknown>> = (ctx: GetStaticPropsContext) => Promise<GetStaticPropsResult<P>> | GetStaticPropsResult<P>;
/** Page export `getStaticPaths`: which params to prerender. `fallback: false` makes every other URL a 404; `true` / "blocking" render them on demand. */
export interface GetStaticPathsResult { paths: Array<string | { params: Record<string, string | string[]> }>; fallback?: boolean | "blocking" }
export type GetStaticPaths = () => Promise<GetStaticPathsResult> | GetStaticPathsResult;
export type GetServerSidePropsResult<P> = { props: P } | { notFound: true } | { redirect: { destination: string; permanent?: boolean; statusCode?: number } };
export type SecurityEventType = "url-too-long" | "method" | "host" | "ip-denied" | "csrf" | "rate-limit" | "probe" | "csp-report";
export interface SecurityEvent {
  type: SecurityEventType; at: number; requestId?: string; method: string; path: string; ip?: string; status?: number;
  /** extras per type: rule (rate-limit), origin (csrf), host (host), blockedUri / violatedDirective / documentUri (csp-report) ... */
  [detail: string]: unknown;
}
/** Anything with get / set (sync or async) can back the rate limiter, e.g. Redis. state is plain JSON. */
export interface RateLimitStore {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, state: unknown, ttlMs: number): void | Promise<void>;
  close?(): void;
}
export interface RateLimitOptions {
  windowMs?: number; max?: number;
  /** fixed (default): cheap; sliding: smooths the window boundary; token-bucket: continuous refill, `burst` = bucket size. */
  algorithm?: "fixed" | "sliding" | "token-bucket";
  burst?: number;
  store?: RateLimitStore;
  /** What a client is: default its IP. e.g. (req) => req.headers["x-api-key"] */
  keyGenerator?: (req: import("node:http").IncomingMessage, ip: string) => string;
  /** Requests to leave alone, e.g. health checks. */
  skip?: (req: import("node:http").IncomingMessage, pathname: string) => boolean;
  /** Per-path overrides (windowMs, max, algorithm, burst fall back to the top-level values). */
  rules?: { source: string; windowMs?: number; max?: number; algorithm?: "fixed" | "sliding" | "token-bucket"; burst?: number }[];
}
export interface SecurityConfig {
  /** Security headers (X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP ...). false = none; an object overrides single headers (null removes one). Default true. */
  headers?: boolean | Record<string, string | null | false>;
  /** Strict-Transport-Security, production + HTTPS only. Default true. */
  hsts?: boolean | { maxAge?: number; includeSubDomains?: boolean; preload?: boolean };
  /** true = strict preset (production only), string / object = your own policy. Default false (opt in: it can block third-party scripts, fonts, images). */
  contentSecurityPolicy?: boolean | string | Record<string, string | string[] | boolean | null>;
  /** Block cross-site unsafe requests that carry cookies (Origin check). Default true. */
  csrf?: boolean;
  /** Extra origins the CSRF check accepts, e.g. ["https://app.example.com"]. */
  allowedOrigins?: string[];
  /** Accepted Host headers, e.g. ["example.com", ".example.com"] (others get 421). Default: any. */
  allowedHosts?: string[] | null;
  /** Behind a reverse proxy: true (1 hop) or a number of hops, to read the client IP / protocol from X-Forwarded-*. Default false. */
  trustProxy?: boolean | number;
  /** Send the policy as Content-Security-Policy-Report-Only. */
  cspReportOnly?: boolean;
  /** true = built-in collector at POST /_nepx/csp-report (emits "csp-report" events); a string = your own report-uri. */
  cspReport?: boolean | string;
  /** IP allow / deny lists (IPs or CIDR). deny wins; with an allow list everything else is refused; a matching rule replaces the global lists for its paths. */
  ipAccess?: { allow?: string[]; deny?: string[]; rules?: { source: string; allow?: string[]; deny?: string[] }[] } | null;
  /** Limiter per client. true = 120 requests / minute / IP. Default off. */
  rateLimit?: boolean | RateLimitOptions;
  /** Unmatched scanner paths (/wp-admin, /.git, *.php ...) get a cheap plain 404 and a "probe" event. Default true. */
  probes?: boolean | { paths?: (RegExp | string)[] };
  /** Called for every refused request, CSP report and probe. Fire-and-forget: it can be async and can never break a request. */
  onEvent?: ((event: SecurityEvent) => void | Promise<void>) | null;
  /** Longer request targets get 414. Default 8192 (0 = off). */
  maxUrlLength?: number;
  /** Larger header blocks get 431. Default 16384 bytes. */
  maxHeaderSize?: number;
  /** Time to send the request headers (slowloris). Default 20000. */
  headersTimeoutMs?: number;
  /** Time to send the whole request. Default 60000. */
  requestTimeoutMs?: number;
  /** Never serve /.env, /.git ... from public/ (".well-known" stays allowed). Default true. */
  blockDotfiles?: boolean;
}
export interface TurboConfig {
  /** Keep the options but switch turbo off. Default true (an options object turns turbo on). */
  enabled?: boolean;
  /** Cache compiled JSX/TS on disk, keyed by content. Default true. */
  cache?: boolean;
  /** Where the caches live. Default node_modules/.cache/nepx (or the OS temp dir without node_modules). */
  cacheDir?: string;
  /** Node's V8 compile cache for Nepx and dependencies (Node >= 22.1, ignored on older versions). Default true. */
  compileCache?: boolean;
  /** Routes inspected / pages prerendered at the same time. Default: CPU count, between 2 and 8. */
  concurrency?: number;
  /** dev: a save that did not change the file's content does not restart the server. Default true. */
  skipUnchanged?: boolean;
  /** dev: extra globs (or RegExps, tested on the "/"-separated path) that never restart the server, e.g. "generated/**". Added to the built-in list (logs, swap files, tests, coverage, dist). */
  watchIgnore?: (string | RegExp)[];
  /** start: import the route modules in the background right after listening. Default true. */
  warmup?: boolean;
}
export interface UserAgent {
  /** The raw User-Agent header. */
  ua: string;
  isBot: boolean;
  browser: { name?: string; version?: string; major?: string };
  engine: { name?: string; version?: string };
  os: { name?: string; version?: string };
  device: { type?: "mobile" | "tablet"; vendor?: string; model?: string };
  cpu: { architecture?: string };
}
/** Parse the User-Agent of a Request, Headers or a plain string. */
export function userAgent(input: Request | Headers | string | { headers: Record<string, string | string[] | undefined> }): UserAgent;
export function userAgentFromString(ua: string): UserAgent;

export interface NepxConfig {
  /** Write nepx-routes.d.ts so <Link href> and router.push() only accept routes that exist (compile-time). Default false. */
  typedRoutes?: boolean;
  /** Folder (inside the project) for the build output. Default ".nepx". One folder name, e.g. "build-output". */
  distDir?: string;
  /** "standalone": `nepx build` also writes .nepx/standalone/ (server.js + package.json + the build) to deploy on its own. Default "server". */
  output?: "standalone" | "server";
  /** Which file extensions count as pages / route handlers, e.g. ["tsx", "ts"]. Default: all of ksx, jsx, tsx, ts, js. */
  pageExtensions?: string[];
  /** node_modules packages (TS / JSX source) compiled like your own code on the server. */
  transpilePackages?: string[];
  /** Accepted for Next.js compatibility: the server already loads node_modules natively. */
  serverExternalPackages?: string[];
  /** Absolute URL (CDN) the client bundle and imported assets are linked from, e.g. "https://cdn.example.com". The origin still serves /_nepx/*. */
  assetPrefix?: string;
  /** Send "X-Powered-By: Nepx" on every response. Default false. */
  poweredByHeader?: boolean;
  /** Wrap the browser tree in <React.StrictMode> (double-invokes effects in development). Default false. */
  reactStrictMode?: boolean;
  /** Build-time transforms. `removeConsole` strips console.* calls from the production browser bundle (`exclude` keeps the listed methods). */
  compiler?: { removeConsole?: boolean | { exclude?: string[] } };
  /** Defaults for process.env (string values). Real environment variables and .env files win. Only NEPX_PUBLIC_* names reach the browser bundle. */
  env?: Record<string, string>;
  /** Faster dev restarts, builds and cold starts. Off by default; also `--turbo` / `--no-turbo` and NEPX_TURBO=1|0. */
  turbo?: boolean | TurboConfig;
  port?: number;
  /** Server hardening. `false` turns every protection off. */
  security?: SecurityConfig | false;
  maxBodySize?: number;
  compress?: boolean;
  /** Serve the whole app under a sub-path, e.g. "/docs" (leading slash, no trailing slash). Links, assets, redirects and the router follow it. */
  basePath?: string;
  /** Stream pages (shell first, Suspense boundaries as they finish). Default true; off automatically with a Content-Security-Policy and for bots. */
  streaming?: boolean;
  /** `true`: "/about" is redirected (308) to "/about/". Default `false`. */
  trailingSlash?: boolean;
  /** Image optimization for <Image>: local files from public/ are resized and re-encoded (webp/avif) at /_nepx/image. Needs the optional `sharp` package; without it originals are served. Off by default. */
  images?: {
    optimize?: boolean; widths?: number[]; quality?: number; formats?: ("webp" | "avif")[];
    /** Remote hosts the optimizer may fetch (next/image): `*` = one subdomain label, `**` = any number; pathname `*` = one segment, `**` = any depth. */
    remotePatterns?: { protocol?: "http" | "https"; hostname: string; port?: string; pathname?: string; search?: string }[];
    /** Shorthand for `remotePatterns: [{ hostname }]`. */
    domains?: string[];
    /** Let the optimizer connect to loopback / private addresses (off by default; SSRF risk). */
    dangerouslyAllowLocalIP?: boolean;
    /** Largest remote image the optimizer downloads (default 10 MB). */
    maxRemoteBytes?: number;
  };
  /** Locale-prefixed routes: /id/about is /about in Indonesian. The default locale has no prefix. `detection` (default true) redirects "/" using the NEPX_LOCALE cookie, then Accept-Language. Needs a server (not `nepx export`). */
  i18n?: { locales: string[]; defaultLocale: string; detection?: boolean };
  redirects?: Rule[] | (() => Rule[] | Promise<Rule[]>);
  /** An array (applied before routes) or Next.js' phases: `fallback` rules only run when no page, API route or public file matched. */
  rewrites?: RewriteRule[] | (() => RewriteRule[] | Promise<RewriteRule[]>) | RewritePhases | (() => RewritePhases | Promise<RewritePhases>);
  headers?: HeaderRule[] | (() => HeaderRule[] | Promise<HeaderRule[]>);
}
/** `value` is a regular expression source matched against the whole value (omit it to only test presence). */
export type RuleCondition = { type: "header" | "cookie" | "query"; key: string; value?: string } | { type: "host"; value: string };
type Conditions = { has?: RuleCondition[]; missing?: RuleCondition[] };
type Rule = { source: string; destination: string; permanent?: boolean; statusCode?: 301 | 302 | 303 | 307 | 308 } & Conditions;
type RewriteRule = { source: string; destination: string } & Conditions;
type RewritePhases = { beforeFiles?: RewriteRule[]; afterFiles?: RewriteRule[]; fallback?: RewriteRule[] };
type HeaderRule = { source: string; headers: { key: string; value: string }[] } & Conditions;
export interface SitemapEntry { url: string; lastModified?: string | Date; changeFrequency?: string; priority?: number }

// ---- components
import type { ComponentType, ReactNode, ImgHTMLAttributes, CSSProperties, FormHTMLAttributes } from "react";
export interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height" | "placeholder"> {
  src: string | { src: string; width?: number; height?: number };
  alt: string;
  width?: number | string;
  height?: number | string;
  /** Fill the (positioned) parent instead of width/height. */
  fill?: boolean;
  /** Eager + high fetch priority (the LCP image). */
  priority?: boolean;
  placeholder?: "empty" | "blur";
  blurDataURL?: string;
  /** 1-100, used with config.images.optimize (default config.images.quality, 75). */
  quality?: number;
  /** Skip the optimizer for this image (config.images.optimize). */
  unoptimized?: boolean;
}
export function Image(props: ImageProps): JSX.Element;
/** The props <Image> would put on its <img> (for <picture>, CSS backgrounds, meta tags). The 2nd argument overrides the app's basePath / images config. */
export function getImageProps(props: ImageProps, ctx?: { basePath?: string; images?: { widths: number[]; quality: number } | null }): { props: ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string } };
export const unstable_getImgProps: typeof getImageProps;

// ---- next/third-parties
export function GoogleAnalytics(props: { gaId: string; dataLayerName?: string; debugMode?: boolean; nonce?: string }): JSX.Element[];
export function sendGAEvent(...args: unknown[]): void;
export function GoogleTagManager(props: { gtmId: string; dataLayerName?: string; dataLayer?: Record<string, unknown>; auth?: string; preview?: string; nonce?: string }): JSX.Element;
export function sendGTMEvent(data: Record<string, unknown>, dataLayerName?: string): void;
export function YouTubeEmbed(props: { videoid: string; playlabel?: string; params?: string; width?: number; height?: number; style?: CSSProperties; className?: string; title?: string }): JSX.Element;
export function GoogleMapsEmbed(props: { apiKey: string; mode: "place" | "view" | "directions" | "streetview" | "search"; height?: number | string; width?: number | string; style?: CSSProperties; loading?: "lazy" | "eager"; allowfullscreen?: boolean; title?: string; [param: string]: unknown }): JSX.Element;
export interface ScriptProps { src?: string; id?: string; strategy?: "beforeInteractive" | "afterInteractive" | "lazyOnload" | "worker"; onLoad?: (e: Event) => void; onReady?: () => void; onError?: (e: unknown) => void; children?: ReactNode; dangerouslySetInnerHTML?: { __html: string }; [attr: string]: unknown }
export function Script(props: ScriptProps): JSX.Element | null;
export interface FormProps extends Omit<FormHTMLAttributes<HTMLFormElement>, "action"> { action: string | ((formData: FormData) => void | Promise<void>); replace?: boolean }
/** A GET form that navigates on the client (`/search?q=...`); a function `action` is passed to React as a Server Action. */
export function Form(props: FormProps): JSX.Element;
export function dynamic<P = {}>(loader: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>, options?: { ssr?: boolean; loading?: ComponentType<{ isLoading: boolean; pastDelay: boolean; error: unknown }> }): ComponentType<P>;
export interface FontResult { className: string; style: CSSProperties; variable: string }
export function localFont(options: { family: string; src: string | { path: string; weight?: string | number; style?: string }[]; weight?: string | number; style?: string; display?: "auto" | "block" | "swap" | "fallback" | "optional"; fallback?: string[]; variable?: string; preload?: boolean }): FontResult;
export function googleFont(options: { family: string; weight?: string | string[]; style?: "normal" | "italic" | ("normal" | "italic")[]; display?: "auto" | "block" | "swap" | "fallback" | "optional"; fallback?: string[]; variable?: string }): FontResult;
/** Used by the generated stubs of "use server" files. */
export function createServerReference<T extends (...args: any[]) => Promise<any>>(id: string, name?: string): T;

// ---------------------------------------------------------------------------------------------- 1.5: actions beyond "use server", React + Next hooks
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]>; code?: string };
export type ActionSchema<I> = ((value: any) => I) | { parse(value: any): I } | { safeParse(value: any): { success: true; data: I } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } } };
export interface CreateActionDefinition<I, O, C extends object = {}> {
  /** Validates the first argument (FormData becomes a plain object first). */
  input?: ActionSchema<I>;
  /** Guards that run before the handler (auth, rate limits); returned objects are merged into `ctx`. Throw ActionError to stop. */
  use?: Array<(ctx: C, raw: unknown) => C | void | Promise<C | void>>;
  handler: (input: I, ctx: C) => O | Promise<O>;
}
/** A validated server action that returns { ok, data } / { ok:false, error, fieldErrors }. Works in "use server" files and in *.action.js files (no directive needed). */
export function createAction<I = unknown, O = unknown, C extends object = {}>(def: CreateActionDefinition<I, O, C> | ((input: I) => O | Promise<O>)): (input: I | FormData) => Promise<ActionResult<O>>;
export class ActionError extends Error { constructor(message: string, opts?: { fieldErrors?: Record<string, string[]>; code?: string }); fieldErrors?: Record<string, string[]>; code?: string }
export function actionError(message: string, opts?: { fieldErrors?: Record<string, string[]>; code?: string }): ActionError;

export interface UseActionOptions<D> { onSuccess?(data: D): void; onError?(message: string | undefined, detail: unknown): void }
export interface UseActionState<A extends any[], D> { execute(...args: A): Promise<unknown>; pending: boolean; data: D | undefined; error: string | null; fieldErrors?: Record<string, string[]>; executed: boolean; reset(): void }
/** Run a server action with pending / data / error state. */
export function useAction<A extends any[], R>(fn: (...args: A) => Promise<R>, options?: UseActionOptions<R extends { ok: true; data: infer D } ? D : R>): UseActionState<A, R extends { ok: true; data: infer D } ? D : R>;
/** Show `reducer(current, input)` immediately while the action runs; rolls back when it ends. */
export function useOptimisticAction<S, I, R>(fn: (input: I) => Promise<R>, current: S, reducer: (current: S, input: I) => S): UseActionState<[I], R> & { value: S };

export { useActionState, useOptimistic, useTransition, useDeferredValue, useId, use, cache } from "react";
/** Active path segments below the root layout; `depth` skips leading segments. */
export function useSelectedLayoutSegments(depth?: number): string[];
export function useSelectedLayoutSegment(depth?: number): string | null;
/** Rethrow notFound()/HttpError control-flow errors caught in your own try/catch. */
export function unstable_rethrow(err: unknown): void;
export function useReportWebVitals(cb: (metric: { name: "FCP" | "LCP" | "CLS"; value: number; id: string }) => void): void;

/** Browser stub of a "use func" export (GET /_nepx/func). Created by the build; you rarely call it yourself. */
export function createFuncReference<A extends any[], R>(id: string, name?: string): (...args: A) => Promise<R>;

/** app/sitemap.js: with `export async function generateSitemaps()`, the default export receives `{ id }` and serves /sitemap/<id>.xml. */
export type SitemapEntry = { url: string; lastModified?: string | Date; changeFrequency?: string; priority?: number; alternates?: { languages?: Record<string, string> }; images?: string[] };

/** Data cache options for server-side fetch(): `cache: "force-cache"`, `nepx: { revalidate, tags }`. */
declare global {
  interface RequestInit {
    nepx?: {
      /** Seconds the response stays cached; `false` = until revalidateTag(); `0` = never cached. A plain fetch() is not cached. */
      revalidate?: number | false;
      /** revalidateTag("name") drops the cached response (and ISR pages that rendered with it). */
      tags?: string[];
    };
    /** @deprecated legacy name of `nepx`. */
    next?: {
      /** Seconds the response stays cached; `false` = until revalidateTag(); `0` = never cached. A plain fetch() is not cached. */
      revalidate?: number | false;
      /** revalidateTag("name") drops the cached response (and ISR pages that rendered with it). */
      tags?: string[];
    };
  }
}

// ---- pages/ (Pages Router): pages/_app, pages/_document, pages/api/*
import type { IncomingHttpHeaders } from "node:http";
export interface NextApiRequest { method: string; url: string; headers: Record<string, string>; query: Record<string, string | string[]>; body: any; cookies: Record<string, string>; on(event: "data" | "end", cb: (...a: any[]) => void): this; [Symbol.asyncIterator](): AsyncIterator<Buffer> }
export interface NextApiResponse<T = any> {
  statusCode: number; headersSent: boolean;
  status(code: number): this; setHeader(name: string, value: string | string[] | number): this; getHeader(name: string): unknown; removeHeader(name: string): void;
  json(body: T): this; send(body: T | string | Buffer): this; end(chunk?: string | Buffer): this; write(chunk: string | Buffer): boolean;
  redirect(url: string): this; redirect(status: number, url: string): this; revalidate(path: string): Promise<void>;
}
export type NextApiHandler<T = any> = (req: NextApiRequest, res: NextApiResponse<T>) => unknown | Promise<unknown>;
/** `export const config = { api: { bodyParser: false } }` in a pages/api file leaves req.body unparsed. */
export interface PageConfig { api?: { bodyParser?: boolean } }
export interface AppProps<P = any> { Component: NextPage<P> | React.ComponentType<P>; pageProps: P }
/** `getInitialProps` (Pages Router): runs on the server for the first request and for client-side navigation; the result is serialised to the browser. `req` is a Fetch API `Request`. */
export interface NextPageContext { pathname: string; query: Record<string, string | string[] | undefined>; asPath: string; req: Request; locale?: string; locales?: string[]; defaultLocale?: string }
export interface AppContext { Component: NextPage<any>; ctx: NextPageContext; router: { pathname: string; route: string; query: Record<string, string | string[] | undefined>; asPath: string; locale?: string } }
export type NextPage<P = {}, IP = P> = React.ComponentType<P> & { getInitialProps?: (ctx: NextPageContext) => IP | Promise<IP> };
/** next/document building blocks for pages/_document. */
export function Html(props: React.HTMLAttributes<HTMLHtmlElement>): React.ReactElement;
export function Main(): React.ReactElement;
export function NextScript(): React.ReactElement;
export class Document extends React.Component {}
/** next/app: `class MyApp extends App`; `App.getInitialProps(appContext)` runs the page's getInitialProps and returns `{ pageProps }`. */
export class App<P = {}, S = {}> extends React.Component<AppProps & P, S> {
  static getInitialProps(appContext: AppContext): Promise<{ pageProps: any }>;
}
