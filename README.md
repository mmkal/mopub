# mopub

Publish every package in a pnpm monorepo with one command. It builds, packs, diffs against what's on the registry, prompts for the new version(s), and publishes.

## Use it

Dry-run first (packs everything into a temp folder so you can inspect):

```
npx mopub
```

It'll figure out when you last published, calculate a changelog based on git history in each sub-package, prompt you for version number(s) you'd like to publish, and write a ready-to-publish package + changelog to a staging folder under `/tmp`. It'll print out the command for actually publishing at your leisure:

```
npx mopub prebuilt /tmp/mopub/your-repo-name-will-be-here/1777048359189
```

Once the publish succeeds, it prints a command for drafting a GitHub release (opens the "new release" page with the changelog prefilled — no side effects until you click "Create release"):

```
npx mopub release-notes --comparison 0.0.3-7...0.0.3-8
```

Other commands:

- `npx mopub local` replaces workspace deps with `file:` paths and prints `pnpm add` commands so you can test installs in another project.
- `npx mopub --help` for the full option list.

## Staged package transforms

Add `mopub.config.mjs` in the workspace root when the publishable package needs final edits that should not live in source. mopub applies these edits to the staged `right/package` folder after it has packed the package and written version/git/dependency metadata, but before changelogs, diffs, context, and publishing.

For example, a fork can keep its source package named `jsonata` while publishing the staged artifact as `@mmkal/jsonata`:

```js
import {defineConfig} from 'mopub'

export default defineConfig({
  packages: {
    jsonata: {
      publishName: '@mmkal/jsonata',
    },
  },
  async transformPackage({pkg, packageJson, helpers}) {
    if (pkg.name !== 'jsonata') return

    packageJson.description = 'JSON query and transformation language. Includes a synchronous API.'

    await helpers.editFile('README.md', readme => {
      return `This is a fork of jsonata.\n\n${readme.replaceAll(/\bjsonata\b/g, '@mmkal/jsonata')}`
    })
  },
})
```

`packages[sourceName].publishName` is the package name mopub uses for registry lookup, npm links, dist-tags, dependency rewrites, and the final staged `package.json` name. `transformPackage` runs once per selected package and receives:

- `packageDir`: the staged package directory.
- `packageJsonPath`: the staged package.json path.
- `packageJson`: a mutable package.json object, written back after the transform.
- `pkg`: `{name, publishName, version, targetVersion, path}`.
- `helpers`: async path-confined helpers for text and JSON files.

Use either the mutable `packageJson` object or `helpers.editJsonFile('package.json', ...)` for package.json changes, not both. Name changes belong in `publishName`, and version changes belong in mopub's version inputs.

## Caveats

- pnpm only. It shells out to `pnpm list` and `pnpm recursive exec`, and looks for a `pnpm-workspace.yaml` or `pnpm-lock.yaml` at the workspace root.
- For monorepos. A single-package repo works, but there's no real reason to reach for this over `np`.
- Rough and ready. Expect to answer a few prompts and read some output before trusting `--publish`. The dry-run folder it prints (`/tmp/mopub/...`) is the source of truth for what will be shipped.
