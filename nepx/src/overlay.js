// Development error overlay (like the Next.js one): turns any server, build or browser error into
// a readable panel with the message, a code frame of the failing source line and a call stack.
// Only used by `nepx dev`; production never loads this and never exposes messages or stacks.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseInlineMap } from "./sourcemap.js";

const NEPX_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const VERSION = (() => { try { return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version; } catch { return ""; } })();

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ser = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const clip = (s, n) => String(s ?? "").slice(0, n);
const posix = (p) => p.split(path.sep).join("/");

export const LIVE_RELOAD = `<script>(function(){var es=new EventSource("/_nepx/livereload");es.onerror=function(){es.close();var t=setInterval(function(){fetch("/_nepx/livereload",{method:"HEAD"}).then(function(){clearInterval(t);location.reload()}).catch(function(){})},300)}})()</script>`;

// ---------------------------------------------------------------- stack + code frames

const NODE_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
const BROWSER_FRAME = /^\s*(?:at\s+(.*?)\s+\(|at\s+|(.*?)@)?(https?:\/\/[^\s)]+?):(\d+):(\d+)\)?\s*$/;

/** Frames that are not the user's code: node internals, node_modules and Nepx itself. */
function isIgnored(abs) {
  if (!abs || abs.startsWith("node:")) return true;
  return abs.includes(`${path.sep}node_modules${path.sep}`) || abs.startsWith(NEPX_DIR + path.sep);
}
const inside = (abs, root) => !!abs && path.resolve(abs).startsWith(path.resolve(root) + path.sep);
const display = (abs, root) => (inside(abs, root) ? posix(path.relative(root, abs)) : abs);

function parseNodeStack(stack, root) {
  const frames = [];
  for (const line of String(stack).split("\n")) {
    const m = NODE_FRAME.exec(line);
    if (!m) continue;
    let abs = m[2];
    if (abs.startsWith("file://")) { try { abs = fileURLToPath(abs); } catch { continue; } }
    frames.push({ fn: m[1] || "<anonymous>", file: display(abs, root), line: Number(m[3]), column: Number(m[4]), ignored: isIgnored(abs) || !inside(abs, root), abs });
  }
  return frames;
}

/** A few source lines around `line` (1-based) of a file inside the project, or null. */
function codeFrame(abs, line, column, root, context = 3) {
  if (!abs || !line || isIgnored(abs) || !inside(abs, root)) return null;
  let src;
  try { src = readFileSync(abs, "utf8"); } catch { return null; }
  const all = src.replace(/\r?\n$/, "").split(/\r?\n/); // no phantom empty last line
  if (line > all.length) return null;
  const from = Math.max(1, line - context), to = Math.min(all.length, line + context);
  return { file: display(abs, root), line, column: column || 0, lines: all.slice(from - 1, to).map((text, i) => ({ n: from + i, text: clip(text, 300) })) };
}

// "/abs/or/relative/file.jsx:3:7: message" (esbuild / loader syntax errors)
const MESSAGE_LOCATION = /^(.+?):(\d+):(\d+): /m;

/** Everything the overlay needs about an error, JSON-serializable. column is 1-based. */
export function buildPayload(err, { projectRoot, kind = "Server Error", method, url, requestId, status = 500, handled = false } = {}) {
  const isObj = !!err && typeof err === "object";
  const name = isObj && err.name ? String(err.name) : "Error";
  const rootPrefix = projectRoot ? path.resolve(projectRoot) + path.sep : null;
  let message = clip(isObj && err.message != null ? err.message : err, 8000);
  if (rootPrefix) message = message.split(rootPrefix).join(""); // paths relative to the project, like the code frame header
  const details = isObj && Array.isArray(err.details) ? err.details : null;
  const stack = details ? "" : clip(isObj && err.stack ? err.stack : "", 20000);
  const frames = details ? [] : parseNodeStack(stack, projectRoot);
  const code = [];
  if (details) {
    for (const d of details.slice(0, 5)) {
      const f = d.file && codeFrame(path.resolve(projectRoot, d.file), d.line, d.column, projectRoot);
      if (f) code.push({ ...f, text: d.text });
    }
  } else {
    const top = frames.find((f) => !f.ignored);
    const f = top && codeFrame(top.abs, top.line, top.column, projectRoot);
    if (f) code.push(f);
    else {
      const m = MESSAGE_LOCATION.exec(message);
      const g = m && codeFrame(path.resolve(projectRoot, m[1]), Number(m[2]), Number(m[3]), projectRoot);
      if (g) code.push(g);
    }
  }
  if (kind === "Server Error" && (details || (name === "SyntaxError" && MESSAGE_LOCATION.test(message)))) kind = "Build Error";
  const buildError = kind === "Build Error"; // the call stack of a compile error is only loader internals: show the code frame instead
  return {
    kind, name, message, stack: buildError ? "" : stack,
    frames: buildError ? [] : frames.slice(0, 40).map(({ abs, ...f }) => f), code,
    request: method ? { method, url: clip(url, 500), id: requestId, status } : null,
    handled, version: VERSION,
  };
}

