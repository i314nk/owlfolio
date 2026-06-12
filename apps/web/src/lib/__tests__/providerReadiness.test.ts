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
    const geminiCli = await getProviderReadiness('gemini-cli' as any, env)
    const serialized = JSON.stringify([claude, openai, geminiCli])

    expect(claude).toMatchObject({ is_ready: false, auth_source: 'missing' })
    expect(openai).toMatchObject({ is_ready: false, auth_source: 'missing' })
    expect(geminiCli).toMatchObject({ is_ready: false, readiness_state: 'missing_credentials' })
    expect(serialized).not.toContain('oauth_browser_login')
    expect(serialized).not.toContain('secret-browser-cookie')
    expect(serialized).not.toContain('signed-in-browser-session')
    expect(serialized).not.toContain('/definitely/missing/auth.json')
  })
  it('keeps OpenAI direct API readiness separate from Codex CLI credentials and redacts secrets', async () => {
    const openAiApiKey = ['openai', 'redaction', 'key'].join('-')
    const codexAccessToken = ['codex', 'redaction', 'token'].join('-')
    const missingOpenAiApi = await getProviderReadiness('openai-api' as any, { CODEX_ACCESS_TOKEN: codexAccessToken })
    const openAiApi = await getProviderReadiness('openai-api' as any, { OPENAI_API_KEY: openAiApiKey, CODEX_ACCESS_TOKEN: codexAccessToken })

    expect(missingOpenAiApi).toMatchObject({
      provider_id: 'openai-api',
      provider_surface_id: 'openai-api',
      runtime_kind: 'direct_api',
      auth_mode: 'api_key',
      readiness_state: 'missing_credentials',
      credential_source_category: 'missing',
      auth_source: 'missing',
      is_ready: false,
    })
    expect(openAiApi).toMatchObject({
      provider_id: 'openai-api',
      provider_surface_id: 'openai-api',
      runtime_kind: 'direct_api',
      auth_mode: 'api_key',
      readiness_state: 'ready',
      credential_source_category: 'env_var',
      credential_source_label: 'OPENAI_API_KEY',
      billing_mode: 'platform_api_billing',
      quota_source: 'api_project',
      is_ready: true,
    })
    expect(JSON.stringify([missingOpenAiApi, openAiApi])).not.toContain(openAiApiKey)
    expect(JSON.stringify([missingOpenAiApi, openAiApi])).not.toContain(codexAccessToken)
  })

  it('classifies Gemini CLI missing cached-session readiness without leaking browser sessions or local paths', async () => {
    const readiness = await getProviderReadiness('gemini-cli' as any, {
      GEMINI_HOME: '/secret/gemini/home',
      OAUTH_BROWSER_LOGIN: 'signed-in-browser-session',
    } as any)

    expect(readiness).toMatchObject({
      provider_id: 'gemini-cli',
      provider_surface_id: 'gemini-cli',
      support_level: 'experimental',
      is_ready: false,
      readiness_state: 'missing_credentials',
      credential_source_category: 'missing',
      auth_source: 'missing',
      status_label: 'Missing Gemini CLI Google sign-in session',
      data_policy_source: 'unknown',
      retention_or_zdr_status: 'not_verified',
      headless_supported: false,
      scheduled_workflow_supported: false,
      automation_suitability: 'personal_local_interactive',
      reauth_action: 'Run gemini login outside Owlfolio, then retry readiness.',
    })
    const serialized = JSON.stringify(readiness)
    expect(serialized).not.toContain('/secret/gemini/home')
    expect(serialized).not.toContain('signed-in-browser-session')
  })

  it('classifies Gemini CLI cached session as discovered but unexecutable until a CLI adapter exists', async () => {
    await withTempDir(async (dir) => {
      const authPath = join(dir, '.gemini', 'oauth_creds.json')
      await mkdir(join(dir, '.gemini'), { recursive: true })
      await writeFile(authPath, '{"access_token":"secret-gemini-oauth-token"}', 'utf8')

      const geminiApiKey = ['gemini', 'redaction', 'api-key'].join('-')
      const cachedSession = await getProviderReadiness('gemini-cli' as any, { OWLFOLIO_GEMINI_CLI_AUTH_PATH: authPath } as any)
      const apiKey = await getProviderReadiness('gemini-cli' as any, { GEMINI_API_KEY: geminiApiKey } as any)
      const serialized = JSON.stringify([cachedSession, apiKey])

      expect(cachedSession).toMatchObject({
        provider_id: 'gemini-cli',
        provider_surface_id: 'gemini-cli',
        support_level: 'experimental',
        is_ready: false,
        auth_mode: 'cli_cached_session',
        readiness_state: 'unsupported_surface',
        credential_source_category: 'configured_secret_file',
        credential_source_label: 'Gemini CLI Google sign-in session',
        status_label: 'Gemini CLI Google sign-in session detected for setup only; Owlfolio cannot execute Gemini CLI workflows until a safe adapter and target-specific certification exist. Developer API and Vertex certification remain separate.',
      })
      expect(apiKey).toMatchObject({
        provider_id: 'gemini-cli',
        provider_surface_id: 'gemini-cli',
        is_ready: false,
        auth_mode: 'api_key',
        readiness_state: 'unsupported_surface',
        credential_source_category: 'env_var',
        credential_source_label: 'GEMINI_API_KEY',
        status_label: 'GEMINI_API_KEY belongs to Gemini Developer API, not Gemini CLI Google sign-in; Developer API and Vertex certification remain separate.',
      })
      expect(serialized).not.toContain(authPath)
      expect(serialized).not.toContain('secret-gemini-oauth-token')
      expect(serialized).not.toContain(geminiApiKey)
    })
  })

  it('classifies Gemini CLI reauth and quota-limited states separately from missing credentials', async () => {
    const reauth = await getProviderReadiness('gemini-cli' as any, { OWLFOLIO_GEMINI_CLI_STATUS: 'reauth-required' } as any)
    const quota = await getProviderReadiness('gemini-cli' as any, { OWLFOLIO_GEMINI_CLI_STATUS: 'quota-limited' } as any)

    expect(reauth).toMatchObject({
      provider_id: 'gemini-cli',
      is_ready: false,
      readiness_state: 'reauth_required',
      credential_source_category: 'default_cli_config',
      status_label: 'Gemini CLI session requires reauthentication outside Owlfolio',
    })
    expect(quota).toMatchObject({
      provider_id: 'gemini-cli',
      is_ready: false,
      readiness_state: 'quota_limited',
      credential_source_category: 'default_cli_config',
      quota_status: 'limited',
      status_label: 'Gemini CLI quota is limited or exhausted for this local session',
    })
  })

  it('distinguishes Gemini Developer API key readiness from Gemini CLI subscription sign-in and privacy posture', async () => {
    const geminiApiKey = ['gemini', 'redaction', 'key'].join('-')
    const readiness = await getProviderReadiness('gemini-developer-api' as any, { GEMINI_API_KEY: geminiApiKey, GEMINI_HOME: '/secret/gemini/home' } as any)
    const serialized = JSON.stringify(readiness)

    expect(readiness).toMatchObject({
      provider_id: 'gemini-developer-api',
      provider_surface_id: 'gemini-developer-api',
      vendor_id: 'google-gemini',
      runtime_kind: 'direct_api',
      auth_mode: 'api_key',
      readiness_state: 'ready',
      credential_source_category: 'env_var',
      credential_source_label: 'GEMINI_API_KEY',
      billing_mode: 'platform_api_billing',
      quota_source: 'api_project',
      quota_status: 'unknown',
      data_policy_source: 'api_free_training_possible',
      retention_or_zdr_status: 'not_verified',
      is_ready: true,
      support_level: 'experimental',
    })
    expect(readiness.status_label).toMatch(/developer api key/i)
    expect(readiness.status_label).toMatch(/separate from gemini cli/i)
    expect(readiness.status_label).toMatch(/google ai pro/i)
    expect(serialized).not.toContain(geminiApiKey)
    expect(serialized).not.toContain('/secret/gemini/home')
  })

  it('keeps Gemini OAuth testing and Vertex or service-account paths distinct from Developer API key certification', async () => {
    const googleOauthToken = ['google', 'redaction', 'oauth-token'].join('-')
    const oauth = await getProviderReadiness('gemini-developer-api' as any, { GOOGLE_OAUTH_ACCESS_TOKEN: googleOauthToken } as any)
    const adc = await getProviderReadiness('gemini-developer-api' as any, { GOOGLE_APPLICATION_CREDENTIALS: '/secret/google/adc.json', GOOGLE_CLOUD_PROJECT: 'owlfolio-prod' } as any)
    const serviceAccount = await getProviderReadiness('gemini-developer-api' as any, { OWLFOLIO_GOOGLE_SERVICE_ACCOUNT_PATH: '/secret/google/service-account.json' } as any)

    expect(oauth).toMatchObject({
      auth_mode: 'oauth_browser_login',
      readiness_state: 'unsupported_surface',
      credential_source_category: 'env_var',
      credential_source_label: 'GOOGLE_OAUTH_ACCESS_TOKEN',
      is_ready: false,
    })
    expect(adc).toMatchObject({
      auth_mode: 'application_default_credentials',
      readiness_state: 'unsupported_surface',
      credential_source_category: 'application_default_credentials',
      credential_source_label: 'GOOGLE_APPLICATION_CREDENTIALS',
      is_ready: false,
    })
    expect(serviceAccount).toMatchObject({
      auth_mode: 'service_account',
      readiness_state: 'unsupported_surface',
      credential_source_category: 'service_account',
      credential_source_label: 'OWLFOLIO_GOOGLE_SERVICE_ACCOUNT_PATH',
      is_ready: false,
    })
    expect(JSON.stringify([oauth, adc, serviceAccount])).not.toContain(googleOauthToken)
    expect(JSON.stringify([oauth, adc, serviceAccount])).not.toMatch(/\/secret\/google|owlfolio-prod/)
  })

  it('lists provider options in onboarding order with frozen support semantics', () => {
    const options = getProviderOptions()

    expect(options.map((provider) => provider.provider_id)).toEqual(['mock-provider', 'claude', 'openai', 'gemini-cli'])
    expect(options.map((provider) => provider.provider_surface_id)).toEqual(['mock-provider', 'claude-cli', 'openai-codex-cli', 'gemini-cli'])
    expect(options.map((provider) => provider.support_level)).toEqual(['certified', 'experimental', 'experimental', 'experimental'])
  })

  it('exposes simple recommended sign-in copy and progressive advanced auth options for OpenAI and Gemini', () => {
    const options = getProviderOptions()
    const openai = options.find((provider) => provider.provider_id === 'openai')
    const gemini = options.find((provider) => provider.provider_id === 'gemini-cli')

    expect(openai).toMatchObject({
      provider_family_label: 'OpenAI',
      recommended_sign_in_label: 'Connect Codex',
      recommended_sign_in_description: expect.stringContaining('codex login'),
      simple_next_step: 'Run codex login outside Owlfolio, then refresh readiness.',
    })
    expect(openai?.advanced_auth_options).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'OpenAI API key', certification_note: expect.stringContaining('direct API certification') }),
    ]))

    expect(gemini).toMatchObject({
      provider_family_label: 'Gemini',
      recommended_sign_in_label: 'Connect Gemini',
      recommended_sign_in_description: expect.stringContaining('gemini login'),
      simple_next_step: 'Run gemini login outside Owlfolio, then refresh readiness.',
    })
    expect(gemini?.advanced_auth_options).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Gemini Developer API key', certification_note: expect.stringContaining('certification') }),
      expect.objectContaining({ label: 'Vertex AI / service account', certification_note: expect.stringContaining('enterprise') }),
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

  it('keeps curated frontier candidates fail-closed with honest credential hints', async () => {
    const deepseek = await getProviderReadiness('deepseek', { DEEPSEEK_API_KEY: 'test-key' })
    expect(deepseek).toMatchObject({ provider_id: 'deepseek', is_ready: false, auth_source: 'DEEPSEEK_API_KEY', readiness_state: 'unsupported_surface' })

    const qwen = await getProviderReadiness('qwen', {})
    expect(qwen).toMatchObject({ provider_id: 'qwen', is_ready: false, auth_source: 'missing', readiness_state: 'missing_credentials' })

    const mistral = await getProviderReadiness('mistral', { MISTRAL_API_KEY: 'test-key' })
    expect(mistral).toMatchObject({ provider_id: 'mistral', is_ready: false, auth_source: 'MISTRAL_API_KEY' })
  })

  it('does not surface the new fail-closed candidates in onboarding options', () => {
    const optionIds = getProviderOptions().map((option) => option.provider_id)
    expect(optionIds).not.toContain('openrouter')
    expect(optionIds).not.toContain('deepseek')
    expect(optionIds).not.toContain('qwen')
    expect(optionIds).not.toContain('mistral')
  })
})
