// Isomorphic: `h` is React.createElement (the server passes the project's React, the browser bundle its own),
// so SSR and hydration produce identical markup.
import { FONT } from "./styles.js";

/** Default 404 page (a project's own not-found.jsx always wins). */
export function defaultNotFound(h) {
  return h("main", { style: { fontFamily: FONT, minHeight: "70vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "2rem", gap: "0.75rem", color: "#111" } },
    h("h1", { style: { margin: 0, fontSize: "1.75rem", fontWeight: 600 } }, "404 - Page not found"),
    h("p", { style: { margin: 0, color: "#666" } }, "This page could not be found."),
    h("a", { href: "/", style: { marginTop: "0.5rem", padding: "0.5rem 1rem", borderRadius: "0.5rem", background: "#111", color: "#fff", textDecoration: "none", fontSize: "0.9rem" } }, "Back to home"));
}
