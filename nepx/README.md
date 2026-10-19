# Nepx.js — Simple to Build. Fast to Run.

A small full-stack React framework with a Next.js App Router–style file structure.
Formerly "Kite.js". Status: **v0.5** (package 1.6.0; new in 1.6: `dynamicParams = false`, file-based icons / OG images, `has`/`missing` rule conditions, `trailingSlash`; new in 1.5: `"use func"` / `"use client"` directives, `*.action.js` actions, `createAction`, `useAction`, React/Next hooks, see "New in 1.5"; 1.4: mutable `cookies()`, `draftMode`, `revalidateTag` / `unstable_cache` / `cacheTag`, `after()`, `instrumentation.js`, external rewrites (proxy), `dynamic` route config, `viewport`, `<Form>`, `permanentRedirect`, see "New in 1.4"; 1.3: streaming SSR, Server Actions, `Image`/`Script`/`dynamic`/fonts, `template.jsx`, parallel + intercepting routes, `basePath`, see "New in 1.3") - API, React frontend, SSR + hydration + data loading + middleware + env + static prerender, metadata API, `notFound()`, nested `not-found` / `loading.jsx` / **`error.jsx`**, optional catch-all routes, `nepx.config.js` redirects / **rewrites** / headers, hashed assets and compression, and new in v0.3: **ISR (`revalidate`, `revalidatePath`)**, **`cookies()` / `headers()`**, **middleware `rewrite()` / `next()`**, **`sitemap` / `robots` / `manifest` files**, **CSS Modules**, **images/fonts imported from code**, **Link prefetch + `router.refresh()`**, **TypeScript declarations** and dev request logging.
Requires Node >= 20.6. Dependencies: `esbuild`; `react` + `react-dom` (peer; only needed when you have pages).

## Quick start
```
node packages/nepx/bin/nepx.js create my-app          # --mode fullstack (default) | frontend | backend
cd my-app && npm install                              # nepx is linked via a file: path (not on npm yet)
npm run dev      # http://localhost:3000  (restarts + auto-reloads the browser on change)
npm run routes
npm run build && npm start
```

## Project structure (same ideas as Next.js App Router + React)
```
my-app/
  app/
    layout.jsx            root layout (wraps everything; nested layouts supported)
    page.jsx              /
    about/page.jsx        /about
    users/[id]/page.jsx   /users/:id        (also [...slug] catch-all, [[...slug]] optional catch-all, (group) folders, _private folders)
    users/[id]/loading.jsx   shown while client-side navigation to this segment loads (inside the layouts that stay mounted)
    not-found.jsx         404 page; may also live in any folder - the nearest one is used (inside its own layouts)
    error.jsx             error page; may live in any folder (nearest wins, inside its own layouts). Gets { error: { message, digest }, reset }
    401.jsx 403.jsx 429.jsx 503.jsx ...   pages for other HTTP statuses (root of app/ only): see "Error pages" below
    sitemap.js robots.js manifest.js   generated /sitemap.xml, /robots.txt, /manifest.webmanifest (root of app/)
    globals.css           imported by layout.jsx
    page.module.css       CSS Modules: import styles from "./page.module.css"
    api/hello/route.js    /api/hello        export GET / POST / PUT / PATCH / DELETE / OPTIONS
  components/Navbar.jsx   plain React components
  public/                 served at /
  middleware.js           runs before every matched request
  .env  .env.local  .env.production ...
  nepx.config.js          optional: { port, maxBodySize, compress, redirects, rewrites, headers, security }
```
Use `src/app/...` instead of `app/...` if you prefer a `src/` folder. File extensions: `.jsx .js .tsx .ts .ksx` (TypeScript is compiled, **not type-checked**).
Imports: extensionless (`import X from "../components/X"`) and the `@/` alias (project root, or `src/`) both work.

