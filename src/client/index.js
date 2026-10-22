// What `import ... from "nepx"` gives you in the browser bundle.
export { Link, formatHref, navigate, usePathname, useSearchParams, useParams, useLinkStatus, useLocale } from "../link.js";
export { redirect, permanentRedirect, notFound, next, rewrite, RedirectType, ReadonlyURLSearchParams } from "../shared.js";
export { Image, getImageProps, unstable_getImgProps, Script, Form, dynamic } from "../components.js";
export { GoogleAnalytics, sendGAEvent, GoogleTagManager, sendGTMEvent, YouTubeEmbed, GoogleMapsEmbed } from "../third-parties.js";
export { localFont, googleFont } from "../fonts.js";
export { useAction, useOptimisticAction, useActionState, useOptimistic, useTransition, useDeferredValue, useId, use, cache, useSelectedLayoutSegment, useSelectedLayoutSegments, unstable_rethrow, useReportWebVitals, useServerInsertedHTML } from "../hooks.js";
export { createAction, ActionError, actionError } from "../action-kit.js";
export { createServerReference, createFuncReference } from "./actions.js";
export { mountNepx } from "./runtime.js";
const serverOnly = (name) => () => { throw new Error(`${name}() is server-only: call it from a route handler, middleware or while a page renders on the server.`); };
export const cookies = serverOnly("cookies");
export const headers = serverOnly("headers");
export const revalidatePath = serverOnly("revalidatePath");
export const revalidateTag = serverOnly("revalidateTag");
export const updateTag = serverOnly("updateTag");
export const refresh = serverOnly("refresh");
export const unstable_cache = serverOnly("unstable_cache");
export const draftMode = serverOnly("draftMode");
export const after = serverOnly("after");
export const connection = serverOnly("connection");
export const unstable_noStore = serverOnly("unstable_noStore");
export const cacheTag = serverOnly("cacheTag");
export const getLocale = serverOnly("getLocale"); // in the browser use useLocale()
export const NepxResponse = serverOnly("NepxResponse");
export const NextResponse = NepxResponse, NepxRequest = serverOnly("NepxRequest"), NextRequest = NepxRequest;
export const unstable_after = serverOnly("unstable_after");
export const unstable_expireTag = serverOnly("unstable_expireTag");
export const unstable_expirePath = serverOnly("unstable_expirePath");
export { userAgent, userAgentFromString } from "../user-agent.js"; // pure string parsing: also fine in the browser (userAgent(navigator.userAgent))
export const ImageResponse = serverOnly("ImageResponse");
export const cacheLife = serverOnly("cacheLife");
export const unstable_cacheLife = serverOnly("unstable_cacheLife");
export const unstable_cacheTag = serverOnly("unstable_cacheTag");
export { App, useRouter, Router, withRouter, Head, useAmp, isInAmpMode, ErrorPage, ErrorPage as NextError, LegacyImage, PHASE_EXPORT, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER, PHASE_DEVELOPMENT_SERVER, PHASE_TEST, currentPhase } from "../pages-compat.js";
