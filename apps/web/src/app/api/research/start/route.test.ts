import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { createNotConfiguredCertificationReport } from '@owlfolio/providers'
import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'

import { POST } from './route'
import * as circleGate from '../../../../lib/circleGate'
import { recordProviderConnectedEvent } from '../../../../lib/providerConnections'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
  OWLFOLIO_PROVIDER_CERTIFICATION_DIR: process.env.OWLFOLIO_PROVIDER_CERTIFICATION_DIR,
  OWLFOLIO_CLAUDE_CREDENTIALS_PATH: process.env.OWLFOLIO_CLAUDE_CREDENTIALS_PATH,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OWLFOLIO_ENV_FILE: process.env.OWLFOLIO_ENV_FILE,
  OWLFOLIO_MARKET_DATA_API_KEY: process.env.OWLFOLIO_MARKET_DATA_API_KEY,
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
    // Isolate the env-key file and market-data signal so the gate is deterministic.
    process.env.OWLFOLIO_ENV_FILE = join(tempDir, '.env')
    delete process.env.OWLFOLIO_MARKET_DATA_API_KEY

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
    delete process.env.OWLFOLIO_TEST_MODE
    vi.restoreAllMocks()
    await rm(tempDir, { force: true, recursive: true })
  })

  // Count `research_run_requested` events in the ledger — a started research case appends exactly this
  // event, so zero of them proves a pre-spend rejection created NO research case. (The ledger file itself
  // may exist from readiness/gate reads; only the research event proves a case was started.)
  async function researchRunRequestedCount(): Promise<number> {
    const ledgerPath = join(tempDir, 'personal.sqlite')
    if (!(await readdir(tempDir)).some((name) => name === 'personal.sqlite')) return 0
    const store = new SQLiteEventStore(ledgerPath)
    const events = await store.list()
    return events.filter((e) => e.event_type === 'research_run_requested').length
  }

  // Reach the circle gate deterministically: mock-provider is ready and we skip the (capital-dependent)
  // onboarding gate via the existing playwright seam, so the circle gate is the next decision.
  async function writeMockProviderConfigWithCircle(circle: Record<string, unknown>): Promise<void> {
    process.env.OWLFOLIO_TEST_MODE = 'playwright'
    await writeFile(appConfigPath, JSON.stringify({
      ...defaultPersonalLocalAppConfig(),
      provider: {
        ...defaultPersonalLocalAppConfig().provider,
        provider_id: 'mock-provider',
      },
      circle_of_competence: circle,
      ledger_path: join(tempDir, 'personal.sqlite'),
      source_ledger_path: join(tempDir, 'source-ledger'),
      initialized_at: '2026-06-01T00:00:00.000Z',
    }), 'utf8')
  }

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

  it('refuses to start a deep dive when onboarding is incomplete, naming the missing item', async () => {
    // mock-provider is ready, so we pass the readiness check and reach the onboarding gate.
    // The gate is provider + capital only; with no investable capital set, capital is the missing item.
    await writeFile(appConfigPath, JSON.stringify({
      ...defaultPersonalLocalAppConfig(),
      provider: {
        ...defaultPersonalLocalAppConfig().provider,
        provider_id: 'mock-provider',
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
    expect(payload.error.code).toBe('onboarding_incomplete')
    expect(payload.error.message).toMatch(/Investable capital/)
    expect(payload.error.missing_items).toEqual(expect.arrayContaining([expect.stringMatching(/Investable capital/)]))
    // The market-data key is no longer a gate item, so it must never appear in the missing list.
    expect(payload.error.missing_items).not.toEqual(expect.arrayContaining([expect.stringMatching(/market-data/i)]))
  })

  it('allows a research run when provider + capital are set even with NO market-data key (EDGAR direct)', async () => {
    // mock-provider ready + frontier-LLM connected + investable capital set, but no market-data key.
    delete process.env.OWLFOLIO_MARKET_DATA_API_KEY
    const ledgerPath = join(tempDir, 'personal.sqlite')
    await writeFile(appConfigPath, JSON.stringify({
      ...defaultPersonalLocalAppConfig(),
      provider: {
        ...defaultPersonalLocalAppConfig().provider,
        provider_id: 'mock-provider',
      },
      ledger_path: ledgerPath,
      source_ledger_path: join(tempDir, 'source-ledger'),
      initialized_at: '2026-06-01T00:00:00.000Z',
    }), 'utf8')

    const store = new SQLiteEventStore(ledgerPath)
    try {
      await recordProviderConnectedEvent(store, { provider_id: 'anthropic', env_key_name: 'ANTHROPIC_API_KEY', connected_at: '2026-06-09T00:00:00Z' })
      await store.append({
        event_id: 'evt_investable_capital_set_route',
        event_type: 'investable_capital_set',
        aggregate_type: 'portfolio',
        aggregate_id: 'portfolio_local',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: { amount: 10000, currency: 'USD', as_of: '2026-06-09T00:00:00Z' },
        source_ids: [],
        created_at: '2026-06-09T00:00:00Z',
        schema_version: 1,
      })
    } finally {
      store.close()
    }

    const response = await POST(new Request('http://localhost/api/research/start', {
      method: 'POST',
      body: JSON.stringify({ ticker: 'MSFT' }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(202)
    expect(typeof payload.research_case_id).toBe('string')
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

  describe('circle-of-competence pre-spend gate', () => {
    it('rejects an out-of-circle ticker pre-spend, returns the reason, and creates no research case', async () => {
      await writeMockProviderConfigWithCircle({ enabled: true, allowed_sic_prefixes: ['73'] })
      const spy = vi.spyOn(circleGate, 'evaluateCircleGate').mockResolvedValue({
        allowed: false,
        reason: 'SIC 6022 is outside the allowed SIC prefixes (73)',
      })

      const response = await POST(new Request('http://localhost/api/research/start', {
        method: 'POST',
        body: JSON.stringify({ ticker: 'JPM' }),
      }))
      const payload = await response.json()

      expect(response.status).toBe(400)
      expect(payload.error.code).toBe('out_of_circle')
      expect(payload.error.message).toContain('6022')
      expect(spy).toHaveBeenCalled()
      // No research case was created: no research_run_requested event was appended.
      expect(await researchRunRequestedCount()).toBe(0)
    })

    it('proceeds to start research when the candidate is in-circle', async () => {
      await writeMockProviderConfigWithCircle({ enabled: true, allowed_sic_prefixes: ['73'] })
      vi.spyOn(circleGate, 'evaluateCircleGate').mockResolvedValue({ allowed: true })

      const response = await POST(new Request('http://localhost/api/research/start', {
        method: 'POST',
        body: JSON.stringify({ ticker: 'MSFT' }),
      }))
      const payload = await response.json()

      expect(response.status).toBe(202)
      expect(typeof payload.research_case_id).toBe('string')
    })

    it('does not run the circle gate at all under the permissive default (disabled)', async () => {
      await writeMockProviderConfigWithCircle({ enabled: false })
      const spy = vi.spyOn(circleGate, 'evaluateCircleGate')

      const response = await POST(new Request('http://localhost/api/research/start', {
        method: 'POST',
        body: JSON.stringify({ ticker: 'MSFT' }),
      }))
      const payload = await response.json()

      expect(response.status).toBe(202)
      expect(typeof payload.research_case_id).toBe('string')
      // Common path untouched: the gate evaluator was never invoked.
      expect(spy).not.toHaveBeenCalled()
    })
  })
})
