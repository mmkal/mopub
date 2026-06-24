---
status: complete
size: small
---

# Staged package transform

Status summary: Complete after simplification. The branch now adds explicit `--config` module loading, `defineConfig`, one staged `transformPackage` hook, and two helper methods. The earlier default config filename search, `publishName` identity model, release-notes plumbing, dependency-key rewriting, interview transcript, and test harness were removed as overbuilt.

## Goal

Let users edit the staged `right/package` directory before mopub writes changelogs, diffs, context, and publishes.

Example use cases:

- edit `package.json` before publish;
- prepend README text;
- rewrite package references in staged docs;
- use existing `--scope` for simple scoped package renames.

## API

```js
import {defineConfig} from 'mopub'

export default defineConfig({
  async transformPackage({directory, pkg, helpers}) {
    await helpers.editJsonFile('package.json', packageJson => {
      packageJson.description = `Forked build of ${pkg.name}`
    })
  },
})
```

The hook receives:

- `directory`: the staged package directory.
- `packageDir`: alias for `directory`.
- `pkg`: `{name, version, targetVersion, path}`.
- `helpers.editFile(relativePath, updater)`.
- `helpers.editJsonFile(relativePath, updater)`.

## Checklist

- [x] Add config module loading. _Implemented in `src/config.ts` and exposed through `--config`; mopub imports the provided path and has no default config filename._
- [x] Export `defineConfig` and config types from `mopub`. _Implemented in `src/index.ts` plus package `exports`/`types`._
- [x] Run `transformPackage` after built-in package metadata edits and before changelog/diff/context/publish. _Added a single `Transform packages` task in `src/publish.ts`._
- [x] Add minimal path-confined `editFile` and `editJsonFile` helpers. _Implemented in `src/transform-package.ts`._
- [x] Document the config hook in `README.md`. _Added a short `Transform staged packages` section._
- [x] Verify with `pnpm build`, `pnpm lint`, and a runtime config import smoke check. _All passed; `pnpm test` remains the existing placeholder._

## Non-goals

- No `publishName` model.
- No release-notes identity changes.
- No dependency key rewriting.
- No per-package hook map.
- No new test harness in this pass.
