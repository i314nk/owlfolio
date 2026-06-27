import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { buffettMungerStrategy, discountRate, twoStageValuation } from '@owlfolio/strategies/buffettMunger'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import { createResearchCase, draftDecision } from '@owlfolio/workflow'
import { afterEach, describe, expect, it } from 'vitest'

import { promoteResearchCaseToWatchlist } from '../workflow'

// ---------------------------------------------------------------------------
// scope-reframe — lightening the sell/freeze. The band/gap decision engine was removed, so the sign-off
// freeze no longer records a sustainable-growth BAND. promoteResearchCaseToWatchlist (the admit/sign-off
// path) now freezes a frozen REFERENCE fair value (`frozen_reference_fair_value`) + the normalized
// owner-earnings/share (`frozen_oe_ps`) — and drops `frozen_band_low` / `frozen_band_high`. The reference
// is the forward two-stage fair value off the frozen oe_ps + the sign-off assumed growth (a reference,
// NOT a band). Don't-move-the-number (F.9/F.10): the freeze with its valuation-version provenance.
// FAIL-CLOSED: a case with no oe_ps freezes the reference ABSENT.
//
// Sibling file (NOT workflow.test.ts) per the slice's test-placement guidance.
// ---------------------------------------------------------------------------

/** The expected frozen REFERENCE FV: forward two-stage FV at the sign-off assumed growth off the oe_ps. */
function expectedReferenceFairValue(oe_ps: number, g: number): number {
  return twoStageValuation({
    oe_ps,
    g,
    terminal_g: VALUATION_PARAMS.terminal_growth,
    discount: discountRate(buffettMungerStrategy),
    ceiling_multiple: VALUATION_PARAMS.fv_cap_multiple,
    absurd_multiple: VALUATION_PARAMS.fv_absurd_multiple,
    horizon: VALUATION_PARAMS.stage1_horizon,
    fade_years: VALUATION_PARAMS.growth_fade_years,
  }).fair_value as number
}


function makeState(ledgerPath: string, sourceLedgerPath: string) {
  return {
    config: {
      ...defaultPersonalLocalAppConfig(),
      provider: {
        provider_id: 'mock-provider' as const,
        support_level: 'certified' as const,
        model_id: 'mock-buffett-munger-demo',
      },
      initialized_at: '2026-06-09T12:00:00.000Z',
      ledger_path: ledgerPath,
      source_ledger_path: sourceLedgerPath,
    },
    is_initialized: true,
  }
}

/**
 * Seed a research case whose `buffett_munger_analysis_drafted` carries a `valuation` payload, then a drafted
 * WATCH decision so the case is ready for promotion.
 */
async function seedCase(
  ledgerPath: string,
  valuation: Record<string, unknown> | undefined,
): Promise<{ research_case_id: string }> {
  const researchCaseId = `rc_iv_${Date.now()}`
  const decisionId = `decision_iv_${Date.now()}`
  const sourceIds = ['src_iv_10k_2025', 'src_iv_proxy_2025', 'src_iv_q1_2026']
  const store = new SQLiteEventStore(ledgerPath)
  try {
    const researchCase = await createResearchCase(store, {
      research_case_id: researchCaseId,
      company_id: 'company_iv',
      ticker: 'IVCO',
      strategy_id: 'buffett-munger',
      actor_id: 'user_local',
    })
    await store.append({
      event_id: `evt_buffett_munger_analysis_drafted_${researchCaseId}`,
      event_type: 'buffett_munger_analysis_drafted',
      aggregate_type: 'research_case',
      aggregate_id: researchCaseId,
      correlation_id: researchCaseId,
      actor_type: 'provider',
      actor_id: 'mock-provider',
      payload: {
        research_case_id: researchCaseId,
        company_id: 'company_iv',
        ticker: 'IVCO',
        investment_verdict: 'WATCH',
        shariah_status: 'COMPLIANT',
        ...(valuation === undefined ? {} : { valuation }),
      },
      source_ids: sourceIds,
      created_at: new Date().toISOString(),
      schema_version: 1,
    })
    await draftDecision(store, {
      research_case_id: researchCaseId,
      decision_id: decisionId,
      decision: 'WATCH',
      reason: 'Durable business; wait for a wider margin of safety.',
      causation_id: researchCase.event_id,
      source_ids: sourceIds,
    })
  } finally {
    store.close()
  }
  return { research_case_id: researchCaseId }
}


