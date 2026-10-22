// next/third-parties equivalents: Google Analytics, Google Tag Manager, YouTube and Google Maps embeds. Isomorphic.
import { createElement as h } from "react";
import { Script } from "./components.js";

const ID = /^[A-Za-z0-9_-]+$/;
const need = (name, v) => { if (typeof v !== "string" || !ID.test(v)) throw new TypeError(`${name} must be an id like "G-XXXXXXX" (letters, digits, - and _)`); return v; };
const layerName = (name, v) => { if (!/^[A-Za-z_$][\w$]*$/.test(v)) throw new TypeError(`${name} must be a valid JavaScript identifier`); return v; };

/** <GoogleAnalytics gaId="G-XXXX" /> - loads gtag.js once and sends page views (also on client-side navigation: gtag's history events). */
export function GoogleAnalytics({ gaId, dataLayerName = "dataLayer", debugMode, nonce }) {
  need("<GoogleAnalytics> gaId", gaId); layerName("<GoogleAnalytics> dataLayerName", dataLayerName);
  return [
    h(Script, { key: "ga-init", id: "_nepx-ga-init", nonce, strategy: "afterInteractive" },
      `window['${dataLayerName}']=window['${dataLayerName}']||[];function gtag(){window['${dataLayerName}'].push(arguments);}gtag('js',new Date());gtag('config','${gaId}'${debugMode ? ",{debug_mode:true}" : ""});`),
    h(Script, { key: "ga-src", id: "_nepx-ga", nonce, strategy: "afterInteractive", src: `https://www.googletagmanager.com/gtag/js?id=${gaId}${dataLayerName !== "dataLayer" ? `&l=${dataLayerName}` : ""}` }),
  ];
}
/** sendGAEvent("event", "buttonClicked", { value: "x" }) - pushes arguments onto the GA data layer (browser only). */
export function sendGAEvent() {
  if (typeof window === "undefined") return;
  (window.dataLayer ??= []).push(arguments); // gtag() pushes its Arguments object, not an array
}

/** <GoogleTagManager gtmId="GTM-XXXX" /> - the GTM container snippet. */
export function GoogleTagManager({ gtmId, dataLayerName = "dataLayer", dataLayer, auth, preview, nonce }) {
  need("<GoogleTagManager> gtmId", gtmId); layerName("<GoogleTagManager> dataLayerName", dataLayerName);
  const extra = (auth ? `&gtm_auth=${encodeURIComponent(auth)}` : "") + (preview ? `&gtm_preview=${encodeURIComponent(preview)}&gtm_cookies_win=x` : "");
  const init = (dataLayer ? `window['${dataLayerName}']=window['${dataLayerName}']||[];window['${dataLayerName}'].push(${JSON.stringify(dataLayer).replace(/</g, "\\u003c")});` : "")
    + `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl+'${extra}';f.parentNode.insertBefore(j,f);})(window,document,'script','${dataLayerName}','${gtmId}');`;
  return h(Script, { id: "_nepx-gtm", nonce, strategy: "afterInteractive" }, init);
}
/** sendGTMEvent({ event: "buttonClicked", value: "x" }) - pushes onto the GTM data layer (browser only). */
export function sendGTMEvent(data, dataLayerName = "dataLayer") {
  if (typeof window === "undefined") return;
  (window[dataLayerName] ??= []).push(data);
}

/** <YouTubeEmbed videoid="ABC" params="controls=0" /> - a click-to-load facade: no YouTube code until the visitor presses play (privacy-friendly nocookie domain). */
export function YouTubeEmbed({ videoid, playlabel = "Play video", params = "", width = 560, height = 315, style, className, title = "YouTube video" }) {
  need("<YouTubeEmbed> videoid", videoid);
  const src = `https://www.youtube-nocookie.com/embed/${videoid}?autoplay=1${params ? "&" + params.replace(/^[?&]/, "") : ""}`;
  return h("div", { className, style: { width, maxWidth: "100%", aspectRatio: `${width} / ${height}`, position: "relative", background: "#000", ...style }, "data-nepx-youtube": videoid },
    h("a", { href: `https://www.youtube.com/watch?v=${videoid}`, "aria-label": playlabel, style: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", textDecoration: "none", backgroundImage: `url(https://i.ytimg.com/vi/${videoid}/hqdefault.jpg)`, backgroundSize: "cover" },
      onClick(e) { if (typeof document === "undefined" || e.button !== 0 || e.metaKey || e.ctrlKey) return; e.preventDefault(); const f = document.createElement("iframe"); f.src = src; f.title = title; f.allow = "autoplay; encrypted-media; picture-in-picture"; f.allowFullscreen = true; f.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0"; e.currentTarget.parentNode.replaceChildren(f); } },
      h("span", { style: { fontSize: 48, textShadow: "0 1px 6px #000" } }, "\u25B6")));
}

/** <GoogleMapsEmbed apiKey="..." mode="place" q="Eiffel Tower" /> - the Maps Embed API iframe (lazy loaded). */
export function GoogleMapsEmbed({ apiKey, mode, height = 450, width = 600, style, loading = "lazy", allowfullscreen = true, title = "Google Maps", ...query }) {
  if (typeof apiKey !== "string" || !apiKey) throw new TypeError("<GoogleMapsEmbed> needs an apiKey");
  if (!["place", "view", "directions", "streetview", "search"].includes(mode)) throw new TypeError('<GoogleMapsEmbed> mode must be "place", "view", "directions", "streetview" or "search"');
  const qs = new URLSearchParams({ key: apiKey });
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && typeof v !== "function" && typeof v !== "object") qs.set(k, String(v));
  return h("iframe", { src: `https://www.google.com/maps/embed/v1/${mode}?${qs}`, title, width, height, style: { border: 0, maxWidth: "100%", ...style }, loading, allowFullScreen: allowfullscreen, referrerPolicy: "no-referrer-when-downgrade" });
}
