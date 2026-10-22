// Builds the publishable package into ./dist (minified, no tests/scripts/docs-for-devs).
// Layout is kept 1:1 with the source so every `new URL("../package.json", import.meta.url)`,
// `bin/nepx.js`, `client/index.js` and `loader.js` lookup keeps working.
import { transform } from "esbuild";
import { readdir, readFile, writeFile, mkdir, rm, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

await rm(DIST, { recursive: true, force: true });

let count = 0;
for (const folder of ["src", "bin"]) {
  for await (const file of walk(path.join(ROOT, folder))) {
    const out = path.join(DIST, path.relative(ROOT, file));
    await mkdir(path.dirname(out), { recursive: true });
    if (file.endsWith(".js")) {
      const { code } = await transform(await readFile(file, "utf8"), {
        loader: "js",
        format: "esm",
        target: "node20",
        minify: true,        // whitespace + syntax + identifiers
        keepNames: true,     // component/function .name stays intact (React devtools, error messages)
        legalComments: "none",
        sourcemap: false,
      });
      await writeFile(out, code);
      count++;
    } else {
      await copyFile(file, out);
    }
  }
}

for (const f of ["index.d.ts", "README.md", "CHANGELOG.md", "LICENSE"]) await copyFile(path.join(ROOT, f), path.join(DIST, f));

// Published package.json: no scripts / devDependencies, only what consumers need.
const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
delete pkg.scripts;
delete pkg.devDependencies;
delete pkg.files; // dist/ already contains exactly what ships
await writeFile(path.join(DIST, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

console.log(`nepx build: ${count} files minified -> dist/`);