## What each file can do
**Page** (`page.jsx`): default-export a component; receives `{ params, searchParams }` (+ props from data loading).
```jsx
export const metadata = { title: "User", description: "..." };            // static metadata ...
export async function generateMetadata({ params, searchParams, props }) {  // ... or computed (props = what getServerSideProps returned)
  return { title: `User ${params.id}`, openGraph: { title: "...", images: ["/og.png"] } };
}
export async function getServerSideProps({ params, searchParams, request, cookies }) {
  return { props: {...} }      // or { notFound: true }  or  { redirect: { destination: "/x", permanent: true } }
}
export async function generateStaticParams() { return [{ id: "1" }] }   // prerender dynamic pages at build time ([[...x]]: return {} for the base path)
export const revalidate = 60;                                            // ISR: serve from memory, re-render in the background when older than 60s (not together with getServerSideProps)
export default function Page({ params, user }) { ... }
```
`getServerSideProps`/`generateStaticParams`/`generateMetadata` are removed from the browser bundle (with their imports). Props must be JSON-serializable.
**Metadata keys**: `title` (string, or `{ default, template: "%s | Site", absolute }` - a layout's template wraps the titles below it), `description`, `keywords`, `robots` (string or `{ index, follow }`), `themeColor`, `alternates.canonical`, `icons`, `openGraph`, `twitter`. Layouts and pages merge (page wins); the `<head>` is also kept in sync on client-side navigation.
**Layout**: `export default function Layout({ children, params })`; may export `metadata` / `generateMetadata`.
**`notFound()`** (from `"nepx"`): call it in a page, layout, `getServerSideProps` or `generateMetadata` to stop and show the nearest `not-found.jsx` with status 404. In the browser it is caught the same way.
**`loading.jsx`**: default-export a component; shown during client-side navigation to anything below its folder, until `/_nepx/data` answers. (No streaming: the first HTML load is still rendered completely on the server.)
**Route handler** (`route.js`): `export async function GET(request, { params, url, cookies, requestId }) { return Response.json(...) }` (standard `Request`/`Response`; `request.json()` answers 400/413/415 instead of crashing).
**Middleware**: `export default function middleware(request, { url, cookies })` returning a `Response` (e.g. `redirect("/login")` from `"nepx"`) or nothing; `export const config = { matcher: ["/admin/:path*"] }`. It cannot read the request body.
**`error.jsx`**: default-export a component receiving `{ error: { message, digest }, reset }`. It catches errors thrown while rendering the segment below it, **in the browser** (the layouts above it stay mounted and keep their state; `reset()` re-renders the segment; navigating away clears the error) and **on the server** (status 500, rendered inside the layouts above it; production hides the message, `digest` is the request id). Without any `error.jsx` a failed server render answers with the JSON 500.
**Middleware helpers**: `redirect(url)`, `rewrite("/other")` (serve another route at the current URL; the browser URL does not change) and `next({ headers })` (continue, adding response headers).
**Request helpers** (server only): `cookies().get("name")?.value`, `headers().get("user-agent")` work anywhere on the server: pages, layouts, `getServerSideProps`, route handlers, middleware. They make a page dynamic: it is skipped by the build-time prerender and never cached by ISR.
**ISR**: `export const revalidate = N` on a page. First request renders and caches it in memory (a page prerendered at build seeds the cache); within N seconds the cached HTML is served (`x-nepx-cache: HIT`); later it is served stale while one background render refreshes it (`STALE`). `revalidatePath("/blog/hello")` (from a route handler, middleware, ...) drops one cached page, `revalidatePath("/blog", "layout")` everything below it. Cached pages are rendered without a query string; the cache is per server process.
**Generated files**: `app/sitemap.js` (default export returns `[{ url, lastModified?, changeFrequency?, priority? }]`), `app/robots.js` (`{ rules: { userAgent, allow, disallow }, sitemap }`), `app/manifest.js` (any JSON object). They may be `async`.
**CSS Modules**: `import styles from "./x.module.css"` gives `{ local: "x_local_<hash>" }` (the same names on the server and in the browser); `:global(.name)` opts out. Plain `.css` imports stay global.
**Assets from code**: `import logo from "./logo.png"` (png jpg gif webp avif svg ico woff woff2 ttf otf mp4 webm mp3 pdf) gives a content-hashed immutable URL; `url(...)` in CSS files is rewritten the same way. Files in `public/` keep working as before.
**From `"nepx"`**: `Link`, `navigate`, `useRouter`, `usePathname`, `useSearchParams`, `useParams`, `redirect`, `rewrite`, `next`, `notFound`, `cookies`, `headers`, `revalidatePath`. Types ship in `index.d.ts`.
**`Link` / `useRouter`**: links prefetch the navigation data on hover/focus/touch (and when visible, in production). Pages with `getServerSideProps` are *not* prefetched unless you write `<Link prefetch>`, so hovering never runs your data code by surprise; `prefetch={false}` turns it off. A prefetched result is used once and expires after 30 s. `router.prefetch(href)` and `router.refresh()` (re-runs middleware, `getServerSideProps` and metadata for the current page without a reload or losing client state).
**Route handlers** may call `notFound()` (JSON 404).
**Env**: `.env` files load in order `.env`, `.env.<mode>`, `.env.local`, `.env.<mode>.local`; real environment variables win. Only `NEPX_PUBLIC_*` reach the browser (inlined at build time); everything else stays on the server.
**`nepx.config.js`**:
```js
export default {
  port: 3000, maxBodySize: 1048576, compress: true,                         // gzip/brotli for text responses >= 1 KB
  rewrites: [{ source: "/shop/:id", destination: "/products/:id" }],        // internal: the URL stays /shop/7, the content is /products/7 (paths only)
  redirects: async () => [{ source: "/old/:slug", destination: "/new/:slug", permanent: true }],   // :name, :name* (0+ segments), :name+ (1+); query string is kept
  headers: () => [{ source: "/:path*", headers: [{ key: "X-Frame-Options", value: "DENY" }] }],
};
```
Order: headers, redirects, middleware, then rewrites (a middleware `rewrite()` wins over config rewrites). Headers apply to every response (a route can still override one it sets itself). A rewritten page is hydrated and client-navigated as the destination route.

## Dev error overlay (`nepx dev`)
Errors in development no longer end as a bare JSON 500 or a red `<pre>`: Nepx renders its own error panel (dark card, message, **code frame** of the failing line with a caret, call stack with framework frames collapsed, `Esc` to close, a "N errors" badge to reopen). It is built in: no config, no dependency, and it is never part of production.
- **Server errors** (page, layout, `getServerSideProps`, `generateMetadata`, route handler, middleware): browsers get a full error page (`Accept: text/html`); `fetch()`/curl still get JSON, now with the `stack`. The terminal prints the stack plus the same code frame. Stacks point at your original `.jsx`/`.tsx` lines (source maps are enabled for the dev server).
- **Compile errors** (syntax error in a page, failing client build): shown as `Build Error` with one code frame per location; the page re-renders by itself as soon as the file is fixed (live reload).
- **Browser errors**: render errors, errors in event handlers, unhandled promise rejections and hydration mismatches open the overlay. The browser stack is mapped back to your source files by the dev server (`POST /_nepx/overlay/resolve`, dev only). Nothing is injected into the page until an error happens.
- **With an `error.jsx`**: your own error UI stays visible; the overlay only shows as the small badge (click it for the details), so it never covers the page you are testing.
- **Default 404**: projects without `not-found.jsx` get a styled built-in 404 page (still status 404, same `<h1>`), in dev and production.
- **Production** never loads the overlay, never shows messages or stacks, and does not have the resolve endpoint.

## Error pages for every HTTP status
Besides `not-found.jsx` (404) and `error.jsx` (500 from a crashed render), Nepx has a built-in, dark-mode aware page for **400 401 402 403 405 406 408 409 410 411 413 414 415 421 422 423 429 431 451 500 501 502 503 504 505 507 508**. Put `app/<status>.jsx` (e.g. `app/403.jsx`, `app/429.jsx`) at the root of `app/` to replace one. It default-exports a component and receives `{ status, title, message, digest, url }` (`digest` = request id, only on 5xx). It renders inside your root layout and may export `metadata`.
```jsx
// app/403.jsx
export default function Forbidden({ title, message }) { return <main><h1>{title}</h1><p>{message}</p></main>; }
```
Raise a status from anywhere on the server (pages, layouts, `getServerSideProps`, middleware, route handlers):
```js
import { unauthorized, forbidden, httpError, HttpError } from "nepx";
if (!user) unauthorized();                                   // 401 page
if (!user.isAdmin) forbidden("Admins only");                 // 403 page, custom message
httpError(429, "Slow down", { headers: { "retry-after": "30" } });
throw new HttpError(503, "Back in 10 minutes");              // same thing; works in middleware too
```
- **Content negotiation**: browsers (`Accept: text/html`) get the page, `fetch()`/curl and everything under `/api/*` get JSON `{ error }` (5xx also carry `requestId`). Responses carry `Vary: Accept` and `Cache-Control: no-store`.
- Status pages are plain server markup: **not hydrated** (no client script, `noindex`). Use ordinary links/forms in them.
- Client-side navigation that ends in an error falls back to a full page load, so the right status page (and status code) is shown.
- Production never shows internal error messages: only messages you passed yourself, plus the request id for 5xx.
- Requests the HTTP parser rejects before any handler runs also get a status page: **400**, **408** (slow request), **431** (headers too large), **501** (unknown method), **505** (HTTP version).

## Security (`security` in `nepx.config.js`)
Every request goes through one pipeline before any route runs: **URL length, method, Host, IP lists, CSRF origin, rate limit**, in that order (cheap checks first). The first refusal answers the request, is reported to `onEvent`, and is rendered as a status page (HTML for browsers, JSON for everything else).

On by default, no setup needed:
- Headers on every response (assets and errors included): `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy` (camera, microphone, geolocation, payment, usb off), `Cross-Origin-Opener-Policy: same-origin-allow-popups`, `X-Permitted-Cross-Domain-Policies`, and `Strict-Transport-Security` in production over HTTPS. A `headers` rule in the config or a route can still override any of them.
- **CSRF guard**: an unsafe request (POST/PUT/PATCH/DELETE) that carries cookies *and* an `Origin` from another site gets **403**. Same-site requests, token-authenticated API calls (no cookies) and non-browser clients are unaffected. Add trusted sites with `allowedOrigins`.
- **Request limits**: URLs over 8 KB → 414, header blocks over 16 KB → 431, slow header/body senders cut off (`headersTimeoutMs`, `requestTimeoutMs`), invalid `Host` → 400, `TRACE`/`CONNECT` → 405, unknown verbs → 501.
- `public/.env`, `.git/...` and other **dotfiles are never served** (`.well-known/` is).
- **Probe detection**: requests nothing serves, for paths scanners love (`/wp-admin`, `/.git/config`, `/phpmyadmin`, `*.php`, `*.sql` ...), get a cheap plain 404 (no page render) and a `probe` event. Extend with `probes: { paths: [/^\/internal-/] }`, disable with `probes: false`.

Opt in (they depend on how you deploy):
```js
// nepx.config.js
export default {
  security: {
    trustProxy: true,                                  // behind nginx / a load balancer: real client IP + protocol from X-Forwarded-*
    allowedHosts: ["example.com", ".example.com"],     // other Host headers -> 421
    ipAccess: {                                        // IPs or CIDR (v4 + v6); deny wins; a matching rule replaces the global lists
      deny: ["203.0.113.0/24"],
      rules: [{ source: "/admin/:path*", allow: ["10.0.0.0/8"] }],
    },
    rateLimit: {
      windowMs: 60_000, max: 120,
      algorithm: "sliding",                            // "fixed" (default) | "sliding" | "token-bucket" (+ burst)
      rules: [{ source: "/api/login", max: 5, algorithm: "token-bucket" }],
      keyGenerator: (req, ip) => req.headers["x-api-key"] ?? ip,   // what a client is (default: IP)
      skip: (req, pathname) => pathname === "/health",
      // store: { get(key), set(key, state, ttlMs) }   // sync or async: back it with Redis to share limits between processes
    },
    contentSecurityPolicy: true,                       // strict preset in production; or your own string / directive object
    cspReportOnly: true,                               // try a policy without breaking anything
    cspReport: true,                                   // built-in collector: POST /_nepx/csp-report -> "csp-report" events
    headers: { "x-frame-options": "DENY", "permissions-policy": null },   // override or remove a default header
    onEvent(e) { console.warn(e.type, e.status, e.ip, e.path, e.requestId); },   // url-too-long | method | host | ip-denied | csrf | rate-limit | probe | csp-report
  },
};
```
Notes: the default limiter store is in memory (per process, resets on restart, capped at 50 000 keys); without `trustProxy` every client behind a proxy shares the proxy's IP, so set it when you are behind one. `X-Forwarded-For` is read from the right (your proxy's entry), so clients cannot spoof it, and an inbound `X-Request-Id` is only honoured behind a trusted proxy. The `true` CSP preset allows only same-origin scripts, styles (inline allowed), images, fonts and connections: add the CDNs you use through the object form. `onEvent` is fire-and-forget: it may be async and can never break or slow a request. `security: false` turns every protection off.

