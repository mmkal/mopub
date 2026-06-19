# Grill interview: staged package hooks

## Q1 - Hook breadth - 2026-06-19

What I found in the codebase: mopub already has a late mutation step, `Modify local packages`, that edits the staged `right/package/package.json` after packing. `--scope` already does the simplest version of the jsonata rename, but only for `package.json.name`; it cannot edit README or other staged files. Changelogs, package diffs, `context.json`, and `prebuilt` all happen after that point, so a transform inserted there would become part of the dry-run artifact and the eventual publish.

Recommended answer: yes, this is a good idea only as a narrow staged-package transform, not a general hook system. It should run once per package after mopub's built-in package metadata edits and before changelog/diff/context/publish. It should mutate only the staged temp directory by default.

Question 1: Should we lock the MVP to one late staged-package transform hook, rather than designing a broader lifecycle/plugin system?

## A1 - 2026-06-19

Yes. Lock the MVP to one late staged-package transform hook. It should run after mopub has packed the source and applied its built-in version/git/dependency/scope mutations, and before changelog, diff, context, and publish. It should mutate only the staged `right/package` directory.

[guess: The name should probably avoid generic "hooks" language in public docs unless we later add more lifecycle points; this is a transform/customization point, not a plugin system.]

---

## Q2 - Config surface - 2026-06-19

What I found in the codebase: mopub has no config loading today, and `package.json` only exposes the CLI bin plus `files: ["dist"]`. The desired `import * as mopub from 'mopub'` API would need an intentional public module export; otherwise this is only a command-line tool.

Recommended answer: use a root config file discovered from the workspace root, e.g. `mopub.config.mjs`/`mopub.config.js`, with a default export. Add a tiny public `defineConfig` helper for typing later, but do not require it. Shape should be direct, not `extend`, because there is no inherited config yet:

```js
export default {
  async transformPackage({ packageDir, packageJson, package: pkg, helpers }) {
    // mutate staged packageDir only
  },
}
```

Question 2: Should the MVP add this root config file surface now, or should the transform be passed only programmatically to `publish()` and leave config/module exports for a later pass?

## A2 - 2026-06-19

Add the root config surface now. The main use case is running `npx mopub` in a forked repo, so programmatic-only hooks would miss the point.

Use `mopub.config.mjs`, `mopub.config.js`, and probably `mopub.config.cjs` discovered from the workspace root. The default export should be a plain config object. Add a tiny public `defineConfig(config) { return config }` helper for editor/type ergonomics, but do not call it `extend`; there is nothing to extend yet and that name overpromises.

The hook name should be direct, probably `transformPackage`, and it should receive `packageDir` rather than generic `directory`.

[guess: Supporting `.ts` config is not worth the loader complexity for this MVP. If someone wants TypeScript config later, add it intentionally rather than smuggling in tsx/register behavior.]

[guess: Programmatic `publish()` can accept the same config object internally, but the CLI-discovered config is the main product surface.]

---

## Q3 - Package identity - 2026-06-19

What I found in the codebase: package identity is currently split-prone. `ctx.packages[*].name` comes from the source workspace and is used for registry version lookup, pulling the left package, dependency matching, changelog headings/links, dist-tag lookup, task titles, and folder names. `--scope` rewrites only staged `package.json.name` late, so a scoped fork can publish the right npm package, but comparisons, changelog links, and dist-tags still mostly think in terms of the source name.

Recommended answer: the transform hook should be allowed to change staged `package.json.name`, but mopub should explicitly record a second identity after transforms, something like `pkg.publishName`, derived from final `right/package/package.json`. Publishing, changelog npm links, dist-tag lookup, and `context.json` should use `publishName`; workspace dependency graph matching should keep using source `pkg.name`. Registry pulls before the transform are the hard part, so the config should also support a declarative pre-transform name mapping for lookup, probably not inside the arbitrary hook.

Question 3: For the rename use case, should the config include an explicit package name mapping such as `packages: {"jsonata": {publishName: "@mmkal/jsonata"}}`, so mopub can query/pull the correct registry package before the late transform runs?

## A3 - 2026-06-19

Yes. Add declarative package identity mapping now, or the real rename use case is dangerously half-supported.

Use `packages` keyed by source/workspace package name. Each package config can include `publishName`. mopub should use `pkg.name` for workspace identity and dependency graph matching, and `pkg.publishName` for registry lookup, left package pulls, npm links, dist-tag lookup, publish task labels where useful, and `context.json`.

If `publishName` is present, mopub should also apply that package name to staged `package.json.name` in the built-in metadata mutation step. The transform hook is then for README and arbitrary file edits, not the primary identity change.

