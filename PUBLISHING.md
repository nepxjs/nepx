# Publishing nepxjs

1. **Check the name is free:** `npm view nepxjs` should answer `404`. If it is taken, change `"name"` in `package.json` (the `nepx` command and `import "nepx"` stay the same; `src/scaffold.js` reads the name from `package.json`).
2. **Optional metadata** — add to `package.json` once you have a repository: `author`, `repository`, `homepage`, `bugs`. They were left out on purpose so no placeholder links get published.
3. **Test:** `npm install && npm test` (all green).
4. **Preview the tarball:** `npm run pack:check` builds `dist/` (minified) and lists what would ship: only `bin/`, `src/` (minified), `index.d.ts`, `README.md`, `CHANGELOG.md`, `LICENSE` and `package.json`.
5. **Log in and publish:** `npm login`, then `npm run release` (tests → build → `npm publish ./dist`). Plain `npm publish` in the repo root is blocked on purpose so raw source never ships.
6. **Or via GitHub:** add an `NPM_TOKEN` repository secret, then create a GitHub release — `.github/workflows/publish.yml` publishes with provenance.
7. **Next release:** bump `version`, add a `CHANGELOG.md` entry, repeat.
