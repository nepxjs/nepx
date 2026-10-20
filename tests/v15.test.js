// Nepx 1.5: createAction, *.action.js convention, useAction helpers (unit level).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAction, ActionError, runSchema, isActionFile } from "../src/action-kit.js";
import { scanActions, isActionModule, clientStub, actionId } from "../src/actions.js";

test("createAction validates, runs guards and wraps results", async () => {
  const a = createAction({ input: (v) => { if (!v.title) throw new ActionError("bad", { fieldErrors: { title: ["required"] } }); return v; }, use: [() => ({ user: "u1" })], handler: (i, c) => ({ t: i.title, u: c.user }) });
  assert.deepEqual(await a({ title: "x" }), { ok: true, data: { t: "x", u: "u1" } });
  assert.deepEqual(await a({}), { ok: false, error: "bad", fieldErrors: { title: ["required"] } });
  const fd = new FormData(); fd.append("title", "fd");
  assert.equal((await a(fd)).data.t, "fd");
});
test("createAction: zod-style safeParse, ActionError from handler, unexpected errors rethrow", async () => {
  const schema = { safeParse: (v) => (v.n > 1 ? { success: true, data: v } : { success: false, error: { issues: [{ path: ["n"], message: "min 2" }] } }) };
  const z = createAction({ input: schema, handler: (i) => i.n });
  assert.deepEqual(await z({ n: 1 }), { ok: false, error: "Invalid input", fieldErrors: { n: ["min 2"] } });
  assert.equal((await z({ n: 5 })).data, 5);
  const e = createAction(() => { throw new ActionError("nope", { code: "E1" }); });
  assert.deepEqual(await e({}), { ok: false, error: "nope", code: "E1" });
  await assert.rejects(createAction(() => { throw new Error("boom"); })({}), /boom/);
  assert.throws(() => createAction({}), /handler/);
  assert.throws(() => runSchema(42, {}), /input/);
});
test("*.action.js files are action modules without the directive", () => {
  assert.ok(isActionFile("a/b.action.ts") && !isActionFile("a/action.ts"));
  assert.ok(isActionModule("export async function f(){}", "x.action.js"));
  assert.ok(!isActionModule("export const a = 1", "x.js"));
  const d = mkdtempSync(path.join(tmpdir(), "nepx-act-"));
  writeFileSync(path.join(d, "posts.action.js"), "export async function save(){}\nexport const del = async () => {}");
  writeFileSync(path.join(d, "plain.js"), "export const x = 1");
  const map = scanActions(d);
  assert.deepEqual([...map.values()].map((v) => v.name).sort(), ["del", "save"]);
  assert.ok(map.has(actionId("posts.action.js", "save")));
  assert.match(clientStub("export async function save(){}", "posts.action.js"), /createServerReference/);
});

import { moduleKind, clientServerOnlyCall } from "../src/actions.js";
test("directives: use server / use func / use client", () => {
  assert.equal(moduleKind('"use func"; export const a = 1', "a.js"), "func");
  assert.equal(moduleKind("'use client';\nexport default 1", "a.js"), "client");
  assert.equal(moduleKind('"use server"', "a.js"), "server");
  assert.equal(moduleKind("export const a = 1", "a.action.js"), "server");
  assert.equal(moduleKind("export const a = 1", "a.js"), null);
  assert.equal(clientServerOnlyCall('import { cookies } from "nepx"; cookies().get("a")'), "cookies");
  assert.equal(clientServerOnlyCall('import { Link } from "nepx"; el.after(x)'), null);
});
test("scanActions registers use func with kind, rejects server-only calls in use client", () => {
  const d = mkdtempSync(path.join(tmpdir(), "nepx-dir-"));
  writeFileSync(path.join(d, "q.js"), '"use func"\nexport async function find(){ return 1 }');
  writeFileSync(path.join(d, "ok.jsx"), '"use client"\nexport default function A(){ return null }');
  const map = scanActions(d);
  assert.deepEqual([...map.values()].map((v) => [v.name, v.kind]), [["find", "func"]]);
  assert.match(clientStub('"use func"\nexport async function find(){}', "q.js", "func"), /createFuncReference/);
  writeFileSync(path.join(d, "bad.jsx"), '"use client"\nimport { cookies } from "nepx"\nexport default () => cookies().get("a")');
  assert.throws(() => scanActions(d), /cannot call cookies\(\)/);
});
