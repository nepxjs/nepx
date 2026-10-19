import test from "node:test";
import assert from "node:assert/strict";
import { makeProject, linkDeps } from "./helpers.js";
import { scanApp, scanPages, matchRoute, inspectRoutes, formatRoutes, findMiddleware } from "../src/router.js";

const page = "export default function P(){ return null; }";
const get = "export async function GET(){ return Response.json({}); }";

test("App Router conventions: page/route/layout/groups/dynamic/catch-all", () => {
  const root = makeProject({
    "app/page.jsx": page, "app/layout.jsx": page, "app/not-found.jsx": page,
    "app/about/page.jsx": page, "app/(marketing)/pricing/page.jsx": page, "app/blog/[slug]/page.jsx": page,
    "app/docs/[...path]/page.jsx": page, "app/api/hello/route.js": get, "app/_private/page.jsx": page, "app/components/Button.jsx": page,
  });
  const s = scanApp(root);
  assert.deepEqual(s.routes.map((r) => r.path).sort(), ["/", "/about", "/api/hello", "/blog/:slug", "/docs/:path*", "/pricing"]);
  assert.equal(s.rootLayout, "app/layout.jsx");
  assert.equal(s.notFound, "app/not-found.jsx");
  assert.equal(s.routes.find((r) => r.path === "/api/hello").type, "API");
});
test("nested layouts are collected outermost first, groups included", () => {
  const root = makeProject({ "app/layout.jsx": page, "app/dash/layout.jsx": page, "app/dash/(g)/layout.jsx": page, "app/dash/(g)/x/page.jsx": page, "app/other/page.jsx": page });
  const r = scanPages(root);
  assert.deepEqual(r.find((x) => x.path === "/dash/x").layouts, ["app/layout.jsx", "app/dash/layout.jsx", "app/dash/(g)/layout.jsx"]);
  assert.deepEqual(r.find((x) => x.path === "/other").layouts, ["app/layout.jsx"]);
});
test("src/app is supported", () => {
  const root = makeProject({ "src/app/page.jsx": page, "src/app/a/route.js": get });
  assert.deepEqual(scanApp(root).routes.map((r) => r.file).sort(), ["src/app/a/route.js", "src/app/page.jsx"]);
});
test("priority: static > dynamic > catch-all", () => {
  const root = makeProject({ "app/u/[id]/page.jsx": page, "app/u/me/page.jsx": page, "app/u/[...rest]/page.jsx": page });
  const routes = scanApp(root).routes;
  assert.equal(matchRoute(routes, ["u", "me"]).route.path, "/u/me");
  assert.deepEqual(matchRoute(routes, ["u", "5"]).params, { id: "5" });
  assert.deepEqual(matchRoute(routes, ["u", "5", "6"]).params, { rest: ["5", "6"] });
  assert.equal(matchRoute(routes, ["u"]), null);
});
test("conflicts and invalid structures are errors", () => {
  assert.throws(() => scanApp(makeProject({ "app/a/page.jsx": page, "app/a/route.js": get })), /Route conflict/);
  assert.throws(() => scanApp(makeProject({ "app/a/[x]/page.jsx": page, "app/a/[y]/page.jsx": page })), /Route conflict/);
  assert.throws(() => scanApp(makeProject({ "app/(g)/a/page.jsx": page, "app/a/page.jsx": page })), /Route conflict/);
  assert.throws(() => scanApp(makeProject({ "app/[...a]/b/page.jsx": page })), /last segment/);
  assert.throws(() => scanApp(makeProject({ "app/[[...a]]/b/page.jsx": page })), /last segment/);
  assert.throws(() => scanApp(makeProject({ "app/x/error.jsx": page, "app/x/error.tsx": page, "app/x/page.jsx": page })), /Multiple error files/);
  assert.throws(() => scanApp(makeProject({ "app/b ad/page.jsx": page })), /Invalid route segment/);
});
test("inspect: methods, getServerSideProps, extensionless imports, syntax errors, bad exports", async () => {
  const root = makeProject({
    "lib/util.js": 'export const greet = () => "hi";',
    "app/api/a/route.js": 'import { greet } from "../../../lib/util";\nexport const GET = () => Response.json({ m: greet() });\nexport async function POST(){ return new Response(); }',
    "app/api/broken/route.js": "export function GET( {",
    "app/api/empty/route.js": "export const x = 1;",
    "app/data/page.jsx": "export default () => <p/>;\nexport async function getServerSideProps(){ return { props: {} }; }",
    "app/nofn/page.jsx": "export default 5;",
  });
  linkDeps(root);
  const info = await inspectRoutes(root, scanApp(root));
  const by = Object.fromEntries(info.routes.map((x) => [x.path, x]));
  assert.deepEqual(by["/api/a"].methods, ["GET", "POST"]);
  assert.match(by["/api/broken"].error, /app\/api\/broken\/route\.js/);
  assert.match(by["/api/empty"].error, /no HTTP handler/);
  assert.equal(by["/data"].hasData, true);
  assert.match(by["/nofn"].error, /default-export a React component/);
  assert.match(formatRoutes(info.routes), /API\s+POST\s+\/api\/a\s+app\/api\/a\/route\.js/);
});
test("findMiddleware", () => {
  assert.equal(findMiddleware(makeProject({ "middleware.js": "" })), "middleware.js");
  assert.equal(findMiddleware(makeProject({ "src/app/page.jsx": page, "src/middleware.ts": "" })), "src/middleware.ts");
  assert.equal(findMiddleware(makeProject({ "x": "" })), null);
});
