import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'

import { POST } from './route'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
}

const RC = 'rc_sell_route'
const HOLDING_ID = 'holding_sell_route'
const WATCH_ID = 'watch_sell_route'
const SOURCE_IDS = ['src_a', 'src_b']

function ev(partial: Omit<LedgerEventEnvelope<Record<string, unknown>>, 'schema_version' | 'created_at' | 'source_ids'> & {
  source_ids?: string[]
  created_at?: string
}): LedgerEventEnvelope<Record<string, unknown>> {
  return {
    schema_version: 1,
    source_ids: partial.source_ids ?? SOURCE_IDS,
    created_at: partial.created_at ?? new Date().toISOString(),
    ...partial,
  } as LedgerEventEnvelope<Record<string, unknown>>
}

/** Seed a HELD name (gate-passing case + admit recommendation + sign-off-frozen IV + a lot). */
async function seedHeld(ledgerPath: string, opts: { held?: boolean } = {}): Promise<void> {
  const store = new SQLiteEventStore(ledgerPath)
  try {
    await store.append(ev({
      event_id: `evt_research_case_created_${RC}`,
      event_type: 'research_case_created',
      aggregate_type: 'research_case', aggregate_id: RC, correlation_id: RC,
      actor_type: 'user', actor_id: 'user_local',
      payload: { research_case_id: RC, company_id: 'company_tst', ticker: 'TST' },
    }))
    await store.append(ev({
      event_id: `evt_buffett_munger_analysis_drafted_${RC}`,
      event_type: 'buffett_munger_analysis_drafted',
      aggregate_type: 'research_case', aggregate_id: RC, correlation_id: RC,
      actor_type: 'provider', actor_id: 'mock-provider',
      payload: {
        research_case_id: RC, company_id: 'company_tst', ticker: 'TST',
        investment_verdict: 'WATCH',
        valuation: { moat_class: 'wide', moat_passes_gate: true, buy_price_per_share: 60, fair_value_per_share: 80 },
      },
    }))
    await store.append(ev({
      event_id: `evt_admit_judgment_recorded_admit_${RC}`,
      event_type: 'admit_judgment_recorded',
      aggregate_type: 'research_case', aggregate_id: RC, correlation_id: RC,
      actor_type: 'provider', actor_id: 'mock-provider',
      payload: {
        admit_judgment_id: `admit_${RC}`, research_case_id: RC, ticker: 'TST',
        uncertainty: { level: 'low' }, permanent_loss_risk: { level: 'low' },
        admittable: true, buy_below: 60,
        downside_floor: { status: 'floor', floor_per_share: 40, basis: 'net_cash', reliability: 'sound' },
        is_observation: true, is_recommendation: false,
      },
    }))
    await store.append(ev({
      event_id: `evt_watchlist_draft_confirmed_${WATCH_ID}`,
      event_type: 'watchlist_draft_confirmed',
      aggregate_type: 'watchlist_item', aggregate_id: WATCH_ID, correlation_id: RC,
      actor_type: 'user', actor_id: 'user_local',
      payload: {
        watchlist_item_id: WATCH_ID, research_case_id: RC, company_id: 'company_tst', ticker: 'TST',
        locked_buy_below: 60, signed_thesis: 'I am admitting TST.',
        // scope-reframe — the lightened valuation-inverted sell flag compares the live price against the
        // frozen REFERENCE. This is a LEGACY-style event (frozen_band_* + frozen_iv): tolerance maps the old
        // frozen_iv (80) onto the reference, so the live price 90 ≥ 80 → flagged (inverted).
        frozen_band_low: 0.05, frozen_band_high: 0.09, frozen_oe_ps: 5,
        frozen_iv: 80, frozen_iv_valuation_version: 'valuation-2026-06-cap-1',
      },
    }))
    if (opts.held !== false) {
      await store.append(ev({
        event_id: `evt_holding_opened_${HOLDING_ID}`,
        event_type: 'holding_opened',
        aggregate_type: 'holding', aggregate_id: HOLDING_ID, correlation_id: RC,
        actor_type: 'user', actor_id: 'user_local',
        created_at: '2020-01-01T00:00:00.000Z',
        payload: {
          holding_id: HOLDING_ID, watchlist_item_id: WATCH_ID, research_case_id: RC,
          company_id: 'company_tst', ticker: 'TST',
          shares: 10, cost_basis_per_share: 100, currency: 'USD', opened_at: '2020-01-01',
        },
      }))
    }
  } finally {
    store.close()
  }
}

