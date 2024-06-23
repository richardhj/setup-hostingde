import * as core from '@actions/core'
import crypto from 'crypto'
import { HttpClient } from '@actions/http-client'
import { TypedResponse } from '@actions/http-client/lib/interfaces'
import { CronjobConfig, ManifestApp, ManifestAppWeb } from './config'
import process from 'node:process'

const _http = new HttpClient()
const token = core.getInput('auth-token', { required: true })
const baseUri = 'https://secure.hosting.de/api'

export async function findActiveWebspaces(
  projectPrefix: string
): Promise<WebspaceResult[]> {
  const response: TypedResponse<ApiFindResponse<WebspaceResult>> =
    await _http.postJson(`${baseUri}/webhosting/v1/json/webspacesFind`, {
      authToken: token,
      filter: {
        subFilterConnective: 'AND',
        subFilter: [
          {
            field: 'webspaceName',
            value: `${projectPrefix}-*`
          },
          {
            field: 'webspaceStatus',
            value: 'active'
          }
        ]
      }
    })

  return response.result?.response?.data ?? []
}

export async function findOneWebspaceByName(
  webspaceName: string
): Promise<WebspaceResult | null> {
  const response: TypedResponse<ApiFindResponse<WebspaceResult>> =
    await _http.postJson(`${baseUri}/webhosting/v1/json/webspacesFind`, {
      authToken: token,
      limit: 1,
      filter: {
        subFilterConnective: 'AND',
        subFilter: [
          {
            field: 'webspaceName',
            value: webspaceName
          },
          {
            field: 'webspaceStatus',
            value: 'active'
          }
        ]
      }
    })
  if ((response.result?.response?.totalEntries ?? 0) > 1) {
    throw new Error(
      `We found more than 1 webspace with name "${webspaceName}" and cannot know where to deploy to.`
    )
  }

  return response.result?.response?.data[0] ?? null
}

export async function findWebspaceById(
  webspaceId: string
): Promise<WebspaceResult | null> {
  const response: TypedResponse<ApiFindResponse<WebspaceResult>> =
    await _http.postJson(`${baseUri}/webhosting/v1/json/webspacesFind`, {
      authToken: token,
      limit: 1,
      filter: {
        field: 'webspaceId',
        value: webspaceId
      }
    })

  return response.result?.response?.data[0] ?? null
}

export async function findVhostByWebspace(
  webspaceId: string
): Promise<VhostResult[]> {
  const response: TypedResponse<ApiFindResponse<VhostResult>> =
    await _http.postJson(`${baseUri}/webhosting/v1/json/vhostsFind`, {
      authToken: token,
      filter: {
        subFilterConnective: 'AND',
        subFilter: [
          {
            field: 'webspaceId',
            value: webspaceId
          },
          {
            field: 'vHostStatus',
            value: 'active'
          }
        ]
      }
    })

  return response.result?.response?.data ?? []
}

export async function deleteWebspaceById(webspaceId: string): Promise<void> {
  await _http.postJson(`${baseUri}/webhosting/v1/json/webspaceDelete`, {
    authToken: token,
    webspaceId
  })
}

export async function deleteVhostById(vhostId: string): Promise<void> {
  await _http.postJson(`${baseUri}/webhosting/v1/json/vhostDelete`, {
    authToken: token,
    vhostId
  })
}

export async function deleteDatabaseById(databaseId: string): Promise<void> {
  await _http.postJson(`${baseUri}/database/v1/json/databaseDelete`, {
    authToken: token,
    databaseId
  })
}

export async function findDatabasesByPrefix(
  databasePrefix: string
): Promise<DatabaseResult[]> {
  const response: TypedResponse<ApiFindResponse<DatabaseResult>> =
    await _http.postJson(`${baseUri}/database/v1/json/databasesFind`, {
      authToken: token,
      filter: {
        subFilterConnective: 'AND',
        subFilter: [
          {
            field: 'databaseName',
            value: `${databasePrefix}-*`
          },
          {
            field: 'databaseStatus',
            value: 'active'
          }
        ]
      }
    })

  return response.result?.response?.data ?? []
}

