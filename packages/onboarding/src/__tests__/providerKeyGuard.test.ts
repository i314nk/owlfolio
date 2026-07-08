import { describe, expect, it, vi } from 'vitest'

import {
  assessEnvKeyRuntimeState,
  preflightProviderKeyGuard,
  providerEnvKeyNames,
  validateOpenRouterKey,
} from '../providerKeyGuard'

// ---------------------------------------------------------------------------
// The reliability guard for today's failure mode: keys hydrate into process.env ONCE at server boot
// (instrumentation.ts), the providers page reads the env FILE fresh — so the page says "connected"
// while a run dies mid-swarm on the stale in-memory key. The guard (1) detects file↔process
// divergence and fails FAST with "restart to apply", and (2) pre-flight-validates the run-effective
// OpenRouter key with one cheap authenticated call, so a revoked key is a clear 400, not a dead run.
// ---------------------------------------------------------------------------

describe('assessEnvKeyRuntimeState', () => {
  it('classifies the four runtime states', () => {
    expect(assessEnvKeyRuntimeState('K', { K: 'a' }, { K: 'a' })).toBe('active')
    expect(assessEnvKeyRuntimeState('K', { K: 'a' }, {})).toBe('active') // shell-exported only
    expect(assessEnvKeyRuntimeState('K', { K: 'old' }, { K: 'new' })).toBe('stale_changed')
    expect(assessEnvKeyRuntimeState('K', {}, { K: 'a' })).toBe('not_loaded') // saved after boot
    expect(assessEnvKeyRuntimeState('K', {}, {})).toBe('absent')
    expect(assessEnvKeyRuntimeState('K', { K: '' }, { K: 'a' })).toBe('not_loaded') // empty = unset
  })
})

describe('providerEnvKeyNames', () => {
  it('maps surviving providers to their key names', () => {
    expect(providerEnvKeyNames('openrouter')).toEqual(['OPENROUTER_API_KEY'])
    expect(providerEnvKeyNames('openai-api')).toEqual(['OPENAI_API_KEY'])
    expect(providerEnvKeyNames('anthropic-api')).toEqual(['ANTHROPIC_API_KEY'])
    expect(providerEnvKeyNames('gemini-developer-api')).toEqual(['GEMINI_API_KEY', 'GOOGLE_API_KEY'])
    expect(providerEnvKeyNames('mock-provider')).toEqual([])
  })
})

describe('validateOpenRouterKey', () => {
  const fetchWith = (status: number) => vi.fn(async () => new Response('{}', { status })) as unknown as typeof fetch

  it('200 → valid; 401/403 → invalid (revoked/bad key)', async () => {
    expect(await validateOpenRouterKey('k', { fetchImpl: fetchWith(200) })).toBe('valid')
    expect(await validateOpenRouterKey('k', { fetchImpl: fetchWith(401) })).toBe('invalid')
    expect(await validateOpenRouterKey('k', { fetchImpl: fetchWith(403) })).toBe('invalid')
  })

  it('uses the key-info endpoint with a Bearer header (the models endpoint is public and cannot validate)', async () => {
    const fetchImpl = fetchWith(200)
    await validateOpenRouterKey('sk-or-test', { fetchImpl })
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(String(url)).toBe('https://openrouter.ai/api/v1/auth/key')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-or-test')
  })

  it('FAIL-OPEN on anything else: 5xx / network error / timeout → indeterminate (never block a run on a flaky probe)', async () => {
    expect(await validateOpenRouterKey('k', { fetchImpl: fetchWith(500) })).toBe('indeterminate')
    const throwing = vi.fn(async () => { throw new Error('network down') }) as unknown as typeof fetch
    expect(await validateOpenRouterKey('k', { fetchImpl: throwing })).toBe('indeterminate')
  })
})

describe('preflightProviderKeyGuard', () => {
  it('key saved after boot → provider_key_not_loaded with a restart message', async () => {
    const result = await preflightProviderKeyGuard({
      providerId: 'openrouter',
      processEnv: {},
      fileEnv: { OPENROUTER_API_KEY: 'sk-or-new' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.code).toBe('provider_key_not_loaded')
    expect(result.message).toMatch(/restart/i)
  })

  it('key CHANGED on disk after boot → provider_key_stale (the run would use the old key)', async () => {
    const result = await preflightProviderKeyGuard({
      providerId: 'openrouter',
      processEnv: { OPENROUTER_API_KEY: 'sk-or-old' },
      fileEnv: { OPENROUTER_API_KEY: 'sk-or-new' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.code).toBe('provider_key_stale')
    expect(result.message).toMatch(/restart/i)
  })

  it('active OpenRouter key that fails live validation → provider_key_invalid', async () => {
    const result = await preflightProviderKeyGuard({
      providerId: 'openrouter',
      processEnv: { OPENROUTER_API_KEY: 'sk-or-revoked' },
      fileEnv: { OPENROUTER_API_KEY: 'sk-or-revoked' },
      validate: async () => 'invalid',
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.code).toBe('provider_key_invalid')
    expect(result.message).toMatch(/invalid|revoked/i)
  })

  it('active + valid (or indeterminate probe) → ok; non-key providers → ok without probing', async () => {
    expect((await preflightProviderKeyGuard({
      providerId: 'openrouter',
      processEnv: { OPENROUTER_API_KEY: 'k' },
      fileEnv: { OPENROUTER_API_KEY: 'k' },
      validate: async () => 'valid',
    })).ok).toBe(true)
    expect((await preflightProviderKeyGuard({
      providerId: 'openrouter',
      processEnv: { OPENROUTER_API_KEY: 'k' },
      fileEnv: {},
      validate: async () => 'indeterminate',
    })).ok).toBe(true)
    const probe = vi.fn(async () => 'valid' as const)
    expect((await preflightProviderKeyGuard({ providerId: 'mock-provider', processEnv: {}, fileEnv: {}, validate: probe })).ok).toBe(true)
    expect(probe).not.toHaveBeenCalled()
  })

  it('gemini dual keys: either active key satisfies the guard', async () => {
    const result = await preflightProviderKeyGuard({
      providerId: 'gemini-developer-api',
      processEnv: { GOOGLE_API_KEY: 'g' },
      fileEnv: { GOOGLE_API_KEY: 'g' },
    })
    expect(result.ok).toBe(true)
  })
})