After transforms, mopub should read final staged `package.json.name`. If it differs from `pkg.publishName`, either update `pkg.publishName` only before later publish surfaces or fail. Prefer failing for MVP if the package had already queried registry under a different name, because silently changing identity after registry comparison is misleading.

[guess: The final-name mismatch error should say to use `packages["source-name"].publishName` instead of changing `package.json.name` only in `transformPackage`.]

---

## Q4 - Dependency key rewrites - 2026-06-19

What I found in the codebase: `getBumpedDependencies()` rewrites dependency versions by iterating `params.pkg.dependencies` from `pnpm list` and looking up `ctx.packages` by source `name`. It writes the new version back under the same dependency key from the staged package.json. That means if package `a` becomes `@scope/a`, any sibling package that depends on `a` would still publish a dependency on `a` unless mopub explicitly renames dependency keys too.

Recommended answer: when a workspace dependency has a `publishName`, mopub should rewrite dependency keys in staged `dependencies`, `peerDependencies`, and `optionalDependencies` from source name to publish name while applying the bumped version. It should not try to rewrite arbitrary string references in package files; that stays in `transformPackage`.

Question 4: Should `publishName` automatically rewrite workspace dependency keys in staged package.json dependency sections, or should users handle that themselves in `transformPackage`?

## A4 - 2026-06-19

Automatically rewrite workspace dependency keys in package.json dependency sections. `publishName` is a core package identity mapping, so dependency metadata should follow it.

Keep the rewrite scoped to `dependencies`, `peerDependencies`, and `optionalDependencies`. Preserve the original section and version-prefix logic. If the publish-name key already exists and the source-name key also exists, fail rather than guess which one wins.

Do not rewrite arbitrary file contents or source imports; those belong in `transformPackage`.

---

## Q5 - Transform execution model - 2026-06-19

What I found in the codebase: mopub's pipeline uses Listr concurrency in several package-level phases. `Modify local packages`, `Write changelogs`, and `Diff packages` are independent per package today. A `transformPackage` hook could run once per package in the same slot, but if it receives the full `ctx` and starts mutating sibling package dirs, concurrent execution would become surprising.

Recommended answer: make `transformPackage` per-package and scoped. It receives `{ packageDir, packageJsonPath, packageJson, package: pkg, config, helpers }`, and the contract is that it only edits that package's staged `right/package`. Run transforms sequentially for MVP, not because every hook needs it, but because arbitrary user code plus filesystem edits should produce deterministic output and simpler logs.

Question 5: Should `transformPackage` run once per package with scoped inputs, sequentially, and should mopub treat edits outside that package's staged directory as unsupported rather than trying to sandbox/enforce it?

## A5 - 2026-06-19

Yes. Run `transformPackage` once per package, sequentially, with scoped inputs. The hook should receive the package's staged `packageDir`, package metadata, a mutable `packageJson` object for convenience, and helpers rooted at `packageDir`.

The contract is "edit this staged package". Do not try to sandbox arbitrary user code; direct `fs` can always escape. Helpers should resolve paths relative to `packageDir` and reject paths that escape it, because helpers should be safe by default.

[guess: Sequential execution is worth the small speed cost because transforms are publish-time user code and clearer task output matters more than concurrency.]

---

## Q6 - package.json writeback - 2026-06-19

What I found in the codebase: package.json editing is currently manual: load JSON, mutate object, then write sorted JSON using `sort-package-json`. For a hook, if we pass a mutable `packageJson`, mopub needs a clear writeback rule or users will have to call `helpers.editJsonFile("package.json")` anyway. The README example also wants `editFile` and `editJsonFile`.

Recommended answer: `packageJson` should be live convenience state. Before the hook, mopub loads final staged `package.json`; after the hook returns, mopub reloads `package.json` if it exists, merges/uses the passed mutable object only if the file was not changed by helpers/direct FS, then writes sorted package.json once. Helpers should include at least `readFile`, `writeFile`, `editFile`, `readJsonFile`, `writeJsonFile`, `editJsonFile`, all path-confined to `packageDir`.

Question 6: What should the package.json writeback contract be: mutate the passed `packageJson` object and mopub always writes it after the hook, or require users to edit `package.json` through helpers if they want file changes?

## A6 - 2026-06-19

Support both styles, but do not merge them silently.

Before the hook, mopub should load staged `package.json` and pass a mutable `packageJson` object. After the hook:

- if the hook changed only the mutable object, write that object back through `sort-package-json`;
- if the hook changed only the `package.json` file through helpers or direct fs, reload it, validate the final name, and sort/write it;
- if both the mutable object and the file changed, fail with a clear error asking the user to choose one style.

Helpers should include `readFile`, `writeFile`, `editFile`, `readJsonFile`, `writeJsonFile`, and `editJsonFile`, all relative to `packageDir` and path-confined.

