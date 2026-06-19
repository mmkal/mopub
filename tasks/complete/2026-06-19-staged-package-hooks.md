---
status: complete
size: medium
---

# Staged package transforms

Status summary: Complete on the `staged-package-hooks` branch. Implemented root config discovery, declarative `publishName`, staged package transforms, helper APIs, identity-aware publish/release/local flows, docs, and focused tests. Missing only PR review/merge.

Decision trail: [2026-06-19-staged-package-hooks.interview.md](2026-06-19-staged-package-hooks.interview.md)

## Goal

Let a repo customize the publishable package contents that mopub stages under `/tmp/mopub/...`, without mutating the source tree. The first real use case is publishing a forked package under a different npm name, such as source package `jsonata` published as `@mmkal/jsonata`, plus staged README/package metadata edits.

This is deliberately a staged package transform, not a general lifecycle hook framework.

## MVP API

Config is discovered from the workspace root. Supported filenames:

- `mopub.config.mjs`
- `mopub.config.js`
- `mopub.config.cjs`

Exactly one config file may exist. Unknown top-level config keys and unknown package config keys should fail.

```js
import {defineConfig} from 'mopub'

export default defineConfig({
  packages: {
    jsonata: {
      publishName: '@mmkal/jsonata',
    },
  },
  async transformPackage({packageDir, packageJson, pkg, helpers}) {
    if (pkg.name !== 'jsonata') return

    packageJson.description = 'JSON query and transformation language. Includes a synchronous API.'

    await helpers.editFile('README.md', old => {
      let updated = old.replaceAll(/\bjsonata\b/g, '@mmkal/jsonata')
      updated = `This is a fork of jsonata.\n\n${updated}`
      return updated
    })
  },
})
```

Config type:

```ts
type MopubConfig = {
  packages?: Record<string, {publishName?: string}>
  transformPackage?: (context: TransformPackageContext) => void | Promise<void>
}
```

Transform context:

```ts
type TransformPackageContext = {
  packageDir: string
  packageJsonPath: string
  packageJson: PackageJson
  pkg: {
    name: string
    publishName: string
    version: string
    targetVersion: string
    path: string
  }
  helpers: TransformPackageHelpers
}
```

Helpers are async, UTF-8, and path-confined to `packageDir` by lexical path resolution:

- `readFile(relativePath): Promise<string>`
- `writeFile(relativePath, content): Promise<void>`
- `editFile(relativePath, updater): Promise<void>`
- `readJsonFile(relativePath): Promise<unknown>`
- `writeJsonFile(relativePath, value): Promise<void>`
- `editJsonFile(relativePath, updater): Promise<void>`

`editFile` requires the updater to return a string. `editJsonFile` supports mutating the parsed value in place or returning a replacement value. General JSON is written as two-space JSON with a trailing newline; `package.json` is additionally sorted with `sort-package-json`.

## Behavior

- Run `transformPackage` once per selected package, sequentially.
- Run transforms after mopub packs the local source and applies built-in version/git/dependency/name metadata, before the first changelog generation, diff, context write, and publish.
- Config loading/top-level validation happens after setting the workspace root and before the repo build script.
- Package config key validation and `publishName` resolution happen after package collection and before registry work.
- Do not persist the loaded config object into `context.json`; persist only resolved metadata such as `publishName`.
- Old `context.json` files without `publishName` remain valid by defaulting `publishName` to `name`.

Identity rules:

- `pkg.name` is the source/workspace identity.
- `pkg.publishName` is the npm registry/published artifact identity.
- Registry lookups and registry package pulls use `publishName`.
- Workspace dependency graph matching, source git history, and temp folder naming use `name`.
- User-facing changelog/release/publish text uses `publishName`.
- Hidden changelog metadata should retain source identity and include publish identity where useful.
- `--scope` remains a backwards-compatible shorthand fallback. If config `publishName` and `--scope` both apply and disagree, fail.
- `publishName` should be validated early with a pragmatic npm-name-shaped check.
- Staged dependency keys for workspace dependencies should be rewritten from source `name` to dependency `publishName`, preserving the original dependency section and version-prefix behavior.
- If rewriting would collide with an existing publish-name dependency key, fail.

Transform validation:

- Helpers path-confine by lexical resolution but do not claim to sandbox arbitrary direct `fs` usage.
- The hook may mutate the passed `packageJson` object or edit `package.json` on disk, but not both. If both changed, fail with a clear error.
- After transforms, final staged `package.json.name` must equal `pkg.publishName`.
- After transforms, final staged `package.json.version` must equal `pkg.targetVersion`.
- Config and transform errors should be wrapped with config path or source/publish package context while preserving the original cause.