export async function findDatabaseAccesses(
  userName: string,
  databaseId: string
): Promise<DatabaseUserResult[]> {
  const response: TypedResponse<ApiFindResponse<DatabaseUserResult>> =
    await _http.postJson(`${baseUri}/database/v1/json/usersFind`, {
      authToken: token,
      filter: {
        subFilterConnective: 'AND',
        subFilter: [
          {
            field: 'userName',
            value: userName
          },
          {
            field: 'userAccessesDatabaseId',
            value: databaseId
          }
        ]
      }
    })

  return response.result?.response?.data ?? []
}

export async function findWebspaceUsers(): Promise<WebspaceUserResult[]> {
  const response: TypedResponse<ApiFindResponse<WebspaceUserResult>> =
    await _http.postJson(`${baseUri}/webhosting/v1/json/usersFind`, {
      authToken: token,
      filter: {
        field: 'userName',
        value: 'github-action--*'
      }
    })

  return response.result?.response?.data ?? []
}

export async function createWebspace(
  name: string,
  cronjobs: CronjobConfig[],
  phpVersion: string | null,
  poolId: string | null = null,
  accountId: string | null = null,
  redisEnabled = false
): Promise<WebspaceResult> {
  const user = await createWebspaceUser(name)

  const response: TypedResponse<ApiActionResponse<WebspaceResult>> =
    await _http.postJson(`${baseUri}/webhosting/v1/json/webspaceCreate`, {
      poolId,
      authToken: token,
      webspace: {
        name,
        accountId,
        comments: 'Created by github action. Please do not change name.',
        productCode: 'webhosting-webspace-v1-1m',
        cronJobs: cronjobs.map(c => transformCronJob(c, phpVersion)),
        redisEnabled
      },
      accesses: [
        {
          userId: user.id,
          sshAccess: true
        }
      ]
    })

  if (null === response.result) {
    throw new Error('Unexpected error')
  }

  if ('error' === (response.result.status ?? null)) {
    throw new Error(JSON.stringify(response.result.errors ?? []))
  }

  return response.result.response
}

export async function updateWebspace(
  originalWebspace: WebspaceResult,
  phpVersion: string | null,
  cronjobs: CronjobConfig[] | null = null,
  redisEnabled = false
): Promise<WebspaceResult> {
  const webspace = originalWebspace
  const accesses = originalWebspace.accesses

  if (null !== cronjobs) {
    webspace.cronJobs = cronjobs.map(c => transformCronJob(c, phpVersion))
  }

  if (null !== redisEnabled) {
    webspace.redisEnabled = redisEnabled
  }

  const response: TypedResponse<ApiActionResponse<WebspaceResult>> =
    await _http.postJson(`${baseUri}/webhosting/v1/json/webspaceUpdate`, {
      authToken: token,
      webspace,
      accesses
    })

  if (null === response.result) {
    throw new Error('Unexpected error')
  }

  if ('error' === (response.result.status ?? null)) {
    throw new Error(JSON.stringify(response.result.errors ?? []))
  }

  return response.result.response
}

export async function createVhost(
  webspace: WebspaceResult,
  web: ManifestAppWeb,
  app: ManifestApp,
  domainName: string
): Promise<VhostResult> {
  const response: TypedResponse<ApiActionResponse<VhostResult>> =
    await _http.postJson(`${baseUri}/webhosting/v1/json/vhostCreate`, {
      authToken: token,
      vhost: {
        domainName,
        serverType: 'nginx',
        webspaceId: webspace.id,
        enableAlias: web.www ?? true,
        redirectToPrimaryName: true,
        redirectHttpToHttps: true,
        phpVersion: app.php?.version ?? process.env.PHP_VERSION ?? null,
        webRoot: `current/${web.root ?? ''}`.replace(/\/$/, ''),
        locations: Object.entries(web.locations ?? {}).map(function ([
          matchString,
          location
        ]) {
          return {
            matchString,
            matchType: matchString.startsWith('^')
              ? 'regex'
              : matchString.startsWith('/')
                ? 'directory'
                : 'default',
            locationType: location.allow ?? true ? 'generic' : 'blockAccess',
            mapScript:
              typeof (location.passthru ?? false) === 'string'
                ? location.passthru
                : '',
            phpEnabled: false !== (location.passthru ?? false)
          }
        }),
        sslSettings: {
          profile: 'modern',
          managedSslProductCode: 'ssl-letsencrypt-dv-3m'
        }
      },
      phpIni: {
        values: transformPhpIni(app.php?.ini ?? {})
      }
    })

  if (null === response.result) {
    throw new Error('Unexpected error')
  }

  if ('error' === (response.result.status ?? null)) {
    throw new Error(JSON.stringify(response.result.errors ?? []))
  }

  return response.result.response
}

