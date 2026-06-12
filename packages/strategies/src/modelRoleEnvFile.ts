import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { modelRoleIds } from './modelRegistry'

/**
 * Shared, dependency-light reader that makes the UI-managed `OWLFOLIO_MODEL_ROLE_*` entries in the local
 * env file (~/.owlfolio/.env, or `OWLFOLIO_ENV_FILE`) ACTUALLY take effect in the research run paths.
 *
 * The model registry's pure resolver (`resolveModelForRole`) reads `OWLFOLIO_MODEL_ROLE_<ROLE>` from an
 * INJECTABLE env, but the run paths historically passed `process.env`, and entries written to the env
 * FILE are NOT in `process.env`. This module bridges that gap for BOTH the web (via apps/web's
 * `modelRoleEnv` re-export) and the worker (which cannot import from apps/web). It lives in `strategies`
 * because that package already owns the registry and is a dependency of both web and worker.
 *
 * SECURITY: the env file also holds provider SECRETS (API keys). This module ONLY ever reads/returns the
 * `OWLFOLIO_MODEL_ROLE_*` entries (provider:model@temp strings, never keys). Other entries are never
 * pulled out. `resolveModelRoleEnv` overlays only those role keys onto a caller-supplied process env
 * (whose secrets the caller already holds) — it never widens secret exposure.
 *
 * Precedence for the role keys: the FILE wins over process.env — the env file is the UI-managed source of
 * truth (the /settings/providers selector writes there). Fail-closed: an unreadable/absent file yields an
 * empty override map (process.env only).
 */

/** The env-var prefix for a per-role model override (matches the registry resolver's lookup). */
export const MODEL_ROLE_ENV_PREFIX = 'OWLFOLIO_MODEL_ROLE_' as const

/** The full set of valid `OWLFOLIO_MODEL_ROLE_*` key names (one per registry role). */
const VALID_MODEL_ROLE_ENV_KEYS: ReadonlySet<string> = new Set(
  modelRoleIds.map((role) => `${MODEL_ROLE_ENV_PREFIX}${role.toUpperCase()}`),
)

/** The env-var name a given registry role resolves against (e.g. `lane_moat` → `OWLFOLIO_MODEL_ROLE_LANE_MOAT`). */
export function modelRoleEnvKeyForRole(role: string): string {
  return `${MODEL_ROLE_ENV_PREFIX}${role.toUpperCase()}`
}

/** True when a name is a per-role model override key (prefix + a non-empty role suffix). */
export function isModelRoleEnvKey(name: string): boolean {
  return name.startsWith(MODEL_ROLE_ENV_PREFIX) && name.length > MODEL_ROLE_ENV_PREFIX.length
}

/** True when a name is a per-role override key whose role suffix is an actual registry role. */
export function isKnownModelRoleEnvKey(name: string): boolean {
  return VALID_MODEL_ROLE_ENV_KEYS.has(name)
}

export type ModelRoleEnvFileOptions = {
  /** Absolute path to the env file. When omitted, resolved from `OWLFOLIO_ENV_FILE` then ~/.owlfolio/.env. */
  envPath?: string
  env?: Record<string, string | undefined>
  homedir?: string
}

/** Resolve the env-file path: OWLFOLIO_ENV_FILE override, else ~/.owlfolio/.env (mirrors apps/web's envKeys). */
export function resolveModelRoleEnvFilePath(options: ModelRoleEnvFileOptions = {}): string {
  if (options.envPath !== undefined && options.envPath.length > 0) return options.envPath
  const env = options.env ?? (process.env as Record<string, string | undefined>)
  if (env.OWLFOLIO_ENV_FILE !== undefined && env.OWLFOLIO_ENV_FILE.length > 0) return env.OWLFOLIO_ENV_FILE
  const home = options.homedir ?? homedir()
  return join(home, '.owlfolio', '.env')
}

/**
 * Read ONLY the `OWLFOLIO_MODEL_ROLE_*` entries from the local env file. Never returns other entries
 * (provider secrets stay untouched). Fail-closed: an unreadable/absent file yields an empty map.
 */
export async function readModelRoleOverridesFromEnvFile(
  options: ModelRoleEnvFileOptions = {},
): Promise<Record<string, string>> {
  let raw: string
  try {
    raw = await readFile(resolveModelRoleEnvFilePath(options), 'utf8')
  } catch {
    return {}
  }
  const out: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const name = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (value.length > 0 && isModelRoleEnvKey(name)) {
      out[name] = value
    }
  }
  return out
}

export type ResolveModelRoleEnvOptions = ModelRoleEnvFileOptions & {
  /** The base process env to overlay the file's role overrides onto (the caller's existing env). */
  processEnv?: Record<string, string | undefined>
}

/**
 * Build the env map the run paths hand to the model registry: the caller's process env with the env
 * FILE's `OWLFOLIO_MODEL_ROLE_*` entries overlaid on top (FILE wins for those keys). All non-role
 * process entries pass through untouched. Fail-closed: an unreadable file leaves process.env unchanged.
 */
export async function resolveModelRoleEnv(
  options: ResolveModelRoleEnvOptions = {},
): Promise<Record<string, string | undefined>> {
  const { processEnv, ...fileOptions } = options
  const base: Record<string, string | undefined> = { ...(processEnv ?? (process.env as Record<string, string | undefined>)) }
  const fileOverrides = await readModelRoleOverridesFromEnvFile(fileOptions)
  for (const [name, value] of Object.entries(fileOverrides)) {
    base[name] = value
  }
  return base
}
