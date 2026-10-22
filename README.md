# Nepx.js

> Simple to Build. Fast to Run.

A lightweight React framework with file-based routing, SSR, API routes, server actions, metadata, ISR and a built-in security pipeline. Powered by esbuild.

## Quick start

```bash
npx nepxjs create my-app          # add --ts for TypeScript; or: npm i -g nepxjs && nepx create my-app
cd my-app
npm install
npm run dev                  # http://localhost:3000
```

> The npm package is **`nepxjs`**, the command is **`nepx`**, and code imports from **`"nepx"`**.

## Requirements

- Node.js >= 20.6
- React 19 + React DOM 19 (for UI projects; installed by the scaffold)

## Commands

| Command | What it does |
| --- | --- |
| `nepx create <name> [--mode fullstack\|frontend\|backend] [--ts]` | Create a new project (`--ts`: TypeScript) |
| `nepx dev [--port N]` | Dev server (restarts on change) |
| `nepx build` | Validate routes and write `.nepx/` |
| `nepx start [--port N]` | Run the production build |
| `nepx export [--out dir]` | Static site in `out/` (needs a fully static app) |
| `nepx routes` | List routes |
| `nepx info` | Versions, platform and project details (paste into bug reports) |
| `nepx --help` / `--version` | Help / version |

Update notice: `nepx dev|build|start|export|info` prints a short note when a newer `nepxjs` is on npm (checked in the background at most once a day, never blocks). Turn it off with `--no-update-check` or `NEPX_NO_UPDATE_CHECK=1`; it is also silent in CI and non-interactive shells.

Turbo mode (faster restarts, builds, cold starts; off by default): `--turbo` / `--no-turbo`, `NEPX_TURBO=1`, or `turbo: true` in `nepx.config.js`.

## Project layout

```
app/
  layout.jsx
  page.jsx
  about/page.jsx
  users/[id]/page.jsx
  api/hello/route.js
nepx.config.js
middleware.js
```

```jsx
import { Link, redirect } from "nepx";
```

## What is included

File-based conventions on a small esbuild core:

- **Routing** — `app/` file routes, dynamic `[id]`, catch-all `[...slug]`, optional `[[...slug]]`, route groups `(group)`, parallel `@slot` and intercepting routes, `layout` / `template` / `loading` / `error` / `global-error` / `not-found` / `401` / `403` / any status page.
- **Rendering** — SSR with streaming, static prerender (`generateStaticParams`), ISR (`revalidate`, `revalidatePath`, `revalidateTag`), `getServerSideProps`, `dynamic = "force-dynamic" | "force-static"`.
- **API & actions** — `route.js` / `route.ts` handlers, Server Actions (`"use server"`, `createAction`), `useAction`, `useOptimisticAction`.
- **Data cache** — `fetch(url, { cache: "force-cache", nepx: { revalidate, tags } })` on the server, `revalidateTag()` drops it.
- **Build & deploy** — `output: "standalone"`, `distDir`, `assetPrefix`, `typedRoutes`, `pageExtensions`, `transpilePackages`, `generateImageMetadata`.
- **Request helpers** — `cookies()`, `headers()`, `draftMode()`, `after()`, `unstable_cache()`, `middleware` (or `proxy`) with `matcher`, `redirect()` / `rewrite()` / `next()`, and `NepxResponse`.
- **Metadata** — `metadata` (incl. `metadataBase`, `authors`, `verification`, `alternates.languages`, `appleWebApp`, `other`, ...), `generateMetadata`, `viewport`, `sitemap.js`, `robots.js`, `manifest.js`, app icons and OpenGraph/Twitter images.
- **Components & hooks** — `Link` (prefetch, `useLinkStatus`), `Image`, `Script`, `Form`, `dynamic()`, `useRouter`, `usePathname`, `useSearchParams`, `useParams`, `useSelectedLayoutSegment(s)`, `localFont` / `googleFont`.
- **Images & i18n** — opt-in image optimization (`images: { optimize: true }`, needs `sharp`), locale-prefixed routing (`i18n: { locales, defaultLocale }`) with `useLocale()` / `<Link locale>`, `useServerInsertedHTML()`.
- **Production** — hashed, immutable client assets with `ETag`/`304`, compression, built-in security headers, CSP, rate limiting, `basePath`, `trailingSlash`, redirects / rewrites / headers rules, `instrumentation.js`.
- **Client hooks & build options** — `instrumentation-client.js` (runs before hydration, `onRouterTransitionStart`), `reactStrictMode`, `compiler.removeConsole`.
- **TypeScript** — `.ts` / `.tsx` out of the box, types for `"nepx"` shipped in the package.

