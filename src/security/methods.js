export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const ALLOWED_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const KNOWN = new Set([...ALLOWED_METHODS, "TRACE", "CONNECT", "PROPFIND", "PROPPATCH", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK", "PURGE", "LINK", "UNLINK"]);

/** -> null (fine) | { status, allow }: known-but-refused verbs (TRACE, CONNECT ...) are 405, unknown ones 501. */
export function checkMethod(method) {
  if (ALLOWED_METHODS.includes(method)) return null;
  return { status: KNOWN.has(method) ? 405 : 501, allow: ALLOWED_METHODS.join(", ") };
}