/** A short version for the terminal: location + code frame. */
export function terminalFrame(payload) {
  const c = payload.code[0];
  if (!c) return "";
  const w = String(c.lines[c.lines.length - 1].n).length;
  const rows = c.lines.map((l) => `${l.n === c.line ? ">" : " "} ${String(l.n).padStart(w)} | ${l.text}`);
  const caret = c.column ? [`  ${" ".repeat(w)} | ${" ".repeat(Math.max(0, c.column - 1))}^`] : [];
  const at = rows.findIndex((_r, i) => c.lines[i].n === c.line);
  rows.splice(at + 1, 0, ...caret);
  return `  ${c.file}:${c.line}${c.column ? ":" + c.column : ""}\n${rows.join("\n")}\n`;
}

// ---------------------------------------------------------------- browser errors -> original source

const mapCache = new WeakMap(); // asset object -> SourceMap | null

/** The browser reported an error (stack of bundled client.js frames): map it back to the source files. */
export function resolveBrowserError(body, { assets, projectRoot }) {
  const stack = clip(body && body.stack, 20000);
  const frames = [];
  for (const line of stack.split("\n")) {
    const m = BROWSER_FRAME.exec(line);
    if (!m) continue;
    const fn = m[1] || m[2] || "<anonymous>";
    let pathname;
    try { pathname = new URL(m[3]).pathname; } catch { continue; }
    const asset = assets.get(pathname);
    let map = null;
    if (asset && pathname.endsWith(".js")) {
      if (!mapCache.has(asset)) mapCache.set(asset, parseInlineMap(Buffer.from(asset.body).toString("utf8")));
      map = mapCache.get(asset);
    }
    const pos = map && map.find(Number(m[4]), Number(m[5]) - 1);
    if (pos) {
      const abs = path.resolve(projectRoot, ".nepx-out", pos.source); // esbuild writes sources relative to the output dir
      frames.push({ fn, file: display(abs, projectRoot), line: pos.line, column: pos.column + 1, ignored: isIgnored(abs) || !inside(abs, projectRoot), abs });
    } else frames.push({ fn, file: pathname, line: Number(m[4]), column: Number(m[5]), ignored: true });
  }
  const top = frames.find((f) => !f.ignored);
  const f = top && codeFrame(top.abs, top.line, top.column, projectRoot);
  return { frames: frames.slice(0, 40).map(({ abs, ...x }) => x), code: f ? [f] : [], version: VERSION };
}

// ---------------------------------------------------------------- the panel (runs in the browser)