Command coverage:

- `publish` dry-run and direct publish: apply identity mapping and run transforms.
- `local` without `--prebuilt`: gets transforms through its internal `publish()` call.
- `local --prebuilt`: match dependency keys against `publishName` first and source `name` second when rewriting to `file:` paths.
- `prebuilt`: do not load config or rerun transforms; publish the already staged artifact.
- `releaseNotes`: load identity mapping but do not run transforms.

## Checklist

- [x] Add config types, `defineConfig`, public module entrypoint, package `exports`/`types`, and declaration output. _Implemented in `src/config.ts`, `src/index.ts`, `package.json`, and `tsconfig.json`._
- [x] Add config discovery/loading/validation for `mopub.config.mjs`, `.js`, and `.cjs`. _Implemented by `loadMopubConfig` with strict zod validation._
- [x] Resolve and persist `publishName`, including `--scope` compatibility and unknown package-key validation. _Implemented in `src/package-identity.ts` and setup context._
- [x] Use `publishName` for all npm registry lookups/pulls, dist-tag lookup, npm links, publish labels, and user-facing changelog/release text. _Updated registry, publish, changelog, and release-note paths in `src/publish.ts`._
- [x] Keep source `name` for workspace dependency matching, source git history, and temp folder naming. _Source identity remains the graph/path key; `publishName` is separate._
- [x] Rewrite staged workspace dependency keys to dependency `publishName` where needed. _Implemented via `writePublishedDependencyVersion` inside `getBumpedDependencies`._
- [x] Add path-confined async transform helpers. _Implemented in `src/transform-package.ts`._
- [x] Run top-level `transformPackage` sequentially after built-in package metadata writes and before changelog/diff/context/publish. _Added `Transform packages` task after `Modify local packages`._
- [x] Implement package.json writeback conflict detection and final name/version validation. _Implemented in `runTransformPackage`._
- [x] Make `releaseNotes` use identity mapping without running transforms. _Release notes use setup identity config; transforms remain publish-only._
- [x] Make `local --prebuilt` match dependency keys by `publishName` first, source `name` second. _Implemented in `src/cli.ts`._
- [x] Document the config API and forked-package example in `README.md`. _Added staged package transforms section._
- [x] Add focused `node:test`/`tsx` tests for config validation, helper confinement, identity resolution, dependency key rewriting, and package.json writeback where practical. _Added tests under `test/`._
- [x] Run `pnpm test`, `pnpm build`, and `pnpm lint`. _All passed; lint exits successfully with warnings from the existing formatting/import-order setup._

## Non-goals

- Do not build a broad lifecycle/plugin framework.
- Do not add per-package transform functions in `packages[sourceName]`.
- Do not add `--config` or `--no-config`.
- Do not support TypeScript config files in this MVP.
- Do not rerun transforms for `prebuilt`.
- Do not build a full end-to-end pnpm/npm/git publish harness.
- Do not refactor the duplicate `Write changelogs` task unless it directly blocks this feature.

## Guesses and assumptions

- Public docs should avoid generic "hooks" language until there are multiple lifecycle points.
- `.ts` config support is not worth the loader complexity for the MVP.
- Programmatic publish can be considered later with a cleaner public API.
- Final-name mismatch errors should point users to `packages["source-name"].publishName`.
- Sequential transforms are worth the small speed cost for deterministic publish-time user code.
- Direct `package.json` edits can be detected by comparing file text before and after the hook.
- If users need arbitrary constants, they can declare them outside the exported config object.
- If programmatic publish becomes important, expose it deliberately in a later pass.
- `releaseNotes` identity mapping prevents the "publish worked, release notes point at upstream" failure for forked packages.
- In monorepos, explicit branching in one top-level transform is clearer than nested file-rewrite hooks until proven otherwise.
- `targetVersion` is non-null at the transform point.
- Node tests through `tsx` should be enough; use built JS tests only if `tsx --test` is awkward.
- Removing the duplicate changelog task is tempting cleanup, but unrelated.

## Implementation notes

- Grill workspace: `/tmp/grillings/mopub/staged-package-hooks/`
- jsonata reference repo inspected: `/Users/mmkal/src/jsonata`, branch `sync-package`.
- Verification: `pnpm test`, `pnpm build`, `pnpm lint`, and `node -e "import('mopub').then(m => console.log(typeof m.defineConfig))"`.
