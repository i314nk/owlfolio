import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/**
 * Server-only local `.env` key storage for the provider-keys page.
 *
 * SECURITY INVARIANTS (load-bearing — see CLAUDE.md):
 *  - Secrets NEVER leave the server. The client/page receives only
 *    {@link EnvKeyStatus} ({ name, is_set, tail }) — never the raw value.
 *  - Secrets NEVER enter the ledger, logs, page source, git, or test fixtures.
 *  - The env file lives outside the repo by default (~/.owlfolio/.env) so it is
 *    never committed; an in-repo `.env` is also covered by .gitignore.
 *
 * This module must only ever be imported from server code (route handlers,
 * server components, server actions). It reads/writes the raw value but only
 * exposes masked status to callers that render.
 */

const DEFAULT_DIR_NAME = '.owlfolio'
const DEFAULT_FILE_NAME = '.env'

/** A safe env var NAME: SCREAMING_SNAKE_CASE, the only thing ever shown. */
const SAFE_KEY_NAME = /^[A-Z][A-Z0-9_]*$/

export type EnvKeyStatus = {
  name: string
  is_set: boolean
  /** A short, masked tail of the secret (e.g. `…K3jQAA`), or undefined when unset. NEVER the value. */
  tail?: string
}

export type EnvKeyOptions = {
  /** Absolute path to the env file. When omitted it is resolved from env/home. */
  envPath?: string
  env?: Record<string, string | undefined>
  homedir?: string
}

/** Resolve the env-file path: OWLFOLIO_ENV_FILE override, else ~/.owlfolio/.env (outside the repo). */
export function resolveEnvKeyFilePath(options: { env?: Record<string, string | undefined>; homedir?: string } = {}): string {
  const env = options.env ?? (process.env as Record<string, string | undefined>)
  if (env.OWLFOLIO_ENV_FILE !== undefined && env.OWLFOLIO_ENV_FILE.length > 0) {
    return env.OWLFOLIO_ENV_FILE
  }
  const home = options.homedir ?? homedir()
  return join(home, DEFAULT_DIR_NAME, DEFAULT_FILE_NAME)
}

function envPathFrom(options: EnvKeyOptions): string {
  if (options.envPath !== undefined && options.envPath.length > 0) {
    return options.envPath
  }
  return resolveEnvKeyFilePath(options)
}

/**
 * Mask a secret down to a short tail. Returns `…` + last up-to-6 chars; for very
 * short secrets the tail is fully redacted so no meaningful fragment leaks.
 */
export function maskSecretTail(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 6) {
    return '…••••'
  }
  return `…${trimmed.slice(-6)}`
}

/** Parse `KEY=value` lines into a map. Comments and blank lines are skipped. */
function parseEnvFile(raw: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue
    }
    const eq = trimmed.indexOf('=')
    if (eq <= 0) {
      continue
    }
    const name = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    map.set(name, value)
  }
  return map
}

function serializeEnvFile(map: Map<string, string>): string {
  const lines: string[] = []
  for (const [name, value] of map) {
    lines.push(`${name}=${value}`)
  }
  return `${lines.join('\n')}\n`
}

async function readEnvMap(envPath: string): Promise<Map<string, string>> {
  try {
    return parseEnvFile(await readFile(envPath, 'utf8'))
  } catch {
    return new Map()
  }
}

/**
 * Read a single raw value. SERVER-ONLY. Never serialize the result to the client
 * — used for presence checks and to compute readiness env, not for display.
 */
export async function readEnvKeyValue(name: string, options: EnvKeyOptions = {}): Promise<string | undefined> {
  const map = await readEnvMap(envPathFrom(options))
  const value = map.get(name)
  return value !== undefined && value.length > 0 ? value : undefined
}

/** Load all stored keys as a raw map. SERVER-ONLY (used to build the readiness env). */
export async function readAllEnvKeys(options: EnvKeyOptions = {}): Promise<Record<string, string>> {
  const map = await readEnvMap(envPathFrom(options))
  const out: Record<string, string> = {}
  for (const [name, value] of map) {
    if (value.length > 0) {
      out[name] = value
    }
  }
  return out
}

/**
 * Load the local env-file keys into `target` (default `process.env`) so a credential saved via the providers
 * page is usable by the RUNTIME — the run-start gate, the spawned worker, and the provider adapters — not
 * just the readiness UI. Called once at server/worker startup.
 *
 * Shell/exported vars WIN: an already-set, non-empty `target[name]` is never overwritten (so a value exported
 * before launch always takes precedence). Only SAFE_KEY_NAME (SCREAMING_SNAKE_CASE) names are applied.
 * Returns the NAMES that were hydrated (never values) for optional startup logging.
 */