/** Stringified into an inline <script>: keep it self-contained (no imports, no outer variables). */
function clientOverlay() {
  if (window.__nepxOverlay) return;
  var errors = [], index = 0, open = false, host = null, view = null, showIgnored = false, seen = {};
  var CSS = [
    ":host{all:initial}",
    "*{box-sizing:border-box}",
    ".bd{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;padding:4vh 16px;overflow:auto;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#ededed}",
    ".card{width:100%;max-width:880px;background:#141414;border:1px solid #2e2e2e;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden}",
    ".hd{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #2e2e2e;background:#1a1a1a}",
    ".dot{width:10px;height:10px;border-radius:50%;background:#ff5555;box-shadow:0 0 8px #ff5555}",
    ".kind{font-weight:600;color:#ff8080}.sp{flex:1}",
    "button{font:inherit;color:#ededed;background:#262626;border:1px solid #3a3a3a;border-radius:6px;padding:2px 10px;cursor:pointer}",
    "button:hover{background:#333}.pg{color:#999;font-size:13px}",
    ".bd2{padding:16px 20px}",
    ".title{margin:0 0 6px;font-size:18px;font-weight:600;color:#fff;white-space:pre-wrap;word-break:break-word}",
    ".req{color:#9a9a9a;font-size:13px;margin-bottom:12px}.req b{color:#ddd}",
    ".cf{margin:14px 0;border:1px solid #2e2e2e;border-radius:8px;overflow:hidden;background:#0d0d0d}",
    ".cfh{padding:6px 12px;background:#1a1a1a;color:#8ab4ff;font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;border-bottom:1px solid #2e2e2e}",
    ".cft{padding:6px 12px;color:#ffb3b3;font-size:13px;border-bottom:1px solid #2e2e2e;white-space:pre-wrap}",
    "pre{margin:0;padding:8px 0;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:auto}",
    ".r{display:flex;padding:0 12px;white-space:pre}.r.hit{background:rgba(255,85,85,.16)}",
    ".n{width:3.2em;flex:none;color:#666;text-align:right;padding-right:12px;user-select:none}.hit .n{color:#ff8080}",
    ".car{color:#ff5555}",
    "h2{margin:18px 0 6px;font-size:13px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:.04em}",
    ".fr{padding:5px 0;border-bottom:1px solid #222;font-size:13px}.fr .f{color:#ddd}.fr .l{color:#8ab4ff;font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all}",
    ".fr.ig{opacity:.5}",
    ".ft{padding:10px 20px;border-top:1px solid #2e2e2e;color:#777;font-size:12px;background:#111}",
    ".cs{white-space:pre-wrap;color:#bbb}",
    ".pill{position:fixed;left:16px;bottom:16px;z-index:2147483647;display:flex;align-items:center;gap:8px;background:#141414;color:#ffb3b3;border:1px solid #5a2a2a;border-radius:999px;padding:6px 14px;font:600 13px ui-sans-serif,system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.4)}"
  ].join("\n");

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function close() { open = false; render(); }
  function render() {
    if (!host) {
      host = document.createElement("nepx-dev-overlay");
      var shadow = host.attachShadow({ mode: "open" });
      var st = document.createElement("style"); st.textContent = CSS; shadow.appendChild(st);
      view = el("div"); shadow.appendChild(view);
      document.documentElement.appendChild(host);
    }
    view.textContent = "";
    if (!errors.length) return;
    if (index >= errors.length) index = errors.length - 1;
    var e = errors[index];
    if (!open) {
      var pill = el("button", "pill", "\u25CF " + errors.length + (errors.length === 1 ? " error" : " errors"));
      pill.title = "Open the Nepx error overlay";
      pill.onclick = function () { open = true; render(); };
      view.appendChild(pill);
      return;
    }
    var bd = el("div", "bd");
    bd.onclick = function (ev) { if (ev.target === bd) close(); };
    var card = el("div", "card"); card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true");
    var hd = el("div", "hd");
    hd.appendChild(el("span", "dot"));
    hd.appendChild(el("span", "kind", e.kind || "Error"));
    if (errors.length > 1) {
      var prev = el("button", null, "\u2039"), next = el("button", null, "\u203A");
      prev.onclick = function () { index = (index + errors.length - 1) % errors.length; render(); };
      next.onclick = function () { index = (index + 1) % errors.length; render(); };
      hd.appendChild(prev); hd.appendChild(el("span", "pg", (index + 1) + " / " + errors.length)); hd.appendChild(next);
    }
    hd.appendChild(el("span", "sp"));
    var x = el("button", null, "\u00D7"); x.title = "Close (Esc)"; x.onclick = close; hd.appendChild(x);
    card.appendChild(hd);

    var body = el("div", "bd2");
    body.appendChild(el("p", "title", (e.name && e.message.indexOf(e.name) !== 0 ? e.name + ": " : "") + e.message));
    if (e.request) {
      var rq = el("div", "req");
      rq.appendChild(el("b", null, e.request.method + " " + e.request.url));
      rq.appendChild(document.createTextNode(" \u00B7 " + e.request.status + (e.request.id ? " \u00B7 request " + e.request.id : "")));
      body.appendChild(rq);
    }
    (e.code || []).forEach(function (c) {
      var box = el("div", "cf");
      box.appendChild(el("div", "cfh", c.file + ":" + c.line + (c.column ? ":" + c.column : "")));
      if (c.text) box.appendChild(el("div", "cft", c.text));
      var pre = el("pre");
      c.lines.forEach(function (l) {
        var row = el("div", "r" + (l.n === c.line ? " hit" : ""));
        row.appendChild(el("span", "n", String(l.n))); row.appendChild(el("span", null, l.text || " "));
        pre.appendChild(row);
        if (l.n === c.line && c.column) {
          var cr = el("div", "r"); cr.appendChild(el("span", "n", ""));
          cr.appendChild(el("span", "car", new Array(c.column).join(" ") + "^")); pre.appendChild(cr);
        }
      });
      box.appendChild(pre); body.appendChild(box);
    });
    var frames = e.frames || [], shown = frames.filter(function (f) { return showIgnored || !f.ignored; }), hidden = frames.length - frames.filter(function (f) { return !f.ignored; }).length;
    if (frames.length) {
      body.appendChild(el("h2", null, "Call Stack " + shown.length));
      shown.forEach(function (f) {
        var fr = el("div", "fr" + (f.ignored ? " ig" : ""));
        fr.appendChild(el("div", "f", f.fn));
        fr.appendChild(el("div", "l", f.file + ":" + f.line + ":" + f.column));
        body.appendChild(fr);
      });
      if (hidden > 0) {
        var tg = el("button", null, showIgnored ? "Hide framework frames" : "Show " + hidden + " framework frame" + (hidden === 1 ? "" : "s"));
        tg.style.marginTop = "8px"; tg.onclick = function () { showIgnored = !showIgnored; render(); };
        body.appendChild(tg);
      }
    } else if (e.stack && !(e.code || []).length) { body.appendChild(el("h2", null, "Stack")); body.appendChild(el("div", "cs", e.stack)); }
    if (e.componentStack) { body.appendChild(el("h2", null, "Component Stack")); body.appendChild(el("div", "cs", String(e.componentStack).replace(/^\n+/, ""))); }
    card.appendChild(body);
    card.appendChild(el("div", "ft", "Nepx.js" + (e.version ? " " + e.version : "") + " (dev) \u00B7 only shown in development \u00B7 it disappears when you fix the error \u00B7 Esc to close"));
    bd.appendChild(card); view.appendChild(bd);
  }

  function add(p) { errors.push(p); if (!p.handled) open = true; index = errors.length - 1; render(); return p; }
  function kindOf(message) { return /hydrat|did not match|Minified React error #(418|423|425)/i.test(message) ? "Hydration Error" : "Runtime Error"; }
  function report(err, opts) {
    opts = opts || {};
    if (err && err.digest === "NEPX_NOT_FOUND") return;
    var name = (err && err.name) || "Error";
    var message = err && err.message != null ? String(err.message) : String(err);
    var stack = err && err.stack ? String(err.stack) : "";
    var key = name + "|" + message + "|" + stack.split("\n").slice(0, 3).join("|");
    if (seen[key]) return; seen[key] = 1;
    var p = add({ kind: opts.kind || kindOf(message), name: name, message: message, stack: stack, frames: [], code: [], componentStack: opts.componentStack || "", handled: !!opts.handled });
    try {
      fetch("/_nepx/overlay/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name, message: message, stack: stack }) })
        .then(function (r) { return r.json(); })
        .then(function (res) { p.frames = res.frames || []; p.code = res.code || []; p.version = res.version; render(); })
        .catch(function () {});
    } catch (_e) { /* ignore */ }
  }

  window.__nepxOverlay = { show: add, report: report };
  window.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && open) close(); });
  window.addEventListener("error", function (ev) {
    if (ev.target && ev.target !== window) return; // failed <img>/<script> loads
    if (!ev.error && (!ev.message || ev.message === "Script error.")) return;
    report(ev.error || new Error(ev.message));
  });
  window.addEventListener("unhandledrejection", function (ev) {
    var r = ev.reason, m;
    if (r instanceof Error) return report(r, { kind: "Unhandled Rejection" });
    try { m = typeof r === "string" ? r : JSON.stringify(r); } catch (_e) { m = String(r); }
    report(new Error(m === undefined ? "Unhandled promise rejection" : m), { kind: "Unhandled Rejection" });
  });
  if (window.__NEPX_DEV_ERROR__) add(window.__NEPX_DEV_ERROR__);
}