[guess: Detect direct fs edits by comparing package.json file text before and after the hook, not only by tracking helper writes.]

---

## Q7 - `--scope` interaction - 2026-06-19

What I found in the codebase: `PublishInput` already has `--scope`, which rewrites every staged package name to `${scope}/${unscopedName}`. That overlaps heavily with the proposed per-package `publishName`. If both exist and disagree, the current code would make one identity decision in `Modify local packages` and the config would make another.

Recommended answer: keep `--scope` for backwards compatibility, but treat it as a shorthand for packages without explicit `publishName`. If both are present for a package, fail when they resolve to different names; allow it only when they resolve to the same final name. Document `packages[source].publishName` as the more precise surface.

Question 7: How should `--scope` interact with config `packages[sourceName].publishName`: shorthand fallback, override, or mutually exclusive?

## A7 - 2026-06-19

Treat `--scope` as a backwards-compatible shorthand fallback.

Resolution order:

1. If a package has config `publishName`, use it.
2. Else if `--scope` is provided, use `${scope}/${unscopedSourceName}`.
3. Else use the source package name.

If both config `publishName` and `--scope` are present and they resolve to different names for the same package, fail with a clear error. If they resolve to the same name, allow it. Document `publishName` as the precise long-term surface.

---

## Q8 - Public module entrypoint - 2026-06-19

What I found in the codebase: `package.json` has only a `bin`, no `main`, no `exports`, and no generated declarations. So `import {defineConfig} from "mopub"` would not currently be a stable or working public API, even though `src/publish.ts` exports internals for local use.

Recommended answer: add a small public module entrypoint, probably `src/index.ts`, exporting `defineConfig` plus config-related types. Add package `exports`/`types` and enable declaration output. Keep `publish()` and pipeline internals out of the documented public surface for now, even if they remain exported from their source modules internally.

Question 8: Should this MVP create an official `mopub` module entrypoint for `defineConfig` and config types only, rather than exposing the full publish API as public?

## A8 - 2026-06-19

Yes. Add a small official module entrypoint for config authoring only:

- `src/index.ts` exports `defineConfig` and config-related types.
- `package.json` gets an `exports` entry for `"."` and `types` pointing at generated declarations.
- TypeScript build emits declarations.

Do not document `publish()` as public API in this pass. It can remain exported from `src/publish.ts` for the CLI and internal use, but the stable package API should be the config helper and types.

[guess: If users later need programmatic publish, expose it deliberately in a separate pass with a cleaner options type than the CLI zod input.]

---

## Q9 - Config loading strictness - 2026-06-19

What I found in the codebase: mopub is `"type": "module"` and builds to ESM. The CLI runs from `dist/cli.js`. A config loader can use dynamic `import()` for `.mjs` and `.js`, but `.cjs` needs interop handling. Since config is loaded from arbitrary workspace roots, cache busting also matters if someone reruns in the same process, though CLI runs are usually one process per command.

Recommended answer: discover exactly one of `mopub.config.mjs`, `mopub.config.js`, `mopub.config.cjs` in the workspace root. If more than one exists, fail. Load via dynamic `import(pathToFileURL(file).href + "?t=...")`; for CJS, accept `module.exports = { ... }` through the module namespace's `default`. Validate the default export with a light runtime schema that allows functions but rejects unknown top-level shapes enough to catch typos like `package` instead of `packages`.

Question 9: Should the loader fail on multiple config files and unknown top-level config keys, or be permissive and ignore extras?

## A9 - 2026-06-19

Fail on multiple config files and unknown top-level config keys. Also fail on unknown package config keys. This is publish tooling; silently ignoring a typo is worse than being slightly strict.

Supported files: `mopub.config.mjs`, `mopub.config.js`, `mopub.config.cjs` in the workspace root. If more than one exists, fail. Use dynamic import and accept default exports, including the default namespace from CJS interop.

[guess: If users want arbitrary constants, they can declare them outside the exported config object rather than putting unknown keys in the object.]

---

## Q10 - Command coverage - 2026-06-19

What I found in the codebase: `publish` and `local` both build staged packages by calling `publish(...)`; `prebuilt` only reads `context.json`; `releaseNotes` creates package folders from registry, not local staged source. A root config transform would therefore affect `npx mopub`, `npx mopub --publish`, and `npx mopub local` when local has to build its own prebuilt folder. It would not run for `prebuilt`, and probably should not run for `releaseNotes`.

Recommended answer: apply config identity mapping and transform only in the publish/staging pipeline, including dry-run, direct publish, and `local` when it internally builds. Do not rerun transforms in `prebuilt`; `context.json` already points at transformed artifacts. Do not apply transforms in `releaseNotes`, but release notes may need the `packages.publishName` mapping later if the command should discover renamed registry packages.

