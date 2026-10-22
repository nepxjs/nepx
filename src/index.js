// What `import ... from "nepx"` gives you on the server (SSR, route handlers, middleware).
export { Link, formatHref, navigate, usePathname, useSearchParams, useParams, useLinkStatus, useLocale } from "./link.js";
export { redirect, permanentRedirect, notFound, next, rewrite, unauthorized, forbidden, httpError, RedirectType, ReadonlyURLSearchParams } from "./shared.js";
export { HttpError } from "./errors/index.js";
export { NepxResponse, NepxResponse as NextResponse, NepxRequest, NepxRequest as NextRequest } from "./response.js"; // the legacy aliases ease copy-pasting middleware and route handlers
export { userAgent, userAgentFromString } from "./user-agent.js";
export { cookies, headers, draftMode, after, connection, unstable_noStore, cacheTag, getLocale, unstable_after } from "./request-context.js";
export { unstable_cache, revalidateTag, updateTag, refresh, unstable_expireTag, unstable_expirePath } from "./cache.js";
export { revalidatePath } from "./isr.js";
export { Image, getImageProps, unstable_getImgProps, Script, Form, dynamic } from "./components.js";
export { GoogleAnalytics, sendGAEvent, GoogleTagManager, sendGTMEvent, YouTubeEmbed, GoogleMapsEmbed } from "./third-parties.js"; // next/third-parties
export { localFont, googleFont } from "./fonts.js";
// "use server" modules run as real functions on the server; the browser bundle replaces them with stubs that call createServerReference.
export { useAction, useOptimisticAction, useActionState, useOptimistic, useTransition, useDeferredValue, useId, use, cache, useSelectedLayoutSegment, useSelectedLayoutSegments, unstable_rethrow, useReportWebVitals, useServerInsertedHTML } from "./hooks.js";
export { createAction, ActionError, actionError } from "./action-kit.js";
export { createServerReference, createFuncReference } from "./client/actions.js";

// next/og, "use cache" (the directive is handled by the loader; these are its helpers) and the Pages-Router era modules.
export { ImageResponse } from "./og.js";
export { cacheLife, unstable_cacheLife } from "./use-cache.js";
export { cacheTag as unstable_cacheTag } from "./request-context.js";
export { createPagesApiHandler } from "./pages-api.js"; // used by the generated pages/api adapters
export { Html, Main, NextScript, Document, App } from "./pages-compat.js"; // next/document
export { useRouter, Router, withRouter, Head, useAmp, isInAmpMode, ErrorPage, ErrorPage as NextError, LegacyImage, PHASE_EXPORT, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER, PHASE_DEVELOPMENT_SERVER, PHASE_TEST, currentPhase } from "./pages-compat.js";
