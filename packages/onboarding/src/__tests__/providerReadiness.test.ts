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

  it('reports a direct API-key provider as ready (experimental) when its key is configured', async () => {
    const anthropic = await getProviderReadiness('anthropic-api', { ANTHROPIC_API_KEY: 'test-key' })
    expect(anthropic).toMatchObject({
      provider_id: 'anthropic-api',
      provider_surface_id: 'anthropic-api',
      is_ready: true,
      support_level: 'experimental',
      auth_source: 'ANTHROPIC_API_KEY',
    })

    const openai = await getProviderReadiness('openai-api', { OPENAI_API_KEY: 'test-key' })
    expect(openai).toMatchObject({ provider_id: 'openai-api', is_ready: true, auth_source: 'OPENAI_API_KEY' })

    const gemini = await getProviderReadiness('gemini-developer-api', { GOOGLE_API_KEY: 'test-key' })
    expect(gemini).toMatchObject({ provider_id: 'gemini-developer-api', is_ready: true, auth_source: 'GEMINI_API_KEY' })
  })

  it('reports a direct API-key provider as experimental and not ready without its key, leaking no secrets', async () => {
    const readiness = await getProviderReadiness('anthropic-api', { BROWSER_COOKIE: 'secret-browser-cookie' } as Record<string, string | undefined>)
    expect(readiness).toMatchObject({
      provider_id: 'anthropic-api',
      is_ready: false,
      support_level: 'experimental',
      auth_source: 'missing',
    })
    expect(readiness.status_label).toMatch(/missing/i)
    expect(JSON.stringify(readiness)).not.toContain('secret-browser-cookie')
  })

  it('lists provider options in onboarding order with frozen support semantics', () => {
    const options = getProviderOptions()

    // The CLI/OAuth lanes (Codex, Claude CLI, Gemini CLI) were retired; surviving providers are OpenRouter
    // + the direct API-key providers (openai-api/anthropic-api/gemini-developer-api).
    expect(options.map((provider) => provider.provider_id)).toEqual(['mock-provider', 'openrouter', 'openai-api', 'anthropic-api', 'gemini-developer-api'])
    expect(options.map((provider) => provider.provider_surface_id)).toEqual(['mock-provider', 'openrouter-api', 'openai-api', 'anthropic-api', 'gemini-developer-api'])
    expect(options.map((provider) => provider.support_level)).toEqual(['certified', 'experimental', 'experimental', 'experimental', 'experimental'])
  })

  it('excludes mock-provider from options for a production (non-test) env', () => {
    const options = getProviderOptions({ OWLFOLIO_DISABLE_TEST_DEFAULTS: '1' })

    expect(options.map((provider) => provider.provider_id)).not.toContain('mock-provider')
    // Real providers remain available so the unconfigured → personal-local path still works.
    expect(options.map((provider) => provider.provider_id)).toEqual(['openrouter', 'openai-api', 'anthropic-api', 'gemini-developer-api'])
  })

  it('includes mock-provider in options under the test harness env', () => {
    const playwright = getProviderOptions({ OWLFOLIO_TEST_MODE: 'playwright' })
    expect(playwright.map((provider) => provider.provider_id)).toContain('mock-provider')

    const vitest = getProviderOptions({ VITEST: '1' })
    expect(vitest.map((provider) => provider.provider_id)).toContain('mock-provider')
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
