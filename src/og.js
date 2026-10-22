// next/og: ImageResponse - turn a JSX tree into an image (Open Graph cards, icons, dynamic images).
//   return new ImageResponse(<div style={{ display: "flex", fontSize: 64, background: "#111", color: "#fff", width: "100%", height: "100%" }}>Hello</div>, { width: 1200, height: 630 })
// Rendering: if the optional `satori` package is installed AND you pass `fonts`, it does the layout (full CSS flexbox, same engine as satori).
// Otherwise a built-in renderer draws a practical subset (flex row/column, padding, gap, colors, gradients, borders, radius, text, <img>) -
// text widths are estimated, so use satori when you need pixel-exact text. PNG output needs the optional `sharp`; `format: "svg"` needs nothing.

const isEl = (v) => v && typeof v === "object" && "type" in v && "props" in v;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------------------------------------- element tree -> plain nodes
function toNode(el) {
  if (el === null || el === undefined || typeof el === "boolean") return [];
  if (typeof el === "string" || typeof el === "number") return [{ text: String(el) }];
  if (Array.isArray(el)) return el.flatMap(toNode);
  if (!isEl(el)) throw new TypeError("ImageResponse: the first argument must be a React element");
  const { type, props } = el;
  if (typeof type === "function") {
    if (type.prototype && type.prototype.isReactComponent) throw new TypeError("ImageResponse: class components are not supported");
    return toNode(type(props ?? {}));
  }
  if (typeof type === "symbol") return toNode(props?.children); // Fragment
  if (typeof type !== "string") throw new TypeError("ImageResponse: unsupported element type");
  return [{ tag: type, style: props.style ?? {}, props, children: toNode(props.children) }];
}

// ---------------------------------------------------------------------------------------------- style helpers
const px = (v, ref = 0) => {
  if (v === undefined || v === null || v === "auto") return undefined;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (s.endsWith("%")) return (parseFloat(s) / 100) * ref;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
};
function box(style, prefix, ref) {
  const all = px(style[prefix], ref) ?? 0;
  const x = px(style[prefix + "Horizontal"], ref), y = px(style[prefix + "Vertical"], ref);
  return {
    t: px(style[prefix + "Top"], ref) ?? y ?? all, r: px(style[prefix + "Right"], ref) ?? x ?? all,
    b: px(style[prefix + "Bottom"], ref) ?? y ?? all, l: px(style[prefix + "Left"], ref) ?? x ?? all,
  };
}
const HEADING = { h1: 2, h2: 1.5, h3: 1.17, h4: 1, h5: 0.83, h6: 0.67 };
const INHERIT = ["color", "fontSize", "fontWeight", "fontFamily", "fontStyle", "lineHeight", "textAlign", "letterSpacing", "textTransform", "whiteSpace"];

function resolveStyle(node, parent) {
  const inherited = {};
  for (const k of INHERIT) if (parent && parent[k] !== undefined) inherited[k] = parent[k];
  const base = {};
  if (node.tag in HEADING) { base.fontSize = (px(inherited.fontSize) ?? 16) * HEADING[node.tag]; base.fontWeight = "bold"; }
  if (node.tag === "b" || node.tag === "strong") base.fontWeight = "bold";
  if (node.tag === "i" || node.tag === "em") base.fontStyle = "italic";
  return { ...inherited, ...base, ...node.style };
}