```js
// app/api/login/route.js
import { NepxResponse } from "nepx";

export async function POST(request) {
  const { user } = await request.json();
  const res = NepxResponse.json({ ok: true }, { status: 201 });
  res.cookies.set("session", user, { httpOnly: true, maxAge: 3600 });
  return res;
}
```

```jsx
// a spinner while the next page loads
import { Link, useLinkStatus } from "nepx";

function Spinner() {
  const { pending } = useLinkStatus();
  return pending ? <span aria-busy="true">…</span> : null;
}

export const NavLink = ({ href, children }) => <Link href={href}>{children}<Spinner /></Link>;
```

### Next.js module map

Everything you import from `next/*` has a counterpart in `"nepx"` (one import path for server and browser):

| Next.js | Nepx |
| --- | --- |
| `next/link` | `Link` (`prefetch`, `replace`, `scroll`, `onNavigate`, `locale`, URL-object `href`), `useLinkStatus` |
| `next/navigation` | `useRouter` (`push/replace(href, { scroll })`), `usePathname`, `useSearchParams`, `useParams`, `useSelectedLayoutSegment(s)`, `redirect`, `permanentRedirect`, `notFound`, `forbidden`, `unauthorized`, `RedirectType`, `ReadonlyURLSearchParams`, `unstable_rethrow`, `useServerInsertedHTML` |
| `next/server` | `NextResponse` / `NepxResponse`, `NextRequest` / `NepxRequest`, `userAgent`, `userAgentFromString`, `after` / `unstable_after`, `connection` |
| `next/headers` | `cookies`, `headers`, `draftMode` |
| `next/cache` | `unstable_cache`, `revalidatePath`, `revalidateTag`, `updateTag`, `refresh`, `unstable_noStore`, `cacheTag`, `unstable_expireTag`, `unstable_expirePath` |
| `next/image` | `Image`, `getImageProps` |
| `next/script`, `next/dynamic`, `next/form` | `Script`, `dynamic`, `Form` |
| `next/font` | `localFont`, `googleFont` |
| `next/third-parties` | `GoogleAnalytics`, `GoogleTagManager`, `sendGAEvent`, `sendGTMEvent`, `YouTubeEmbed`, `GoogleMapsEmbed` |
| `next/web-vitals` | `useReportWebVitals` |
| `next/og` | `ImageResponse` (also from `next/server`) |
| `"use cache"` | the directive, `cacheLife`, `cacheTag` (`unstable_cacheLife` / `unstable_cacheTag`) |
| `next/head`, `next/amp`, `next/error` | `Head`, `useAmp` (always `false`), `ErrorPage` (`NextError`) |
| `next/app` | `App` (`class MyApp extends App`, `App.getInitialProps`) |
| `next/router` | `useRouter` (adds `pathname`, `query`, `asPath`, `isReady`, `events`), `Router` (browser singleton), `withRouter` |
| `next/constants`, `next/legacy/image` | `PHASE_*`, `currentPhase()`, `LegacyImage` |

Not available: AMP rendering and `getInitialProps` in `_document`.

### `getStaticProps` / `getStaticPaths`

Pages-Router style data functions work in any `app/**/page.*`:

```jsx
// app/posts/[slug]/page.jsx
export default function Post({ title }) { return <h1>{title}</h1>; }

export async function getStaticPaths() {
  return { paths: [{ params: { slug: "hello" } }, "/posts/world"], fallback: false }; // false -> every other slug is a 404
}
export async function getStaticProps({ params }) {
  return { props: { title: params.slug } };   // also { notFound: true } and { redirect }
}
export const revalidate = 60;                  // optional: ISR (regenerate in the background)
```

`nepx build` prerenders every path from `getStaticPaths` (strings and `{ params }` both work). `fallback: true` / `"blocking"` render other URLs on demand. A page cannot export both `getStaticProps` and `getServerSideProps`. The refresh interval is `export const revalidate` or the `revalidate` field returned from `getStaticProps`.

### `pages/` directory (Pages Router)

`pages/` (or `src/pages/`) works next to `app/` (the same URL cannot exist in both):

```
pages/
  _app.jsx          export default ({ Component, pageProps }) => <Layout><Component {...pageProps} /></Layout>
  _document.jsx     <Html lang="en"><Head>...</Head><body><Main /><NextScript /></body></Html>
  index.jsx         /
  blog/[slug].jsx   getStaticProps / getStaticPaths / getServerSideProps
  404.jsx           not-found page (also _error.jsx and 500.jsx for errors)
  api/hello.js      export default function handler(req, res) { res.status(200).json({ ok: true }) }
```