export async function createDatabase(
  dbUserName: string,
  databaseName: string,
  poolId: string | null = null,
  accountId: string | null = null
): Promise<{
  database: DatabaseResult
  databaseUserName: string
  databasePassword: string
}> {
  const { user, password } = await createDatabaseUser(dbUserName, accountId)

  const response: TypedResponse<ApiActionResponse<DatabaseResult>> =
    await _http.postJson(`${baseUri}/database/v1/json/databaseCreate`, {
      authToken: token,
      poolId,
      database: {
        name: databaseName,
        comments: 'Created by github action. Please do not change name.',
        productCode: 'database-mariadb-single-v1-1m',
        storageQuota: 512,
        accountId
      },
      accesses: [
        {
          userId: user.id,
          accessLevel: ['read', 'write', 'schema']
        }
      ]
    })

  if (null === response.result) {
    throw new Error('Unexpected error')
  }

  if ('error' === (response.result.status ?? null)) {
    throw new Error(JSON.stringify(response.result.errors ?? []))
  }

  const database = response.result.response
  const access = database.accesses.find(a => a.userId === user.id) ?? null

  return {
    database,
    databaseUserName: access?.dbLogin ?? '',
    databasePassword: password
  }
}

export async function addDatabaseAccess(
  database: DatabaseResult,
  dbUserName: string,
  accountId: string | null = null
): Promise<{
  database: DatabaseResult
  databaseUserName: string
  databasePassword: string
}> {
  const { user, password } = await createDatabaseUser(dbUserName, accountId)
  const accesses = database.accesses
  accesses.push({
    userId: user.id,
    databaseId: database.id,
    accessLevel: ['read', 'write', 'schema']
  })

  const response: TypedResponse<ApiActionResponse<DatabaseResult>> =
    await _http.postJson(`${baseUri}/database/v1/json/databaseUpdate`, {
      authToken: token,
      database: {
        id: database.id,
        name: database.name,
        productCode: database.productCode,
        forceSsl: database.forceSsl,
        storageQuota: database.storageQuota,
        comments: database.comments
      },
      accesses
    })

  if (null === response.result) {
    throw new Error('Unexpected error')
  }

  if ('error' === (response.result.status ?? null)) {
    throw new Error(JSON.stringify(response.result.errors ?? []))
  }

  const result = response.result.response
  const access = result.accesses.find(a => a.userId === user.id) ?? null

  return {
    database: result,
    databaseUserName: access?.dbLogin ?? '',
    databasePassword: password
  }
}

export async function createWebspaceUser(
  webspaceName: string
): Promise<WebspaceUserResult> {
  const sshKey: string = core.getInput('ssh-public-key', { required: true })

  const response: TypedResponse<ApiActionResponse<WebspaceUserResult>> =
    await _http.postJson(`${baseUri}/webhosting/v1/json/userCreate`, {
      authToken: token,
      user: {
        sshKey,
        name: `github-action--${webspaceName}`,
        comment: 'Created by github action. Please do not remove.'
      },
      password: crypto.randomUUID()
    })

  if (null === response.result) {
    throw new Error('Unexpected error')
  }

  if ('error' === (response.result.status ?? null)) {
    throw new Error(JSON.stringify(response.result.errors ?? []))
  }

  return response.result.response
}

export async function createDatabaseUser(
  dbUserName: string,
  accountId: string | null = null
): Promise<{ user: DatabaseUserResult; password: string }> {
  const password = crypto.randomUUID()

  const response: TypedResponse<ApiActionResponse<DatabaseUserResult>> =
    await _http.postJson(`${baseUri}/database/v1/json/userCreate`, {
      authToken: token,
      user: {
        name: dbUserName,
        comment: 'Created by github action. Please do not remove.',
        accountId
      },
      password
    })

  if (null === response.result) {
    throw new Error('Unexpected error')
  }

  if ('error' === (response.result.status ?? null)) {
    throw new Error(JSON.stringify(response.result.errors ?? []))
  }

  return { user: response.result.response, password }
}

function transformPhpIni(ini: object): object {
  return Object.entries(ini).map(([k, v]) => ({ key: k, value: `${v}` }))
}

