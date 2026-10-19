// Minimal source-map v3 reader (no dependencies). The dev overlay uses it to turn a browser stack frame
// (line/column inside the bundled client.js) back into the original file, line and column.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

function vlq(segment) {
  const out = [];
  let shift = 0, value = 0;
  for (const ch of segment) {
    const d = B64_INDEX.get(ch);
    if (d === undefined) return out;
    value += (d & 31) << shift;
    if (d & 32) shift += 5;
    else { out.push(value & 1 ? -(value >> 1) : value >> 1); value = 0; shift = 0; }
  }
  return out;
}

/** "AAAA,CAAC;..." -> per generated line: [[genCol, sourceIndex, sourceLine, sourceCol], ...] (all 0-based). */
function decodeMappings(mappings) {
  const lines = [];
  let src = 0, srcLine = 0, srcCol = 0;
  for (const lineStr of mappings.split(";")) {
    const segs = [];
    let genCol = 0;
    if (lineStr) {
      for (const seg of lineStr.split(",")) {
        const f = vlq(seg);
        if (!f.length) continue;
        genCol += f[0];
        if (f.length >= 4) { src += f[1]; srcLine += f[2]; srcCol += f[3]; segs.push([genCol, src, srcLine, srcCol]); }
      }
    }
    lines.push(segs);
  }
  return lines;
}

export class SourceMap {
  constructor(raw) {
    this.sources = raw.sources || [];
    this.lines = decodeMappings(raw.mappings || "");
  }
  /** line is 1-based, column 0-based (like a browser stack frame minus one). -> { source, line (1-based), column (0-based) } | null */
  find(line, column) {
    const segs = this.lines[line - 1];
    if (!segs || !segs.length) return null;
    let lo = 0, hi = segs.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid][0] <= column) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (best < 0) return null;
    const [, s, l, c] = segs[best];
    return { source: this.sources[s], line: l + 1, column: c };
  }
}

/** Read the inline `//# sourceMappingURL=data:...;base64,...` comment at the end of a bundle. */
export function parseInlineMap(code) {
  const m = /\/\/# sourceMappingURL=data:application\/json;(?:charset=[\w-]+;)?base64,([A-Za-z0-9+/=]+)\s*$/.exec(code);
  if (!m) return null;
  try { return new SourceMap(JSON.parse(Buffer.from(m[1], "base64").toString("utf8"))); } catch { return null; }
}
