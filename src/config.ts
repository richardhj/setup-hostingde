import * as yaml from 'js-yaml'
import fs from 'fs'

export async function config(appKey: string): Promise<{
  manifest: Manifest
  app: ManifestApp | null
  envVars: { [key: string]: string | boolean | number }
}> {
  const manifest = yaml.load(
    fs.readFileSync('./.hosting/config.yaml', 'utf8')
  ) as Manifest
  const app = manifest.applications[appKey] ?? null
  const envVars = app?.env ?? {}

  return { manifest, app, envVars }
}

interface Manifest {
  project?: {
    parent?: string
    domain?: string
    prune?: boolean
  }
  applications: {
    [app: string]: ManifestApp
  }
  databases?: {
    schemas: string[]
    endpoints: {
      [endpoint: string]: string // 'schema:privileges' or 'schema'
    }
  }
}

interface ManifestApp {
  pool?: string
  account?: string
  php: {
    version: string
    extensions?: string[]
    ini?: {
      [key: string]: string | boolean
    }
  }
  env?: {
    [key: string]: string | boolean | number
  }
  relationships?: {
    [key: string]: string
  }
  web: {
    [domainName: string]: ManifestAppWeb
  }
  disk?: number
  sync?: string[]
  cron?: CronjobConfig[]
  users?: {
    [displayName: string]: string
  }
}

interface ManifestAppWeb {
  root?: string
  www?: boolean
  locations: {
    [matchString: string]: {
      passthru?: string | boolean
      expires?: boolean
      allow?: boolean
    }
  }
}

interface CronjobConfig {
  php?: string
  cmd?: string
  every: string
  on: string
}

export { Manifest, ManifestApp, ManifestAppWeb, CronjobConfig }