## Source layout (`packages/nepx/src`)
```
errors/        http-error.js (HttpError, expose, retryAfter) · status-codes.js (copy + retryable per status) · plain-html.js (no-React fallback page)
security/      config.js (validate + compile) · pipeline.js (createSecurity: one inspect() per request) · guards/ (url, method, host, ip, origin, rate limit)
               headers.js · csp.js · client.js (ip, protocol) · access-list.js (CIDR) · probes.js · events.js · methods.js
               rate-limit/ algorithms.js (fixed, sliding, token bucket) · memory-store.js · limiter.js
views/         built-in pages: not-found.js · status.js · styles.js
server/        index.js (routing + request lifecycle) · http-utils.js · compression.js · static-files.js · error-response.js (JSON vs HTML) · parser-errors.js
```

## New in 1.5: actions beyond `"use server"`, React and Next.js hooks

**`*.action.js` files** (also `.ts`, `.jsx`, `.tsx`): every export is a Server Action **without** the `"use server"` directive. The browser gets the same stubs; only the file name decides.

**`createAction({ input, use, handler })`**: a validated action that returns `{ ok: true, data }` or `{ ok: false, error, fieldErrors }`. `input` is a function, `{ parse }` or `{ safeParse }` (zod style); `FormData` becomes a plain object first. `use` is a list of guards (auth, rate limits) whose returned objects are merged into `ctx`. Throw `ActionError` / `actionError(msg, { fieldErrors, code })` for expected failures; anything else is a 500.

