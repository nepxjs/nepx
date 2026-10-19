// next/font-style helpers: localFont() / googleFont(). Isomorphic: the server collects the @font-face CSS and puts it in <head>,
// the browser bundle injects the same <style> at startup (all modules are evaluated once at boot), so class names always match.
import { esc } from "./metadata.js";

const KEY = Symbol.for("nepx.fonts");
const registry = (globalThis[KEY] ??= new Map()); // id -> { css, preload: [{href, type}], links: [href] }

const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, "0"); };
const FORMATS = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };
const MIME_FONT = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" };
const extOf = (u) => String(u).split(/[?#]/)[0].split(".").pop().toLowerCase();
const quote = (family) => (/^[\w-]+$/.test(family) ? family : `'${family.replace(/'/g, "")}'`);
const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong"]);
const stack = (family, fallback) => [`'${family.replace(/'/g, "")}'`, ...fallback.map((f) => (GENERIC.has(f) ? f : quote(f)))].join(", ");

function check(opts, who) {
  if (!opts || typeof opts !== "object") throw new TypeError(`${who}(): options object required`);
  if (typeof opts.family !== "string" || !opts.family.trim() || /[{};<>\\]/.test(opts.family)) throw new TypeError(`${who}(): "family" must be a plain font name`);
  if (opts.variable !== undefined && !/^--[\w-]+$/.test(opts.variable)) throw new TypeError(`${who}(): "variable" must be a CSS custom property name like "--font-inter"`);
  if (opts.fallback !== undefined && (!Array.isArray(opts.fallback) || opts.fallback.some((f) => typeof f !== "string" || /[{};<>\\]/.test(f)))) throw new TypeError(`${who}(): "fallback" must be an array of font names`);
}

function register(id, entry) {
  registry.set(id, entry);
  if (typeof document !== "undefined" && !document.head.querySelector(`[data-nepx-font="${id}"]`)) {
    const style = document.createElement("style");
    style.setAttribute("data-nepx-font", id);
    style.textContent = entry.css;
    document.head.append(style);
  }
}

function result(id, family, fallback, variable) {
  const className = `nepx-font-${id}`;
  const fontFamily = stack(family, fallback);
  let css = `.${className}{font-family:${fontFamily}}`;
  let varClass;
  if (variable) { varClass = `nepx-fontvar-${id}`; css += `.${varClass}{${variable}:${fontFamily}}`; }
  return { css, out: { className, style: { fontFamily }, variable: varClass ?? "" } };
}

/**
 * Self-hosted font. Import the file so it gets a hashed URL, then pass it:
 *   import inter from "./Inter.woff2";
 *   const font = localFont({ family: "Inter", src: [{ path: inter, weight: "400" }], display: "swap", variable: "--font-inter" });
 *   <body className={font.className}>
 */
export function localFont(opts) {
  check(opts, "localFont");
  const { family, display = "swap", fallback = ["sans-serif"], variable, preload = true } = opts;
  if (!["auto", "block", "swap", "fallback", "optional"].includes(display)) throw new TypeError('localFont(): "display" must be auto, block, swap, fallback or optional');
  const files = (typeof opts.src === "string" ? [{ path: opts.src }] : Array.isArray(opts.src) ? opts.src : []).map((f) => (typeof f === "string" ? { path: f } : f));
  if (!files.length || files.some((f) => typeof (f.path ?? f.src) !== "string" || !FORMATS[extOf(f.path ?? f.src)])) throw new TypeError("localFont(): src must be an imported font file (woff2, woff, ttf, otf) or a list of { path, weight, style }");
  let faces = "";
  const pre = [];
  for (const f of files) {
    const url = f.path ?? f.src, ext = extOf(url);
    const weight = f.weight ?? opts.weight, style = f.style ?? opts.style;
    if ((weight !== undefined && !/^[\w\s.]+$/.test(String(weight))) || (style !== undefined && !/^[\w\s-]+$/.test(String(style)))) throw new TypeError("localFont(): invalid weight or style");
    faces += `@font-face{font-family:'${family.replace(/'/g, "")}';src:url(${JSON.stringify(url)}) format('${FORMATS[ext]}');${weight !== undefined ? `font-weight:${weight};` : ""}${style !== undefined ? `font-style:${style};` : ""}font-display:${display}}`;
    if (preload) pre.push({ href: url, type: MIME_FONT[ext] });
  }
  const id = fnv(faces + stack(family, fallback) + (variable ?? ""));
  const { css, out } = result(id, family, fallback, variable);
  register(id, { css: faces + css, preload: pre, links: [] });
  return out;
}

/** Google font through fonts.googleapis.com (the browser downloads it; add fonts.googleapis.com / fonts.gstatic.com to your CSP). */
export function googleFont(opts) {
  check(opts, "googleFont");
  const { family, display = "swap", fallback = ["sans-serif"], variable } = opts;
  const weights = [].concat(opts.weight ?? "400").map(String);
  const styles = [].concat(opts.style ?? "normal");
  if (weights.some((w) => !/^\d{2,4}(\.\.\d{2,4})?$/.test(w))) throw new TypeError('googleFont(): "weight" must be numbers like "400" or a range like "100..900"');
  if (styles.some((s) => s !== "normal" && s !== "italic")) throw new TypeError('googleFont(): "style" must be "normal" and/or "italic"');
  const name = encodeURIComponent(family).replace(/%20/g, "+");
  const italic = styles.includes("italic");
  const axes = italic ? `ital,wght@${[...new Set(weights)].flatMap((w) => styles.map((s) => `${s === "italic" ? 1 : 0},${w}`)).sort().join(";")}` : `wght@${[...new Set(weights)].sort().join(";")}`;
  const href = `https://fonts.googleapis.com/css2?family=${name}:${axes}&display=${display}`;
  const id = fnv(href + stack(family, fallback) + (variable ?? ""));
  const { css, out } = result(id, family, fallback, variable);
  register(id, { css, preload: [], links: [href] });
  if (typeof document !== "undefined" && !document.head.querySelector(`link[data-nepx-font="${id}"]`)) {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href; l.setAttribute("data-nepx-font", id);
    document.head.append(l);
  }
  return out;
}

/** <head> markup for every font registered so far (server side). */
export function fontHead() {
  let html = "";
  const seen = new Set();
  for (const [id, e] of registry) {
    for (const href of e.links) {
      if (!seen.has("pc")) { seen.add("pc"); html += `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`; }
      html += `<link rel="stylesheet" href="${esc(href)}" data-nepx-font="${id}">`;
    }
    for (const p of e.preload) html += `<link rel="preload" href="${esc(p.href)}" as="font" type="${p.type}" crossorigin data-nepx-font="${id}">`;
    html += `<style data-nepx-font="${id}">${e.css.replace(/</g, "\\3c ")}</style>`;
  }
  return html;
}