// ---------------------------------------------------------------------------------------------- text
const charW = (ch, size, bold) => size * (/[WM@%]/.test(ch) ? 0.9 : /[iljtfI.,:;'|! ]/.test(ch) ? 0.3 : /[A-Z0-9]/.test(ch) ? 0.64 : /[^\x00-\xff]/.test(ch) ? 1 : 0.52) * (bold ? 1.06 : 1);
const textW = (s, size, bold, spacing) => { let w = 0; for (const ch of s) w += charW(ch, size, bold) + spacing; return w; };
function wrap(text, maxW, size, bold, spacing, nowrap) {
  const lines = [];
  for (const para of text.split("\n")) {
    if (nowrap) { lines.push(para); continue; }
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      if (line && textW(line + word, size, bold, spacing) > maxW && word.trim()) { lines.push(line.trimEnd()); line = word.trimStart(); }
      else line += word;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------- layout
// measure(node, parentStyle, maxW, maxH) fills node.layout = { w, h, style, ... } (children get positions in place()).
function measure(node, parent, maxW, maxH) {
  if (node.text !== undefined) {
    const st = { ...parent };
    const size = px(st.fontSize) ?? 16, bold = /bold|[6-9]00/.test(String(st.fontWeight ?? "")), spacing = px(st.letterSpacing) ?? 0;
    let t = node.text;
    if (st.textTransform === "uppercase") t = t.toUpperCase(); else if (st.textTransform === "lowercase") t = t.toLowerCase(); else if (st.textTransform === "capitalize") t = t.replace(/\b\w/g, (c) => c.toUpperCase());
    if (!/pre/.test(st.whiteSpace ?? "")) t = t.replace(/[ \t\r\n]+/g, " ");
    const lh = st.lineHeight === undefined ? size * 1.2 : (typeof st.lineHeight === "number" && st.lineHeight < 10 ? st.lineHeight * size : px(st.lineHeight, size));
    const lines = wrap(t, maxW, size, bold, spacing, st.whiteSpace === "nowrap" || st.whiteSpace === "pre");
    const w = Math.min(maxW, Math.max(...lines.map((l) => textW(l, size, bold, spacing)), 0));
    node.layout = { w, h: lines.length * lh, text: { lines, size, bold, lh, st } };
    return node.layout;
  }
  const st = resolveStyle(node, parent);
  if (st.display === "none") { node.layout = { w: 0, h: 0, style: st, hidden: true, kids: [] }; return node.layout; }
  const pad = box(st, "padding", maxW), bw = px(st.borderWidth) ?? (st.border ? parseFloat(String(st.border)) || 0 : 0);
  let W = px(st.width, maxW), H = px(st.height, maxH);
  if (node.tag === "img") {
    const iw = px(node.props.width) ?? W, ih = px(node.props.height) ?? H;
    node.layout = { w: W ?? iw ?? 0, h: H ?? ih ?? 0, style: st, kids: [], image: node.props.src };
    return node.layout;
  }
  const mw = px(st.maxWidth, maxW), minW = px(st.minWidth, maxW);
  const outerW = W ?? Math.min(maxW, mw ?? maxW);
  const innerMaxW = outerW - pad.l - pad.r - bw * 2;
  const innerMaxH = (H ?? maxH) - pad.t - pad.b - bw * 2;
  const column = st.flexDirection === "column" || st.flexDirection === "column-reverse";
  const gap = px(st.gap) ?? 0;
  const kids = node.children.map((c) => ({ node: c, m: c.text === undefined ? box(resolveStyle(c, st), "margin", innerMaxW) : { t: 0, r: 0, b: 0, l: 0 } }));
  // Children are measured at the width left over after earlier siblings (row) or the full width (column).
  let used = 0, main = 0, cross = 0;
  for (const k of kids) {
    const avail = column ? innerMaxW - k.m.l - k.m.r : Math.max(0, innerMaxW - used - k.m.l - k.m.r);
    const cs = measure(k.node, st, avail, innerMaxH - (column ? main : 0));
    k.lay = cs;
    const mw2 = cs.w + k.m.l + k.m.r, mh = cs.h + k.m.t + k.m.b;
    if (column) { main += mh + gap; cross = Math.max(cross, mw2); } else { used += mw2 + gap; main += mw2 + gap; cross = Math.max(cross, mh); }
  }
  if (kids.length) main -= gap;
  const contentW = column ? cross : main, contentH = column ? main : cross;
  const w = W ?? Math.max(minW ?? 0, contentW + pad.l + pad.r + bw * 2);
  const h = H ?? contentH + pad.t + pad.b + bw * 2;
  node.layout = { w, h, style: st, pad, bw, kids, column, gap, W, H, tag: node.tag };
  return node.layout;
}

function place(node, x, y, w, h, out) {
  const L = node.layout;
  if (L.hidden) return;
  if (node.text !== undefined) { out.push({ kind: "text", x, y, w, h, ...L.text }); return; }
  const st = L.style, { pad, bw, column, gap } = L;
  const radius = px(st.borderRadius, Math.min(w, h)) ?? 0;
  const op = st.opacity === undefined ? 1 : Number(st.opacity);
  const bg = st.backgroundImage?.startsWith?.("linear-gradient") ? st.backgroundImage : st.background ?? st.backgroundColor;
  if (bg || bw) out.push({ kind: "rect", x, y, w, h, radius, bg, bw, bc: st.borderColor ?? (typeof st.border === "string" ? st.border.split(/\s+/).find((p) => /^(#|rgb|hsl|[a-z]+$)/i.test(p) && !/solid|dashed|dotted/.test(p)) : undefined) ?? "#000", op });
  if (L.image) { out.push({ kind: "image", x, y, w, h, src: L.image, radius, fit: st.objectFit }); return; }
  const ix = x + pad.l + bw, iy = y + pad.t + bw, iw = w - pad.l - pad.r - bw * 2, ih = h - pad.t - pad.b - bw * 2;
  const kids = L.kids, n = kids.length;
  if (!n) return;
  const total = kids.reduce((s, k) => s + (column ? k.lay.h + k.m.t + k.m.b : k.lay.w + k.m.l + k.m.r), 0) + gap * (n - 1);
  const mainSize = column ? ih : iw;
  const grow = kids.map((k) => (k.node.text === undefined ? Number(resolveStyleGrow(k.node)) || 0 : 0));
  const growTotal = grow.reduce((a, b) => a + b, 0);
  const free = mainSize - total;
  let offset = 0, between = 0;
  const jc = st.justifyContent;
  if (growTotal > 0 && free > 0) { /* grow below */ }
  else if (jc === "center") offset = free / 2;
  else if (jc === "flex-end" || jc === "end") offset = free;
  else if (jc === "space-between" && n > 1) between = free / (n - 1);
  else if (jc === "space-around") { between = free / n; offset = between / 2; }
  else if (jc === "space-evenly") { between = free / (n + 1); offset = between; }
  if (L.column && st.flexDirection === "column-reverse") kids.reverse();
  let pos = (column ? iy : ix) + Math.max(0, offset);
  const ai = st.alignItems;
  kids.forEach((k, i) => {
    let cw = k.lay.w, ch = k.lay.h;
    const extra = growTotal > 0 && free > 0 ? (free * grow[i]) / growTotal : 0;
    if (column) ch += extra; else cw += extra;
    const crossAvail = column ? iw - k.m.l - k.m.r : ih - k.m.t - k.m.b;
    const stretch = (ai === undefined || ai === "stretch" || ai === "normal") && k.node.text === undefined;
    const explicit = column ? k.lay.W !== undefined : k.lay.H !== undefined;
    if (stretch && !explicit && k.node.tag !== "img") { if (column) cw = crossAvail; else ch = crossAvail; }
    const crossSize = column ? cw : ch;
    let co = 0;
    if (ai === "center") co = (crossAvail - crossSize) / 2; else if (ai === "flex-end" || ai === "end") co = crossAvail - crossSize;
    const cx = column ? ix + k.m.l + co : pos + k.m.l, cy = column ? pos + k.m.t : iy + k.m.t + co;
    place(k.node, cx, cy, cw, ch, out);
    // text nodes keep their own width; containers laid out above already hold the right size
    pos += (column ? ch + k.m.t + k.m.b : cw + k.m.l + k.m.r) + gap + between;
  });
}
const resolveStyleGrow = (node) => node.style?.flexGrow ?? (node.style?.flex !== undefined ? parseFloat(String(node.style.flex)) : 0);

// ---------------------------------------------------------------------------------------------- SVG
function gradient(css, id) {
  const m = /^linear-gradient\((.*)\)$/i.exec(css.trim());
  if (!m) return null;
  const parts = []; let depth = 0, cur = "";
  for (const ch of m[1]) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && !depth) { parts.push(cur.trim()); cur = ""; } else cur += ch; }
  parts.push(cur.trim());
  let angle = 180;
  if (/^(to |-?[\d.]+deg)/.test(parts[0])) {
    const a = parts.shift();
    const dirs = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270, "to top right": 45, "to right top": 45, "to bottom right": 135, "to right bottom": 135, "to bottom left": 225, "to left bottom": 225, "to top left": 315, "to left top": 315 };
    angle = a in dirs ? dirs[a] : parseFloat(a);
  }
  const rad = (angle * Math.PI) / 180, dx = Math.sin(rad), dy = -Math.cos(rad);
  const stops = parts.map((p, i) => {
    const mm = /^(.*?)(?:\s+(-?[\d.]+)%)?$/.exec(p);
    return `<stop offset="${mm[2] !== undefined ? mm[2] + "%" : Math.round((i / Math.max(1, parts.length - 1)) * 100) + "%"}" stop-color="${esc(mm[1].trim())}"/>`;
  });
  return `<linearGradient id="${id}" x1="${(0.5 - dx / 2) * 100}%" y1="${(0.5 - dy / 2) * 100}%" x2="${(0.5 + dx / 2) * 100}%" y2="${(0.5 + dy / 2) * 100}%">${stops.join("")}</linearGradient>`;
}

function toSvg(items, width, height, fontFamily) {
  const defs = []; let body = "", gid = 0;
  for (const it of items) {
    if (it.kind === "rect") {
      let fill = "none";
      if (it.bg) {
        if (/^linear-gradient/i.test(it.bg)) { const id = `g${gid++}`, g = gradient(it.bg, id); if (g) { defs.push(g); fill = `url(#${id})`; } }
        else fill = esc(it.bg);
      }
      const half = it.bw / 2;
      body += `<rect x="${it.x + half}" y="${it.y + half}" width="${Math.max(0, it.w - it.bw)}" height="${Math.max(0, it.h - it.bw)}" rx="${it.radius}" fill="${fill}"${it.bw ? ` stroke="${esc(it.bc)}" stroke-width="${it.bw}"` : ""}${it.op !== 1 ? ` opacity="${it.op}"` : ""}/>`;
    } else if (it.kind === "image") {
      const id = `c${gid++}`;
      if (it.radius) defs.push(`<clipPath id="${id}"><rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="${it.radius}"/></clipPath>`);
      body += `<image href="${esc(it.src)}" x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" preserveAspectRatio="${it.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice"}"${it.radius ? ` clip-path="url(#${id})"` : ""}/>`;
    } else {
      const st = it.st, align = st.textAlign;
      const anchor = align === "center" ? "middle" : align === "right" || align === "end" ? "end" : "start";
      const tx = anchor === "middle" ? it.x + it.w / 2 : anchor === "end" ? it.x + it.w : it.x;
      it.lines.forEach((line, i) => {
        if (!line) return;
        const y = it.y + i * it.lh + it.lh / 2 + it.size * 0.35;
        body += `<text x="${tx}" y="${y}" font-size="${it.size}" font-family="${esc(st.fontFamily ?? fontFamily)}" font-weight="${it.bold ? 700 : (st.fontWeight ?? 400)}"${st.fontStyle === "italic" ? ' font-style="italic"' : ""} fill="${esc(st.color ?? "#000")}" text-anchor="${anchor}"${st.letterSpacing ? ` letter-spacing="${px(st.letterSpacing)}"` : ""} xml:space="preserve">${esc(line)}</text>`;
      });
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${defs.join("")}</defs>${body}</svg>`;
}

/** The built-in renderer: React element -> SVG string. */
export function renderToSvg(element, { width = 1200, height = 630, fontFamily = "sans-serif" } = {}) {
  const roots = toNode(element);
  if (roots.length !== 1 || roots[0].text !== undefined) throw new TypeError("ImageResponse: pass one root element (wrap the content in a <div>)");
  const root = roots[0];
  root.style = { display: "flex", ...root.style }; // the root always fills the canvas unless it sets its own size
  root.style = { width, height, ...root.style };
  measure(root, { fontSize: 16 }, width, height);
  const out = [];
  place(root, 0, 0, root.layout.w, root.layout.h, out);
  return toSvg(out, width, height, fontFamily);
}

// ---------------------------------------------------------------------------------------------- ImageResponse
async function optional(name) { try { return (await import(/* @vite-ignore */ name)).default; } catch { return null; } }

async function render(element, o) {
  const { width, height, format, fonts } = o;
  let svg;
  const satori = fonts && fonts.length ? await optional("satori") : null;
  if (satori) svg = await satori(element, { width, height, fonts, debug: o.debug });
  else svg = renderToSvg(element, { width, height, fontFamily: o.fontFamily });
  if (format === "svg") return { body: Buffer.from(svg), type: "image/svg+xml" };
  const sharp = await optional("sharp");
  if (!sharp) throw new Error('ImageResponse needs the "sharp" package to produce png/jpeg/webp (npm i sharp), or pass { format: "svg" }');
  const img = sharp(Buffer.from(svg), { density: 72 });
  if (format === "jpeg") return { body: await img.flatten({ background: "#fff" }).jpeg({ quality: 90 }).toBuffer(), type: "image/jpeg" };
  if (format === "webp") return { body: await img.webp().toBuffer(), type: "image/webp" };
  return { body: await img.png().toBuffer(), type: "image/png" };
}

/**
 * new ImageResponse(element, { width = 1200, height = 630, format = "png" | "jpeg" | "webp" | "svg", fonts, emoji, debug, status, statusText, headers })
 * A standard Response: return it from a route handler, or from app/opengraph-image.jsx / icon.jsx / apple-icon.jsx / twitter-image.jsx.
 */
export class ImageResponse extends Response {
  constructor(element, options = {}) {
    const { width = 1200, height = 630, format = "png", fonts, status = 200, statusText, headers, debug, fontFamily } = options;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) throw new RangeError("ImageResponse: width and height must be integers between 1 and 4096");
    if (!["png", "jpeg", "webp", "svg"].includes(format)) throw new RangeError('ImageResponse: format must be "png", "jpeg", "webp" or "svg"');
    const h = new Headers(headers);
    const ext = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml" }[format];
    if (!h.has("content-type")) h.set("content-type", ext);
    if (!h.has("cache-control")) h.set("cache-control", process.env.NODE_ENV === "production" ? "public, immutable, no-transform, max-age=31536000" : "no-cache, no-store");
    const work = render(element, { width, height, format, fonts, debug, fontFamily });
    work.catch(() => {}); // surfaced through the stream below
    super(new ReadableStream({
      async start(controller) {
        try { const { body } = await work; controller.enqueue(new Uint8Array(body)); controller.close(); }
        catch (e) { controller.error(e); }
      },
    }), { status, statusText, headers: h });
  }
}