export async function hydrateProcessEnvFromEnvKeys(
  options: EnvKeyOptions = {},
  target: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Promise<string[]> {
  const fileKeys = await readAllEnvKeys(options)
  const hydrated: string[] = []
  for (const [name, value] of Object.entries(fileKeys)) {
    if (!SAFE_KEY_NAME.test(name)) {
      continue
    }
    const existing = target[name]
    if (existing === undefined || existing.length === 0) {
      target[name] = value
      hydrated.push(name)
    }
  }
  return hydrated
}

/** Build masked status for the requested names — the ONLY shape that reaches the client. */
export async function listEnvKeyStatuses(names: string[], options: EnvKeyOptions = {}): Promise<EnvKeyStatus[]> {
  const map = await readEnvMap(envPathFrom(options))
  return names.map((name) => {
    const value = map.get(name)
    if (value === undefined || value.length === 0) {
      return { name, is_set: false }
    }
    return { name, is_set: true, tail: maskSecretTail(value) }
  })
}

/** Whether a given key is present (non-empty). Used by the onboarding gate. */
export async function isEnvKeySet(name: string, options: EnvKeyOptions = {}): Promise<boolean> {
  return (await readEnvKeyValue(name, options)) !== undefined
}

/**
 * Set/update a single key, writing the env file immediately. The write is
 * local-only and atomic per-call; existing keys are preserved and the named key
 * is replaced in place (no duplicates). Rejects unsafe names.
 */
export async function setEnvKey(name: string, value: string, options: EnvKeyOptions = {}): Promise<void> {
  if (!SAFE_KEY_NAME.test(name)) {
    throw new Error(`Unsafe env key name: ${name}. Use SCREAMING_SNAKE_CASE.`)
  }
  const cleanValue = value.trim()
  if (cleanValue.length === 0) {
    throw new Error('Cannot set an empty value for an env key')
  }
  if (/[\r\n]/.test(value)) {
    throw new Error('Env key value must not contain newlines')
  }

  const envPath = envPathFrom(options)
  const map = await readEnvMap(envPath)
  map.set(name, cleanValue)

  await mkdir(dirname(envPath), { recursive: true })
  await writeFile(envPath, serializeEnvFile(map), { encoding: 'utf8', mode: 0o600 })
}

/**
 * Remove a single key from the env file, if present. Writes the file back without that entry; other
 * entries are preserved. A no-op (no error) when the key or file is absent. Rejects unsafe names so a
 * malformed name can never be used to probe the filesystem. SERVER-ONLY.
 */
export async function removeEnvKey(name: string, options: EnvKeyOptions = {}): Promise<void> {
  if (!SAFE_KEY_NAME.test(name)) {
    throw new Error(`Unsafe env key name: ${name}. Use SCREAMING_SNAKE_CASE.`)
  }
  const envPath = envPathFrom(options)
  const map = await readEnvMap(envPath)
  if (!map.has(name)) {
    return
  }
  map.delete(name)
  await mkdir(dirname(envPath), { recursive: true })
  await writeFile(envPath, serializeEnvFile(map), { encoding: 'utf8', mode: 0o600 })
}

/**
 * Confirm the chosen storage path is safe to NOT commit: either the project root
 * is not a git working tree at all (nothing under it can be committed), the path
 * is OUTSIDE the repo, or it is an in-repo dotfile that the repo's `.gitignore`
 * already covers (`.env`, `.env.local`). We do not consult git's index; this is a
 * conservative static check surfaced honestly in the page header.
 *
 * `repoIsGitWorkTree` lets the caller report whether `repoRoot` is actually inside
 * a git working tree (the page resolves this from the filesystem). It defaults to
 * `true` so the pure path logic stays unit-testable without touching the disk; a
 * caller running against a non-repo project dir (e.g. a local sandbox) passes
 * `false`, which makes the path safe and suppresses the false "NOT git-ignored"
 * warning.
 */
export function isEnvKeyPathGitIgnored(envPath: string, repoRoot: string, repoIsGitWorkTree = true): boolean {
  // A project dir that is not a git working tree cannot commit anything — the env file there is safe.
  if (!repoIsGitWorkTree) {
    return true
  }
  const absolute = resolve(envPath)
  const root = resolve(repoRoot)
  const insideRepo = absolute === root || absolute.startsWith(`${root}/`)
  if (!insideRepo) {
    return true
  }
  // Inside the repo: only the .gitignore-covered env dotfiles are safe.
  const relative = absolute.slice(root.length + 1)
  return relative === '.env' || relative === '.env.local'
}
