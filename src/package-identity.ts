import type {MopubConfig} from './config.js'

const npmNameSegment = String.raw`[a-z0-9][a-z0-9._-]*`
const npmPackageNamePattern = new RegExp(String.raw`^(?:${npmNameSegment}|@${npmNameSegment}/${npmNameSegment})$`)

export type PackageWithPublishName = {
  name: string
  publishName: string
}

export type PackageConfigTarget = {
  name: string
  publishName?: string
}

export function applyPublishNames(
  packages: PackageConfigTarget[],
  config: MopubConfig,
  options: {scope?: string},
) {
  validatePackageConfigKeys(packages, config)

  for (const pkg of packages) {
    pkg.publishName = resolvePublishName({
      sourceName: pkg.name,
      configuredPublishName: config.packages?.[pkg.name]?.publishName,
      scope: options.scope,
    })
  }
}

export function resolvePublishName(params: {sourceName: string; configuredPublishName?: string; scope?: string}) {
  const scopedPublishName = params.scope ? `${params.scope}/${unscopedPackageName(params.sourceName)}` : undefined
  if (params.configuredPublishName && scopedPublishName && params.configuredPublishName !== scopedPublishName) {
    throw new Error(
      `Package ${params.sourceName} has publishName ${params.configuredPublishName}, which conflicts with --scope ${params.scope} resolving to ${scopedPublishName}`,
    )
  }

  const publishName = params.configuredPublishName || scopedPublishName || params.sourceName
  assertValidPublishName(publishName, `publishName for ${params.sourceName}`)
  return publishName
}

export function assertValidPublishName(publishName: string, label = 'publishName') {
  if (!npmPackageNamePattern.test(publishName)) {
    throw new Error(
      `Invalid ${label}: ${publishName}. Expected an npm package name like "package-name" or "@scope/package-name".`,
    )
  }
}

export function validatePackageConfigKeys(packages: {name: string}[], config: MopubConfig) {
  const packageNames = new Set(packages.map(pkg => pkg.name))
  const unknown = Object.keys(config.packages || {}).filter(name => !packageNames.has(name))
  if (unknown.length > 0) {
    throw new Error(`mopub config contains package entries that are not publishable workspace packages: ${unknown.join(', ')}`)
  }
}

export function findPackageByPublishedDependencyName<T extends PackageWithPublishName>(packages: T[], dependencyName: string) {
  return packages.find(pkg => pkg.publishName === dependencyName) || packages.find(pkg => pkg.name === dependencyName)
}

export function writePublishedDependencyVersion(
  packageJson: Record<string, Record<string, string> | undefined>,
  params: {section: string; sourceName: string; publishName: string; version: string},
) {
  const currentDependencies = packageJson[params.section]
  const dependencies: Record<string, string> = currentDependencies ? {...currentDependencies} : {}
  const hasSourceName = Object.prototype.hasOwnProperty.call(dependencies, params.sourceName)
  const hasPublishName = Object.prototype.hasOwnProperty.call(dependencies, params.publishName)

  if (params.sourceName !== params.publishName && hasSourceName && hasPublishName) {
    throw new Error(
      `Cannot rewrite dependency ${params.sourceName} to ${params.publishName} because both keys already exist in ${params.section}`,
    )
  }

  if (params.sourceName !== params.publishName) {
    delete dependencies[params.sourceName]
  }
  dependencies[params.publishName] = params.version
  packageJson[params.section] = dependencies
}

function unscopedPackageName(packageName: string) {
  return packageName.split('/').at(-1) || packageName
}