```js
// app/posts.action.js  (no directive needed)
import { createAction, cookies, revalidatePath } from "nepx";
export const createPost = createAction({
  input: (v) => { if (!v.title) throw actionError("Invalid", { fieldErrors: { title: ["required"] } }); return v; },
  use: [() => { if (!cookies().get("session")) throw actionError("Sign in first", { code: "AUTH" }); }],
  handler: async ({ title }) => { revalidatePath("/posts"); return { id: 1, title }; },
});
```

**Other directives (1.5)**:
- `"use server"`: POST actions (mutations, may `redirect()` / `revalidatePath()`).
- `"use func"`: a file whose first statement is `"use func"` exports **read-only server functions**. The browser gets stubs that call `GET /_nepx/func?args=[...]` (header `x-nepx-func`, JSON-serializable args up to 8 KB, never cached, no redirects). Use it for lookups and queries; use `"use server"` for writes. Like actions, middleware does not run: check the user inside the function.
- `"use client"`: the module is a browser module (it still renders on the server for SSR, like Next.js). New: the build fails if a `"use client"` file that imports from `"nepx"` calls a server-only API (`cookies()`, `headers()`, `revalidatePath()`, `revalidateTag()`, `draftMode()`, `unstable_cache()`, `after()`).
- Inline directives inside a function are still not supported (build error).

