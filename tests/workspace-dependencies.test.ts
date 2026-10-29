import {execa, execaSync} from 'execa'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
// eslint-disable-next-line vitest/no-import-node-test
import {test} from 'node:test'

void test('bumps a workspace peer dependency that is also a dev dependency', async () => {
  // `pnpm list --prod` reports `a` as a dev-only dependency of `b`, so it's absent from mopub's workspace dependency graph
  using fixture = createFixture({
    a: {},
    b: {peerDependencies: {a: 'workspace:*'}, devDependencies: {a: 'workspace:*'}},
  })

  const result = await execa(path.resolve('node_modules/.bin/tsx'), [path.resolve('src/cli.ts'), '--version', '1.0.0'], {
    cwd: fixture.repoPath,
    env: {PATH: `${fixture.binPath}:${process.env.PATH}`},
    stdin: 'ignore',
    all: true,
    reject: false,
  })
  const stagingFolder = result.stdout.match(/npx mopub prebuilt (\S+)/)?.[1]
  assert.ok(stagingFolder, result.all)

  const stagedB = JSON.parse(fs.readFileSync(path.join(stagingFolder, '101.b/right/package/package.json'), 'utf8'))
  assert.partialDeepStrictEqual(stagedB, {version: '1.0.0', peerDependencies: {a: '1.0.0'}})
})

/**
 * A pnpm workspace in a fresh git repo, plus a fake `npm` on `binPath` which says every package has 0.0.1 published
 * at the repo's first commit, so `mopub` diffs against that instead of prompting for a sha.
 */
function createFixture(packages: Record<string, {peerDependencies?: {}; devDependencies?: {}}>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mopub-workspace-dependencies-'))
  const rootName = path.basename(directory).toLowerCase()
  const repoPath = path.join(directory, 'repo')
  const binPath = path.join(directory, 'bin')
  fs.mkdirSync(binPath)
  writeJson(path.join(repoPath, 'package.json'), {name: rootName, version: '0.0.0', private: true})
  fs.writeFileSync(path.join(repoPath, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
  for (const [name, dependencies] of Object.entries(packages)) {
    writeJson(path.join(repoPath, 'packages', name, 'package.json'), {name, version: '0.0.0-dev', ...dependencies})
  }

  execaSync('pnpm', ['install', '--offline', '--silent'], {cwd: repoPath})
  execaSync('git', ['init', '--quiet'], {cwd: repoPath})
  execaSync('git', ['add', '--all'], {cwd: repoPath})
  execaSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '--quiet', '-m', 'init'], {
    cwd: repoPath,
  })
  const publishedSha = execaSync('git', ['rev-parse', '--short', 'HEAD'], {cwd: repoPath}).stdout

  fs.writeFileSync(
    path.join(binPath, 'npm'),
    `#!/usr/bin/env node
const {execFileSync} = require('node:child_process')
const fs = require('node:fs')
const [command, spec, field] = process.argv.slice(2)
if (command === 'view' && field === 'versions') console.log(JSON.stringify(['0.0.1']))
if (command === 'pack') {
  const name = spec.slice(0, spec.lastIndexOf('@'))
  fs.mkdirSync('package')
  fs.writeFileSync('package/package.json', JSON.stringify({name, version: '0.0.1', git: {sha: '${publishedSha}'}}))
  execFileSync('tar', ['-czf', 'published.tgz', 'package'])
  fs.rmSync('package', {recursive: true})
}
`,
    {mode: 0o755},
  )

  return {
    repoPath,
    binPath,
    [Symbol.dispose]() {
      fs.rmSync(directory, {recursive: true})
      fs.rmSync(path.join('/tmp/mopub', rootName), {recursive: true, force: true})
    },
  }
}

function writeJson(filepath: string, value: {}) {
  fs.mkdirSync(path.dirname(filepath), {recursive: true})
  fs.writeFileSync(filepath, JSON.stringify(value, null, 2))
}
