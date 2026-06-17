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
// valuation-core revision — freezing the sustainable-growth BAND + owner-earnings/share at sign-off.
//
// promoteResearchCaseToWatchlist (the admit/sign-off path) must freeze the case's band edges
// (verdict_state.band_low / band_high) + normalized owner-earnings/share
// (valuation.normalized_owner_earnings_per_share) as `frozen_band_low` / `frozen_band_high` / `frozen_oe_ps`
// — the inputs the rekeyed valuation-inverted SELL keys off (the mirror of the BUY). It also retains a
// DERIVED `frozen_iv` price anchor (the forward two-stage fair value at frozen_band_high off frozen_oe_ps)
// for the anchoring bias guard. Don't-move-the-number (F.9/F.10): all freeze here with their
// valuation-version provenance. FAIL-CLOSED: a case with no band/oe_ps freezes them ABSENT.
//
// Sibling file (NOT workflow.test.ts) per the slice's test-placement guidance.
// ---------------------------------------------------------------------------

/** The expected DERIVED frozen_iv: forward two-stage FV at the frozen band-high off the frozen oe_ps. */
function expectedDerivedFrozenIv(oe_ps: number, band_high: number): number {
  return twoStageValuation({
    oe_ps,
    g: band_high,
    terminal_g: VALUATION_PARAMS.terminal_growth,
    discount: discountRate(buffettMungerStrategy),
    ceiling_multiple: VALUATION_PARAMS.fv_cap_multiple,
    absurd_multiple: VALUATION_PARAMS.fv_absurd_multiple,
    horizon: VALUATION_PARAMS.stage1_horizon,
    fade_years: VALUATION_PARAMS.growth_fade_years,
  }).fair_value as number
}

const HUMAN_SIGNED_THESIS =
  'I am admitting this name: durable franchise, low permanent-loss risk, buying with a margin of safety.'

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
 * Seed a research case whose `buffett_munger_analysis_drafted` carries a `valuation` payload with BOTH the
 * undiscounted fair value and the discounted buy-below (when `valuation` is provided), then a drafted
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
        // COMPLIANT + sourced so the Shariah gate allows the watchlist promotion (mirrors the MSFT setup).
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


describe('promoteResearchCaseToWatchlist — freeze the sustainable-growth band at sign-off (valuation-core revision)', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  it('freezes the band edges + oe_ps, derives frozen_iv from the band, distinct from the discounted buy-below', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-frozen-band-'))
    dirs.push(projectDir)
    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
    const state = makeState(ledgerPath, join(projectDir, 'data', 'source-ledger'))

    // The band (band_low 0.06, band_high 0.10) + oe_ps (10) are the SELL inputs; buy_price_per_share (150)
    // is the MoS-discounted buy-below frozen separately as locked_buy_below.
    const { research_case_id } = await seedCase(ledgerPath, {
      normalized_owner_earnings_per_share: 10,
      buy_price_per_share: 150,
      verdict_state: { band_low: 0.06, band_high: 0.10 },
    })

    const promoted = await promoteResearchCaseToWatchlist(state, research_case_id, HUMAN_SIGNED_THESIS, true)

    expect(promoted.frozen_band_low).toBe(0.06)
    expect(promoted.frozen_band_high).toBe(0.10)
    expect(promoted.frozen_oe_ps).toBe(10)
    expect(promoted.frozen_iv_valuation_version).toBe(VALUATION_PARAMS.version)
    // frozen_iv is DERIVED from the frozen band (forward FV at band_high off oe_ps), NOT the buy-below.
    expect(promoted.frozen_iv).toBeCloseTo(expectedDerivedFrozenIv(10, 0.10), 6)
    expect(promoted.locked_buy_below).toBe(150)
    expect(promoted.frozen_iv).not.toBe(promoted.locked_buy_below)

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const [item] = projectWatchlist(await store.list())
      expect(item?.frozen_band_low).toBe(0.06)
      expect(item?.frozen_band_high).toBe(0.10)
      expect(item?.frozen_oe_ps).toBe(10)
      expect(item?.frozen_iv).toBeCloseTo(expectedDerivedFrozenIv(10, 0.10), 6)
      expect(item?.frozen_iv_valuation_version).toBe(VALUATION_PARAMS.version)
      expect(item?.locked_buy_below).toBe(150)
    } finally {
      store.close()
    }
  })

  it('leaves the frozen band + derived frozen_iv absent when the case has no band/oe_ps (fail-closed)', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-frozen-band-none-'))
    dirs.push(projectDir)
    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
    const state = makeState(ledgerPath, join(projectDir, 'data', 'source-ledger'))

    // A valuation WITH a discounted buy-below but NO band / oe_ps.
    const { research_case_id } = await seedCase(ledgerPath, { buy_price_per_share: 150 })

    const promoted = await promoteResearchCaseToWatchlist(state, research_case_id, HUMAN_SIGNED_THESIS, true)

    // No band/oe_ps → the frozen band fields + the derived frozen_iv are absent (fail-closed); the sell then
    // returns cannot_assess. They must NEVER be backfilled from the discounted buy-below.
    expect(promoted.frozen_band_low).toBeUndefined()
    expect(promoted.frozen_band_high).toBeUndefined()
    expect(promoted.frozen_oe_ps).toBeUndefined()
    expect(promoted.frozen_iv).toBeUndefined()
    expect(promoted.frozen_iv_valuation_version).toBeUndefined()
    expect(promoted.locked_buy_below).toBe(150)

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const [item] = projectWatchlist(await store.list())
      expect(item?.frozen_band_high).toBeUndefined()
      expect(item?.frozen_oe_ps).toBeUndefined()
      expect(item?.frozen_iv).toBeUndefined()
      expect(item?.frozen_iv_valuation_version).toBeUndefined()
      expect(item?.locked_buy_below).toBe(150)
    } finally {
      store.close()
    }
  })
})
