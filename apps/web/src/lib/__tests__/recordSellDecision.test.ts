import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'

import { getOnboardingState } from '../onboarding'
import { recordSellDecision } from '../workflow'

// ---------------------------------------------------------------------------------------------------
// Phase 6 S8a — recordSellDecision web-workflow test.
//
// A held name + a trigger → ONE holding_sell_review_drafted OBSERVATION (is_observation:true), the right
// reason_code, NEVER a holding_closed; idempotent on re-run; a non-held name → not_a_held_position; a
// cannot_assess case (valuation_inverted with no frozen_iv) surfaces.
// ---------------------------------------------------------------------------------------------------

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
}

const RC = 'rc_sell_decision'
const HOLDING_ID = 'holding_sell_tst'
const WATCH_ID = 'watch_sell_decision'
const SOURCE_IDS = ['src_a', 'src_b']
const NOW = '2026-06-09T00:00:00.000Z'

type SeedOpts = {
  /** Open the holding (default true). When false, the name stays merely watched (non-held). */
  held?: boolean
  /** Freeze the sign-off IV onto the watchlist lineage (default true). */
  withFrozenIv?: boolean
  /** The opened-at date for the held lot (default well past the minimum-hold window). */
  openedAt?: string
  /** The held lot's cost basis per share (default 100 — a high cost so a low price is "at a loss"). */
  costBasis?: number
  permanentLoss?: string
  uncertainty?: string
}

function ev(partial: Omit<LedgerEventEnvelope<Record<string, unknown>>, 'schema_version' | 'created_at' | 'source_ids'> & {
  source_ids?: string[]
  created_at?: string
}): LedgerEventEnvelope<Record<string, unknown>> {
  return {
    schema_version: 1,
    source_ids: partial.source_ids ?? SOURCE_IDS,
    created_at: partial.created_at ?? NOW,
    ...partial,
  } as LedgerEventEnvelope<Record<string, unknown>>
}

/** Seed a HELD name with a gate-passing case, an admit recommendation, a sign-off-frozen IV, and a lot. */
async function seedHeld(ledgerPath: string, opts: SeedOpts = {}): Promise<void> {
  const store = new SQLiteEventStore(ledgerPath)
  try {
    // 1) The research case (gate-passing valuation; the frozen IV = fair_value_per_share = 80).
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
    // 2) The persisted admit recommendation — the current grounded risk fields + downside floor.
    await store.append(ev({
      event_id: `evt_admit_judgment_recorded_admit_${RC}`,
      event_type: 'admit_judgment_recorded',
      aggregate_type: 'research_case', aggregate_id: RC, correlation_id: RC,
      actor_type: 'provider', actor_id: 'mock-provider',
      payload: {
        admit_judgment_id: `admit_${RC}`, research_case_id: RC, ticker: 'TST',
        uncertainty: { level: opts.uncertainty ?? 'low' },
        permanent_loss_risk: { level: opts.permanentLoss ?? 'low' },
        admittable: true, buy_below: 60,
        downside_floor: { status: 'floor', floor_per_share: 40, basis: 'net_cash', reliability: 'sound' },
        is_observation: true, is_recommendation: false,
      },
    }))
    // 3) The watchlist confirmation — carries the sign-off-frozen IV onto the lineage.
    await store.append(ev({
      event_id: `evt_watchlist_draft_confirmed_${WATCH_ID}`,
      event_type: 'watchlist_draft_confirmed',
      aggregate_type: 'watchlist_item', aggregate_id: WATCH_ID, correlation_id: RC,
      actor_type: 'user', actor_id: 'user_local',
      payload: {
        watchlist_item_id: WATCH_ID, research_case_id: RC, company_id: 'company_tst', ticker: 'TST',
        locked_buy_below: 60, signed_thesis: 'I am admitting TST.',
        ...(opts.withFrozenIv === false ? {} : { frozen_iv: 80, frozen_iv_valuation_version: 'valuation-2026-06-cap-1' }),
      },
    }))
    // 4) The open holding (default — a held lot with a high cost so a low price is "at a loss").
    if (opts.held !== false) {
      await store.append(ev({
        event_id: `evt_holding_opened_${HOLDING_ID}`,
        event_type: 'holding_opened',
        aggregate_type: 'holding', aggregate_id: HOLDING_ID, correlation_id: RC,
        actor_type: 'user', actor_id: 'user_local',
        created_at: opts.openedAt ?? '2020-01-01T00:00:00.000Z',
        payload: {
          holding_id: HOLDING_ID, watchlist_item_id: WATCH_ID, research_case_id: RC,
          company_id: 'company_tst', ticker: 'TST',
          shares: 10, cost_basis_per_share: opts.costBasis ?? 100, currency: 'USD',
          opened_at: (opts.openedAt ?? '2020-01-01T00:00:00.000Z').slice(0, 10),
        },
      }))
    }
  } finally {
    store.close()
  }
}

/** A fixture price resolver. */
function priceDeps(pricePerShare: number) {
  return {
    resolvePrice: async () => ({ available: true as const, price_per_share: pricePerShare, currency: 'USD', as_of: 'x', source: 'fixture' }),
  }
}

