import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import test from 'node:test'
import {loadMopubConfig, parseMopubConfig} from '../src/config.js'

void test('loads a workspace mopub config default export', async () => {
  using workspace = tempWorkspace()
  const configPath = path.join(workspace.dir, 'mopub.config.mjs')
  fs.writeFileSync(
    configPath,
    `export default { packages: { jsonata: { publishName: '@mmkal/jsonata' } } }\n`,
  )

  const loaded = await loadMopubConfig(workspace.dir)

  assert.equal(loaded.filepath, configPath)
  assert.deepEqual(loaded.config.packages, {
    jsonata: {
      publishName: '@mmkal/jsonata',
    },
  })
})

void test('rejects multiple config files in one workspace', async () => {
  using workspace = tempWorkspace()
  fs.writeFileSync(path.join(workspace.dir, 'mopub.config.mjs'), `export default {}\n`)
  fs.writeFileSync(path.join(workspace.dir, 'mopub.config.cjs'), `module.exports = {}\n`)

  await assert.rejects(() => loadMopubConfig(workspace.dir), /Multiple mopub config files found/)
})

void test('rejects unknown config keys', () => {
  assert.throws(
    () =>
      parseMopubConfig({
        package: {},
      }),
    /Unrecognized key/,
  )
})

function tempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopub-config-test-'))
  return {
    dir,
    [Symbol.dispose]() {
      fs.rmSync(dir, {recursive: true, force: true})
    },
  }
}
