// Registers the Nepx loader hooks (JSX/TS/.ksx, extensionless imports, "@/" alias, "nepx", css stubs).
import { register } from "node:module";
register("./loader.js", import.meta.url, { data: { root: process.env.NEPX_ROOT || process.cwd(), basePath: process.env.NEPX_BASE_PATH || "", cacheDir: process.env.NEPX_TURBO_CACHE || "" } });
