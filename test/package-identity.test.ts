import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyPublishNames,
  findPackageByPublishedDependencyName,
  writePublishedDependencyVersion,
} from '../src/package-identity.js'

void test('resolves configured publish names', () => {
  const packages = [{name: 'jsonata'}]

  applyPublishNames(packages, {packages: {jsonata: {publishName: '@mmkal/jsonata'}}}, {})

  assert.deepEqual(packages, [{name: 'jsonata', publishName: '@mmkal/jsonata'}])
})

void test('rejects scope conflicts with configured publish names', () => {
  assert.throws(
    () => applyPublishNames([{name: 'jsonata'}], {packages: {jsonata: {publishName: '@other/jsonata'}}}, {scope: '@mmkal'}),
    /conflicts with --scope/,
  )
})

void test('rejects package config keys that do not match publishable packages', () => {
  assert.throws(
    () => applyPublishNames([{name: 'jsonata'}], {packages: {missing: {publishName: '@mmkal/missing'}}}, {}),
    /not publishable workspace packages: missing/,
  )
})

void test('finds packages by publish name before source name', () => {
  const packages = [
    {name: 'jsonata', publishName: '@mmkal/jsonata'},
    {name: 'other', publishName: 'other'},
  ]

  assert.equal(findPackageByPublishedDependencyName(packages, '@mmkal/jsonata')?.name, 'jsonata')
  assert.equal(findPackageByPublishedDependencyName(packages, 'other')?.name, 'other')
})

void test('rewrites dependency keys to publish names', () => {
  const packageJson = {
    dependencies: {
      jsonata: 'workspace:*',
      unchanged: '^1.0.0',
    },
  }

  writePublishedDependencyVersion(packageJson, {
    section: 'dependencies',
    sourceName: 'jsonata',
    publishName: '@mmkal/jsonata',
    version: '^2.0.0',
  })

  assert.deepEqual(packageJson, {
    dependencies: {
      '@mmkal/jsonata': '^2.0.0',
      unchanged: '^1.0.0',
    },
  })
})

void test('rejects dependency key rewrite collisions', () => {
  const packageJson = {
    dependencies: {
      jsonata: 'workspace:*',
      '@mmkal/jsonata': '^1.0.0',
    },
  }

  assert.throws(
    () =>
      writePublishedDependencyVersion(packageJson, {
        section: 'dependencies',
        sourceName: 'jsonata',
        publishName: '@mmkal/jsonata',
        version: '^2.0.0',
      }),
    /both keys already exist/,
  )
})