- **`_app`** wraps every page (`Component`, `pageProps`). **`_document`**: `Html` attributes, `<Head>` tags and `<body>` attributes/markup around `<Main />` are used for every page (`Html`, `Head`, `Main`, `NextScript`, `Document` come from `"nepx"`).
- **`pages/api`** handlers get Node-style `req` (`method`, `headers`, `query` incl. dynamic params, `body` parsed from JSON / form / text, `cookies`) and `res` (`status`, `json`, `send`, `redirect`, `setHeader`, `end`, `write`, `revalidate(path)`). `export const config = { api: { bodyParser: false } }` leaves the body raw.
- `getStaticProps` may return `{ revalidate: 60 }` (or use `export const revalidate`). Pages are prerendered at build; other paths are rendered on first request and cached.
- **`getInitialProps`**: `Page.getInitialProps = async (ctx) => props` (`ctx`: `pathname` like `/post/[id]`, `query` incl. dynamic params, `asPath`, `req`, `locale`) and a custom `_app`'s `App.getInitialProps({ Component, ctx, router })` returning `{ pageProps, ...appProps }` (extra keys reach `<App>`; `import { App } from "nepx"` and call `App.getInitialProps(appContext)` to run the page's). It runs on the server (first request and client-side navigation, like `getServerSideProps`), the result must be JSON-serializable, `notFound()` shows the 404 page, and it cannot be combined with `getServerSideProps` / `getStaticProps`. A page that has one is rendered per request; an `_app` that only extends `App` keeps pages statically optimised. `req` is a Fetch API `Request` and there is no `res`.
- Files are generated into `.nepx-pages/` (add it to `.gitignore`). Not supported: `next/document` `getInitialProps` / `renderPage`, AMP.

### URL-object hrefs

```jsx
<Link href={{ pathname: "/post/[id]", query: { id: 5, ref: "home" }, hash: "top" }}>Post</Link>   // /post/5?ref=home#top
router.push({ pathname: "/search", query: { q: "nepx", tag: ["a", "b"] } });                      // /search?q=nepx&tag=a&tag=b
```

`[id]`, `[...slug]` and `[[...slug]]` are filled from `query` (and left out of the search string); a missing required value throws. Works in `Link`, `useRouter().push/replace/prefetch`, `navigate()` and `Router`. `formatHref()` is exported too.

### `searchParams`

Pages, `@slot` pages and `generateMetadata` get `searchParams` the way Next.js 15 passes it, and it is still a `URLSearchParams`:

```jsx
export default async function Page({ searchParams }) {
  const { q, tag } = await searchParams;   // q: "hello", tag: ["a", "b"] for ?q=hello&tag=a&tag=b
  return <p>{q} {searchParams.get("q")}</p>;
}
```

### Remote images (`next/image`)

```js
// nepx.config.js
export default {
  images: {
    optimize: true,
    remotePatterns: [{ protocol: "https", hostname: "**.example.com", pathname: "/photos/**" }],
    domains: ["cdn.other.com"],          // shorthand for { hostname }
  },
};
```

`<Image src="https://img.example.com/photos/a.jpg" width={400} height={300} alt="" />` is then fetched, resized and re-encoded (webp/avif) by `/_nepx/image` and served from your origin. A remote `src` that matches no pattern is used as it is (unoptimized). The server only connects to allowed hosts, never to loopback / private / link-local addresses (`dangerouslyAllowLocalIP: true` lifts that), does not follow redirects, and only accepts raster images up to `maxRemoteBytes` (10 MB). SVG is never fetched. Needs `sharp`; without it the original bytes are served.

### `fetch()` data cache

```js
// any server code (pages, layouts, route handlers, actions)
const res = await fetch("https://api.example.com/posts", { next: { revalidate: 60, tags: ["posts"] } });
await fetch(url, { cache: "force-cache" });   // until revalidateTag()
await fetch(url, { cache: "no-store" });      // never cached (a plain fetch() is not cached either)
```

Only successful `GET`/`HEAD` responses are cached (in process memory). `revalidateTag("posts")` drops the entry and the ISR pages that rendered with it.

### `"use cache"`

```js
// lib/data.js
"use cache";                       // every exported async function in this file is cached
import { cacheLife, cacheTag } from "nepx";

export async function getPosts(category) {
  cacheLife("hours");              // "seconds" | "minutes" | "hours" | "days" | "weeks" | "max" | { revalidate: 120 }
  cacheTag("posts");               // revalidateTag("posts") drops it
  return db.posts.findMany({ where: { category } });
}
```

The directive also works as the first statement of one `async function` or `const f = async () => {}`. The key is the function plus its arguments (primitives, arrays, plain objects, Dates); other arguments (promises, functions, class instances) skip the cache. Entries live in process memory, errors are never cached, and concurrent calls share one run. A `"use cache"` file may only export async functions. The directive is applied on the server; it is a no-op in code that only runs in the browser.

### `ImageResponse` (next/og)

