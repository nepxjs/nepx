// React + Router hooks (isomorphic: safe to render on the server).
import { useCallback, useEffect, useRef, useState, useContext, createContext } from "react";
import { RouterContext } from "./link.js";
import { isNotFoundError } from "./shared.js";

// React 19 primitives, re-exported so `import { useActionState } from "nepx"` works like next/react.
export { useActionState, useOptimistic, useTransition, useDeferredValue, useId, use, cache } from "react";

/**
 * useAction(fn) - run a server action (or any async fn) with built-in state.
 *   const { execute, pending, data, error, fieldErrors, reset } = useAction(createPost, { onSuccess, onError });
 * Works with createAction() results ({ ok, data, error, fieldErrors }) and with plain return values.
 */
export function useAction(fn, { onSuccess, onError } = {}) {
  const [state, setState] = useState({ pending: false, data: undefined, error: null, fieldErrors: undefined, executed: false });
  const run = useRef(0), alive = useRef(true), cb = useRef({ onSuccess, onError });
  cb.current = { onSuccess, onError };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const execute = useCallback(async (...args) => {
    const id = ++run.current;
    setState((s) => ({ ...s, pending: true, error: null, fieldErrors: undefined }));
    const apply = (next) => { if (alive.current && id === run.current) setState(next); };
    try {
      const res = await fn(...args);
      if (res && typeof res === "object" && res.ok === false) {
        apply({ pending: false, data: undefined, error: res.error ?? "Action failed", fieldErrors: res.fieldErrors, executed: true });
        cb.current.onError?.(res.error, res);
        return res;
      }
      const data = res && typeof res === "object" && res.ok === true && "data" in res ? res.data : res;
      apply({ pending: false, data, error: null, fieldErrors: undefined, executed: true });
      cb.current.onSuccess?.(data);
      return res;
    } catch (e) {
      apply({ pending: false, data: undefined, error: e?.message ?? String(e), fieldErrors: undefined, executed: true });
      cb.current.onError?.(e?.message, e);
      return undefined;
    }
  }, [fn]);
  const reset = useCallback(() => { run.current++; setState({ pending: false, data: undefined, error: null, fieldErrors: undefined, executed: false }); }, []);
  return { ...state, execute, reset };
}

/** useOptimisticAction(fn, current, reducer) - show `reducer(current, input)` immediately while the action runs, roll back on failure. */
export function useOptimisticAction(fn, current, reducer) {
  const [optimistic, setOptimistic] = useState(null);
  const base = useAction(async (input) => {
    setOptimistic({ value: reducer(current, input) });
    try { return await fn(input); } finally { setOptimistic(null); }
  });
  return { ...base, value: optimistic ? optimistic.value : current };
}

// ---------------------------------------------------------------------------------------------- Router hooks
const segmentsOf = (pathname) => pathname.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
/** Active path segments below the root layout (`/blog/hello` -> ["blog","hello"]). Pass `depth` to skip that many leading segments. */
export function useSelectedLayoutSegments(depth = 0) { return segmentsOf(useContext(RouterContext).pathname).slice(depth); }
/** The first active segment below the root layout, or null. */
export function useSelectedLayoutSegment(depth = 0) { return useSelectedLayoutSegments(depth)[0] ?? null; }

/** Rethrow framework control-flow errors (notFound, HttpError) caught in your own try/catch. */
export function unstable_rethrow(err) {
  if (isNotFoundError(err) || (err && typeof err === "object" && typeof err.status === "number" && err.name === "HttpError")) throw err;
}

/** useReportWebVitals(cb) - calls cb({ name, value, id }) for FCP, LCP, CLS (browser only). */
export function useReportWebVitals(cb) {
  const ref = useRef(cb); ref.current = cb;
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    const obs = [];
    const watch = (type, name, pick) => {
      try {
        const o = new PerformanceObserver((list) => { for (const e of list.getEntries()) ref.current({ name, value: pick(e), id: `${name}-${Date.now()}` }); });
        o.observe({ type, buffered: true }); obs.push(o);
      } catch { /* unsupported entry type */ }
    };
    watch("paint", "FCP", (e) => e.startTime);
    watch("largest-contentful-paint", "LCP", (e) => e.startTime);
    watch("layout-shift", "CLS", (e) => e.value);
    return () => obs.forEach((o) => o.disconnect());
  }, []);
}

// ---------------------------------------------------------------------------------------------- useServerInsertedHTML
/** Collector the server renderer provides while it renders a page (null in the browser, where the hook does nothing). */
export const InsertedHtmlContext = createContext(null);

/**
 * useServerInsertedHTML(() => <style>...</style>) - add markup to the <head> of the server-rendered page (CSS-in-JS, inline scripts).
 * The callback runs once the shell has rendered, so it sees what the components above registered; nothing happens in the browser.
 * Components can render more than once: guard against duplicates yourself (a ref or a Set) as usual.
 */
export function useServerInsertedHTML(callback) {
  const c = useContext(InsertedHtmlContext);
  if (c) c.push(callback);
}
