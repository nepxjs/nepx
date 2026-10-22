// Server Actions: a file that starts with "use server" exports async functions that the browser can call.
//   server: the real functions (called through POST /_nepx/action with an action id)
//   browser bundle: every export is replaced by a stub that sends the call to the server (createServerReference)
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import path from "node:path";
import { NepxError } from "./errors/index.js";
import { isActionFile } from "./action-kit.js";

const CODE_EXT = /\.(jsx?|tsx?|ksx)$/;
const SKIP_DIRS = new Set(["node_modules", ".nepx", ".git", "public", "dist", "build", "coverage"]);
const DIRECTIVE_TOP = /^\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)\s*)*(["'])use server\1\s*;?/;
const DIRECTIVE_ANY = /^\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)\s*)*(["'])use (server|func|client)\1\s*;?/;
const DIRECTIVE_LINE_ANY = /^[ \t]*["']use (?:server|func)["'];?[ \t]*$/m;
const SERVER_ONLY_CALL = /(?<![.\w$])(cookies|headers|revalidatePath|revalidateTag|draftMode|unstable_cache|after)\s*\(/;
const DIRECTIVE_LINE = /^[ \t]*["']use server["'];?[ \t]*$/m;
const IDENT = /^[A-Za-z_$][\w$]*$/;

export const hasUseServer = (src) => DIRECTIVE_TOP.test(src);
/** A server-action module: starts with "use server" OR is named *.action.js (no directive needed). */
export const isActionModule = (src, rel) => isActionFile(rel) || DIRECTIVE_TOP.test(src);
/** The module kind from its first directive: "server" (POST action), "func" (GET server function), "client" (browser module) or null. */
export function moduleKind(src, rel = "") {
  const m = DIRECTIVE_ANY.exec(src);
  if (m) return m[2];
  return isActionFile(rel) ? "server" : null;
}
/** A "use client" module must not call server-only APIs (cookies(), revalidatePath(), ...): returns the offending call name or null. */
export function clientServerOnlyCall(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
  if (!/from\s*["']nepx["']/.test(code)) return null; // only when imported from "nepx"
  const m = SERVER_ONLY_CALL.exec(code);
  return m ? m[1] : null;
}

/** Stable id of one exported function: hash(file) + name. The browser only ever sees this, never the file path. */
export const actionId = (rel, name) => createHash("sha256").update(rel).digest("hex").slice(0, 10) + "." + name;

/** Names exported by a "use server" module (plain `export` forms only; see README for what is supported). */
export function exportedNames(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
  const names = new Set();
  let m;
  const fn = /\bexport\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g;
  while ((m = fn.exec(code))) names.add(m[1]);
  const vars = /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = vars.exec(code))) names.add(m[1]);
  const lists = /\bexport\s*\{([^}]*)\}/g;
  while ((m = lists.exec(code))) {
    for (let part of m[1].split(",")) {
      part = part.trim().replace(/^type\s+/, "");
      if (!part) continue;
      const as = part.split(/\s+as\s+/);
      const out = (as[1] ?? as[0]).trim();
      if (IDENT.test(out) || out === "default") names.add(out);
    }
  }
  if (/\bexport\s+default\b/.test(code)) names.add("default");
  return [...names];
}

function* walkCode(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name === process.env.NEPX_DIST_DIR || name.startsWith(".")) continue;
    const abs = path.join(dir, name);
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) yield* walkCode(abs);
    else if (CODE_EXT.test(name)) yield abs;
  }
}

/** 1-based line of an inline "use server" directive (inside a function), or 0. */
export function findInlineDirective(src) {
  const m = DIRECTIVE_LINE_ANY.exec(src);
  return m ? src.slice(0, m.index).split("\n").length : 0;
}

/** Every "use server" file below `root` -> Map(id -> { file (relative, "/" separators), name }). Throws on inline "use server". */
export function scanActions(root) {
  const map = new Map();
  for (const abs of walkCode(root)) {
    const src = readFileSync(abs, "utf8");
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const kind = moduleKind(src, rel);
    if (kind === "client") {
      const bad = clientServerOnlyCall(src);
      if (bad) throw new NepxError(`${rel}: a "use client" module cannot call ${bad}() (server-only). Call it from a "use server" action or a route handler instead.`);
      continue;
    }
    if (!kind) {
      if (!/use (server|func)/.test(src)) continue;
      const line = findInlineDirective(src);
      if (line) throw new NepxError(`${rel}:${line}: an inline "use server" / "use func" inside a function is not supported. Move the function into a file that starts with the directive.`);
      continue;
    }
    for (const name of exportedNames(src)) map.set(actionId(rel, name), { file: rel, name, kind });
  }
  return map;
}

/** Browser replacement for a "use server" file: one stub per export. */
export function clientStub(src, rel, kind = "server") {
  const names = exportedNames(src);
  const maker = kind === "func" ? "createFuncReference" : "createServerReference";
  const lines = [`import { ${maker} } from "nepx";`];
  for (const n of names) {
    const ref = `${maker}(${JSON.stringify(actionId(rel, n))}, ${JSON.stringify(n)})`;
    lines.push(n === "default" ? `export default ${ref};` : `export const ${n} = ${ref};`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------- call protocol
/** Arguments are JSON; a FormData argument (<form action={fn}>) travels as { $formData: [[name, value], ...] } (text fields only). */
export function reviveArgs(args) {
  if (!Array.isArray(args) || args.length > 50) throw new TypeError("args must be an array");
  return args.map((a) => {
    if (a && typeof a === "object" && !Array.isArray(a) && Array.isArray(a.$formData) && Object.keys(a).length === 1) {
      const fd = new FormData();
      for (const pair of a.$formData) { if (!Array.isArray(pair) || typeof pair[0] !== "string" || typeof pair[1] !== "string") throw new TypeError("invalid form data"); fd.append(pair[0], pair[1]); }
      return fd;
    }
    return a;
  });
}
