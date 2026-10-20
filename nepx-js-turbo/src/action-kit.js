// Actions beyond the "use server" directive.
//  1. createAction({ input, use, handler })  - validated, middleware-aware action (works in "use server" files AND in *.action.js files)
//  2. ActionError / actionError()            - expected failures returned as data ({ ok:false, error, fieldErrors })
//  3. *.action.{js,ts,jsx,tsx} files         - every export is a server action WITHOUT the "use server" directive
import { NepxError } from "./errors/index.js";

export const ACTION_FILE = /\.action\.(jsx?|tsx?|ksx)$/;
export const isActionFile = (rel) => ACTION_FILE.test(rel);

/** Expected, user-facing failure: createAction() turns it into { ok:false, error, fieldErrors } instead of a 500. */
export class ActionError extends Error {
  constructor(message, { fieldErrors, code } = {}) { super(message); this.name = "ActionError"; this.fieldErrors = fieldErrors; this.code = code; }
}
export const actionError = (message, opts) => new ActionError(message, opts);

const toObject = (v) => {
  if (typeof FormData !== "undefined" && v instanceof FormData) {
    const o = {};
    for (const [k, val] of v.entries()) { if (k.startsWith("$ACTION")) continue; o[k] = k in o ? [].concat(o[k], val) : val; }
    return o;
  }
  return v;
};

/** Run a schema: a function (value) => value | throws, `{ parse }` (zod style) or `{ safeParse }`. Returns { value } or { fieldErrors, error }. */
export function runSchema(schema, value) {
  if (!schema) return { value };
  try {
    if (typeof schema.safeParse === "function") {
      const r = schema.safeParse(value);
      if (r.success) return { value: r.data };
      const fieldErrors = {};
      for (const i of r.error?.issues ?? []) { const k = (i.path ?? []).join(".") || "_"; (fieldErrors[k] ??= []).push(i.message); }
      return { error: "Invalid input", fieldErrors };
    }
    if (typeof schema.parse === "function") return { value: schema.parse(value) };
    if (typeof schema === "function") return { value: schema(value) };
  } catch (e) {
    return { error: e?.message || "Invalid input", fieldErrors: e instanceof ActionError ? e.fieldErrors : undefined };
  }
  throw new NepxError("createAction(): `input` must be a function, { parse } or { safeParse }");
}

/**
 * createAction({ input?, use?, handler })
 *   input   validates the first argument (FormData is turned into an object first)
 *   use     array of (ctx) => ctx | void | Promise; runs before the handler (auth, rate limits). Throw ActionError to stop.
 *   handler (input, ctx) => data
 * The result is always { ok:true, data } or { ok:false, error, fieldErrors? }. Unexpected errors are rethrown (500).
 */
export function createAction(def) {
  if (typeof def === "function") def = { handler: def };
  if (!def || typeof def.handler !== "function") throw new NepxError("createAction(): `handler` must be a function");
  const guards = def.use ?? [];
  return async function action(raw, ...rest) {
    try {
      let ctx = {};
      for (const g of guards) { const r = await g(ctx, raw); if (r && typeof r === "object") ctx = { ...ctx, ...r }; }
      const parsed = runSchema(def.input, toObject(raw));
      if (parsed.error) return { ok: false, error: parsed.error, ...(parsed.fieldErrors ? { fieldErrors: parsed.fieldErrors } : {}) };
      return { ok: true, data: await def.handler(parsed.value, ctx, ...rest) };
    } catch (e) {
      if (e instanceof ActionError) return { ok: false, error: e.message, ...(e.fieldErrors ? { fieldErrors: e.fieldErrors } : {}), ...(e.code ? { code: e.code } : {}) };
      throw e;
    }
  };
}
