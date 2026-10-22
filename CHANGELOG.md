# Changelog

## Unreleased
- URL-object hrefs (`next/link`): `<Link href={{ pathname: "/post/[id]", query: { id: 5 }, hash: "top" }}>`, also for `router.push/replace/prefetch`, `navigate()` and the Pages `Router`. Dynamic segments (`[id]`, `[...slug]`, `[[...slug]]`) are filled from `query`, the other keys become the search string (arrays repeat the key). `formatHref()` is exported; `Href` / `UrlObject` are typed.
- Remote images: `images.remotePatterns` (`protocol`, `hostname` with `*` / `**`, `port`, `pathname`, `search`) and `images.domains`. `<Image>` sends matching `http(s)` sources through `/_nepx/image` (resized, webp/avif); others stay unoptimized. SSRF guards: allow-list only, the validated DNS answer is the address used to connect, loopback / private / link-local / CGNAT / multicast addresses are refused (`dangerouslyAllowLocalIP` for local development), no redirects, raster content types only (no SVG), `maxRemoteBytes` (default 10 MB), 8 s timeout.
- `getInitialProps` (Pages Router): `Page.getInitialProps(ctx)` and a custom `_app`'s `App.getInitialProps({ Component, ctx, router })`, with `App` exported from `"nepx"` (`next/app`). Runs on the server for the first request and for client-side navigation; props are delivered like `getServerSideProps` props, extra `_app` props reach `<App>`, `notFound()` works, and combining it with `getServerSideProps` / `getStaticProps` is a build error. An `_app` that only extends `App` leaves pages statically optimised. Typed (`NextPage`, `NextPageContext`, `AppContext`, `App`).
- `searchParams` handed to pages, `@slot` pages, `generateMetadata` and `getServerSideProps` is now also a plain-object view of the query, so `const { q } = await searchParams` and `searchParams.q` work (a repeated key gives an array). It is still a `URLSearchParams` (`get`, `getAll`, `has`, iteration), and not thenable, so `await searchParams` returns the same object. Before, destructuring silently gave `undefined`.
- `pages/` directory (also `src/pages/`): file routes (`[id]`, `[...all]`, `[[...all]]`), `_app`, `_document` (`Html`, `Head`, `Main`, `NextScript`, `Document`), `404` / `_error` / `500`, and `pages/api/**` handlers with Node-style `req` / `res` (`NextApiRequest` / `NextApiResponse` types, `config.api.bodyParser`). Generated adapters live in `.nepx-pages/`.
- `getStaticProps` can return `{ revalidate }`: per-page ISR interval (also recorded at build time for prerendered pages).
- `getStaticProps` and `getStaticPaths` (Pages-Router style) in `app/**/page.*`: prerendered at build, props delivered like `getServerSideProps`, `{ notFound }` / `{ redirect }` results, `paths` as `{ params }` or URL strings, `fallback: false` = 404 for unknown params (`true` / `"blocking"` render on demand), combinable with `export const revalidate` for ISR. Also stripped from the browser bundle, accepted by `nepx export`, and typed (`GetStaticProps`, `GetStaticPaths`).

## 1.9.0
- Update notice: the CLI (`dev`, `build`, `start`, `export`, `info`) tells you when a newer `nepxjs` is published. Background lookup, cached 24h, never blocks; silent in CI / non-TTY / tests. Off: `--no-update-check` or `NEPX_NO_UPDATE_CHECK=1`.
- Nepx-native names: `request.nepxUrl` and `fetch(url, { nepx: { revalidate, tags } })`. The previous names (`nextUrl`, `next: {...}`, `NextResponse`, `NextRequest`, `NextError`) still work and are marked deprecated.
- Internal header `x-nepx-next` is now `x-nepx-continue`; docs and comments no longer reference other frameworks.

## 1.8.0
- Windows fixes (all tests now pass on Windows as well as Linux/macOS):
  - `"use cache"` injected an import with a broken file URL (`file:///D:/D:/...`) on Windows, so pages using it failed with `MODULE_NOT_FOUND`. It now uses `import.meta.url` directly.
  - Build errors from esbuild now always print forward-slash paths (`app/about/page.jsx:1:8`), also on Windows.
  - `nepx create` writes a forward-slash `file:` dependency spec; `nepx export` reports posix paths.
  - Tests: use directory junctions instead of symlinks (no admin rights needed on Windows), normalise `readdir` paths, and a regression test (`tests/windows-paths.test.js`).
  - CI now also runs on `windows-latest`.
