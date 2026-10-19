import { statusInfo } from "./status-codes.js";

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const CSS = ':root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fafafa;color:#111;text-align:center;padding:2rem}main{max-width:32rem}h1{margin:0;font-size:4.5rem;line-height:1;letter-spacing:-.04em}h2{margin:.5rem 0;font-size:1.25rem}p{margin:0 0 1.5rem;color:#666}a{display:inline-block;padding:.55rem 1.1rem;border-radius:.5rem;background:#111;color:#fff;text-decoration:none;font-size:.9rem}@media(prefers-color-scheme:dark){body{background:#0b0b0c;color:#f4f4f5}p{color:#a1a1aa}a{background:#f4f4f5;color:#111}}';

/** Dependency-free HTML page (no React needed): socket-level errors and servers without pages. */
export function plainStatusHtml(status, message) {
  const { title, message: copy } = statusInfo(status);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${status} - ${escapeHtml(title)}</title><style>${CSS}</style></head><body><main><h1>${status}</h1><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message || copy)}</p><a href="/">Back to home</a></main></body></html>`;
}