export const OVERLAY_SCRIPT = `<script>(${clientOverlay.toString()})()</script>`;

/** The <script> tags a development page gets: the panel (+ the server's own error, if any). */
export function devScripts(devError) {
  return `${devError ? `<script>window.__NEPX_DEV_ERROR__=${ser(devError)}</script>` : ""}${OVERLAY_SCRIPT}`;
}

/** Full page for a request that could not be rendered at all (no error.jsx to fall back on). */
export function errorPageHtml(payload) {
  const first = String(payload.message).split("\n")[0];
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(payload.kind)} | Nepx</title><style>body{margin:0;min-height:100vh;background:#0a0a0a;color:#ededed;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}#nepx-fallback{max-width:880px;margin:0 auto;padding:10vh 20px}#nepx-fallback .k{color:#ff8080;font-weight:600;margin:0 0 6px}#nepx-fallback h1{font-size:20px;margin:0 0 16px;word-break:break-word}#nepx-fallback pre{white-space:pre-wrap;word-break:break-word;color:#aaa;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}</style></head><body><main id="nepx-fallback"><p class="k">${esc(payload.kind)}</p><h1>${esc(first)}</h1><noscript><pre>${esc(payload.stack || payload.message)}</pre></noscript></main>${devScripts(payload)}${LIVE_RELOAD}</body></html>\n`;
}