describe('recordSellDecision (Phase 6 S8a — on-demand held-position sell decision)', () => {
  let tempDir: string
  let ledgerPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-sell-decision-'))
    const appConfigPath = join(tempDir, 'app-config.json')
    ledgerPath = join(tempDir, 'personal.sqlite')
    process.env.OWLFOLIO_APP_CONFIG_PATH = appConfigPath
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
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

  it('a held name + valuation_inverted (price reached frozen IV) → ONE sell_review OBSERVATION, never a close', async () => {
    await seedHeld(ledgerPath)
    const state = await getOnboardingState()
    // Price 90 ≥ frozen IV 80 → valuation_inverted sell_review; 90 < cost basis 100 is irrelevant here
    // (a valuation-inverted gain/parity proceeds on its own terms; the guard only brakes loss sales).
    const outcome = await recordSellDecision(state, RC, { trigger: 'valuation_inverted' }, priceDeps(90))

    expect(outcome.status).toBe('complete')
    if (outcome.status !== 'complete') return
    expect(outcome.recommendation.reason_code).toBe('valuation_inverted')
    expect(outcome.recommendation.is_observation).toBe(true)
    expect(outcome.recommendation.is_execution).toBe(false)
    expect(outcome.recommendation.requires_user_authoring).toBe(true)
    expect(outcome.recommendation.decision_status).toBe('sell_review')
    expect(outcome.recommendation.holding_id).toBe(HOLDING_ID)
    expect(outcome.recommendation.frozen_iv).toBe(80)
    // The rebuilt scaffold carries the REAL holding identity (the assembler used a placeholder).
    const draft = outcome.recommendation.sell_review_draft as Record<string, unknown>
    expect(draft.holding_id).toBe(HOLDING_ID)
    expect(draft.ticker).toBe('TST')

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      const sellEvents = events.filter((e) => e.event_type === 'holding_sell_review_drafted')
      expect(sellEvents).toHaveLength(1)
      expect(sellEvents[0]?.actor_type).toBe('provider')
      expect((sellEvents[0]?.payload as Record<string, unknown>).is_observation).toBe(true)
      // NEVER auto-close.
      expect(events.some((e) => e.event_type === 'holding_closed')).toBe(false)
    } finally {
      store.close()
    }
  })

  it('is idempotent — an identical recompute converges to ONE event (same content → same idempotency_key)', async () => {
    await seedHeld(ledgerPath)
    const state = await getOnboardingState()
    const first = await recordSellDecision(state, RC, { trigger: 'valuation_inverted' }, priceDeps(90))
    const second = await recordSellDecision(state, RC, { trigger: 'valuation_inverted' }, priceDeps(90))
    expect(first.status).toBe('complete')
    expect(second.status).toBe('complete')
    if (first.status === 'complete' && second.status === 'complete') {
      expect(second.sell_review_id).toBe(first.sell_review_id)
    }

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      expect(events.filter((e) => e.event_type === 'holding_sell_review_drafted')).toHaveLength(1)
    } finally {
      store.close()
    }
  })

  it('a thesis_broke trigger on a permanently-impaired held name at a loss → sell_review (released)', async () => {
    // High permanent-loss → permanent_impairment; at a loss (price 70 < cost 100); inside window (opened today).
    await seedHeld(ledgerPath, { permanentLoss: 'high', openedAt: NOW })
    const state = await getOnboardingState()
    const outcome = await recordSellDecision(state, RC, { trigger: 'thesis_broke' }, priceDeps(70))
    expect(outcome.status).toBe('complete')
    if (outcome.status !== 'complete') return
    // A broken thesis firing THROUGH the window releases via the guard → minimum_hold_released.
    expect(outcome.recommendation.reason_code).toBe('minimum_hold_released')
    expect(outcome.recommendation.requires_human_signoff).toBe(true)
  })

  it('a NON-held (merely watched) name → not_a_held_position', async () => {
    await seedHeld(ledgerPath, { held: false })
    const state = await getOnboardingState()
    const outcome = await recordSellDecision(state, RC, { trigger: 'valuation_inverted' }, priceDeps(90))
    expect(outcome.status).toBe('not_a_held_position')

    const store = new SQLiteEventStore(ledgerPath)
    try {
      expect((await store.list()).some((e) => e.event_type === 'holding_sell_review_drafted')).toBe(false)
    } finally {
      store.close()
    }
  })

  it('valuation_inverted with NO sign-off-frozen IV → cannot_assess (a raw price move never sells alone)', async () => {
    await seedHeld(ledgerPath, { withFrozenIv: false })
    const state = await getOnboardingState()
    const outcome = await recordSellDecision(state, RC, { trigger: 'valuation_inverted' }, priceDeps(90))
    expect(outcome.status).toBe('cannot_assess')

    const store = new SQLiteEventStore(ledgerPath)
    try {
      expect((await store.list()).some((e) => e.event_type === 'holding_sell_review_drafted')).toBe(false)
    } finally {
      store.close()
    }
  })

  it('rejects an invalid trigger', async () => {
    await seedHeld(ledgerPath)
    const state = await getOnboardingState()
    await expect(
      recordSellDecision(state, RC, { trigger: 'bogus' as never }, priceDeps(90)),
    ).rejects.toThrow(/Invalid minimum-hold trigger/i)
  })
})