**React hooks**: `useAction(fn, { onSuccess, onError })` -> `{ execute, pending, data, error, fieldErrors, reset }`; `useOptimisticAction(fn, current, reducer)`; plus re-exports of React 19 `useActionState`, `useOptimistic`, `useTransition`, `useDeferredValue`, `useId`, `use`, `cache` (import `useFormStatus` from `react-dom`).

**Next.js hooks**: `useSelectedLayoutSegment(s)(depth?)` (segments below the root layout), `unstable_rethrow(err)`, `useReportWebVitals(cb)` (FCP, LCP, CLS).

Same security rules as `"use server"`: middleware does not run for actions, so check the user in a guard.

## New in 1.3: components, streaming, Server Actions, routing
**Components** (`import { Image, Script, dynamic, localFont, googleFont } from "nepx"`)
- `<Image src alt width height>`: lazy by default, reserved space, `priority`, `fill`, `placeholder="blur"`, absolute paths get the `basePath`. It does **not** resize or re-encode (no sharp pipeline); `quality`/`unoptimized` are accepted and ignored. `alt` and `width`+`height` (or `fill`) are required: a missing one is a render error.
- `<Script src strategy>`: `beforeInteractive` (in the server HTML, full page loads only, use in the root layout), `afterInteractive` (default), `lazyOnload`; inline scripts need an `id`; `onLoad`/`onReady`/`onError`; each script is added once. `worker` is treated as `afterInteractive`.
- `dynamic(() => import("./X"), { ssr, loading })`: the browser build splits it into its own chunk. `ssr: true` streams it; `ssr: false` renders `loading` first. (Pages themselves are still one bundle.)
- `localFont({ family, src: [{ path: importedFile, weight }], variable })` / `googleFont({ family, weight })` return `{ className, style, variable }`; the `@font-face` CSS goes into `<head>` and local fonts are preloaded. Google fonts are loaded by the browser from fonts.googleapis.com (allow it in your CSP); they are not self-hosted.

