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
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
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
    // Strip the OpenRouter key so the default provider is deterministically not-ready (missing creds),
    // independent of the developer machine's environment.
    delete process.env.OPENROUTER_API_KEY
    // Isolate the env-key file and market-data signal so the gate is deterministic.
    process.env.OWLFOLIO_ENV_FILE = join(tempDir, '.env')
    delete process.env.OWLFOLIO_MARKET_DATA_API_KEY

    await writeFile(appConfigPath, JSON.stringify({
      ...defaultPersonalLocalAppConfig(),
      // Pin Claude as the not-ready provider fixture: the env above strips its credentials, so readiness
      // is deterministically not-ready. (The default personal-local provider is now OpenAI/Codex, which
      // is ready in this environment, so it can't serve as the "unready provider" fixture.)
      provider: { provider_id: 'openrouter', support_level: 'experimental' },
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

  // The pre-flight key guard runs BEFORE the readiness gate and, for an ACTIVE OpenRouter key, its
  // default live-validates against the provider — unit tests with a key set must inject a fake guard
  // (guardOk) or they would hit the network.
  const guardOk = { keyGuard: async () => ({ ok: true as const }) }

  describe('pre-flight key guard (fail fast instead of a dead mid-swarm run)', () => {
    it('key saved to the env file AFTER server boot → 400 provider_key_not_loaded with a restart message (real file read)', async () => {
      // The file has the key; process.env does not (hydration happens only at boot).
      await writeFile(join(tempDir, '.env'), 'OPENROUTER_API_KEY=sk-or-saved-after-boot\n', 'utf8')
      const response = await POST(new Request('http://localhost/api/research/start', {
        method: 'POST',
        body: JSON.stringify({ ticker: 'MSFT' }),
      }))
      const payload = await response.json()
      expect(response.status).toBe(400)
      expect(payload.error.code).toBe('provider_key_not_loaded')
      expect(payload.error.message).toMatch(/restart/i)
      expect(await researchRunRequestedCount()).toBe(0)
    })

    it('key CHANGED on disk after boot → 400 provider_key_stale (the run would use the old key)', async () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-old-boot-key'
      await writeFile(join(tempDir, '.env'), 'OPENROUTER_API_KEY=sk-or-new-file-key\n', 'utf8')
      const response = await POST(new Request('http://localhost/api/research/start', {
        method: 'POST',
        body: JSON.stringify({ ticker: 'MSFT' }),
      }))
      const payload = await response.json()
      expect(response.status).toBe(400)
      expect(payload.error.code).toBe('provider_key_stale')
      expect(payload.error.message).toMatch(/restart/i)
      expect(await researchRunRequestedCount()).toBe(0)
    })

    it('run-effective key rejected by the live probe → 400 provider_key_invalid (injected guard)', async () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-revoked'
      const response = await POST(new Request('http://localhost/api/research/start', {
        method: 'POST',
        body: JSON.stringify({ ticker: 'MSFT' }),
      }), undefined, {
        keyGuard: async () => ({ ok: false as const, code: 'provider_key_invalid' as const, message: 'The OPENROUTER_API_KEY was rejected by the provider (invalid or revoked).' }),
      })
      const payload = await response.json()
      expect(response.status).toBe(400)
      expect(payload.error.code).toBe('provider_key_invalid')
      expect(await researchRunRequestedCount()).toBe(0)
    })
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
        // OpenRouter is the default provider; with its key stripped it is deterministically not-ready
        // on the missing-credentials reason (the OpenRouter adapter is live but needs a key).
        message: 'Provider openrouter is not ready: Missing OPENROUTER_API_KEY; the OpenRouter adapter is live but needs a key, and each routed model still requires its own certification report.',
      },
    })
  })

  it('returns a clean 400 JSON error when latest certification makes credential-present provider effectively unready', async () => {
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

    const response = await POST(new Request('http://localhost/api/research/start', {
      method: 'POST',
      body: JSON.stringify({ ticker: 'MSFT' }),
    }), undefined, guardOk)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toEqual({
      error: {
        code: 'provider_not_ready',
        message: 'Provider openrouter is not ready: OpenRouter routing disabled by latest certification report',
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