Question 10: Should `releaseNotes` load config identity mapping in this MVP, or is config limited to staging/publish/local for now?

## A10 - 2026-06-19

`releaseNotes` should load config identity mapping in the MVP, but should not run `transformPackage`.

Config effects by command:

- `publish` dry-run and direct publish: apply `publishName` and run transforms.
- `local`: if it internally builds by calling `publish`, it gets the same staged transforms.
- `prebuilt`: do not load or rerun transforms; publish the already staged artifact from `context.json`.
- `releaseNotes`: load `publishName`/`--scope` identity mapping so registry pulls, npm links, and changelog headings use the package that was actually published; do not transform files.

[guess: This prevents the "publish worked, release notes point at upstream jsonata" failure, which would be very confusing for the stated use case.]

---

## Q11 - Top-level vs per-package transforms - 2026-06-19

What I found in the codebase: mopub always collects all non-private packages into one `ctx.packages` array, even for single-package repos, and most package-level behavior is driven through that array. With the new `packages[sourceName].publishName` mapping, we already have a per-package config namespace, but the user's original example was a single top-level hook.

Recommended answer: support one top-level `transformPackage` only for MVP. It runs for every selected package and receives `package.name`/`package.publishName`, so users can branch inside it. Keep `packages[sourceName]` declarative for identity only. Per-package transform functions can be added later if branching becomes noisy.

Question 11: Should `transformPackage` be top-level only in the MVP, or should `packages[sourceName].transformPackage` also be supported now?

## A11 - 2026-06-19

Top-level only for the MVP.

`transformPackage` runs once for every selected package and receives enough package metadata to branch:

```js
if (pkg.name !== "jsonata") return
```

Keep `packages[sourceName]` declarative for identity only. Per-package transforms are easy to add later, but supporting both now creates API shape to explain before there is evidence it is needed.

[guess: In a monorepo, a single top-level transform with explicit branching is more readable than hiding publish-time file rewrites in multiple nested config entries.]

---

## Q12 - Context compatibility - 2026-06-19

What I found in the codebase: `Ctx` is persisted to `context.json` and parsed by `prebuilt` using zod. Today it stores package metadata including `name`, `targetVersion`, `shas`, and folders. If we add `publishName`, older prebuilt folders will not have it. Also, package `name` in old contexts was the only identity, and `prebuilt` uses it for publish labels and dist-tags.

Recommended answer: add optional `publishName` to the persisted package schema and normalize loaded contexts so `publishName ||= name`. New contexts should always include `publishName`. This keeps old dry-run folders publishable while making the new identity explicit.

Question 12: Should old `context.json` files without `publishName` remain accepted by `prebuilt`, defaulting `publishName` to `name`?

## A12 - 2026-06-19

Yes. Old `context.json` files should remain accepted.

Add `publishName` to package context, but parse older contexts by defaulting missing `publishName` to `name`. New contexts should always write `publishName` explicitly so prebuilt publish, task labels, and dist-tag lookup can use the intended package identity.

---

## Q13 - Unknown package config keys - 2026-06-19

What I found in the codebase: `Collecting packages` filters out `private` packages, then later independent mode can further reduce `ctx.packages` to the selected publish set. A `packages` config map keyed by source name could silently do nothing if the key is misspelled or points at a private package.

Recommended answer: after collecting non-private workspace packages, fail if any `config.packages` key does not match a collected source package name. Do this before version prompts. If independent mode later excludes a valid package, its config entry is simply unused for that run because it did match a real publishable package.

Question 13: Should mopub fail on config `packages` entries that do not match any collected non-private workspace package?

## A13 - 2026-06-19

Yes. After collecting non-private workspace packages, fail if any configured `packages` key does not match a collected source package name.

Do this before prompts and registry work where possible. If a configured package is valid but later excluded by the user's publish selection, that is not an error.

---

## Q14 - Hook package metadata - 2026-06-19

What I found in the codebase: the internal `Pkg` object contains source identity (`name`, `path`, `dependencies`), registry state (`publishedVersions`), staging paths (`folder`), versioning state (`targetVersion`, `shas`), and soon `publishName`. Passing that whole mutable object to user config would expose internal pipeline state and make it easy for a transform to accidentally corrupt `context.json`.

Recommended answer: pass a small readonly-ish snapshot called `pkg`, not `package`, because `package` is awkward to destructure in ESM strict mode. Include `name`, `publishName`, `version`, `targetVersion`, `path`, and maybe `folder` only if needed. Do not pass full `ctx` or mutable internal package objects. The hook can mutate files and the provided `packageJson`, not mopub's control-plane metadata.

Question 14: What exact package metadata should `transformPackage` receive, and should the property be named `pkg` rather than `package`?

## A14 - 2026-06-19

Use `pkg`, not `package`.

