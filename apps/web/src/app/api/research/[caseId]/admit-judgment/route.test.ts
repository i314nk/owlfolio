import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { createResearchCase } from '@owlfolio/workflow'
import type { AnnualFacts, Fundamentals } from '@owlfolio/workflow/secEdgar'

import { POST } from './route'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
}

const SOURCE_IDS = ['src_a', 'src_b']

function makeFundamentals(): Fundamentals {
  const latest: AnnualFacts = {
    fiscal_year: 2024, currency: 'USD',
    net_income_musd: 1000, d_and_a_musd: 200, capex_musd: 300, sbc_musd: 150,
    diluted_shares_m: 100, total_debt_musd: 500, cash_and_securities_musd: 200,
  }
  return { cik: '1', entity_name: 'Test Co', currency: 'USD', latest_annual: latest, annual_series: [latest], filings: [] }
}

const ground = (async (sources: { source_id: string }[]) => ({
  captured: sources.map((s) => ({
    source_id: s.source_id, title: 't', url: 'https://example.com/x', excerpt: 'e',
    availability: 'available' as const, fetched_at: 'x', content_hash: 'sha256:1',
  })),
  verified_ids: sources.map((s) => s.source_id),
})) as never

function proposedSources() {
  return [{ source_id: 'src_a', title: 'T', url: 'https://www.sec.gov/Archives/edgar/data/0/a.htm', excerpt: 'e' }]
}

function fakeProvider(payloads: unknown[]) {
  let i = 0
  return {
    provider_id: 'mock-provider',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async () => {
      const p = payloads[Math.min(i, payloads.length - 1)]
      i += 1
      return p
    }),
  }
}

function stumblePayloads() {
  return [
    { impairment_bear_case: 'from filings cold: discount reflects smaller IV', proposed_sources: proposedSources() },
    {
      uncertainty: { level: 'high', argument: 'unknowable demand', citations: ['src_a'] },
      permanent_loss_risk: { level: 'low', argument: 'liquidation floors it', citations: ['src_b'] },
      proposed_sources: proposedSources(),
    },
  ]
}

/** Seed a gate-passing, deep-dive-complete case (analysis_drafted with moat_passes_gate). */
async function seedCase(ledgerPath: string, opts?: { gatePassing?: boolean; deepDiveComplete?: boolean }): Promise<string> {
  const rc = 'rc_admit_route'
  const store = new SQLiteEventStore(ledgerPath)
  try {
    await createResearchCase(store, {
      research_case_id: rc, company_id: 'company_tst', ticker: 'TST',
      strategy_id: 'buffett-munger', actor_id: 'user_local',
    })
    if (opts?.deepDiveComplete !== false) {
      await store.append({
        event_id: `evt_buffett_munger_analysis_drafted_${rc}`,
        event_type: 'buffett_munger_analysis_drafted',
        aggregate_type: 'research_case', aggregate_id: rc, correlation_id: rc,
        actor_type: 'provider', actor_id: 'mock-provider',
        payload: {
          research_case_id: rc, company_id: 'company_tst', ticker: 'TST',
          investment_verdict: 'WATCH',
          valuation: { moat_class: 'wide', moat_passes_gate: opts?.gatePassing ?? true, buy_price_per_share: 42 },
        },
        source_ids: SOURCE_IDS,
        created_at: new Date().toISOString(), schema_version: 1,
      })
    }
  } finally {
    store.close()
  }
  return rc
}

function callRoute(caseId: string, deps?: unknown) {
  return POST(
    new Request(`http://localhost/api/research/${caseId}/admit-judgment`, { method: 'POST' }),
    { params: Promise.resolve({ caseId }) },
    deps as never,
  )
}

