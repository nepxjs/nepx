// Removes server-only exports (getServerSideProps, generateStaticParams, generateMetadata) from a page before it is bundled for the browser,
// so their code and imports never reach client.js.
import { NepxError } from "./errors/index.js";

function skipString(src, i, q) {
  for (i++; i < src.length; i++) {
    if (src[i] === "\\") i++;
    else if (q === "`" && src[i] === "$" && src[i + 1] === "{") i = skipBalanced(src, i + 1, "{", "}") - 1;
    else if (src[i] === q) return i + 1;
  }
  return i;
}

/** Returns the index just after the bracket matching src[start]. */
function skipBalanced(src, start, open, close) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, i, c) - 1; continue; }
    if (c === "/" && src[i + 1] === "/") { const e = src.indexOf("\n", i); i = e === -1 ? src.length : e; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e === -1 ? src.length : e + 1; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i + 1;
  }
  throw new NepxError("Unbalanced brackets while stripping server-only export");
}

function endOfStatementExpression(src, i) {
  while (/\s/.test(src[i])) i++;
  if (src.startsWith("async", i) && /\W/.test(src[i + 5])) { i += 5; while (/\s/.test(src[i])) i++; }
  if (src.startsWith("function", i)) { i = skipBalanced(src, src.indexOf("(", i), "(", ")"); i = skipBalanced(src, src.indexOf("{", i), "{", "}"); }
  else {
    if (src[i] === "(") i = skipBalanced(src, i, "(", ")"); else while (/[\w$]/.test(src[i])) i++;
    const arrow = src.indexOf("=>", i);
    if (arrow === -1) throw new NepxError("Cannot strip server-only export; declare it as `export async function`");
    i = arrow + 2;
    while (/\s/.test(src[i])) i++;
    if (src[i] === "{") i = skipBalanced(src, i, "{", "}");
    else { while (i < src.length && src[i] !== ";" && src[i] !== "\n") i++; }
  }
  while (src[i] === ";" || src[i] === " ") i++;
  return i;
}

function stripOne(src, name) {
  const re = new RegExp(`export\\s+(?:async\\s+)?function\\s*\\*?\\s*${name}\\b|export\\s+(?:const|let|var)\\s+${name}\\b`);
  const m = re.exec(src);
  if (!m) return src;
  let end;
  if (/function/.test(m[0])) {
    const paren = src.indexOf("(", m.index + m[0].length);
    end = skipBalanced(src, src.indexOf("{", skipBalanced(src, paren, "(", ")")), "{", "}");
  } else {
    end = endOfStatementExpression(src, src.indexOf("=", m.index + m[0].length) + 1);
  }
  return src.slice(0, m.index) + src.slice(end);
}

export function stripServerExports(source, names = ["getServerSideProps", "generateStaticParams", "generateMetadata"]) {
  return names.reduce((s, n) => stripOne(s, n), source);
}
