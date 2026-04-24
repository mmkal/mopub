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

## Caveats

- pnpm only. It shells out to `pnpm list` and `pnpm recursive exec`, and looks for a `pnpm-workspace.yaml` or `pnpm-lock.yaml` at the workspace root.
- For monorepos. A single-package repo works, but there's no real reason to reach for this over `np`.
- Rough and ready. Expect to answer a few prompts and read some output before trusting `--publish`. The dry-run folder it prints (`/tmp/mopub/...`) is the source of truth for what will be shipped.
