// Browser side of Server Actions: every export of a "use server" file becomes a function that POSTs to /_nepx/action.
import { navigate, refresh, getClientBasePath } from "../link.js";

function serializeArg(a) {
  if (typeof FormData !== "undefined" && a instanceof FormData) {
    const pairs = [];
    for (const [k, v] of a.entries()) {
      if (typeof v !== "string") throw new TypeError("Server actions cannot receive files yet: send text fields (or upload through an API route)");
      pairs.push([k, v]);
    }
    return { $formData: pairs };
  }
  return a;
}

export function createServerReference(id, name = "action") {
  const call = async (...args) => {
    let body;
    try { body = JSON.stringify({ args: args.map(serializeArg) }); }
    catch { throw new TypeError(`${name}(): server action arguments must be JSON-serializable (plain objects, arrays, strings, numbers, booleans, null) or FormData`); }
    const res = await fetch(getClientBasePath() + "/_nepx/action", { method: "POST", headers: { "content-type": "application/json", "x-nepx-action": id }, body, credentials: "same-origin" });
    let json = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      const err = new Error((json && json.error) || `Server action failed (${res.status})`);
      err.status = res.status;
      if (json && json.requestId) err.digest = json.requestId;
      throw err;
    }
    if (json && json.refresh) refresh();
    if (json && json.redirect) navigate(json.redirect);
    return json ? json.result : undefined;
  };
  try { Object.defineProperty(call, "name", { value: name }); } catch { /* ignore */ }
  return call;
}

/** Browser side of "use func": a GET /_nepx/func call (read-only server function; args travel in the query string). */
export function createFuncReference(id, name = "func") {
  const call = async (...args) => {
    let q;
    try { q = encodeURIComponent(JSON.stringify(args)); }
    catch { throw new TypeError(`${name}(): server function arguments must be JSON-serializable`); }
    const res = await fetch(getClientBasePath() + "/_nepx/func?args=" + q, { method: "GET", headers: { "x-nepx-func": id }, credentials: "same-origin" });
    let json = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) { const err = new Error((json && json.error) || `Server function failed (${res.status})`); err.status = res.status; if (json && json.requestId) err.digest = json.requestId; throw err; }
    return json ? json.result : undefined;
  };
  try { Object.defineProperty(call, "name", { value: name }); } catch { /* ignore */ }
  return call;
}