describe('promoteResearchCaseToWatchlist — freeze a REFERENCE fair value at sign-off (scope-reframe; not a band)', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  it('freezes frozen_reference_fair_value + frozen_oe_ps, distinct from the discounted buy-below; NOT frozen_band_*', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-frozen-ref-'))
    dirs.push(projectDir)
    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
    const state = makeState(ledgerPath, join(projectDir, 'data', 'source-ledger'))

    // band_high 0.10 is the sign-off assumed growth used to derive the REFERENCE FV; oe_ps 10. The discounted
    // buy_price_per_share (150) is frozen separately as locked_buy_below.
    const { research_case_id } = await seedCase(ledgerPath, {
      normalized_owner_earnings_per_share: 10,
      buy_price_per_share: 150,
      verdict_state: { band_low: 0.06, band_high: 0.10 },
    })

    const promoted = await promoteResearchCaseToWatchlist(state, research_case_id)

    expect(promoted.frozen_oe_ps).toBe(10)
    expect(promoted.frozen_iv_valuation_version).toBe(VALUATION_PARAMS.version)
    // The frozen REFERENCE FV is the forward FV at the sign-off assumed growth off the oe_ps, NOT the buy-below.
    expect(promoted.frozen_reference_fair_value).toBeCloseTo(expectedReferenceFairValue(10, 0.10), 6)
    expect(promoted.locked_buy_below).toBe(150)
    expect(promoted.frozen_reference_fair_value).not.toBe(promoted.locked_buy_below)
    // The band fields are DROPPED from the freeze (scope-reframe — the band engine was removed).
    expect((promoted as Record<string, unknown>).frozen_band_low).toBeUndefined()
    expect((promoted as Record<string, unknown>).frozen_band_high).toBeUndefined()

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const [item] = projectWatchlist(await store.list())
      expect(item?.frozen_oe_ps).toBe(10)
      expect(item?.frozen_reference_fair_value).toBeCloseTo(expectedReferenceFairValue(10, 0.10), 6)
      expect(item?.frozen_iv_valuation_version).toBe(VALUATION_PARAMS.version)
      expect(item?.locked_buy_below).toBe(150)
      expect((item as Record<string, unknown> | undefined)?.frozen_band_low).toBeUndefined()
      expect((item as Record<string, unknown> | undefined)?.frozen_band_high).toBeUndefined()
    } finally {
      store.close()
    }
  })

  it('leaves the frozen reference absent when the case has no oe_ps (fail-closed)', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-frozen-ref-none-'))
    dirs.push(projectDir)
    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
    const state = makeState(ledgerPath, join(projectDir, 'data', 'source-ledger'))

    // A valuation WITH a discounted buy-below but NO oe_ps.
    const { research_case_id } = await seedCase(ledgerPath, { buy_price_per_share: 150 })

    const promoted = await promoteResearchCaseToWatchlist(state, research_case_id)

    expect(promoted.frozen_oe_ps).toBeUndefined()
    expect(promoted.frozen_reference_fair_value).toBeUndefined()
    expect(promoted.frozen_iv_valuation_version).toBeUndefined()
    expect(promoted.locked_buy_below).toBe(150)

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const [item] = projectWatchlist(await store.list())
      expect(item?.frozen_oe_ps).toBeUndefined()
      expect(item?.frozen_reference_fair_value).toBeUndefined()
      expect(item?.frozen_iv_valuation_version).toBeUndefined()
      expect(item?.locked_buy_below).toBe(150)
    } finally {
      store.close()
    }
  })

  it('LEGACY TOLERANCE: a legacy event carrying frozen_band_* + frozen_iv still projects (frozen_iv → reference)', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-frozen-legacy-'))
    dirs.push(projectDir)
    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')

    const store = new SQLiteEventStore(ledgerPath)
    try {
      // A legacy watchlist confirmation written BEFORE the scope-reframe: it carries frozen_band_low/high +
      // the legacy frozen_iv price anchor. The projection must TOLERATE it (read via guards, not throw) and
      // map the old frozen_iv onto the new frozen_reference_fair_value.
      await store.append({
        event_id: 'evt_watchlist_draft_confirmed_legacy_wi',
        event_type: 'watchlist_draft_confirmed',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'legacy_wi',
        correlation_id: 'rc_legacy',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          watchlist_item_id: 'legacy_wi',
          research_case_id: 'rc_legacy',
          ticker: 'LEG',
          locked_buy_below: 120,
          frozen_band_low: 0.06,
          frozen_band_high: 0.10,
          frozen_oe_ps: 10,
          frozen_iv: 175,
          frozen_iv_valuation_version: 'valuation-2026-06-cap-1',
          signed_thesis: 'legacy admit',
        },
        source_ids: [],
        created_at: new Date().toISOString(),
        schema_version: 1,
      })

      const [item] = projectWatchlist(await store.list())
      expect(item?.frozen_oe_ps).toBe(10)
      // The legacy frozen_iv maps onto the reference fair value.
      expect(item?.frozen_reference_fair_value).toBe(175)
      expect(item?.locked_buy_below).toBe(120)
    } finally {
      store.close()
    }
  })
})
