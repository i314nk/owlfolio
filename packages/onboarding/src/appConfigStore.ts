import { existsSync } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname as pathDirname, join, parse } from 'node:path'
import { homedir } from 'node:os'

import { defaultUnconfiguredAppConfig, owlfolioModeValues, type AppConfig } from '@owlfolio/shared'

type AppConfigEnv = {
  [key: string]: string | undefined
  OWLFOLIO_APP_CONFIG_PATH?: string
  OWLFOLIO_PROJECT_DIR?: string
}

/**
 * The default config for an install with no config file yet: always `unconfigured` (nothing silently
 * falls through to a working mode). Tests that need a usable workspace initialize `personal-local`
 * programmatically via the onboarding init seam.
 */
export function defaultAppConfigForNewInstall(_env: AppConfigEnv = process.env as AppConfigEnv): AppConfig {
  return defaultUnconfiguredAppConfig()
}

/**
 * Coerce a config read from disk: a retired/unknown `mode` (e.g. a stale `"demo"` from before demo mode
 * was removed) reads back as `unconfigured` so the app presents the honest "connect a provider" state
 * rather than an invalid mode. All other fields pass through untouched.
 */
function coercePersistedConfig(raw: AppConfig): AppConfig {
  if ((owlfolioModeValues as readonly string[]).includes(raw.mode)) {
    return raw
  }
  return { ...raw, mode: 'unconfigured' }
}

type AppConfigStoreOptions = {
  cwd?: string
  env?: AppConfigEnv
}

export function resolveAppConfigPath({ cwd = process.cwd(), env = process.env as AppConfigEnv }: AppConfigStoreOptions = {}): string {
  if (env.OWLFOLIO_APP_CONFIG_PATH !== undefined && env.OWLFOLIO_APP_CONFIG_PATH.length > 0) {
    return env.OWLFOLIO_APP_CONFIG_PATH
  }

  const projectRoot = env.OWLFOLIO_PROJECT_DIR ?? resolveProjectRootFromCwd(cwd)
  return join(projectRoot, 'data', 'app-config.json')
}

export function resolveSourceLedgerPath({ cwd = process.cwd(), env = process.env as AppConfigEnv }: AppConfigStoreOptions = {}): string {
  const projectRoot = env.OWLFOLIO_PROJECT_DIR ?? resolveProjectRootFromCwd(cwd)
  return join(projectRoot, 'data', 'source-ledger')
}

export async function appConfigExists(options: AppConfigStoreOptions = {}): Promise<boolean> {
  try {
    await access(resolveAppConfigPath(options))
    return true
  } catch {
    return false
  }
}

export async function loadAppConfig(options: AppConfigStoreOptions = {}): Promise<AppConfig> {
  const configPath = resolveAppConfigPath(options)

  if (!(await appConfigExists(options))) {
    return defaultAppConfigForNewInstall((options.env ?? process.env) as AppConfigEnv)
  }

  const raw = await readFile(configPath, 'utf8')
  return coercePersistedConfig(JSON.parse(raw) as AppConfig)
}

export async function saveAppConfig(config: AppConfig, options: AppConfigStoreOptions = {}): Promise<void> {
  const configPath = resolveAppConfigPath(options)
  await mkdir(pathDirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
}

export function resolveProjectRootFromCwd(cwd: string): string {
  const normalized = cwd.replace(/\/+$/, '') || cwd
  let current = normalized
  const { root } = parse(normalized)

  while (true) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) {
      return current
    }

    if (current === root) {
      return normalized
    }

    const parent = pathDirname(current)
    if (parent === current) {
      return normalized
    }

    current = parent
  }
}

export function defaultClaudeCredentialsPath(): string {
  return join(homedir(), '.claude', '.credentials.json')
}
