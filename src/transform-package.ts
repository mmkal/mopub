import * as fs from 'fs'
import * as path from 'path'
import {sortPackageJson} from 'sort-package-json'
import type {MopubConfig, PackageJson, TransformPackageHelpers, TransformPackageInfo} from './config.js'

export function createTransformPackageHelpers(packageDir: string, packageJsonPath: string): TransformPackageHelpers {
  const resolve = (relativePath: string) => resolvePackagePath(packageDir, relativePath)

  const writeJsonFile = async (relativePath: string, value: unknown) => {
    const filepath = resolve(relativePath)
    await fs.promises.mkdir(path.dirname(filepath), {recursive: true})
    await fs.promises.writeFile(filepath, stringifyJsonForFile(filepath, packageJsonPath, value), 'utf8')
  }

  return {
    readFile: async relativePath => fs.promises.readFile(resolve(relativePath), 'utf8'),
    writeFile: async (relativePath, content) => {
      if (typeof content !== 'string') {
        throw new Error(`writeFile expected string content for ${relativePath}`)
      }
      const filepath = resolve(relativePath)
      await fs.promises.mkdir(path.dirname(filepath), {recursive: true})
      await fs.promises.writeFile(filepath, content, 'utf8')
    },
    editFile: async (relativePath, updater) => {
      const filepath = resolve(relativePath)
      const current = await fs.promises.readFile(filepath, 'utf8')
      const updated = await updater(current)
      if (typeof updated !== 'string') {
        throw new Error(`editFile updater for ${relativePath} must return a string`)
      }
      await fs.promises.writeFile(filepath, updated, 'utf8')
    },
    readJsonFile: async <T = unknown>(relativePath: string) =>
      JSON.parse(await fs.promises.readFile(resolve(relativePath), 'utf8')) as T,
    writeJsonFile,
    editJsonFile: async <T = unknown>(
      relativePath: string,
      updater: (value: T) => T | void | Promise<T | void>,
    ) => {
      const filepath = resolve(relativePath)
      const current = JSON.parse(await fs.promises.readFile(filepath, 'utf8')) as T
      const updated = await updater(current)
      await writeJsonFile(relativePath, updated === undefined ? current : updated)
    },
  }
}

export async function runTransformPackage(
  config: MopubConfig,
  params: {
    packageDir: string
    packageJsonPath: string
    pkg: TransformPackageInfo
  },
) {
  const beforeText = await fs.promises.readFile(params.packageJsonPath, 'utf8')
  const packageJson = JSON.parse(beforeText) as PackageJson
  const beforeObjectJson = JSON.stringify(packageJson)

  if (config.transformPackage) {
    try {
      await config.transformPackage({
        packageDir: params.packageDir,
        packageJsonPath: params.packageJsonPath,
        packageJson,
        pkg: params.pkg,
        helpers: createTransformPackageHelpers(params.packageDir, params.packageJsonPath),
      })
    } catch (error) {
      throw new Error(
        `transformPackage failed for ${params.pkg.name} (${params.pkg.publishName}) in ${params.packageDir}: ${getErrorMessage(error)}`,
        {cause: error},
      )
    }
  }

  const afterText = await fs.promises.readFile(params.packageJsonPath, 'utf8')
  const objectChanged = JSON.stringify(packageJson) !== beforeObjectJson
  const fileChanged = afterText !== beforeText

  if (objectChanged && fileChanged) {
    throw new Error(
      `transformPackage for ${params.pkg.name} changed package.json both through the packageJson object and on disk. Choose one style.`,
    )
  }

  const finalPackageJson = fileChanged ? (JSON.parse(afterText) as PackageJson) : packageJson
  validateFinalPackageJson(finalPackageJson, params.pkg)

  await fs.promises.writeFile(
    params.packageJsonPath,
    stringifyJsonForFile(params.packageJsonPath, params.packageJsonPath, finalPackageJson),
    'utf8',
  )
}

export function resolvePackagePath(packageDir: string, relativePath: string) {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Package transform helper paths must be relative: ${relativePath}`)
  }

  const root = path.resolve(packageDir)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Package transform helper path escapes packageDir: ${relativePath}`)
  }
  return resolved
}

function stringifyJsonForFile(filepath: string, packageJsonPath: string, value: unknown) {
  const json = JSON.stringify(value, null, 2)
  if (path.resolve(filepath) === path.resolve(packageJsonPath)) {
    return sortPackageJson(json)
  }
  return `${json}\n`
}

function validateFinalPackageJson(packageJson: PackageJson, pkg: TransformPackageInfo) {
  if (packageJson.name !== pkg.publishName) {
    throw new Error(
      `Final package.json name for ${pkg.name} is ${String(packageJson.name)}, expected ${pkg.publishName}. Use packages["${pkg.name}"].publishName for package renames.`,
    )
  }
  if (packageJson.version !== pkg.targetVersion) {
    throw new Error(
      `Final package.json version for ${pkg.name} is ${String(packageJson.version)}, expected ${pkg.targetVersion}. Use mopub version inputs for package versions.`,
    )
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