**Streaming SSR**: dynamic page requests are streamed (`renderToPipeableStream`): the shell is sent first and `<Suspense>` boundaries (including `loading.jsx`, which now wraps its page in a boundary on the server) fill in as they resolve; `use(promise)` works. Errors in the shell still give the normal 500/404 page because nothing is sent before the shell is ready. Prerender, ISR, status pages, bots (user-agent match) and `HEAD` get the complete page; with a `contentSecurityPolicy` the page is also sent complete (streaming needs inline scripts); `streaming: false` in the config turns it off. Rendering is aborted after 15 s.

**Server Actions**: a file whose first statement is `"use server"` exports async functions; importing them in a component gives the browser stubs that `POST /_nepx/action`. Arguments/results are JSON (plus text-only `FormData`, so `<form action={fn}>` and `useActionState` work); an action may return `redirect("/x")`; `revalidatePath()` inside an action makes the browser refresh. Only exports of "use server" files are callable (by an opaque id; non-function exports return 404); the call needs the `x-nepx-action` header and JSON content type, on top of the CSRF origin guard. **Middleware does not run for actions: check the user inside the action** (`cookies()`/`headers()` work). Not supported: inline `"use server"` in a function (build error), file uploads, progressive enhancement without JavaScript, `export *`.

**Routing**
- `template.jsx`: like a layout, remounts when the next URL segment changes (state is reset).
- Parallel routes: `app/feed/@side/page.jsx` is passed to `app/feed/layout.jsx` as `{ side }`. A slot needs a `layout` next to it, matches the same URL as the page (its own sub-paths allowed) and falls back to `@side/default.jsx`; with neither the URL is a 404 (like Next.js). Inside a slot only `page` and `default` are supported (no layout/loading/error, no `getServerSideProps`, slot metadata is ignored). Slot props are `undefined` in not-found/error views.
- Intercepting routes (inside a `@slot`): `(.)x`, `(..)x`, `(..)(..)x`, `(...)x`. A client-side navigation to the intercepted URL keeps the page on screen and shows the intercepting page in the slot (URL changes; Back closes it); a reload or direct visit shows the real page.
- `basePath: "/docs"` in `nepx.config.js`: routes, `Link`/`router`, assets, `Image` paths, config/middleware/`getServerSideProps` redirects and the data endpoint live under it; requests outside it are 404. Dev tooling endpoints work unprefixed.

## New in 1.4: caching, draft mode, instrumentation, proxy rewrites
All of these are server features: they come from `"nepx"` on the server and throw a clear error if called in the browser bundle (`<Form>` and `permanentRedirect` are isomorphic).

**`cookies()` can write** (route handlers, middleware, Server Actions): `cookies().set("theme", "dark", { httpOnly, secure, sameSite, maxAge, expires, path, domain })`, `cookies().set({ name, value, ...options })`, `cookies().delete("theme")`. Each call adds a `Set-Cookie` header to the response (default `Path=/`); a later `get()` in the same request sees the change. Names/`sameSite` are validated. Writing inside a *streamed page render* is too late for the headers: do it in a route handler, middleware or action.

**`draftMode()`** -> `{ isEnabled, enable(), disable() }`. `enable()` (from a route handler that checks your own secret) sets a signed, `HttpOnly` cookie; while it is present pages are rendered per request (never the prerendered file, never the ISR copy) with `Cache-Control: private, no-store`, so editors see unpublished content and everybody else keeps the cached page. The cookie is an HMAC: set `NEPX_DRAFT_SECRET` to keep it valid across restarts / processes (otherwise a random secret per process is used).

**Tag revalidation**
```js
import { unstable_cache, revalidateTag, cacheTag } from "nepx";
const getPosts = unstable_cache(async () => db.posts(), ["posts"], { tags: ["posts"], revalidate: 300 });   // memory cache, key = keyParts + JSON args
export const revalidate = 3600;  export const tags = ["posts"];             // ISR page: declare tags statically ...
export default function Page() { cacheTag("posts"); ... }                    // ... or while rendering (unstable_cache adds its tags too)
revalidateTag("posts");                                                       // route handler / action: drops cache entries + ISR pages with the tag
```
Pages prerendered at build are not re-seeded from disk after `revalidateTag` for a tag they declare with `export const tags`. Memory only: per server process (like ISR). Errors are never cached; at most 1000 entries.

**`after(fn)`** runs `fn` once the response has been sent (logging, analytics). Errors are logged, never sent to the client; `headers()` / `cookies()` still work inside. **`connection()`** and **`unstable_noStore()`** mark the current render as dynamic (like `cookies()` does).

