// Pages-Router data functions mapped onto the App-Router machinery:
//   getStaticPaths()  -> { paths: [{ params } | "/blog/1"], fallback: false | true | "blocking" }   (same role as generateStaticParams)
//   getStaticProps(ctx) -> { props, notFound, redirect }   (page is prerendered at build, props reach the page like getServerSideProps)
import { NepxError } from "./errors/index.js";

/** "/blog/2024/x" -> { year: "2024", ... } for this route, or null when the path does not belong to it. */
export function paramsFromPath(route, str) {
  let segs;
  try { segs = String(str).split("/").filter(Boolean).map(decodeURIComponent); } catch { return null; }
  const params = {};
  let i = 0;
  for (const s of route.segments) {
    if (s.static !== undefined) { if (segs[i] !== s.static) return null; i++; continue; }
    if (s.param) { if (segs[i] === undefined) return null; params[s.param] = segs[i++]; continue; }
    const name = s.catchall || s.optional;
    const rest = segs.slice(i);
    if (s.catchall && !rest.length) return null;
    params[name] = rest;
    i = segs.length;
  }
  return i === segs.length ? params : null;
}

/** The list of params a page declares: generateStaticParams() or getStaticPaths().paths. Also returns `fallback` (getStaticPaths only). */
export async function loadStaticParams(route, mod) {
  if (typeof mod.generateStaticParams === "function") return { list: await mod.generateStaticParams(), fallback: undefined };
  const r = await mod.getStaticPaths();
  if (!r || typeof r !== "object" || !Array.isArray(r.paths)) throw new NepxError(`${route.file}: getStaticPaths must return { paths: [...], fallback }`);
  if (r.fallback !== undefined && r.fallback !== false && r.fallback !== true && r.fallback !== "blocking") throw new NepxError(`${route.file}: getStaticPaths fallback must be false, true or "blocking"`);
  const list = r.paths.map((p) => {
    if (typeof p === "string") {
      const params = paramsFromPath(route, p);
      if (!params) throw new NepxError(`${route.file}: getStaticPaths returned ${JSON.stringify(p)} which does not match this route`);
      return params;
    }
    if (!p || typeof p !== "object" || typeof p.params !== "object" || !p.params) throw new NepxError(`${route.file}: getStaticPaths paths must be strings or { params } objects`);
    return p.params;
  });
  return { list, fallback: r.fallback };
}
