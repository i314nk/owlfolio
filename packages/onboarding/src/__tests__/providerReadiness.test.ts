import { describe, expect, it } from 'vitest'

import { getProviderOptions, getProviderReadiness } from '../providerReadiness'

describe('providerReadiness', () => {
  it('reports the mock provider as ready and certified in demo mode', async () => {
    const readiness = await getProviderReadiness('mock-provider', {})

    expect(readiness).toMatchObject({
      provider_id: 'mock-provider',
      is_ready: true,
      support_level: 'certified',
      auth_source: 'built-in demo mode',
    })
    expect(readiness.status_label).toBe('Locally runnable through built-in deterministic demo mode')
    expect(readiness.status_label).not.toMatch(/\bready\b/i)
  })

  it('reports the LOCAL surface as ready-by-default but loudly unstable/experimental/untested', async () => {
    const local = await getProviderReadiness('local', {})
    expect(local).toMatchObject({
      provider_id: 'local',
      provider_surface_id: 'local',
      is_ready: true,
      support_level: 'experimental',
    })
    expect(local.status_label).toContain('UNSTABLE / EXPERIMENTAL / UNTESTED')
    expect(local.status_label).toContain('http://127.0.0.1:11434/v1')
    expect(local.status_label.toLowerCase()).toContain('fail closed')

    const custom = await getProviderReadiness('local', { OWLFOLIO_LOCAL_API_BASE_URL: 'http://127.0.0.1:8000/v1' })
    expect(custom.status_label).toContain('http://127.0.0.1:8000/v1')
    expect(custom.auth_source).toBe('OWLFOLIO_LOCAL_API_BASE_URL')
  })

  it('lists real provider options in onboarding order, excluding the internal mock provider', () => {
    const options = getProviderOptions()

    // PROVIDER CONSOLIDATION (owner, 2026-07-18): OpenRouter is the one real provider; 'local'
    // (Ollama / vLLM) is the experimental untested surface. The mock provider is internal and never offered.
    expect(options.map((provider) => provider.provider_id)).toEqual(['openrouter', 'local'])
    expect(options.map((provider) => provider.provider_surface_id)).toEqual(['openrouter-api', 'local'])
    expect(options.map((provider) => provider.support_level)).toEqual(['experimental', 'experimental'])
  })

  it('never offers the mock provider in the picker, even under the test harness env', () => {
    for (const env of [{}, { OWLFOLIO_TEST_MODE: 'playwright' }, { VITEST: '1' }]) {
      expect(getProviderOptions(env).map((provider) => provider.provider_id)).not.toContain('mock-provider')
    }
  })

  it('marks OpenRouter ready when OPENROUTER_API_KEY is present (live adapter), but flags certification is still required', async () => {
    const withKey = await getProviderReadiness('openrouter', { OPENROUTER_API_KEY: 'test-key' })
    expect(withKey).toMatchObject({
      provider_id: 'openrouter',
      is_ready: true,
      auth_source: 'OPENROUTER_API_KEY',
      readiness_state: 'ready',
    })
    // Readiness is not certification: the status must keep saying each routed model needs its own report.
    expect(withKey.status_label).toMatch(/certification report/)

    const withoutKey = await getProviderReadiness('openrouter', {})
    expect(withoutKey).toMatchObject({
      provider_id: 'openrouter',
      is_ready: false,
      auth_source: 'missing',
      readiness_state: 'missing_credentials',
    })
  })

  it('surfaces OpenRouter (the API-key meta lane) in onboarding options with its catalog default model', () => {
    const options = getProviderOptions()
    const optionIds = options.map((option) => option.provider_id)
    expect(optionIds).toContain('openrouter')

    const openrouter = options.find((option) => option.provider_id === 'openrouter')
    expect(openrouter?.default_model_id).toBe('openrouter/auto')
  })
})
