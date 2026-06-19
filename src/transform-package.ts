import * as fs from 'fs'
import * as path from 'path'
import {sortPackageJson} from 'sort-package-json'
import type {MopubConfig, TransformPackageHelpers, TransformPackageContext} from './config.js'

export async function runTransformPackage(config: MopubConfig, context: Omit<TransformPackageContext, 'helpers'>) {
  if (!config.transformPackage) return

  await config.transformPackage({
    ...context,
    helpers: createHelpers(context.directory),
  })
}

function createHelpers(directory: string): TransformPackageHelpers {
  return {
    editFile: async (relativePath, updater) => {
      const filepath = resolvePackagePath(directory, relativePath)
      const current = await fs.promises.readFile(filepath, 'utf8')
      const updated = await updater(current)
      if (typeof updated !== 'string') {
        throw new Error(`editFile updater for ${relativePath} must return a string`)
      }
      await fs.promises.writeFile(filepath, updated, 'utf8')
    },
    editJsonFile: async <T = Record<string, unknown>>(
      relativePath: string,
      updater: (value: T) => T | void | Promise<T | void>,
    ) => {
      const filepath = resolvePackagePath(directory, relativePath)
      const current = JSON.parse(await fs.promises.readFile(filepath, 'utf8')) as T
      const updated = await updater(current)
      const json = JSON.stringify(updated === undefined ? current : updated, null, 2)
      const content = path.basename(filepath) === 'package.json' ? sortPackageJson(json) : `${json}\n`
      await fs.promises.writeFile(filepath, content, 'utf8')
    },
  }
}

function resolvePackagePath(directory: string, relativePath: string) {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Package transform helper paths must be relative: ${relativePath}`)
  }

  const root = path.resolve(directory)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Package transform helper path escapes package directory: ${relativePath}`)
  }
  return resolved
}
