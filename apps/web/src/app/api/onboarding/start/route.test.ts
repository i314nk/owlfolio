import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createNotConfiguredCertificationReport } from '@owlfolio/providers'
import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POST, normalizeOnboardingStartUpdate } from './route'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PERSONAL_LEDGER_PATH: process.env.OWLFOLIO_PERSONAL_LEDGER_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
  OWLFOLIO_PROVIDER_CERTIFICATION_DIR: process.env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR,
  OWLFOLIO_CLAUDE_CREDENTIALS_PATH: process.env.OWLFOLIO_CLAUDE_CREDENTIALS_PATH,
  OWLFOLIO_GEMINI_CLI_AUTH_PATH: process.env.OWLFOLIO_GEMINI_CLI_AUTH_PATH,
  OWLFOLIO_GEMINI_CLI_STATUS: process.env.OWLFOLIO_GEMINI_CLI_STATUS,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OWLFOLIO_TEST_MODE: process.env.OWLFOLIO_TEST_MODE,
}

describe('/api/onboarding/start', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-start-route-'))
    process.env.OWLFOLIO_APP_CONFIG_PATH = join(tempDir, 'app-config.json')
    process.env.OWLFOLIO_PERSONAL_LEDGER_PATH = join(tempDir, 'personal.sqlite')
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
    delete process.env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR
    process.env.OWLFOLIO_CLAUDE_CREDENTIALS_PATH = join(tempDir, 'missing-claude-credentials.json')
    delete process.env.OWLFOLIO_GEMINI_CLI_AUTH_PATH
    delete process.env.OWLFOLIO_GEMINI_CLI_STATUS
    delete process.env.GEMINI_API_KEY
    delete process.env.GOOGLE_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OWLFOLIO_TEST_MODE
  })

  afterEach(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key as keyof typeof originalEnv]
      } else {
        process.env[key as keyof typeof originalEnv] = value
      }
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  it('rejects initializing personal-local mode while the selected provider is not ready', async () => {
    const response = await POST(new Request('http://localhost/api/onboarding/start', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'personal-local',
        provider: { provider_id: 'claude', support_level: 'experimental' },
      }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toEqual({
      error: {
        code: 'provider_not_ready',
        message: 'Provider claude is not ready: Missing Claude credentials',
      },
    })
  })

  it('rejects initializing personal-local mode when latest certification makes credential-present provider effectively unready', async () => {
    process.env.ANTHROPIC_API_KEY = 'credential-file-exists-but-live-certification-failed'
    const reportDir = join(tempDir, 'data', 'provider-certifications')
    await mkdir(reportDir, { recursive: true })
    await writeFile(join(reportDir, 'claude.latest.json'), JSON.stringify(createNotConfiguredCertificationReport({
      provider_id: 'claude',
      generated_at: '2026-06-02T00:00:00.000Z',
      auth_mode: 'api_key',
      capabilities: {
        'text-generation': 'native',
        'structured-output': 'native',
        'tool-function-calling': 'unsupported',
        'streaming-observability': 'adapter',
        'multi-step-tool-loop': 'unsupported',
      },
      reason: 'Claude Code subscription access disabled',
    })), 'utf8')

    const response = await POST(new Request('http://localhost/api/onboarding/start', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'personal-local',
        provider: { provider_id: 'claude', support_level: 'experimental' },
      }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toEqual({
      error: {
        code: 'provider_not_ready',
        message: 'Provider claude is not ready: Claude Code subscription access disabled',
      },
    })
  })

  it('normalizes personal-local mock-provider starts back to demo outside Playwright test mode', () => {
    const current = defaultPersonalLocalAppConfig()

    expect(normalizeOnboardingStartUpdate({
      mode: 'personal-local',
      provider: { provider_id: 'mock-provider', support_level: 'certified' },
    }, current)).toMatchObject({ mode: 'demo' })
    expect(normalizeOnboardingStartUpdate({
      mode: 'personal-local',
      provider: { provider_id: 'mock-provider', support_level: 'certified' },
    }, current, { OWLFOLIO_TEST_MODE: 'playwright' })).toMatchObject({ mode: 'personal-local' })
  })

  it('normalizes partial mock-provider starts when the saved config is already personal-local', () => {
    expect(normalizeOnboardingStartUpdate({
      provider: { provider_id: 'mock-provider', support_level: 'certified' },
    }, defaultPersonalLocalAppConfig())).toMatchObject({ mode: 'demo' })
  })

  it('allows initializing demo mode with the certified mock provider', async () => {
    const response = await POST(new Request('http://localhost/api/onboarding/start', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'demo',
        provider: { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' },
      }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.config).toMatchObject({
      mode: 'demo',
      provider: { provider_id: 'mock-provider', support_level: 'certified' },
    })
    expect(payload.next_destination).toBe('/')
  })

  it('rejects Gemini CLI onboarding start even when a cached Google sign-in session exists because the lane is setup-only', async () => {
    const geminiAuthPath = join(tempDir, '.gemini', 'oauth_creds.json')
    await mkdir(join(tempDir, '.gemini'), { recursive: true })
    await writeFile(geminiAuthPath, '{"access_token":"secret-gemini-token"}', 'utf8')
    process.env.OWLFOLIO_GEMINI_CLI_AUTH_PATH = geminiAuthPath

    const response = await POST(new Request('http://localhost/api/onboarding/start', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'personal-local',
        provider: { provider_id: 'gemini-cli', support_level: 'unsupported' },
      }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toEqual({
      error: {
        code: 'provider_not_ready',
        message: 'Provider gemini-cli is not ready: Gemini CLI Google sign-in session detected for setup only; Owlfolio cannot execute Gemini CLI workflows until a safe adapter and target-specific certification exist. Developer API and Vertex certification remain separate.',
      },
    })
    expect(JSON.stringify(payload)).not.toContain(geminiAuthPath)
    expect(JSON.stringify(payload)).not.toContain('secret-gemini-token')
  })
})
