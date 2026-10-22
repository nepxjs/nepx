// Fails fast with a readable message when dev dependencies are missing (instead of cryptic test errors).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const missing = ["esbuild", "react", "react-dom"].filter((m) => { try { require.resolve(m + "/package.json"); return false; } catch { return true; } });
if (missing.length) {
  console.error(`\nMissing: ${missing.join(", ")}.\nRun "npm install" in this folder first (and avoid folder names with special characters).\n`);
  process.exit(1);
}