describe('/api/research/[caseId]/admit-judgment', () => {
  let tempDir: string
  let ledgerPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-admit-route-'))
    const appConfigPath = join(tempDir, 'app-config.json')
    ledgerPath = join(tempDir, 'personal.sqlite')
    process.env.OWLFOLIO_APP_CONFIG_PATH = appConfigPath
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
    // The default personal-local provider is OpenRouter; make it deterministically ready so the
    // route's fail-closed readiness gate doesn't 400 the happy paths (the not-ready path is covered
    // explicitly via readinessOverride below).
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key'
    await writeFile(appConfigPath, JSON.stringify({
      ...defaultPersonalLocalAppConfig(),
      ledger_path: ledgerPath,
      source_ledger_path: join(tempDir, 'source-ledger'),
      initialized_at: '2026-06-01T00:00:00.000Z',
    }), 'utf8')
  })

  afterEach(async () => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k as keyof typeof originalEnv]
      else process.env[k as keyof typeof originalEnv] = v
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  const okDeps = () => ({
    provider: fakeProvider(stumblePayloads()),
    ground,
    fundamentals: makeFundamentals(),
    resolvePrice: async () => ({ available: true as const, price_per_share: 50, currency: 'USD', as_of: 'x', source: 'fixture' }),
  })

  it('computes + emits + returns the recommendation (observation, no auto-admit)', async () => {
    const caseId = await seedCase(ledgerPath)
    const res = await callRoute(caseId, okDeps())
    expect(res.status).toBe(200)
    const body = await res.json() as { recommendation: Record<string, unknown> }
    expect(body.recommendation.admittable).toBe(true)
    expect(body.recommendation.impairment_call).toBe('fixable_temporary')

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      const admitEvents = events.filter((e) => e.event_type === 'admit_judgment_recorded')
      expect(admitEvents).toHaveLength(1)
      expect(admitEvents[0]?.actor_type).toBe('provider')
      const payload = admitEvents[0]?.payload as Record<string, unknown>
      expect(payload.is_observation).toBe(true)
      expect(payload.is_recommendation).toBe(false)

      // NO transition: no holding/watchlist event was emitted.
      expect(events.some((e) => e.event_type === 'holding_opened')).toBe(false)
      expect(events.some((e) => e.event_type === 'watchlist_draft_created')).toBe(false)
      expect(events.some((e) => e.event_type === 'watchlist_draft_confirmed')).toBe(false)

      // The recommendation projects onto the case (read-only) without moving the stage to watchlist.
      const rc = projectResearchCases(events).find((c) => c.research_case_id === caseId)!
      expect(rc.admit_recommendation?.impairment_call).toBe('fixable_temporary')
      expect(rc.stage).not.toBe('watchlist')
    } finally {
      store.close()
    }
  })

  it('fail-closed when the provider is not ready', async () => {
    const caseId = await seedCase(ledgerPath)
    // Force readiness false by pointing config at an unconfigured/unsupported provider via env stub.
    const deps = { ...okDeps(), readinessOverride: { is_ready: false, provider_id: 'openrouter', status_label: 'not configured' } }
    const res = await callRoute(caseId, deps)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code?: string } }
    expect(body.error.code).toBe('provider_not_ready')

    const store = new SQLiteEventStore(ledgerPath)
    try {
      expect((await store.list()).some((e) => e.event_type === 'admit_judgment_recorded')).toBe(false)
    } finally {
      store.close()
    }
  })

  it('rejects a non-admission candidate (not gate-passing) with a clear reason and no event', async () => {
    const caseId = await seedCase(ledgerPath, { gatePassing: false })
    const res = await callRoute(caseId, okDeps())
    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code?: string; message?: string } }
    expect(body.error.code).toBe('not_an_admission_candidate')
    expect(body.error.message).toMatch(/gate/i)

    const store = new SQLiteEventStore(ledgerPath)
    try {
      expect((await store.list()).some((e) => e.event_type === 'admit_judgment_recorded')).toBe(false)
    } finally {
      store.close()
    }
  })

  it('rejects a case that is not deep-dive-complete', async () => {
    const caseId = await seedCase(ledgerPath, { deepDiveComplete: false })
    const res = await callRoute(caseId, okDeps())
    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code?: string; message?: string } }
    expect(body.error.code).toBe('not_an_admission_candidate')
    expect(body.error.message).toMatch(/deep.dive/i)
  })

  it('returns 404 for an unknown research case', async () => {
    const res = await callRoute('rc_missing', okDeps())
    expect(res.status).toBe(404)
  })
})