**`instrumentation.js`** (next to `app/` or in `src/`): `export async function register()` runs once before the server listens (`process.env.NEPX_RUNTIME === "nodejs"`); `export function onRequestError(error, request, context)` is called for every unhandled server error (500s, also those an `error.jsx` handles; deliberate 4xx like `forbidden()` are not errors): `request = { path, method, headers }`, `context = { routerKind, routePath, routeType, requestId }`. It is fire-and-forget: it can never slow or break a response. A throwing `register()` stops the start with a clear message.

**External rewrites (proxy)**: `rewrites: [{ source: "/api/:path*", destination: "https://api.example.com/v1/:path*" }]` forwards method, body, query, cookies and `X-Forwarded-*` headers and returns the upstream answer (status, headers, `Set-Cookie`; upstream redirects are passed on, not followed; 502/504 if the upstream is down / slow after 30 s). The host must be literal in the config (no `:params`, no credentials), so a visitor can never pick the target. The body is buffered (no streaming / WebSocket proxying). Client-side navigation to a proxied URL falls back to a full page load.

**Route segment config** (exports of a page): `export const dynamic = "force-dynamic"` (never prerendered, never cached; cannot be combined with `revalidate`), `"force-static"` (prerendered even if it calls `cookies()` / `headers()`, which are empty at build time), `"auto"` (default). `export const tags = [...]` see above. Invalid values are build errors.

**`viewport` / `generateViewport`** (layouts and pages, merged field by field, page wins): `export const viewport = { width, initialScale, minimumScale, maximumScale, userScalable, viewportFit, interactiveWidget, themeColor: "#000" | [{ media, color }], colorScheme }`. Renders exactly one `<meta name="viewport">` (default `width=device-width, initial-scale=1`), `theme-color` tags (with `media`) and `color-scheme`; also kept in sync on client navigation (the default tag comes back on a page without a `viewport` export).

**`<Form action="/search">`**: a GET form that navigates on the client: the fields become the query string (`/search?q=abc`), `replace` swaps the history entry, `basePath` is applied. Without JavaScript it is a normal GET form. `<Form action={fn}>` hands a function to React (Server Action / `useActionState`). File inputs, `method="post"`, other targets and external actions keep the browser's behavior.

**`permanentRedirect(url)`**: a 308 `redirect()`.

## How it renders
- Every page is server-rendered (streamed, see above) and hydrated in the browser. Pages without `getServerSideProps` (and static or `generateStaticParams` routes) are **prerendered at `nepx build`** into `.nepx/static`; other params fall back to SSR.
- `nepx dev` logs each request (`GET /about 200 12ms`) in development.
- Client navigation (`Link`) asks `/_nepx/data` on every navigation (or uses the prefetched copy), so middleware, `getServerSideProps` and `generateMetadata` apply to it too; Back/Forward, scroll reset, focus move, `<head>` updates and `loading.jsx` are handled.
- Production client files are content-hashed (`/_nepx/client.<hash>.js`) and served `immutable`; text responses are brotli/gzip compressed.
- `nepx dev` restarts the server on any project change and **reloads the browser automatically** (full reload; no HMR / state preservation).
- `nepx build` validates all routes, bundles + minifies the client, copies the project to `.nepx/server`, prerenders. `nepx start` runs only from `.nepx/`.

## New in 1.6
**`dynamicParams = false`**: on a page with `generateStaticParams`, `export const dynamicParams = false` serves only the params that function returns; any other URL (HTML request or client navigation) answers the nearest `not-found` with status 404. Default (`true`) is unchanged: other params render on demand. Using it without `generateStaticParams`, or with a non-boolean, is a build error.
```jsx
export const dynamicParams = false;
export async function generateStaticParams() { return [{ slug: "hello" }, { slug: "world" }]; }   // /blog/nope -> 404
```

**File-based metadata**: put `favicon.ico`, `icon.(png|jpg|svg|ico|webp|gif)`, `apple-icon.*`, `opengraph-image.*` or `twitter-image.*` in the root of `app/`. Each file is served at `/<file name>` (cached 1 h in production) and added to `<head>` (`<link rel="icon">`, `apple-touch-icon`, `og:image`, `twitter:image`, `basePath` aware), also on client navigation. A `metadata` export that sets the same key (`icons`, `openGraph`, `twitter`) replaces the default for that key. Not supported: generated images (`icon.js`), `generateImageMetadata`.

