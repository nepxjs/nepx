#!/usr/bin/env node
import { main } from "../src/cli.js";
main(process.argv.slice(2)).catch((err) => {
  console.error(`nepx: ${err.message}`);
  process.exit(err.exitCode ?? 1);
});
