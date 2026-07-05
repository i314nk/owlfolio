import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createNotConfiguredCertificationReport } from '@owlfolio/providers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POST } from './route'

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
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
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
    // Strip the OpenRouter key so the default provider is deterministically not-ready (missing creds).
    delete process.env.OPENROUTER_API_KEY
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
        provider: { provider_id: 'openrouter', support_level: 'experimental' },
      }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toEqual({
      error: {
        code: 'provider_not_ready',
        // OpenRouter is the default provider; with its key stripped it is deterministically not-ready
        // on the missing-credentials reason.
        message: 'Provider openrouter is not ready: Missing OPENROUTER_API_KEY; the OpenRouter adapter is live but needs a key, and each routed model still requires its own certification report.',
      },
    })
  })

  it('rejects initializing personal-local mode when latest certification makes credential-present provider effectively unready', async () => {
    process.env.OPENROUTER_API_KEY = 'credential-present-but-latest-certification-failed'
    const reportDir = join(tempDir, 'data', 'provider-certifications')
    await mkdir(reportDir, { recursive: true })
    await writeFile(join(reportDir, 'openrouter.latest.json'), JSON.stringify(createNotConfiguredCertificationReport({
      provider_id: 'openrouter',
      generated_at: '2026-06-02T00:00:00.000Z',
      auth_mode: 'api_key',
      capabilities: {
        'text-generation': 'native',
        'structured-output': 'native',
        'tool-function-calling': 'unsupported',
        'streaming-observability': 'adapter',
        'multi-step-tool-loop': 'unsupported',
      },
      reason: 'OpenRouter routing disabled by latest certification report',
    })), 'utf8')

    const response = await POST(new Request('http://localhost/api/onboarding/start', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'personal-local',
        provider: { provider_id: 'openrouter', support_level: 'experimental' },
      }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toEqual({
      error: {
        code: 'provider_not_ready',
        message: 'Provider openrouter is not ready: OpenRouter routing disabled by latest certification report',
      },
    })
  })

  it('rejects a retired provider id (gemini-cli) as an unknown provider — fail-closed after the OpenRouter + Codex CLI reduction', async () => {
    const response = await POST(new Request('http://localhost/api/onboarding/start', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'personal-local',
        provider: { provider_id: 'gemini-cli', support_level: 'unsupported' },
      }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error.code).toBe('unknown_provider')
    expect(payload.error.message).toContain('Unknown provider: gemini-cli')
  })
})