export function transformCronJob(
  config: CronjobConfig,
  phpVersion: string | null
): CronJob {
  // Use default values so that _.isEqual comparison works
  const cronjob = {
    type: '',
    comments: '',
    script: '',
    parameters: [],
    url: '',
    interpreterVersion: null,
    schedule: '',
    weekday: '',
    dayOfMonth: 0,
    hour: 0,
    minute: 0
  } as CronJob

  if (config.php !== undefined && config.php !== null) {
    const [script, ...parameters] = config.php.split(' ')

    cronjob.type = 'php'
    cronjob.script = script
    cronjob.parameters = parameters
    cronjob.interpreterVersion = phpVersion
  } else if (config.cmd !== undefined && config.cmd !== null) {
    const [script, ...parameters] = config.cmd.split(' ')

    cronjob.type = 'bash'
    cronjob.script = script
    cronjob.parameters = parameters
  } else {
    throw new Error('Please configure either "php" or "cmd" for the cron jobs')
  }

  cronjob.comments = 'Created by github action. Please do not change.'

  let schedule = config.every
  switch (schedule) {
    case 'day':
      schedule = 'daily'
      break
    case 'week':
      schedule = 'weekly'
      break
    case 'month':
      schedule = 'monthly'
      break
  }

  cronjob.schedule = schedule

  if (schedule === 'weekly') {
    cronjob.weekday = (config.on ?? 'Mon').toLowerCase()
  } else if (schedule === 'monthly') {
    cronjob.dayOfMonth = Number(config.on ?? 1)
  } else if (schedule === 'daily') {
    cronjob.daypart = config.on ?? '1-5'
  }

  return cronjob
}

interface ApiResponse {
  errors: object[]
  metadata: {
    clientTransactionId: string
    serverTransactionId: string
  }
  status: string
  warnings: string[]
}

interface ApiFindResponse<T> extends ApiResponse {
  response: {
    data: T[]
    limit: number
    page: number
    totalEntries: number
    totalPages: number
    type: string
  }
}

interface ApiActionResponse<T> extends ApiResponse {
  response: T
}

interface WebspaceAccess {
  addDate: string
  ftpAccess: boolean
  lastChangeDate: string
  sshAccess: boolean
  statsAccess: boolean
  userId: string
  userName: string
  webspaceId: string
}

interface DatabaseAccess {
  addDate?: string
  lastChangeDate?: string
  accessLevel: string[]
  userId: string
  dbLogin?: string
  userName?: string
  databaseId?: string
}

interface WebspaceResult {
  id: string
  name: string
  comments: string
  webspaceName: string
  productCode: string
  hostName: string
  poolId: string
  cronJobs: CronJob[]
  redisEnabled: boolean
  status: string
  accesses: WebspaceAccess[]
}

interface CronJob {
  type: string
  comments: string
  script: string
  parameters?: string[]
  url?: string
  interpreterVersion?: string | null
  schedule: string
  daypart?: string | null
  weekday?: string
  dayOfMonth?: number
}

interface UserResult {
  id: string
  accountId: string
  addDate: string
  comments: string
  lastChangeDate: string
  name: string
  status: string
}

interface WebspaceUserResult extends UserResult {
  sshKey: string
  userName: string
}

interface DatabaseUserResult extends UserResult {
  dbUserName: string
}

interface VhostResult {
  id: string
  domainName: string
  additionalDomainNames: string[]
  enableAlias: boolean
  redirectToPrimaryName: boolean
  redirectHttpToHttps: boolean
  enableSystemAlias: boolean
  systemAlias: string
  webRoot: string
  phpVersion: string
  serverType: string
  httpUsers: object[]
  locations: object[]
  sslSettings: object
}

interface DatabaseResult {
  id: string
  accesses: DatabaseAccess[]
  bundleId: string | null
  poolId: string | null
  accountId: string
  addDate: string
  paidUntil: string
  renewOn: string
  deletionScheduledFor: string | null
  lastChangeDate: string
  name: string
  comments: string
  productCode: string
  restorableUntil: string | null
  status: string
  storageQuota: number
  storageQuotaIncluded: number
  storageQuotaUsedRatio: number
  storageUsed: number
  dbName: string
  hostName: string
  dbEngine: string
  dbType: string
  forceSsl: boolean
  restrictions: string[]
  limitations: string[]
}

export { VhostResult, WebspaceAccess, WebspaceResult, DatabaseResult }