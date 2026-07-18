// Pre-flight provider-key guard (reliability quick win #1/#2).
//
// The failure mode this kills: API keys hydrate into process.env ONCE at server boot
// (apps/web instrumentation → hydrateProcessEnvFromEnvKeys), while the providers page reads the env
// FILE fresh on every load — so after a UI key edit the page says "connected" while the next research
// run (which inherits the web server's process.env via the worker spawn) dies mid-swarm on the stale
// in-memory key, burning the run's spend on a confusing failure.
//
// The guard runs at run-start and fails FAST with the honest reason:
//   - file has a key the process never loaded            → "restart to apply" (provider_key_not_loaded)
//   - file key CHANGED since boot                        → "restart to apply" (provider_key_stale)
//   - the run-effective OpenRouter key fails a live probe → provider_key_invalid
// The live probe is FAIL-OPEN: only a definitive 401/403 blocks; a flaky network/5xx must never
// block a run (indeterminate → proceed).

export type EnvKeyRuntimeState = 'active' | 'stale_changed' | 'not_loaded' | 'absent'

type EnvLike = Record<string, string | undefined>

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Classify one key's runtime state from (process.env at boot) vs (the env file now). Shell-exported
 * keys with no file entry are simply 'active' — the file is not the source of truth for them.
 */
export function assessEnvKeyRuntimeState(name: string, processEnv: EnvLike, fileEnv: EnvLike): EnvKeyRuntimeState {
  const processValue = processEnv[name]
  const fileValue = fileEnv[name]
  if (present(processValue)) {
    if (present(fileValue) && fileValue !== processValue) return 'stale_changed'
    return 'active'
  }
  if (present(fileValue)) return 'not_loaded'
  return 'absent'
}

/** The env-key names that make each surviving provider ready (mirrors providerReadiness). */
export function providerEnvKeyNames(providerId: string): string[] {
  switch (providerId) {
    case 'openrouter': return ['OPENROUTER_API_KEY']
    // The experimental local surface needs no key (most local servers run unauthenticated); the
    // optional OWLFOLIO_LOCAL_API_KEY never gates readiness, so it is not listed here.
    default: return []
  }
}

export type KeyValidationResult = 'valid' | 'invalid' | 'indeterminate'

export type ValidateOpenRouterKeyOptions = {
  fetchImpl?: typeof fetch
  /** OpenRouter API base (default https://openrouter.ai/api/v1). */
  baseUrl?: string
  timeoutMs?: number
}

/**
 * One cheap authenticated call against OpenRouter's key-info endpoint (`GET /auth/key`) — chosen
 * because `/models` is public and returns 200 for a bad key. Definitive 401/403 → 'invalid';
 * 2xx → 'valid'; anything else (5xx, network error, timeout) → 'indeterminate' (fail-open).
 */
export async function validateOpenRouterKey(apiKey: string, options: ValidateOpenRouterKeyOptions = {}): Promise<KeyValidationResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const baseUrl = options.baseUrl ?? 'https://openrouter.ai/api/v1'
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, options.timeoutMs ?? 8_000)
  try {
    const response = await fetchImpl(`${baseUrl}/auth/key`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (response.status === 401 || response.status === 403) return 'invalid'
    if (response.ok) return 'valid'
    return 'indeterminate'
  } catch {
    return 'indeterminate'
  } finally {
    clearTimeout(timer)
  }
}

export type PreflightKeyGuardInput = {
  providerId: string
  /** The env the RUN will actually use (the web server's process.env — the worker inherits it). */
  processEnv: EnvLike
  /** The env file's current content (readAllEnvKeys). */
  fileEnv: EnvLike
  /** Injectable live validation (defaults to validateOpenRouterKey for openrouter; none for others). */
  validate?: (apiKey: string) => Promise<KeyValidationResult>
}

export type PreflightKeyGuardResult =
  | { ok: true; validation?: KeyValidationResult }
  | { ok: false; code: 'provider_key_not_loaded' | 'provider_key_stale' | 'provider_key_invalid'; message: string }

/**
 * The run-start guard. Order of honesty: an ACTIVE key wins (validate it live when we know how);
 * otherwise a not-loaded/stale file key is the restart-to-apply case — failing fast here replaces a
 * dead mid-swarm run with a one-line fix. Providers with no key names (mock) pass through untouched.
 */
export async function preflightProviderKeyGuard(input: PreflightKeyGuardInput): Promise<PreflightKeyGuardResult> {
  const keyNames = providerEnvKeyNames(input.providerId)
  if (keyNames.length === 0) return { ok: true }

  const states = keyNames.map((name) => ({ name, state: assessEnvKeyRuntimeState(name, input.processEnv, input.fileEnv) }))

  const active = states.find((entry) => entry.state === 'active')
  if (active !== undefined) {
    if (input.providerId === 'openrouter') {
      const apiKey = input.processEnv[active.name]!
      const validate = input.validate ?? ((key: string) => validateOpenRouterKey(key))
      const validation = await validate(apiKey)
      if (validation === 'invalid') {
        return {
          ok: false,
          code: 'provider_key_invalid',
          message: `The ${active.name} the server is running with was rejected by the provider (invalid or revoked). Update the key in the local env file and restart the app.`,
        }
      }
      return { ok: true, validation }
    }
    return { ok: true }
  }

  const notLoaded = states.find((entry) => entry.state === 'not_loaded')
  if (notLoaded !== undefined) {
    return {
      ok: false,
      code: 'provider_key_not_loaded',
      message: `${notLoaded.name} is saved in the local env file but was added after the server started, so the running server has no key. Restart the app to apply it.`,
    }
  }

  const stale = states.find((entry) => entry.state === 'stale_changed')
  if (stale !== undefined) {
    return {
      ok: false,
      code: 'provider_key_stale',
      message: `${stale.name} changed in the local env file after the server started — the run would use the OLD key. Restart the app to apply the new key.`,
    }
  }

  // All absent: the existing readiness gate owns the "no key at all" message.
  return { ok: true }
}
