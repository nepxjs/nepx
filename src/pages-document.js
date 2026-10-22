// pages/_document: the <Document> is rendered once with placeholders for <Main /> and <NextScript />; what surrounds them is reused for every page.
import { DocumentContext } from "./pages-compat.js";

export function documentTemplate(React, server, Doc) {
  if (typeof Doc !== "function") throw new TypeError("pages/_document must default-export a component (or a class extending Document)");
  const s = server.renderToStaticMarkup(React.createElement(DocumentContext.Provider, { value: true }, React.createElement(Doc, {}))).replace(/^<!DOCTYPE html>/i, "");
  const grab = (re) => { const m = re.exec(s); return m ? m[1] : ""; };
  const body = grab(/<body[^>]*>([\s\S]*?)<\/body>/i).replace(/<nepx-script><\/nepx-script>/g, "");
  const [pre, post = ""] = body.split("<nepx-main></nepx-main>");
  return { htmlAttrs: grab(/<html([^>]*)>/i), bodyAttrs: grab(/<body([^>]*)>/i), head: grab(/<head>([\s\S]*?)<\/head>/i), pre, post };
}
