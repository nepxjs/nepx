import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveTurbo, createTransformCache, pool, createChangeFilter, globToRegExp, DEFAULT_WATCH_IGNORE } from "../src/turbo.js";
import { loadConfig } from "../src/config.js";
import { makeProject } from "./helpers.js";

const R = (input, flags = {}, env = {}) => resolveTurbo(input, { flags, env, root: tmpdir() });

test("turbo is off by default and every switch is honoured in order of precedence", () => {
  assert.equal(R(undefined).enabled, false);
  assert.equal(R(true).enabled, true);
  assert.equal(R({ concurrency: 3 }).enabled, true);
  assert.equal(R({ enabled: false, concurrency: 3 }).enabled, false);
  assert.equal(R(false, { turbo: true }).enabled, true);
  assert.equal(R(true, { "no-turbo": true }).enabled, false);
  assert.equal(R(true, { turbo: "false" }).enabled, false);
  assert.equal(R(undefined, {}, { NEPX_TURBO: "1" }).enabled, true);
  assert.equal(R(true, {}, { NEPX_TURBO: "0" }).enabled, false);
  assert.equal(R(undefined, { turbo: true }, { NEPX_TURBO: "0" }).enabled, true); // flag beats env
  assert.equal(R(true, { turbo: true, "no-turbo": true }).enabled, false);      // --no-turbo beats everything
});

test("turbo options are validated and tunable", () => {
  assert.throws(() => R("yes"), /config\.turbo must be/);
  assert.throws(() => R({ nope: 1 }), /unknown option "nope"/);
  assert.throws(() => R({ concurrency: 0 }), /concurrency/);
  assert.throws(() => R({ cache: "x" }), /cache must be true or false/);
  assert.throws(() => R({ watchIgnore: [1] }), /watchIgnore/);
  assert.throws(() => R(true, { turbo: "maybe" }), /Invalid --turbo/);
  assert.throws(() => R(true, { concurrency: "abc" }), /Invalid --concurrency/);
  assert.equal(R(true, { concurrency: "5" }).concurrency, 5);
  const t = R({ cache: false, warmup: false, skipUnchanged: false, compileCache: false });
  assert.deepEqual([t.cache, t.warmup, t.skipUnchanged, t.compileCache], [false, false, false, false]);
  const off = R(false);
  assert.deepEqual([off.cache, off.cacheDir, off.concurrency, off.warmup], [false, null, 1, false]);
  assert.ok(R(true).concurrency >= 2 && R(true).concurrency <= 8);
});

test("loadConfig exposes cfg.turbo and rejects bad values", async () => {
  assert.equal((await loadConfig(makeProject({}))).turbo.enabled, false);
  assert.equal((await loadConfig(makeProject({ "nepx.config.js": "export default { turbo: true }" }))).turbo.enabled, true);
  assert.equal((await loadConfig(makeProject({ "nepx.config.js": "export default { turbo: true }" }), { flags: { "no-turbo": true } })).turbo.enabled, false);
  await assert.rejects(() => loadConfig(makeProject({ "nepx.config.js": "export default { turbo: 3 }" })), /config\.turbo/);
});

test("transform cache: hit, miss, key depends on every part, survives garbage", () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "nepx-tc-")), "c");
  const c = createTransformCache(dir);
  const k = c.key(["0.27", "jsx", "/a.jsx", "src"]);
  assert.equal(c.get(k), null);
  c.set(k, "export default 1;");
  assert.equal(c.get(k), "export default 1;");
  assert.equal(c.stats.hits, 1); assert.equal(c.stats.misses, 1);
  for (const other of [["0.28", "jsx", "/a.jsx", "src"], ["0.27", "tsx", "/a.jsx", "src"], ["0.27", "jsx", "/b.jsx", "src"], ["0.27", "jsx", "/a.jsx", "src2"]]) assert.notEqual(c.key(other), k);
  const blocker = path.join(path.dirname(dir), "blocker"); writeFileSync(blocker, "x"); // a file where the cache dir should be
  const broken = createTransformCache(path.join(blocker, "sub"));
  assert.equal(broken.set("ab12", "x"), undefined); // never throws
  assert.equal(broken.get("ab12"), null);
});

