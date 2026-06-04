import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createNotConfiguredCertificationReport } from '@owlfolio/providers'
import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'

import { POST } from './route'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
  OWLFOLIO_PROVIDER_CERTIFICATION_DIR: process.env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR,
  OWLFOLIO_CLAUDE_CREDENTIALS_PATH: process.env.OWLFOLIO_CLAUDE_CREDENTIALS_PATH,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
}

describe('/api/research/start', () => {
  let tempDir: string
  let appConfigPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-research-start-route-'))
    appConfigPath = join(tempDir, 'app-config.json')
    process.env.OWLFOLIO_APP_CONFIG_PATH = appConfigPath
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
    delete process.env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR
    process.env.OWLFOLIO_CLAUDE_CREDENTIALS_PATH = join(tempDir, 'missing-claude-credentials.json')
    delete process.env.ANTHROPIC_API_KEY

    await writeFile(appConfigPath, JSON.stringify({
      ...defaultPersonalLocalAppConfig(),
      ledger_path: join(tempDir, 'personal.sqlite'),
      source_ledger_path: join(tempDir, 'source-ledger'),
      initialized_at: '2026-06-01T00:00:00.000Z',
    }), 'utf8')
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

  it('returns a clean 400 JSON error when research is requested with an unready provider', async () => {
    const response = await POST(new Request('http://localhost/api/research/start', {
      method: 'POST',
      body: JSON.stringify({ ticker: 'MSFT' }),
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

  it('returns a clean 400 JSON error when latest certification makes credential-present provider effectively unready', async () => {
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

    const response = await POST(new Request('http://localhost/api/research/start', {
      method: 'POST',
      body: JSON.stringify({ ticker: 'MSFT' }),
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

  it('returns a clean 400 JSON error when research is requested with an unknown provider', async () => {
    await writeFile(appConfigPath, JSON.stringify({
      ...defaultPersonalLocalAppConfig(),
      provider: {
        ...defaultPersonalLocalAppConfig().provider,
        provider_id: 'unknown-provider',
      },
      ledger_path: join(tempDir, 'personal.sqlite'),
      source_ledger_path: join(tempDir, 'source-ledger'),
      initialized_at: '2026-06-01T00:00:00.000Z',
    }), 'utf8')

    const response = await POST(new Request('http://localhost/api/research/start', {
      method: 'POST',
      body: JSON.stringify({ ticker: 'MSFT' }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toEqual({
      error: {
        code: 'unknown_provider',
        message: 'Unknown provider: unknown-provider',
      },
    })
  })
})