Pass a small snapshot:

```ts
{
  name: string
  publishName: string
  version: string
  targetVersion: string
  path: string
}
```

`name` is the source/workspace name, `publishName` is the npm package identity, `version` is the source version, `targetVersion` is the version mopub will publish, and `path` is the source package path. Do not pass full `ctx` or the live internal package object. `packageDir` and `packageJsonPath` are already separate top-level hook fields, so `folder` is unnecessary.

[guess: `targetVersion` can be non-null at this hook point because transforms run after target versions are selected and after packages without a target have been filtered out.]

---

## Q15 - JSON helper formatting - 2026-06-19

What I found in the codebase: mopub currently sorts package.json only in built-in metadata mutation and when normalizing the pulled left package. Other arbitrary files are left as-is. Since the transform can edit JSON files beyond package.json, a helper needs to choose whether to preserve original formatting or normalize.

Recommended answer: `writeJsonFile`/`editJsonFile` should write `JSON.stringify(value, null, 2) + "\n"` for general JSON files. For `package.json`, route through `sort-package-json` so helper edits match mopub's built-in output. Do not preserve comments or custom formatting; these are staged npm package files.

Question 15: Should JSON helpers normalize all JSON formatting, with package.json additionally sorted, or should they preserve original formatting where possible?

## A15 - 2026-06-19

Normalize JSON formatting.

`writeJsonFile` and `editJsonFile` should write two-space JSON with a trailing newline. For `package.json`, sort through `sort-package-json`. Do not attempt comment-preserving or whitespace-preserving edits in this MVP.

---

## Q16 - Testing scope - 2026-06-19

What I found in the codebase: mopub has no real test harness today (`test` is `echo maybe later`), but the transform/identity behavior touches publish-critical logic. The existing build is TypeScript-only, and command execution is tightly coupled to `execa`, pnpm, npm, tar, git, and Listr prompts, which makes full integration testing expensive unless we first introduce seams.

Recommended answer: add focused tests only if we can do it without a large harness: pure/unit tests around config loading, path-confined helpers, identity resolution, and dependency key rewriting. Keep end-to-end publish testing out of scope. If that means adding a small test runner dependency like `vitest`, do it; otherwise at least add `pnpm build` verification.

Question 16: Should this implementation add a small test setup for the new pure behavior, or keep verification to `pnpm build` and manual dry-run reasoning for now?

## A16 - 2026-06-19

Add a small test setup for the new pure behavior.

Use Node's built-in `node:test` with the existing `tsx` dev dependency rather than adding Vitest. Cover at least:

- config loading/validation strictness;
- path-confined file helpers;
- publish-name identity resolution and `--scope` conflict handling;
- workspace dependency key rewriting for publish names;
- package.json transform writeback conflict behavior if it is factored cleanly enough to test without shelling out to pnpm/npm/git.

Do not build a full end-to-end publish harness in this pass. Still run `pnpm build`.

[guess: If `tsx --test` is awkward with this setup, using plain Node tests against built JS is acceptable, but avoid a large test dependency for this small package.]

---

## Q17 - Helper updater return values - 2026-06-19

What I found in the codebase: mopub currently has no file-edit helper layer; JSON changes are done by loading an object, mutating it, and writing it back. The user's example mutates JSON in place for `editJsonFile`, but returns a string for `editFile`.

Recommended answer: `editFile(path, updater)` should require the updater to return the new string. `editJsonFile(path, updater)` should support both ergonomic JSON styles: mutate the parsed object and return nothing, or return a replacement value. If it returns a value, write that value; otherwise write the mutated object. For JSON helper conflicts, only the special staged `package.json` object-vs-file writeback conflict needs strict detection.

Question 17: Should `editJsonFile` support both in-place mutation and returned replacement values, while `editFile` requires a returned string?

## A17 - 2026-06-19

Yes.

`editFile(relativePath, updater)` reads UTF-8 text and requires `updater` to return the next string.

`editJsonFile(relativePath, updater)` reads JSON, passes the parsed value, and supports either in-place mutation with no return value or a returned replacement value. If a replacement is returned, write the replacement; otherwise write the mutated parsed value.

---

## Q18 - Helper path confinement - 2026-06-19

What I found in the codebase: path handling today mostly uses `path.join` directly because mopub controls those paths. For user-facing helpers, path confinement needs a precise rule. Symlink escapes are possible if we only normalize strings, but fully resolving every target with `realpath` can make creating new files awkward because the file may not exist yet.

Recommended answer: confine helper paths lexically for MVP: resolve `path.resolve(packageDir, relativePath)`, require the result to equal `packageDir` or start with `packageDir + path.sep`, and reject absolute paths and `..` escapes. Do not chase symlinks yet; arbitrary direct `fs` can escape anyway, and helpers are safe-by-default ergonomics, not a sandbox.

