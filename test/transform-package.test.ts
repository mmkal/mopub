import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import test from 'node:test'
import {createTransformPackageHelpers, runTransformPackage} from '../src/transform-package.js'

void test('transform helpers reject paths outside the staged package', async () => {
  using stagedPackage = tempStagedPackage()
  const helpers = createTransformPackageHelpers(stagedPackage.packageDir, stagedPackage.packageJsonPath)

  await assert.rejects(() => helpers.writeFile('../outside.txt', 'nope'), /escapes packageDir/)
  await assert.rejects(() => helpers.writeFile(path.join(stagedPackage.dir, 'outside.txt'), 'nope'), /must be relative/)
})

void test('runTransformPackage writes packageJson object mutations', async () => {
  using stagedPackage = tempStagedPackage()

  await runTransformPackage(
    {
      transformPackage({packageJson}) {
        packageJson.description = 'Updated in staged package'
      },
    },
    stagedPackage.transformParams,
  )

  assert.deepEqual(readPackageJson(stagedPackage.packageJsonPath), {
    name: '@mmkal/jsonata',
    version: '2.2.1',
    description: 'Updated in staged package',
  })
})

void test('editJsonFile supports in-place mutation', async () => {
  using stagedPackage = tempStagedPackage()

  await runTransformPackage(
    {
      async transformPackage({helpers}) {
        await helpers.editJsonFile<Record<string, unknown>>('package.json', json => {
          json.description = 'Updated through helper'
        })
      },
    },
    stagedPackage.transformParams,
  )

  assert.deepEqual(readPackageJson(stagedPackage.packageJsonPath), {
    name: '@mmkal/jsonata',
    version: '2.2.1',
    description: 'Updated through helper',
  })
})

void test('runTransformPackage rejects packageJson object and file edits together', async () => {
  using stagedPackage = tempStagedPackage()

  await assert.rejects(
    () =>
      runTransformPackage(
        {
          async transformPackage({packageJson, helpers}) {
            packageJson.description = 'Updated through object'
            await helpers.editJsonFile<Record<string, unknown>>('package.json', json => {
              json.description = 'Updated through helper'
            })
          },
        },
        stagedPackage.transformParams,
      ),
    /both through the packageJson object and on disk/,
  )
})

function tempStagedPackage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopub-transform-test-'))
  const packageDir = path.join(dir, 'right', 'package')
  const packageJsonPath = path.join(packageDir, 'package.json')
  fs.mkdirSync(packageDir, {recursive: true})
  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify(
      {
        name: '@mmkal/jsonata',
        version: '2.2.1',
      },
      null,
      2,
    ) + '\n',
  )

  return {
    dir,
    packageDir,
    packageJsonPath,
    transformParams: {
      packageDir,
      packageJsonPath,
      pkg: {
        name: 'jsonata',
        publishName: '@mmkal/jsonata',
        version: '2.1.0',
        targetVersion: '2.2.1',
        path: path.join(dir, 'source'),
      },
    },
    [Symbol.dispose]() {
      fs.rmSync(dir, {recursive: true, force: true})
    },
  }
}

function readPackageJson(filepath: string) {
  return JSON.parse(fs.readFileSync(filepath, 'utf8'))
}
