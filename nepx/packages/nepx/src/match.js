// Pure route matching, shared by the Node server and the browser runtime.
/** Match decoded path segments against routes sorted by specificity. */
export function matchRoute(routes, segments) {
  for (const r of routes) {
    const segs = r.segments;
    const last = segs[segs.length - 1];
    const rest = last && (last.catchall || last.optional); // [...x] needs >= 1 segment, [[...x]] accepts 0 or more
    const min = last && last.optional ? segs.length - 1 : segs.length;
    if (rest ? segments.length < min : segments.length !== segs.length) continue;
    const fixed = rest ? segs.length - 1 : segs.length;
    const params = {};
    let ok = true;
    for (let i = 0; i < fixed; i++) {
      const s = segs[i];
      if (s.param) params[s.param] = segments[i];
      else if (s.static !== segments[i]) { ok = false; break; }
    }
    if (!ok) continue;
    if (last && last.catchall) params[last.catchall] = segments.slice(fixed);
    else if (last && last.optional && segments.length > fixed) params[last.optional] = segments.slice(fixed);
    return { route: r, params };
  }
  return null;
}

/** The URL segments a matched route stands for (the inverse of matchRoute): used to match @slot pages against the same URL. */
export function segmentsFor(route, params) {
  const out = [];
  for (const s of route.segments) {
    if (s.static !== undefined) out.push(s.static);
    else if (s.param) out.push(String(params[s.param]));
    else { const v = params[s.catchall || s.optional]; if (Array.isArray(v)) out.push(...v); }
  }
  return out;
}

/** The page a @slot shows for these URL segments: its own page, else null (the caller falls back to default.*). */
export const matchSlot = (slot, segments) => matchRoute(slot.routes, segments);
/** Intercepting route of a @slot for a client-side navigation to these URL segments, or null. */
export const matchIntercept = (slot, segments) => (slot.intercepts.length ? matchRoute(slot.intercepts, segments) : null);
