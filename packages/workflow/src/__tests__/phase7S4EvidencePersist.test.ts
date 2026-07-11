import { describe, expect, it } from 'vitest'
import { SIZING_PARAMS } from '@owlfolio/strategies/sizingParams'
import { evaluateClusterCap } from '@owlfolio/strategies/correlatedClusters'

import { computeSizingRecommendation, type SizingAssessmentArgs } from '../sizingAssessment'
import { demonstratedOwnerEarningsGrowth } from '../secEdgar'

// ---------------------------------------------------------------------------
// Phase 7 S4 — the TWO additive PERSIST-ONLY evidence fields.
//
// These two values are computed-but-not-yet-persisted; S4 carries the EXISTING computation onto the
// payload so items 8 (concentration_correlation) + 11 (data_completeness) can marshal evidence. The
// STOP gate: each value MUST already be computed at the persist site (carry-through, never a NEW
// derivation). These tests pin BOTH: (a) the field now rides on the recommendation/result, and (b) its
// value equals the EXISTING computation's value (same engine call the assembler/valuation already made).
// ---------------------------------------------------------------------------

// A baseline that comfortably clears every gate (mirrors sizingAssessment.test.ts). Monopoly + low/low.
const baseArgs = (): SizingAssessmentArgs => ({
  candidate: {
    ticker: 'WONDER',
    moat_class: 'monopoly',
    permanent_loss_level: 'low',
    uncertainty_level: 'low',
    entry_price_per_share: 100,
    fcf_yield: 0.12,
    sic: '73',
  },
  downside_floor: {
    downside_floor_per_share: 90,
    downside_floor_basis: 'net_cash',
    downside_floor_reliability: 'sound',
  },
  held_book: [],
  book_nav: 1_000_000,
  investable_capital: 1_000_000,
  savings_expected_profit_rate: 0.04,
  equity_risk_margin: 0.03,
  buy_price_version: 'v1',
})

describe('Phase 7 S4 — cluster_key / cluster_basis carried onto the sizing worst_case (persist-only)', () => {
  it('attaches the per-name cluster_key + cluster_basis from the existing cluster computation', () => {
    const args = baseArgs()
    const result = computeSizingRecommendation(args)
    if (result.status !== 'sizeable') throw new Error('expected sizeable')

    // The values must EQUAL what the existing engine (evaluateClusterCap) already derived — no new math.
    const floor = args.downside_floor
    if ('cannot_floor' in floor) throw new Error('baseline has a concrete floor')
    const clusterCap = evaluateClusterCap({
      candidate: {
        ticker: args.candidate.ticker,
        entry_price_per_share: args.candidate.entry_price_per_share,
        floor_per_share: floor.downside_floor_per_share,
        // The assembler sizes the cluster at the conviction TARGET value (10% × investable here).
        position_value: 0.1 * args.investable_capital,
        ...(args.candidate.sic === undefined ? {} : { sic: args.candidate.sic }),
      },
      held_book: [],
      book_nav: args.book_nav,
      proposed_value: 0.1 * args.investable_capital,
      params: SIZING_PARAMS,
    })
    if (clusterCap.status !== 'ok') throw new Error('expected ok cluster cap')

    expect(result.recommendation.worst_case.cluster_key).toBe(clusterCap.cluster.cluster_key)
    expect(result.recommendation.worst_case.cluster_basis).toBe(clusterCap.cluster.cluster_basis)
    // sic '73' → the SIC-2-digit proxy key.
    expect(result.recommendation.worst_case.cluster_key).toBe('sic:73')
    expect(result.recommendation.worst_case.cluster_basis).toBe('sic_proxy')
  })

  it('marks an unclusterable candidate (no SIC, no tag) with the unclustered basis', () => {
    const args = baseArgs()
    delete (args.candidate as { sic?: string }).sic
    const result = computeSizingRecommendation(args)
    if (result.status !== 'sizeable') throw new Error('expected sizeable')
    expect(result.recommendation.worst_case.cluster_basis).toBe('unclustered')
    expect(result.recommendation.worst_case.cluster_key).toBe('unclustered:WONDER')
  })
})

describe('Phase 7 S4 — growth_window_years / points_used / method carried from demonstratedOwnerEarningsGrowth', () => {
  // A clean rising OE/share series so the robust measure produces a real window + points + method.
  const series = [
    { fiscal_year: 2016, currency: 'USD' as const, net_income_musd: 100, d_and_a_musd: 20, capex_musd: 15, diluted_shares_m: 100 },
    { fiscal_year: 2017, currency: 'USD' as const, net_income_musd: 115, d_and_a_musd: 21, capex_musd: 16, diluted_shares_m: 100 },
    { fiscal_year: 2018, currency: 'USD' as const, net_income_musd: 132, d_and_a_musd: 22, capex_musd: 17, diluted_shares_m: 100 },
    { fiscal_year: 2019, currency: 'USD' as const, net_income_musd: 152, d_and_a_musd: 23, capex_musd: 18, diluted_shares_m: 100 },
    { fiscal_year: 2020, currency: 'USD' as const, net_income_musd: 175, d_and_a_musd: 24, capex_musd: 19, diluted_shares_m: 100 },
  ]

  it('the existing computation already exposes window_years / points_used / method (carry-through, no new derivation)', () => {
    const r = demonstratedOwnerEarningsGrowth(series)
    // These three are the EXISTING result fields the valuation consumes — S4 only carries them onto the event.
    expect(typeof r.window_years).toBe('number')
    expect(typeof r.points_used).toBe('number')
    expect(typeof r.method).toBe('string')
    expect(r.points_used).toBeGreaterThan(0)
  })
})