- Next.js feature parity, part 3:
  - Full `Metadata` support: `metadataBase` (relative URLs in `alternates`, `icons`, `manifest`, `openGraph`, `twitter` become absolute), `applicationName`, `authors`, `creator`, `publisher`, `generator`, `referrer`, `category`, `classification`, `manifest`, `formatDetection`, `verification` (google / yahoo / yandex / me / other), `alternates.languages|media|types`, `icons.shortcut|other` and icon `sizes` / `type`, `bookmarks`, `archives`, `assets`, `itunes`, `appleWebApp`, `appLinks`, `other` (custom `<meta>`), robots flags (`noarchive`, `maxSnippet`, ... and `googleBot`), Open Graph `article` fields, videos, audio and alternate locales, `twitter:image:alt`. Output for existing metadata is unchanged.
  - `reactStrictMode: true` in `nepx.config.js` wraps the browser tree in `<React.StrictMode>` (off by default).
  - `compiler: { removeConsole: true | { exclude: ["error"] } }` strips `console.*` from the production browser bundle.
  - `instrumentation-client.js` / `.ts` (project root or `src/`): runs in the browser before the app hydrates; `export function onRouterTransitionStart(url, type)` is called for client-side navigations.
- Next.js feature parity, part 2:
  - `"use cache"` directive (file level, `async function`, `const f = async () => {}`; `: private` / `: remote` accepted), `cacheLife()` (profiles `default`, `seconds`, `minutes`, `hours`, `days`, `weeks`, `max`, or `{ stale, revalidate, expire }`), `unstable_cacheLife`, `unstable_cacheTag`. `cacheTag()` inside a cached function tags the entry; `revalidateTag()` drops it.
  - `ImageResponse` (next/og): JSX -> png / jpeg / webp / svg. Uses `satori` when installed and `fonts` are given, otherwise a built-in renderer; raster output needs `sharp`. `app/opengraph-image.jsx`, `twitter-image.jsx`, `icon.jsx`, `apple-icon.jsx` (also `.js` / `.ts` / `.tsx`) are served at `/opengraph-image` ... and linked in `<head>`.
  - `Head` (next/head; a `<title>` in it replaces the metadata title), `useAmp` / `isInAmpMode` (always false), `ErrorPage` / `NextError` (next/error), `Router` singleton and `withRouter`, `useRouter()` now also returns `pathname`, `route`, `query`, `asPath`, `isReady`, `events` (`routeChangeStart` / `routeChangeComplete`), `LegacyImage`, `PHASE_*` constants and `currentPhase()`.
- Next.js module parity (`next/navigation`, `next/server`, `next/image`, `next/cache`, `next/third-parties`):
  - `getImageProps(props, ctx?)` / `unstable_getImgProps` — the props `<Image>` would render (srcSet, sizes, loading, blur style) for `<picture>`, CSS backgrounds and meta tags. `<Image>` now uses the same code.
  - `RedirectType` (`redirect(url, RedirectType.replace)` is accepted) and `ReadonlyURLSearchParams`.
  - `NextResponse` (= `NepxResponse`), `NepxRequest` / `NextRequest` (a `Request` with `nextUrl` and `cookies`, for unit-testing handlers and middleware), `userAgentFromString()`.
  - `unstable_after` (= `after`), `unstable_expireTag`, `unstable_expirePath`.
  - `<Link scroll={false}>`, `router.push/replace(href, { scroll: false })` and `navigate(href, { scroll: false })` keep the scroll position; `<Link onNavigate={(e) => e.preventDefault()}>` runs before a client-side navigation and can cancel it.
  - `GoogleAnalytics`, `GoogleTagManager`, `sendGAEvent`, `sendGTMEvent`, `YouTubeEmbed` (click-to-load facade), `GoogleMapsEmbed`. Ids and data-layer names are validated; JSON is escaped so it cannot close the script tag.
