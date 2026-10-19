import test from "node:test";
import assert from "node:assert/strict";
import { stripServerExports } from "../src/strip.js";
import { parseEnv } from "../src/env.js";
import { compileMatcher } from "../src/middleware.js";
import { serializeData } from "../src/ssr.js";

test("strip: removes server-only exports incl. destructured params, strings, template literals", () => {
  const src = `import fs from "fs";
export const metadata = { title: "x" };
export async function getServerSideProps({ params, request }) {
  const s = "}{ unbalanced in string";
  const t = \`tpl \${ params.id } }\`;
  // } comment
  return { props: { s, t } };
}
export default function P(){ return <p>hi</p>; }
export async function generateStaticParams() { return [{ id: "1" }]; }
export const x = 1;`;
  const out = stripServerExports(src);
  assert.ok(!out.includes("getServerSideProps") && !out.includes("generateStaticParams") && !out.includes("unbalanced"));
  assert.ok(out.includes("export default function P") && out.includes("export const metadata") && out.includes("export const x = 1;"));
});
test("strip: arrow function form", () => {
  const out = stripServerExports("export const getServerSideProps = async ({ params }) => { return { props: {} }; };\nexport default () => 1;");
  assert.ok(!out.includes("getServerSideProps") && out.includes("export default"));
});
test("env parsing", () => {
  assert.deepEqual(parseEnv('A=1\n# c\nexport B="x y" # note\nC=\'q\'\nD=val # inline\nE="l1\\nl2"'), { A: "1", B: "x y", C: "q", D: "val", E: "l1\nl2" });
});
test("middleware matcher", () => {
  const m = compileMatcher(["/admin/:path*", "/blog/:slug", "/exact"]);
  for (const p of ["/admin", "/admin/", "/admin/a/b", "/blog/x", "/exact", "/exact/"]) assert.ok(m(p), p);
  for (const p of ["/administrator", "/blog", "/blog/a/b", "/exact/x", "/"]) assert.ok(!m(p), p);
});
test("serializeData escapes script-breaking characters", () => {
  const s = serializeData({ a: "</script><!--", b: "\u2028" });
  assert.ok(!s.includes("</script") && !s.includes("<!--") && !s.includes("\u2028"));
  assert.deepEqual(JSON.parse(s), { a: "</script><!--", b: "\u2028" });
});