**`has` / `missing` conditions** on `redirects`, `rewrites` and `headers`: `has: [{ type: "cookie", key: "beta", value: "1|yes" }]`, `missing: [{ type: "query", key: "raw" }]`. Types: `header`, `cookie`, `query`, `host` (host needs `value`). `value` is a regex matched against the whole value; leave it out to test presence only. All `has` must match and no `missing` may match; bad types / regexes fail at startup.

**`trailingSlash: true`** (`nepx.config.js`): GET/HEAD `/about?x=1` answers `308 /about/?x=1`. Not applied to `/`, `/_nepx/*` or paths whose last segment has a file extension. Default `false` leaves URLs untouched.

## Tested (145 automated tests, incl. real Chromium)
Routing (groups, nested layouts, dynamic, catch-all, optional catch-all, priority, conflicts, nested not-found/loading scopes), API handlers and HTTP edge cases, middleware, SSR HTML, prerender (incl. `[[...x]]`), redirects, 404 status, public files, env precedence and secret isolation, server code absent from the client bundle, hydration with zero console errors, client navigation without page reloads, `loading.jsx` during a slow navigation, `notFound()` on server and in the browser, nested not-found, metadata templates + `<head>` sync, config redirects/headers/compression (br, gzip, `q=0`, `compress: false`), hashed immutable assets, nested `error.jsx` (server 500 inside its layouts; browser boundary keeps layouts mounted; `reset()`), ISR MISS/HIT/STALE + `revalidatePath`, rewrites (config + middleware, incl. hydration and client navigation), `cookies()`/`headers()` (dynamic pages skip prerender), sitemap/robots/manifest, CSS Modules (SSR class == CSS class), hashed image/font assets, Link prefetch rules, `router.refresh()`, no-JS rendering, dev compile errors, running from `.nepx/` only, backend-only projects without React. Dev error overlay: source maps, code frames (never outside the project), server/build/browser errors, `error.jsx` badge, production leaks nothing, live-reload recovery, default 404. Security + status pages (`tests/security-units.test.js`, `tests/security-http.test.js`, `tests/status-pages.test.js`): headers on every response, HSTS/CSP rules, 414/405/501, parser-level 400/431/505, Host allow-list (421), CSRF origin guard, dotfile blocking, rate limiter (429, per-rule, proxy-aware, assets exempt), `forbidden()`/`unauthorized()`/`httpError()` in pages, GSSP, middleware and API routes, custom `app/<status>.jsx`, JSON vs HTML negotiation, no leaking of 500 messages.

## Not implemented
HMR / Fast Refresh, React Server Components (`"use client"` only validates server-only calls, all components still run on server and client; Server Actions and `"use func"` exist), route-level code splitting (only `dynamic()` imports split), Tailwind/PostCSS pipeline, `composes` in CSS Modules, image resizing/format conversion, self-hosted Google fonts, `next/script` web-worker strategy, i18n routing, `fetch()` cache extensions (use `unstable_cache`), ISR / tag cache shared across processes, proxying of WebSockets or streamed bodies, TypeScript type checking, benchmarks (no performance claims are made).

## Known limitations / assumptions
- `nepx` is not published to npm; `nepx create` writes `nepx: file:<absolute path of this checkout>`.
- Production loads source files through the Nepx loader at runtime (JSX/TS compiled on first import); there is no server bundle yet.
- Build validation executes route modules (top-level code runs). Static prerender runs your pages at build time.
- Server-only code outside `getServerSideProps`/`generateMetadata` (e.g. top-level `import fs`) in a page or layout will fail the client build; keep it inside those functions or in route handlers.
- A layout's `generateMetadata` receives `{ params, searchParams, request, cookies }` but not the page's `props` (only the page's own `generateMetadata` gets `props`).
- `loading.jsx` is shown during client-side navigation and, on the server, as the Suspense fallback of its page while a streamed response is still resolving it.
- The dev overlay needs JavaScript for its panel (without JS the error page shows a short message; the full stack is in a `<noscript>` block and the terminal). Browser frames of code that is not part of the project bundle are listed as framework frames.
- `error.jsx` in the browser only catches errors thrown while *rendering* (like React error boundaries); event-handler and async errors are not caught.
- The ISR cache lives in the server process's memory (lost on restart, not shared between instances); `revalidatePath` only affects the process it runs in.
- ESBuild's class-name scoping is not used for CSS Modules: Nepx rewrites `.class` selectors itself, so exotic CSS (e.g. `composes`, `@value`) is not supported.
- Tests link react/esbuild from global modules to stand in for `npm install` (sandbox had no network). Run `cd packages/nepx && npm install && npm test`.
