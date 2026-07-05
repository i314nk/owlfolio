import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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

/** Seed a gate-passing case WITH a recorded admit recommendation carrying the floor + risk levels. */
async function seedCase(ledgerPath: string, opts?: {
  withAdmit?: boolean
  withFloor?: boolean
  permanentLoss?: string
  buyBelow?: number
  investable?: number
}): Promise<string> {
  const rc = 'rc_sizing_route'
  const store = new SQLiteEventStore(ledgerPath)
  try {
    await createResearchCase(store, {
      research_case_id: rc, company_id: 'company_tst', ticker: 'TST',
      strategy_id: 'buffett-munger', actor_id: 'user_local',
    })
    await store.append({
      event_id: `evt_buffett_munger_analysis_drafted_${rc}`,
      event_type: 'buffett_munger_analysis_drafted',
      aggregate_type: 'research_case', aggregate_id: rc, correlation_id: rc,
      actor_type: 'provider', actor_id: 'mock-provider',
      payload: {
        research_case_id: rc, company_id: 'company_tst', ticker: 'TST',
        investment_verdict: 'WATCH',
        valuation: { moat_class: 'wide', moat_passes_gate: true, buy_price_per_share: opts?.buyBelow ?? 42 },
      },
      source_ids: SOURCE_IDS,
      created_at: new Date().toISOString(), schema_version: 1,
    })
    if (opts?.withAdmit !== false) {
      await store.append({
        event_id: `evt_admit_judgment_recorded_admit_${rc}`,
        event_type: 'admit_judgment_recorded',
        aggregate_type: 'research_case', aggregate_id: rc, correlation_id: rc,
        actor_type: 'provider', actor_id: 'mock-provider',
        payload: {
          admit_judgment_id: `admit_${rc}`, research_case_id: rc, ticker: 'TST',
          uncertainty: { level: 'low' },
          permanent_loss_risk: { level: opts?.permanentLoss ?? 'low' },
          admittable: true, buy_below: opts?.buyBelow ?? 42,
          ...(opts?.withFloor === false
            ? { downside_floor: { status: 'cannot_floor', reason: 'high permanent-loss level' } }
            : { downside_floor: { status: 'floor', floor_per_share: 30, basis: 'net_cash', reliability: 'sound' } }),
          is_observation: true, is_recommendation: false,
        },
        source_ids: SOURCE_IDS,
        created_at: new Date().toISOString(), schema_version: 1,
      })
    }
    await store.append({
      event_id: `evt_investable_capital_set_${rc}`,
      event_type: 'investable_capital_set',
      aggregate_type: 'portfolio', aggregate_id: 'portfolio', correlation_id: 'portfolio',
      actor_type: 'user', actor_id: 'user_local',
      payload: { amount: opts?.investable ?? 100000, currency: 'USD', as_of: '2026-06-01' },
      source_ids: [],
      created_at: new Date().toISOString(), schema_version: 1,
    })
    // A cash deposit → accounting NAV reflects the capital base (the S3/S4 book-impairment denominator).
    await store.append({
      event_id: `evt_cash_deposited_${rc}`,
      event_type: 'cash_deposited',
      aggregate_type: 'cash_account', aggregate_id: 'cash_usd', correlation_id: 'cash_usd',
      actor_type: 'user', actor_id: 'user_local',
      payload: { amount: opts?.investable ?? 100000, currency: 'USD', deposited_at: '2026-06-01' },
      source_ids: [],
      created_at: new Date().toISOString(), schema_version: 1,
    })
  } finally {
    store.close()
  }
  return rc
}

function callRoute(caseId: string, deps?: unknown) {
  return POST(
    new Request(`http://localhost/api/research/${caseId}/sizing`, { method: 'POST' }),
    { params: Promise.resolve({ caseId }) },
    deps as never,
  )
}