Question 18: Should helper path confinement be lexical-only for MVP, or should helpers also resolve symlinks to prevent symlink escapes?

## A18 - 2026-06-19

Lexical-only for MVP.

Helpers should reject absolute paths and resolve relative paths under `packageDir`. The resolved path must be `packageDir` or start with `packageDir + path.sep`. Do not chase symlinks in this pass; direct `fs` can escape anyway, so this is helper ergonomics and typo protection, not a security sandbox.

---

## Q19 - Post-transform identity/version validation - 2026-06-19

What I found in the codebase: after the planned hook point, mopub uses both internal metadata and final staged `package.json`. `createPublishTasks` validates and publishes using the staged package version, while `context.json`, release-note command hints, and changelog generation still rely on `pkg.targetVersion` and `pkg.publishName`. If a transform changes `package.json.version` or `name`, those surfaces can diverge.

Recommended answer: after `transformPackage`, validate that final staged `package.json.name === pkg.publishName` and `package.json.version === pkg.targetVersion`. Fail with a clear error if either differs. The transform can edit arbitrary package files, but core publish identity and version should remain controlled by mopub's declarative config and version selection.

Question 19: Should transforms be forbidden from changing final `package.json.name` and `package.json.version` away from mopub's resolved `publishName` and `targetVersion`?

## A19 - 2026-06-19

Yes. After transforms, fail if final staged `package.json.name !== pkg.publishName` or `package.json.version !== pkg.targetVersion`.

The hook may edit package files and package metadata, but name and version are core control-plane fields for registry lookup, diffs, context, and publishing. Name changes belong in `packages[sourceName].publishName`; version changes belong in mopub's version selection inputs.

---

## Q20 - Temp folder identity - 2026-06-19

What I found in the codebase: staged package folders are named from the source workspace name during `Collecting packages`, e.g. `/tmp/mopub/<project>/<timestamp>/100.jsonata/right/package`. That path is persisted in `context.json` and used by `prebuilt`, `local`, diffs, and changelog files. Changing it to `publishName` would make scoped packages produce names like `100.@mmkal__jsonata` unless we add another sanitization rule.

Recommended answer: keep temp folder names based on source `pkg.name`. The folder is mopub's workspace/staging identity, while the actual publish identity lives in `pkg.publishName` and final `right/package/package.json.name`. This avoids path churn and preserves compatibility with old contexts.

Question 20: Should staged temp folder names remain based on source package names, even when `publishName` differs?

## A20 - 2026-06-19

Yes. Keep temp folder names based on source package names.

`pkg.folder` is a staging/workspace path. Publish identity should live in `pkg.publishName` and final `right/package/package.json.name`.

---

## Q21 - Config storage in context - 2026-06-19

What I found in the codebase: `setupContextTasks` is shared by `publish` and `releaseNotes`, and it currently goes straight from `Collecting packages` into `Getting published versions`. That means config loading and `publishName` resolution must happen inside setup before registry lookup, not as a later publish-only step.

Recommended answer: add a setup step immediately after `Collecting packages` that loads config, validates package keys, resolves each package's `publishName` using config plus `--scope`, and stores the config on the run context. For `prebuilt`, do not run setup. For `releaseNotes`, use the same setup step but ignore `transformPackage`.

Question 21: Should the run context persist the loaded config itself, or should setup store only resolved package metadata (`publishName`) and keep the loaded config as a local variable passed into the transform task?

## A21 - 2026-06-19

Do not persist the loaded config itself. It can contain functions and should not be serialized into `context.json`.

Setup should store only resolved serializable metadata on `ctx.packages`, especially `publishName`. The loaded config object should live in the current run as a closure/local value and be used by the transform task. `prebuilt` should rely entirely on the persisted resolved metadata.

---

## Q22 - Changelog display identity - 2026-06-19

What I found in the codebase: changelog generation currently uses `pkg.name` in the markdown title, npm package links, dependency summaries, and the hidden `data-pkg` marker. Source diffs still need `pkg.path` and source git history, but the reviewer-facing changelog is about the npm artifact being published.

Recommended answer: use `pkg.publishName` for changelog headings, npm links, release-note titles/tags in individual mode, dependency summaries, and publish labels. Keep source `pkg.name` only for workspace matching, temp folders, prompts that need source-package disambiguation, and internal `data-pkg` if we want it to identify the source package. For the hidden marker, I'd store both: `data-pkg="jsonata"` and `data-publish-name="@mmkal/jsonata"`.

Question 22: Should changelog and release-note display use `publishName` everywhere user-facing, while hidden metadata keeps both source name and publish name?

## A22 - 2026-06-19

Yes. User-facing changelog, release-note, npm-link, dependency-summary, and publish-task display should use `publishName`.

