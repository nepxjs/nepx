// instrumentation.js (next to app/ or in src/): `register()` runs once when the server starts (before it listens),
// `onRequestError(error, request, context)` is told about every unhandled server error (500s, also those an error.jsx handles).
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NepxError } from "./errors/index.js";
import { findInstrumentation } from "./router.js";

export async function loadInstrumentation(root) {
  const file = findInstrumentation(root);
  if (!file) return null;
  process.env.NEPX_RUNTIME ??= "nodejs";
  let mod;
  try { mod = await import(pathToFileURL(path.join(root, file)).href); }
  catch (err) { throw new NepxError(`${file}: ${err.message.split("\n")[0]}`); }
  for (const name of ["register", "onRequestError"]) if (mod[name] !== undefined && typeof mod[name] !== "function") throw new NepxError(`${file}: "${name}" must be a function`);
  if (typeof mod.register === "function") {
    try { await mod.register(); } catch (err) { throw new NepxError(`${file}: register() failed: ${err.message}`); }
  }
  return { file, onRequestError: mod.onRequestError ?? null };
}
