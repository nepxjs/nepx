// Type declarations for "nepx" (TypeScript is compiled by Nepx, not type-checked).
import type { AnchorHTMLAttributes, ReactNode, Ref } from "react";

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  /** Replace the history entry instead of pushing a new one. */
  replace?: boolean;
  /** Links prefetch on hover/focus/touch (and when visible in production). `false` turns it off; `true` also prefetches pages that use getServerSideProps. */
  prefetch?: boolean;
  ref?: Ref<HTMLAnchorElement>;
  children?: ReactNode;
}
export function Link(props: LinkProps): JSX.Element;
export function navigate(href: string, options?: { replace?: boolean }): void;
export function usePathname(): string;
export function useSearchParams(): URLSearchParams;
export function useParams<T extends Record<string, string | string[]> = Record<string, string | string[]>>(): T;
export interface Router {
  push(href: string): void;
  replace(href: string): void;
  back(): void;
  forward(): void;
  /** Warm the data of a page (also runs getServerSideProps). */
  prefetch(href: string): void;
  /** Re-run middleware, getServerSideProps and generateMetadata for the current page without a reload. */
  refresh(): void;
}
export function useRouter(): Router;

/** A redirect Response (route handlers, middleware). */
export function redirect(destination: string | URL, status?: 301 | 302 | 303 | 307 | 308): Response;
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
export function revalidateTag(tag: string): void;
/** Memoize an async function. Key = keyParts + JSON arguments; `revalidate` in seconds (omit: until revalidateTag); errors are not cached. */
export function unstable_cache<A extends unknown[], R>(fn: (...args: A) => Promise<R> | R, keyParts?: string[], options?: { revalidate?: number | false; tags?: string[] }): (...args: A) => Promise<R>;
/** Tag the page being rendered so `revalidateTag(tag)` drops its ISR copy. No-op while prerendering. */
export function cacheTag(...tags: string[]): void;
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
export interface Metadata {
  title?: string | { default?: string; template?: string; absolute?: string };
  description?: string;
  keywords?: string | string[];
  robots?: string | { index?: boolean; follow?: boolean };
  themeColor?: string;
  alternates?: { canonical?: string };
  icons?: string | { icon?: string | string[]; apple?: string | string[] };
  openGraph?: Record<string, unknown>;
  twitter?: Record<string, unknown>;
}
export interface PageProps<P extends Record<string, string | string[]> = Record<string, string | string[]>> { params: P; searchParams: URLSearchParams }
export interface ErrorProps { error: { message: string; digest?: string }; reset: () => void }
export interface RouteContext { params: Record<string, string | string[]>; url: URL; cookies: Record<string, string>; requestId: string }
export type RouteHandler = (request: Request & { json(): Promise<any> }, ctx: RouteContext) => Response | Promise<Response>;
export interface GetServerSidePropsContext { params: Record<string, string | string[]>; searchParams: URLSearchParams; request: Request; cookies: Record<string, string>; requestId: string }
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
export interface NepxConfig {
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
  redirects?: Rule[] | (() => Rule[] | Promise<Rule[]>);
  rewrites?: (RewriteRule)[] | (() => RewriteRule[] | Promise<RewriteRule[]>);
  headers?: HeaderRule[] | (() => HeaderRule[] | Promise<HeaderRule[]>);
}
/** `value` is a regular expression source matched against the whole value (omit it to only test presence). */
export type RuleCondition = { type: "header" | "cookie" | "query"; key: string; value?: string } | { type: "host"; value: string };
type Conditions = { has?: RuleCondition[]; missing?: RuleCondition[] };
type Rule = { source: string; destination: string; permanent?: boolean; statusCode?: 301 | 302 | 303 | 307 | 308 } & Conditions;
type RewriteRule = { source: string; destination: string } & Conditions;
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
  /** Accepted for Next.js compatibility; Nepx does not resize or re-encode images. */
  quality?: number;
  unoptimized?: boolean;
}
export function Image(props: ImageProps): JSX.Element;
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
