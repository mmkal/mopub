import * as fs from 'fs'
import * as path from 'path'
import {pathToFileURL} from 'url'
import type {PackageJson as TypeFestPackageJson} from 'type-fest'
import {z} from 'zod'

export type PackageJson = TypeFestPackageJson & {
  name?: string
  version?: string
  git?: {sha?: string}
  [key: string]: unknown
}

export type TransformPackageInfo = {
  name: string
  publishName: string
  version: string
  targetVersion: string
  path: string
}

export type TransformPackageHelpers = {
  readFile: (relativePath: string) => Promise<string>
  writeFile: (relativePath: string, content: string) => Promise<void>
  editFile: (relativePath: string, updater: (content: string) => string | Promise<string>) => Promise<void>
  readJsonFile: <T = unknown>(relativePath: string) => Promise<T>
  writeJsonFile: (relativePath: string, value: unknown) => Promise<void>
  editJsonFile: <T = unknown>(
    relativePath: string,
    updater: (value: T) => T | void | Promise<T | void>,
  ) => Promise<void>
}

export type TransformPackageContext = {
  packageDir: string
  packageJsonPath: string
  packageJson: PackageJson
  pkg: TransformPackageInfo
  helpers: TransformPackageHelpers
}

export type MopubPackageConfig = {
  publishName?: string
}

export type MopubConfig = {
  packages?: Record<string, MopubPackageConfig>
  transformPackage?: (context: TransformPackageContext) => void | Promise<void>
}

export type LoadedMopubConfig = {
  config: MopubConfig
  filepath: string | null
}

export const defineConfig = (config: MopubConfig) => config

export const MOPUB_CONFIG_FILENAMES = ['mopub.config.mjs', 'mopub.config.js', 'mopub.config.cjs'] as const

const MopubPackageConfigSchema = z
  .object({
    publishName: z.string().optional(),
  })
  .strict()

const MopubConfigSchema = z
  .object({
    packages: z.record(z.string(), MopubPackageConfigSchema).optional(),
    transformPackage: z
      .custom<MopubConfig['transformPackage']>(value => typeof value === 'function', {
        message: 'Expected a function',
      })
      .optional(),
  })
  .strict()

export async function loadMopubConfig(workspaceRoot: string): Promise<LoadedMopubConfig> {
  const configFiles = MOPUB_CONFIG_FILENAMES.map(filename => path.join(workspaceRoot, filename)).filter(filepath =>
    fs.existsSync(filepath),
  )

  if (configFiles.length === 0) {
    return {config: {}, filepath: null}
  }
  if (configFiles.length > 1) {
    throw new Error(`Multiple mopub config files found:\n${configFiles.join('\n')}`)
  }

  const filepath = configFiles[0]
  try {
    const moduleUrl = pathToFileURL(filepath)
    moduleUrl.searchParams.set('t', Date.now().toString())
    const imported = (await import(moduleUrl.href)) as {default?: unknown}
    if (!('default' in imported)) {
      throw new Error('Config file must have a default export')
    }
    return {config: parseMopubConfig(imported.default, filepath), filepath}
  } catch (error) {
    throw new Error(`Failed to load mopub config at ${filepath}: ${getErrorMessage(error)}`, {cause: error})
  }
}

export function parseMopubConfig(value: unknown, filepath = 'mopub config'): MopubConfig {
  const parsed = MopubConfigSchema.safeParse(value === undefined ? {} : value)
  if (parsed.success) return parsed.data

  throw new Error(`Invalid ${filepath}: ${z.prettifyError(parsed.error)}`)
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
