// CSS Modules (*.module.css): class names are made unique per file. The same function runs in the client build
// (to emit the CSS) and in the server loader (to give SSR identical class names), so no esbuild is needed at runtime.
import { createHash } from "node:crypto";
import path from "node:path";

const TOKENS = /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|url\([^)]*\)|:global\(([^)]*)\)|\.(-?[_a-zA-Z][\w-]*)/g;

/** rel = file path relative to the code root (posix). -> { css, map } */
export function cssModule(source, rel) {
  const hash = createHash("sha256").update(rel).digest("hex").slice(0, 6);
  const stem = path.posix.basename(rel).replace(/\.module\.css$/, "").replace(/[^\w-]/g, "-");
  const map = {};
  const css = source.replace(TOKENS, (m, globalInner, name) => {
    if (globalInner !== undefined) return globalInner; // :global(.x) -> .x (stays global)
    if (name === undefined) return m; // comment / string / url()
    const local = `${stem}_${name}_${hash}`;
    map[name] = local;
    return "." + local;
  });
  return { css, map };
}