- `updateTag(tag)` and `refresh()` (Server Actions), `revalidateTag(tag, profile?)` accepts Next.js' second argument.
- `sitemap.js`: `alternates.languages` and `images` entries.
- `useServerInsertedHTML(cb)` — add markup to the server-rendered `<head>` (CSS-in-JS, inline scripts); runs once the shell has rendered.
- Image optimization (opt-in): `images: { optimize: true, widths?, quality?, formats? }` serves local `public/` images resized and re-encoded (webp/avif by `Accept`) at `/_nepx/image`; `<Image>` emits a `srcSet`. Optional `sharp` dependency (without it originals are served); remote URLs are never fetched; `svg`/`gif` pass through.
- Internationalized routing (`i18n: { locales, defaultLocale, detection? }`): `/id/about` is the Indonesian `/about`; the default locale has no prefix (`/en/x` redirects to `/x`); `/` redirects using the `NEPX_LOCALE` cookie, then `Accept-Language`. `<Link locale="en">`, `useLocale()`, `useRouter().locale/locales`, `getLocale()` (server), `router.push(href, { locale })`; `<html lang>` follows the locale; `usePathname()` never contains the prefix. Needs a server: `nepx export` refuses it; prerendered/ISR copies are served for the default locale only.
- `generateSitemaps()` in `app/sitemap.js`: serves `/sitemap/<id>.xml` per id; `/sitemap.xml` becomes the sitemap index. `nepx export` writes every part (the index holds the local address; see the warning).

## 1.7.0

### Added
- `NepxResponse` — NextResponse-style helpers for route handlers and middleware: `json()`, `redirect()` (paths allowed), `next()`, `rewrite()` and a chainable `res.cookies.set()/delete()`.
- `useLinkStatus()` — `{ pending }` inside a `<Link>`'s children, true from the click until the next page has loaded (spinners).
- `nepx create <name> --ts` (alias `--typescript`) — TypeScript project: `.tsx`/`.ts` files, `tsconfig.json`, typed layout/page/route handlers, `typecheck` script and the type dev-dependencies.
- `nepx info` — versions, platform and project details for bug reports.
- `ETag` + `304 Not Modified` for files in `public/`, app icons and the hashed client bundle (`If-None-Match` supports lists, weak tags and `*`; `HEAD` returns the tag).

- `nepx export [--out dir]` — static export: builds, then writes plain files (prerendered pages, hashed assets, `public/`, `sitemap.xml` / `robots.txt` / `manifest.webmanifest`, `404.html`) to `out/` for any static host (GitHub Pages, S3, Netlify ...). Honors `basePath` (files go under `out/<basePath>/`). Apps that need a server (API routes, `getServerSideProps`, ISR, dynamic pages without `generateStaticParams`) are refused with the list of offending routes; middleware is skipped with a warning. Navigation in an export is a normal page load.
- `userAgent(request | headers | string)` — browser, engine, OS, device, CPU and `isBot`, no dependencies.
- Route handlers: `request.nextUrl` and `request.cookies` (`get` / `getAll` / `has`), typed as `NepxRequest`.
- `env` in `nepx.config.js` — defaults for `process.env` (real environment and `.env` files win; only `NEPX_PUBLIC_*` reaches the browser).
- `app/global-error.jsx` — shown instead of the root layout and page when nothing else can render a failure: server-side when the root layout or `error.jsx` throws (status 500, message hidden in production), and in the browser when an error escapes every `error.jsx` boundary. Write it without `<html>`/`<body>` (Nepx supplies the document). Validated at build time.
- Real-browser test (Chromium via Playwright; skipped when not installed) covering `useLinkStatus` and the client-side `global-error`.

### Fixed
- `nepx create` templates no longer set `baseUrl` in `tsconfig.json` / `jsconfig.json` (deprecated in TypeScript 6; `paths` work without it).

### Changed
- `package.json`: removed placeholder `homepage` / `bugs` / `repository` / `author` fields so no broken links are published; added `CHANGELOG.md` to the package; `pack:check` script.
- `.npmignore` removed (the `files` whitelist already decides what ships).

## 1.6.0
- Turbo mode (`--turbo`), parallel route inspection and prerendering, transform and V8 compile caches.
