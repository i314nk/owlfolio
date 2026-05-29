import { existsSync } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname as pathDirname, join, parse } from 'node:path'
import { homedir } from 'node:os'

import { defaultDemoAppConfig, type AppConfig } from '@owlfolio/shared'

type AppConfigEnv = {
  OWLFOLIO_APP_CONFIG_PATH?: string
  OWLFOLIO_PROJECT_DIR?: string
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
    return defaultDemoAppConfig()
  }

  const raw = await readFile(configPath, 'utf8')
  return JSON.parse(raw) as AppConfig
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
