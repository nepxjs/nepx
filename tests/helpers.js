import "../src/register.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function makeProject(files) {
  const root = mkdtempSync(path.join(tmpdir(), "nepx-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

import { execSync, spawn } from "node:child_process";
import { symlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/nepx.js");
export const GLOBAL_MODULES = process.env.NEPX_TEST_MODULES || execSync("npm root -g", { encoding: "utf8" }).trim();

/** Make react/react-dom resolvable for a temp project (stands in for `npm install`). */
export function linkDeps(root) { symlinkSync(GLOBAL_MODULES, path.join(root, "node_modules")); }

export function startNepx(cwd, args) {
  const child = spawn(process.execPath, [BIN, ...args], { cwd });
  let buf = "", all = "";
  child.stdout.on("data", (c) => { buf += c; all += c; });
  child.stderr.on("data", (c) => { buf += c; all += c; });
  const wait = (re, ms = 15000) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const m = re.exec(buf);
      if (m) { clearInterval(iv); buf = buf.slice(m.index + m[0].length); resolve(m); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error("timeout waiting for " + re + "; output: " + buf)); }
    }, 50);
  });
  return { child, wait, output: () => all, stop: () => child.kill("SIGTERM") };
}

import { spawnSync } from "node:child_process";
export const nepx = (cwd, ...a) => spawnSync(process.execPath, [BIN, ...a], { cwd, encoding: "utf8" });

/** Scaffold a project with `nepx create` inside a fresh temp dir and link deps. */
export function scaffold(mode = "fullstack") {
  const d = makeProject({ ".keep": "" });
  const r = nepx(d, "create", "app", "--mode", mode);
  if (r.status !== 0) throw new Error(r.stderr);
  const app = path.join(d, "app");
  linkDeps(app);
  return app;
}
