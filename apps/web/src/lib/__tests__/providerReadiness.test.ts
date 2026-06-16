import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getProviderOptions, getProviderReadiness } from '../providerReadiness'

describe('providerReadiness', () => {
  async function withTempDir(assertion: (dir: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), 'owlfolio-provider-readiness-'))
    try {
      await assertion(dir)
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
  }

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

  it('reports claude as ready when an api key is configured', async () => {
    const readiness = await getProviderReadiness('claude', { ANTHROPIC_API_KEY: 'test-key' })

    expect(readiness).toMatchObject({
      provider_id: 'claude',
      is_ready: true,
      support_level: 'experimental',
      auth_source: 'ANTHROPIC_API_KEY',
      status_label: 'Locally runnable via Anthropic API key',
    })
  })

  it('reports claude as ready when subscription credentials exist', async () => {
    await withTempDir(async (dir) => {
      const credentialsPath = join(dir, '.claude', '.credentials.json')
      await mkdir(join(dir, '.claude'), { recursive: true })
      await writeFile(credentialsPath, '{"subscription":true}', 'utf8')

      const readiness = await getProviderReadiness('claude', { OWLFOLIO_CLAUDE_CREDENTIALS_PATH: credentialsPath })

      expect(readiness).toMatchObject({
        provider_id: 'claude',
        is_ready: true,
        auth_source: 'Claude subscription credentials',
        status_label: 'Locally runnable via Claude subscription credentials',
      })
    })
  })

  it('reports openai as ready when an api key is configured while keeping direct API certification separate', async () => {
    const readiness = await getProviderReadiness('openai', { OPENAI_API_KEY: 'test-key' })

    expect(readiness).toMatchObject({
      provider_id: 'openai',
      is_ready: true,
      support_level: 'experimental',
      auth_source: 'OPENAI_API_KEY',
      provider_surface_id: 'openai-codex-cli',
      status_label: 'Locally runnable via OpenAI API key for the Codex CLI surface; direct OpenAI API certification remains separate.',
    })
    expect(readiness.status_label).toMatch(/api key/i)
    expect(readiness.status_label).toMatch(/codex cli surface/i)
    expect(readiness.status_label).toMatch(/direct openai api certification remains separate/i)
  })

  it('reports openai as ready when a Codex access token is configured', async () => {
    const readiness = await getProviderReadiness('openai', { CODEX_ACCESS_TOKEN: 'test-access-token' })

    expect(readiness).toMatchObject({
      provider_id: 'openai',
      is_ready: true,
      support_level: 'experimental',
      auth_source: 'CODEX_ACCESS_TOKEN',
      status_label: 'Locally runnable via Codex access token',
    })
    expect(readiness.status_label).toMatch(/access token/i)
  })

  it('exposes redacted auth/runtime/readiness categories for the legacy OpenAI Codex CLI surface', async () => {
    const codexAccessToken = ['codex', 'redaction', 'token'].join('-')
    const readiness = await getProviderReadiness('openai', { CODEX_ACCESS_TOKEN: codexAccessToken })
    const serialized = JSON.stringify(readiness)

    expect(readiness).toMatchObject({
      provider_id: 'openai',
      provider_surface_id: 'openai-codex-cli',
      vendor_id: 'openai',
      runtime_kind: 'cli',
      auth_mode: 'cli_access_token',
      readiness_state: 'ready',
      credential_source_category: 'env_var',
      credential_source_label: 'CODEX_ACCESS_TOKEN',
      billing_mode: 'subscription_entitlement',
      quota_source: 'subscription_tier',
      quota_status: 'unknown',
      data_policy_source: 'subscription_workspace_policy',
      retention_or_zdr_status: 'not_verified',
      headless_supported: false,
      scheduled_workflow_supported: false,
      automation_suitability: 'personal_local_interactive',
      reauth_action: 'Run codex login outside Owlfolio, then retry readiness.',
    })
    expect(serialized).toContain('CODEX_ACCESS_TOKEN')
    expect(serialized).not.toContain(codexAccessToken)
  })

  it('reports openai as ready when Codex OAuth credentials exist', async () => {
    await withTempDir(async (dir) => {
      const authPath = join(dir, '.codex', 'auth.json')
      await mkdir(join(dir, '.codex'), { recursive: true })
      await writeFile(authPath, '{"access_token":"oauth-token"}', 'utf8')

      const readiness = await getProviderReadiness('openai', { OWLFOLIO_CODEX_AUTH_PATH: authPath })

      expect(readiness).toMatchObject({
        provider_id: 'openai',
        is_ready: true,
        auth_mode: 'cli_cached_session',
        credential_source_category: 'configured_secret_file',
        support_level: 'experimental',
        auth_source: 'Codex OAuth credentials',
        status_label: 'Locally runnable via Codex OAuth credentials',
      })
      expect(readiness.status_label).toMatch(/oauth/i)
      expect(JSON.stringify(readiness)).not.toContain(authPath)
    })
  })

  it('reports openai as experimental and not ready without api key, access token, or oauth credentials', async () => {
    const readiness = await getProviderReadiness('openai', { OWLFOLIO_CODEX_AUTH_PATH: '/definitely/missing/auth.json' })

    expect(readiness).toMatchObject({
      provider_id: 'openai',
      is_ready: false,
      support_level: 'experimental',
      auth_source: 'missing',
    })
    expect(readiness.status_label).toMatch(/missing/i)
  })

  it('rejects browser signed-in sessions and cookies as provider credentials', async () => {
    const env = {
      BROWSER_COOKIE: 'secret-browser-cookie',
      OAUTH_BROWSER_LOGIN: 'signed-in-browser-session',
      OWLFOLIO_CODEX_AUTH_PATH: '/definitely/missing/auth.json',
      // Pin a guaranteed-nonexistent Claude credentials path so the assertion is deterministic
      // regardless of the machine — otherwise real on-disk Claude credentials would report ready.
      OWLFOLIO_CLAUDE_CREDENTIALS_PATH: '/definitely/missing/claude-credentials.json',
    } as any

    const claude = await getProviderReadiness('claude', env)
    const openai = await getProviderReadiness('openai', env)
    const serialized = JSON.stringify([claude, openai])

    expect(claude).toMatchObject({ is_ready: false, auth_source: 'missing' })
    expect(openai).toMatchObject({ is_ready: false, auth_source: 'missing' })
    expect(serialized).not.toContain('oauth_browser_login')
    expect(serialized).not.toContain('secret-browser-cookie')
    expect(serialized).not.toContain('signed-in-browser-session')
    expect(serialized).not.toContain('/definitely/missing/auth.json')
  })

  it('lists provider options in onboarding order with frozen support semantics', () => {
    const options = getProviderOptions()

    expect(options.map((provider) => provider.provider_id)).toEqual(['mock-provider', 'claude', 'openai', 'openrouter'])
    expect(options.map((provider) => provider.provider_surface_id)).toEqual(['mock-provider', 'claude-cli', 'openai-codex-cli', 'openrouter-api'])
    expect(options.map((provider) => provider.support_level)).toEqual(['certified', 'experimental', 'experimental', 'experimental'])
  })

  it('exposes simple recommended sign-in copy and progressive advanced auth options for OpenAI', () => {
    const options = getProviderOptions()
    const openai = options.find((provider) => provider.provider_id === 'openai')

    expect(openai).toMatchObject({
      provider_family_label: 'OpenAI',
      recommended_sign_in_label: 'Connect Codex',
      recommended_sign_in_description: expect.stringContaining('codex login'),
      simple_next_step: 'Run codex login outside Owlfolio, then refresh readiness.',
    })
    expect(openai?.advanced_auth_options).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'OpenAI API key', certification_note: expect.stringContaining('direct API certification') }),
    ]))
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

    const claude = options.find((option) => option.provider_id === 'claude')
    expect(claude?.default_model_id).toBe('claude-sonnet-4-6')
  })
})
