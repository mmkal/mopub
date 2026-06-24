import * as path from 'path'
import {pathToFileURL} from 'url'

export type TransformPackageHelpers = {
  editFile: (relativePath: string, updater: (content: string) => string | Promise<string>) => Promise<void>
  editJsonFile: <T = Record<string, unknown>>(
    relativePath: string,
    updater: (value: T) => T | void | Promise<T | void>,
  ) => Promise<void>
}

export type TransformPackageContext = {
  directory: string
  packageDir: string
  pkg: {
    name: string
    version: string
    targetVersion: string
    path: string
  }
  helpers: TransformPackageHelpers
}

export type MopubConfig = {
  transformPackage?: (context: TransformPackageContext) => void | Promise<void>
}

export const defineConfig = (config: MopubConfig) => config

export async function loadMopubConfig(configPath: string | undefined): Promise<MopubConfig> {
  if (!configPath) return {}

  const filepath = path.resolve(configPath)
  const imported = (await import(pathToFileURL(filepath).href)) as {default?: unknown}
  return validateConfig(imported.default, filepath)
}

function validateConfig(value: unknown, filepath: string): MopubConfig {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid mopub config at ${filepath}: default export must be an object`)
  }

  const unknownKeys = Object.keys(value).filter(key => key !== 'transformPackage')
  if (unknownKeys.length > 0) {
    throw new Error(`Invalid mopub config at ${filepath}: unknown keys ${unknownKeys.join(', ')}`)
  }

  const config = value as MopubConfig
  if (config.transformPackage && typeof config.transformPackage !== 'function') {
    throw new Error(`Invalid mopub config at ${filepath}: transformPackage must be a function`)
  }

  return config
}