```jsx
// app/opengraph-image.jsx  -> served at /opengraph-image and added to <head> (also icon.jsx, apple-icon.jsx, twitter-image.jsx)
import { ImageResponse } from "nepx";

export default function Image() {
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", fontSize: 64, color: "#fff", background: "linear-gradient(to right, #4f46e5, #ec4899)" }}>My site</div>,
    { width: 1200, height: 630 },
  );
}
```

PNG/JPEG/WebP output needs the optional `sharp`; `{ format: "svg" }` needs nothing. Layout uses a built-in renderer (flex row/column, padding, margin, gap, colors, gradients, borders, radius, text, `<img>`; text width is estimated). Install `satori` and pass `fonts` for Next.js' exact layout engine. Return it from any route handler too.

```jsx
// <picture> with getImageProps (art direction)
import { getImageProps } from "nepx";

export function Hero() {
  const common = { alt: "Hero", sizes: "100vw" };
  const { props: { srcSet: wide } } = getImageProps({ ...common, src: "/hero-wide.jpg", width: 1600, height: 600 });
  const { props: { srcSet: narrow, ...img } } = getImageProps({ ...common, src: "/hero-narrow.jpg", width: 800, height: 800 });
  return <picture><source media="(min-width: 800px)" srcSet={wide} /><img {...img} srcSet={narrow} /></picture>;
}
```

### Static export

`nepx export` writes a folder of plain files you can upload to any static host. It works when every page is prerendered (no API routes, `getServerSideProps`, `revalidate`, or dynamic routes without `generateStaticParams`); otherwise it lists exactly which routes need a server. Middleware, redirects and rewrites do not run on a static host, and links do full page loads.

```bash
npx nepx export            # -> out/
npx nepx export --out dist
```

### Request helpers

```js
import { userAgent } from "nepx";

export async function GET(request) {
  const { isBot, browser, device } = userAgent(request);
  const q = request.nextUrl.searchParams.get("q");
  const theme = request.cookies.get("theme")?.value ?? "light";
  return Response.json({ q, theme, isBot, browser: browser.name, mobile: device.type === "mobile" });
}
```

### global-error

`app/global-error.jsx` is the last line of defence: it replaces the root layout and the page when the root layout (or `error.jsx`) throws, and catches client render errors that no `error.jsx` handled. Do not render `<html>`/`<body>` in it.

```jsx
"use client";
export default function GlobalError({ error, reset }) {
  return <main><h1>Something went badly wrong</h1><button onClick={reset}>Try again</button></main>;
}
```

## Configuration

`nepx.config.js` (all optional; `env: { KEY: "default" }` sets defaults for `process.env`, real variables and `.env` files win):

```js
export default {
  port: 3000,
  compress: true,
  redirects: [{ source: "/old/:slug", destination: "/new/:slug", permanent: true }],
  rewrites: { fallback: [{ source: "/:path*", destination: "https://legacy.example.com/:path*" }] }, // or a plain array; fallback = only when nothing else matches
  poweredByHeader: false,
  typedRoutes: true,                 // writes nepx-routes.d.ts: <Link href> / router.push() only accept real routes
  output: "standalone",              // nepx build also writes .nepx/standalone/ (node server.js on any server)
  distDir: "build-output",           // build folder (default .nepx)
  assetPrefix: "https://cdn.example.com", // client bundle + imported assets are linked from the CDN
  pageExtensions: ["tsx", "ts"],     // which files count as pages / route handlers
  transpilePackages: ["my-ui-kit"],  // compile TS/JSX source from node_modules
};
```

```js
// nepx.config.js
export default {
  reactStrictMode: true,                                  // <React.StrictMode> around the browser tree
  compiler: { removeConsole: { exclude: ["error"] } },    // production browser bundle only
};
```

### Images and locales

```js
// nepx.config.js
export default {
  images: { optimize: true },                                // <Image> -> /_nepx/image (npm i sharp; without it originals are served)
  i18n: { locales: ["en", "id"], defaultLocale: "en" },      // /id/about = Indonesian /about; "/" follows NEPX_LOCALE cookie / Accept-Language
};
```

```jsx
import { Link, useLocale } from "nepx";
// <Link href="/about" locale="id">Bahasa Indonesia</Link>   useLocale() -> "en" | "id"   getLocale() on the server
```

## TypeScript

Types ship with the package (`index.d.ts`). Scaffolded projects already map `"nepx"` to them via `jsconfig.json`; for `tsconfig.json` add:

```json
{ "compilerOptions": { "paths": { "nepx": ["./node_modules/nepxjs/index.d.ts"] } } }
```

## Development

```bash
npm install
npm test        # runs the whole suite (unit, HTTP and end-to-end)
```

See [CHANGELOG.md](CHANGELOG.md) for what changed and [PUBLISHING.md](PUBLISHING.md) for the release steps.

## License

MIT