describe('/api/research/[caseId]/sizing', () => {
  let tempDir: string
  let ledgerPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-sizing-route-'))
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

  // A high-OE-yield candidate clears the deployment hurdle → sizeable. EV ≈ price×shares + debt − cash;
  // a low fresh price gives a high OE yield, well above the default ~2% savings + risk margin hurdle.
  const sizeableDeps = () => ({
    fundamentals: makeFundamentals(),
    resolvePrice: async () => ({ available: true as const, price_per_share: 20, currency: 'USD', as_of: 'x', source: 'fixture' }),
  })

  it('computes + emits + returns a SIZEABLE recommendation (observation, no auto-open)', async () => {
    const caseId = await seedCase(ledgerPath)
    const res = await callRoute(caseId, sizeableDeps())
    expect(res.status).toBe(200)
    const body = await res.json() as { recommendation: Record<string, unknown> }
    expect(body.recommendation.status).toBe('sizeable')
    // The worst case ALWAYS rides alongside the size.
    const worst = body.recommendation.worst_case as Record<string, unknown>
    expect(worst.downside_floor_per_share).toBe(30)
    expect(worst.downside_floor_basis).toBe('net_cash')

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      const sizingEvents = events.filter((e) => e.event_type === 'sizing_recommendation_recorded')
      expect(sizingEvents).toHaveLength(1)
      expect(sizingEvents[0]?.actor_type).toBe('provider')
      const payload = sizingEvents[0]?.payload as Record<string, unknown>
      expect(payload.is_observation).toBe(true)
      expect(payload.is_recommendation).toBe(false)

      // NO transition: the buy is human-signed — no holding/watchlist event was emitted.
      expect(events.some((e) => e.event_type === 'holding_opened')).toBe(false)
      expect(events.some((e) => e.event_type === 'watchlist_draft_confirmed')).toBe(false)

      // The recommendation projects onto the case (read-only) without moving the stage.
      const rc = projectResearchCases(events).find((c) => c.research_case_id === caseId)!
      expect(rc.sizing_recommendation?.status).toBe('sizeable')
      expect(rc.sizing_recommendation?.worst_case?.downside_floor_per_share).toBe(30)
    } finally {
      store.close()
    }
  })

  it('hold_in_savings is the CORRECT posture when nothing clears the hurdle (a rich price)', async () => {
    const caseId = await seedCase(ledgerPath)
    // A very high fresh price → low OE yield → below the deployment hurdle → hold_in_savings (not warning).
    const res = await callRoute(caseId, {
      fundamentals: makeFundamentals(),
      resolvePrice: async () => ({ available: true as const, price_per_share: 5000, currency: 'USD', as_of: 'x', source: 'fixture' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { recommendation: Record<string, unknown> }
    expect(body.recommendation.status).toBe('hold_in_savings')
    expect(body.recommendation.reason).toBeTypeOf('string')
  })

  it('cannot_size (fail-closed) when the admit recommendation has cannot_floor', async () => {
    const caseId = await seedCase(ledgerPath, { withFloor: false })
    const res = await callRoute(caseId, sizeableDeps())
    expect(res.status).toBe(200)
    const body = await res.json() as { recommendation: Record<string, unknown> }
    expect(body.recommendation.status).toBe('cannot_size')
  })

  it('fail-closed when the provider is not ready', async () => {
    const caseId = await seedCase(ledgerPath)
    const deps = { ...sizeableDeps(), readinessOverride: { is_ready: false, provider_id: 'openrouter', status_label: 'not configured' } }
    const res = await callRoute(caseId, deps)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code?: string } }
    expect(body.error.code).toBe('provider_not_ready')

    const store = new SQLiteEventStore(ledgerPath)
    try {
      expect((await store.list()).some((e) => e.event_type === 'sizing_recommendation_recorded')).toBe(false)
    } finally {
      store.close()
    }
  })

  it('rejects a case with no recorded admit recommendation (no floor/risk levels to size on)', async () => {
    const caseId = await seedCase(ledgerPath, { withAdmit: false })
    const res = await callRoute(caseId, sizeableDeps())
    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code?: string; message?: string } }
    expect(body.error.code).toBe('not_a_sizing_candidate')
    expect(body.error.message).toMatch(/admit/i)

    const store = new SQLiteEventStore(ledgerPath)
    try {
      expect((await store.list()).some((e) => e.event_type === 'sizing_recommendation_recorded')).toBe(false)
    } finally {
      store.close()
    }
  })

  it('returns 404 for an unknown research case', async () => {
    const res = await callRoute('rc_missing', sizeableDeps())
    expect(res.status).toBe(404)
  })
})