Keep source `name` for workspace dependency matching, source git history, temp folders, and any internal hidden metadata. For hidden changelog markers, include both source and publish identity where useful, e.g. `data-pkg` and `data-publish-name`.

---

## Q23 - `local --prebuilt` dependency matching - 2026-06-19

What I found in the codebase: `local` has two paths. Without `--prebuilt`, it calls `publish({ version: dateVersion, publish: false, skipRegistryPull: true })`, so it will naturally use config once publish does. With `--prebuilt`, it reads `context.json` directly and then rewrites dependency versions to `file:` paths by matching `ctx.packages.find(p => p.name === dep)`. After publish-name dependency rewriting, staged packages may depend on `@scope/dep`, not source `dep`, so `local --prebuilt` would miss those unless updated.

Recommended answer: update `local` dependency replacement to match both `p.name` and `p.publishName`. For dependency keys in staged package.json, prefer matching by the actual dependency key, so a dependency on `@scope/dep` resolves to that package's local `right/package`. Keep source-name fallback for old prebuilt contexts.

Question 23: Should `local --prebuilt` rewrite dependencies by matching dependency keys against `publishName` first and source `name` second?

## A23 - 2026-06-19

Yes. `local --prebuilt` should match staged dependency keys against `publishName` first and source `name` second.

When it rewrites a dependency value to `file:...`, it should leave the dependency key as it appears in the staged package.json. This supports renamed packages while preserving old contexts.

---

## Q24 - Registry identity rule - 2026-06-19

What I found in the codebase: there are several places where npm registry calls happen before or outside the staged artifact: `getRegistryVersions`, `Pulling registry packages`, `getRegistryDistTags`, `findLastPublishWithFindableSha`, `getLastCommitBeforePreviousPublish`, release-note registry pulls, and fallback version discovery. If any still use `pkg.name` after identity mapping, renamed packages will compare or tag against upstream.

Recommended answer: make every registry/package-manager lookup for a published package use `pkg.publishName`; use `pkg.name` only for workspace source/package graph operations. This includes npm view versions/time/git.sha/dist-tags and npm pack. `pnpm pack` of local source still uses `pkg.path`, not package identity.

Question 24: Should every npm registry lookup and registry pack use `publishName`, with no fallback to source `name` except for old contexts where `publishName` defaults to `name`?

## A24 - 2026-06-19

Yes. Every npm registry lookup and registry package pull should use `publishName`.

Use source `name` only for workspace/source operations: package collection identity, dependency graph matching, temp folder naming, and source git history. Old contexts get `publishName = name`, so they naturally preserve existing behavior.

---

## Q25 - Changelog task placement - 2026-06-19

What I found in the codebase: the publish pipeline currently has two `Write changelogs` tasks around `Diff packages`, and `getOrCreateChangelog()` caches the first generated changelog unless it contains `undefined`. A transform must run before the first changelog write or its package metadata/file edits will not be reflected in changelog links/headings and may not be reflected in package diffs.

Recommended answer: insert the transform step immediately after built-in `Modify local packages` and final dependency/name/version writes, before any changelog generation. Also remove or tolerate the duplicate changelog task only if needed for this feature; do not make changelog generation part of the hook API.

Question 25: Should the implementation leave mopub's duplicate `Write changelogs` structure alone unless it blocks correct transform behavior, with the only hard requirement being that transforms run before the first changelog generation?

## A25 - 2026-06-19

Yes. Leave the duplicate `Write changelogs` structure alone unless it directly blocks correct transform behavior.

The hard requirement is that built-in package metadata writes happen first, then `transformPackage`, then the first changelog generation, diff, context, and publish.

[guess: Removing the duplicate changelog task is tempting cleanup, but it is not necessary for this feature and can be a separate small refactor later.]

---

## Q26 - publishName validation - 2026-06-19

What I found in the codebase: `--scope` is validated with `^@[\\w-_.]+$`, but package names from pnpm and staged package.json are otherwise trusted. `publishName` will drive npm registry calls and final publish identity, so a typo like `@mmkal/` or `mmkal/jsonata` would fail later in a less obvious place.

Recommended answer: validate configured `publishName` early with an npm-name-shaped rule: either unscoped `name` or scoped `@scope/name`, with no empty segments and no slash except the scoped separator. Keep it pragmatic rather than pulling in a new dependency. Also validate resolved `publishName` after applying `--scope`, so config and shorthand share the same guard.

Question 26: Should mopub validate `publishName` early with a simple npm package name regex, or defer to npm/pnpm errors later?

## A26 - 2026-06-19

Validate `publishName` early with a simple npm-package-name-shaped check.

Accept either `name` or `@scope/name`, with no empty segments and no extra slash. Keep the validation local and pragmatic; do not add a dependency for this MVP.