test("pool keeps order, honours the limit and propagates the first failure", async () => {
  let running = 0, peak = 0;
  const out = await pool([5, 1, 3, 2, 4, 0], 2, async (n) => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, n * 3)); running--; return n * 10; });
  assert.deepEqual(out, [50, 10, 30, 20, 40, 0]);
  assert.equal(peak, 2);
  assert.deepEqual(await pool([], 4, async () => 1), []);
  assert.equal((await pool(new Set(["a"]), 4, async (x) => x))[0], "a"); // any iterable
  await assert.rejects(() => pool([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error("boom"); return n; }), /boom/);
});

test("globToRegExp: * stays in a segment, ** crosses, folders match their contents", () => {
  assert.ok(globToRegExp("*.snap").test("a.snap")); assert.ok(!globToRegExp("*.snap").test("x/a.snap"));
  assert.ok(globToRegExp("**/*.snap").test("x/y/a.snap"));
  assert.ok(globToRegExp("generated").test("generated/a/b.js"));
  assert.ok(!globToRegExp("a.b").test("aXb"));
});

test("dev change filter: ignored paths and unchanged saves do not restart", () => {
  const t = R({ watchIgnore: ["generated/**"] });
  const store = new Map([["/p/app/page.jsx", "v1"], ["/p/run.log", "x"], ["/p/generated/a.js", "g"], ["/p/tests/a.test.js", "t"]]);
  const f = createChangeFilter(t, { read: (abs) => { if (!store.has(abs)) throw new Error("ENOENT"); return store.get(abs); } });
  assert.equal(f.check("app/page.jsx", "/p/app/page.jsx"), true);   // first sighting: restart
  assert.equal(f.check("app/page.jsx", "/p/app/page.jsx"), false);  // saved without changes
  store.set("/p/app/page.jsx", "v2");
  assert.equal(f.check("app/page.jsx", "/p/app/page.jsx"), true);   // real change
  assert.equal(f.check("run.log", "/p/run.log"), false);
  assert.equal(f.check("generated/a.js", "/p/generated/a.js"), false);
  assert.equal(f.check("tests/a.test.js", "/p/tests/a.test.js"), false);
  store.delete("/p/app/page.jsx");
  assert.equal(f.check("app/page.jsx", "/p/app/page.jsx"), true);   // deleted = change
  store.set("/p/app/page.jsx", "v2");
  assert.equal(f.check("app/page.jsx", "/p/app/page.jsx"), true);   // came back after deletion
  const noSkip = createChangeFilter(R({ skipUnchanged: false }), { read: () => "same" });
  assert.equal(noSkip.check("a.js", "/a.js"), true); assert.equal(noSkip.check("a.js", "/a.js"), true);
  assert.ok(DEFAULT_WATCH_IGNORE.every((re) => re instanceof RegExp));
  assert.equal(createChangeFilter(R(true), { read: () => "" }).check("src\\app\\x.log".split("\\").join(path.sep), "/x"), false); // OS separators are normalised
});

test("cli: --help documents turbo, and turbo flags are accepted", async () => {
  const { execFileSync } = await import("node:child_process");
  const BIN = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../bin/nepx.js");
  assert.match(execFileSync(process.execPath, [BIN, "--help"], { encoding: "utf8" }), /--turbo \| --no-turbo/);
  const dir = makeProject({ "app/page.jsx": "export default () => null" });
  assert.throws(() => execFileSync(process.execPath, [BIN, "routes", "--turbo=maybe"], { cwd: dir, encoding: "utf8", stdio: "pipe" }), /Invalid --turbo/);
  assert.equal(existsSync(dir), true);
});