function callRoute(caseId: string, body: unknown, deps?: unknown) {
  const init: RequestInit = body === undefined
    ? { method: 'POST' }
    : { method: 'POST', body: JSON.stringify(body) }
  return POST(
    new Request(`http://localhost/api/research/${caseId}/sell-decision`, init),
    { params: Promise.resolve({ caseId }) },
    deps as never,
  )
}

const priceDeps = (price: number) => ({
  resolvePrice: async () => ({ available: true as const, price_per_share: price, currency: 'USD', as_of: 'x', source: 'fixture' }),
})

describe('/api/research/[caseId]/sell-decision', () => {
  let tempDir: string
  let ledgerPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-sell-route-'))
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

  it('200 — computes + emits a sell_review OBSERVATION (no auto-close)', async () => {
    await seedHeld(ledgerPath)
    const res = await callRoute(RC, { trigger: 'valuation_inverted' }, priceDeps(90))
    expect(res.status).toBe(200)
    const body = await res.json() as { recommendation: Record<string, unknown> }
    expect(body.recommendation.reason_code).toBe('valuation_inverted')
    expect(body.recommendation.is_observation).toBe(true)

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      expect(events.filter((e) => e.event_type === 'holding_sell_review_drafted')).toHaveLength(1)
      expect(events.some((e) => e.event_type === 'holding_closed')).toBe(false)
    } finally {
      store.close()
    }
  })

  it('409 — a non-held (merely watched) name is not a sell candidate', async () => {
    await seedHeld(ledgerPath, { held: false })
    const res = await callRoute(RC, { trigger: 'valuation_inverted' }, priceDeps(90))
    expect(res.status).toBe(409)
    const body = await res.json() as { error: { code?: string } }
    expect(body.error.code).toBe('not_a_held_position')
  })

  it('422 — an invalid/missing trigger is rejected', async () => {
    await seedHeld(ledgerPath)
    const bad = await callRoute(RC, { trigger: 'bogus' }, priceDeps(90))
    expect(bad.status).toBe(422)
    const missing = await callRoute(RC, {}, priceDeps(90))
    expect(missing.status).toBe(422)
  })

  it('502 — cannot_assess (valuation_inverted with no fresh price) is surfaced as incomplete', async () => {
    await seedHeld(ledgerPath)
    const res = await callRoute(RC, { trigger: 'valuation_inverted' }, {
      resolvePrice: async () => ({ available: false as const }),
    })
    expect(res.status).toBe(502)
    const body = await res.json() as { error: { code?: string } }
    expect(body.error.code).toBe('cannot_assess')
  })

  it('400 — fail-closed when the provider is not ready', async () => {
    await seedHeld(ledgerPath)
    const res = await callRoute(RC, { trigger: 'valuation_inverted' }, {
      ...priceDeps(90),
      readinessOverride: { is_ready: false, provider_id: 'openrouter', status_label: 'not configured' },
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code?: string } }
    expect(body.error.code).toBe('provider_not_ready')

    const store = new SQLiteEventStore(ledgerPath)
    try {
      expect((await store.list()).some((e) => e.event_type === 'holding_sell_review_drafted')).toBe(false)
    } finally {
      store.close()
    }
  })

  it('404 — unknown research case', async () => {
    const res = await callRoute('rc_missing', { trigger: 'valuation_inverted' }, priceDeps(90))
    expect(res.status).toBe(404)
  })
})