---

## Q27 - Error context - 2026-06-19

What I found in the codebase: `transformPackage` is arbitrary async user code. If it throws, Listr will fail the task and show the task title, but the raw error may not identify which package or config file caused it unless we wrap it. The config loader can also fail before Listr has package task context.

Recommended answer: wrap config loading and transform execution errors with actionable context: config path for loader/schema errors, source/publish package names and staged `packageDir` for transform errors, and precise conflict messages for identity/version/package.json writeback failures. Do not swallow stack traces; preserve the original error as `cause` where possible.

Question 27: Should transform/config errors be wrapped with package/config context while preserving the original error cause?

## A27 - 2026-06-19

Yes. Wrap config loader/schema errors with the config path, and wrap transform errors with source name, publish name, and staged `packageDir`.

Use `cause` where possible so stack traces are not lost. Conflict errors for `package.json` writeback and final name/version validation should be direct and actionable.

---

## Q28 - Config timing around build - 2026-06-19

What I found in the codebase: `setupContextTasks` currently sets the workspace root, then immediately runs the repo `build` script before creating the temp dir or collecting packages. Config package-key validation needs collected packages, but config file discovery and top-level schema validation do not.

Recommended answer: load and validate the root config file right after `Set working directory`, before running the project build, so typos and broken config imports fail early. Then, after `Collecting packages`, validate `packages` keys and resolve `publishName` before any registry work.

Question 28: Should config discovery/top-level validation happen before the repo build script, with package-key validation and identity resolution happening after package collection?

## A28 - 2026-06-19

Yes.

Load and validate the config file right after setting the workspace root, before running the project build. After package collection, validate `packages` keys and resolve `publishName` before registry version lookup.

---

## Q29 - Helper async shape - 2026-06-19

What I found in the codebase: mopub's file work is mostly synchronous today, but the proposed hook is async and the user example awaits helper calls. Since transforms may mix filesystem edits with async work, helper return types should be consistent and easy to compose.

Recommended answer: make all helpers async promise-returning methods, even where the underlying operation could be sync. Use UTF-8 text for file helpers. This keeps the hook API uniform:

```ts
await helpers.editFile("README.md", text => text.replaceAll("jsonata", "@mmkal/jsonata"))
await helpers.editJsonFile("package.json", json => {
  json.description = "..."
})
```

Question 29: Should all transform helpers be async promise-returning methods using UTF-8 text by default?

## A29 - 2026-06-19

Yes. All transform helpers should be async promise-returning methods. Text helpers use UTF-8 by default.

---

## Q30 - Config flags - 2026-06-19

What I found in the codebase: mopub's CLI has no explicit config flag today; everything is discovered from the workspace root or passed as command options. Adding config discovery without an escape hatch means any committed `mopub.config.*` will always affect `publish` and `releaseNotes`.

Recommended answer: for the MVP, do automatic root discovery only and do not add `--config`/`--no-config`. If a repo has a config file, mopub should use it; if not, behavior stays as-is. Extra flags can come later if there is a real need for alternate configs or bypassing transforms.

Question 30: Should the MVP avoid adding `--config` or `--no-config` flags and rely only on workspace-root config discovery?

## A30 - 2026-06-19

Yes. Avoid `--config` and `--no-config` in the MVP.

Discover config only from the workspace root. Repos without config preserve existing behavior; repos with config intentionally opt in by committing `mopub.config.*`.

---

## Q31 - Final config shape - 2026-06-19

What I found in the codebase: there is no current public config type, and the only top-level inputs are CLI zod options. Based on the locked decisions, the config object now has a very small shape: `packages` for declarative identity and `transformPackage` for staged file edits. The hook context already has `pkg.publishName`, so exposing the whole config back into the hook would be redundant and could make the API feel more framework-like than it is.

Recommended answer: keep the config shape minimal:

```ts
type MopubConfig = {
  packages?: Record<string, { publishName?: string }>
  transformPackage?: (context: TransformPackageContext) => void | Promise<void>
}
```

`TransformPackageContext` should include only `packageDir`, `packageJsonPath`, `packageJson`, `pkg`, and `helpers`. Do not pass `config` or package-specific config into the hook for the MVP.

Question 31: Should the hook context exclude the loaded config object and expose only the resolved package metadata plus file helpers?

## A31 - 2026-06-19

Yes. Keep the hook context limited to resolved package metadata and file helpers.

Final MVP config shape:

```ts
type MopubConfig = {
  packages?: Record<string, { publishName?: string }>
  transformPackage?: (context: TransformPackageContext) => void | Promise<void>
}
```

Final MVP hook context: `packageDir`, `packageJsonPath`, `packageJson`, `pkg`, and `helpers`.

---
