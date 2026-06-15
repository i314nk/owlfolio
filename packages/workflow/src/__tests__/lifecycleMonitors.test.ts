import { describe, expect, it } from 'vitest'

import { buffettMungerStrategy } from '@owlfolio/strategies/buffettMunger'
import { SIZING_PARAMS } from '@owlfolio/strategies/sizingParams'

import {
  evaluateCaseFreshness,
  evaluateWatchlistBuyWindow,
  evaluateShariahRescreen,
  evaluateTrancheTriggers,
  evaluateConcentration,
  evaluateShariahGrace,
  evaluateAnnualRerun,
  buildSellReviewScaffold,
  type MonitorResearchCaseInput,
  type MonitorHoldingInput,
} from '../lifecycleMonitors'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-06-10T00:00:00.000Z')

function freshGateCleanCase(overrides: Partial<MonitorResearchCaseInput> = {}): MonitorResearchCaseInput {
  return {
    research_case_id: 'rc_cprt_1',
    ticker: 'CPRT',
    updated_at: '2026-01-01T00:00:00.000Z', // ~5 months old → fresh
    buy_price_per_share: 100,
    fair_value_per_share: 140,
    moat_class: 'wide',
    verdict_state: 'BUY-WINDOW',
    investment_verdict: 'WATCH',
    shariah_status: 'PASS',
    superseded: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Case freshness (the load-bearing staleness rule)
// ---------------------------------------------------------------------------

describe('evaluateCaseFreshness', () => {
  it('is fresh when the case is younger than 12 months and no newer annual report exists', () => {
    const result = evaluateCaseFreshness(freshGateCleanCase(), { now: NOW })
    expect(result.fresh).toBe(true)
    expect(result.stale_reason).toBeUndefined()
  })

  it('is stale when the case is older than 12 months', () => {
    const result = evaluateCaseFreshness(
      freshGateCleanCase({ updated_at: '2024-12-01T00:00:00.000Z' }),
      { now: NOW },
    )
    expect(result.fresh).toBe(false)
    expect(result.stale_reason).toContain('older than 12 months')
  })

  it('is stale when a newer annual report has been filed since the case', () => {
    const result = evaluateCaseFreshness(freshGateCleanCase(), {
      now: NOW,
      latest_annual_report_filed: '2026-03-01',
    })
    expect(result.fresh).toBe(false)
    expect(result.stale_reason).toContain('annual report')
  })

  it('is stale when the case has been superseded', () => {
    const result = evaluateCaseFreshness(freshGateCleanCase({ superseded: true }), { now: NOW })
    expect(result.fresh).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Gate-clean check
// ---------------------------------------------------------------------------

describe('evaluateWatchlistBuyWindow gate cleanliness', () => {
  it('treats PASS/GATED investment verdict as not gate-clean and suppresses buy', () => {
    const result = evaluateWatchlistBuyWindow(
      freshGateCleanCase({ investment_verdict: 'PASS' }),
      { current_price: 90, now: NOW },
    )
    expect(result.buy_window_alert).toBe(false)
    expect(result.suppressed).toBe(true)
    expect(result.suppression_reason).toContain('gate')
  })

  it('treats a FAIL Shariah status as not gate-clean and suppresses buy', () => {
    const result = evaluateWatchlistBuyWindow(
      freshGateCleanCase({ shariah_status: 'FAIL' }),
      { current_price: 90, now: NOW },
    )
    expect(result.buy_window_alert).toBe(false)
    expect(result.suppressed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Watchlist buy-window (Module 6)
// ---------------------------------------------------------------------------

describe('evaluateWatchlistBuyWindow', () => {
  it('fires a BUY-WINDOW alert on a fresh, gate-clean, cheap case', () => {
    const result = evaluateWatchlistBuyWindow(freshGateCleanCase(), { current_price: 90, now: NOW })
    expect(result.buy_window_alert).toBe(true)
    expect(result.suppressed).toBe(false)
    // 10% below the $100 buy price.
    expect(result.discount_to_buy_pct).toBeCloseTo(10, 5)
    expect(result.is_observation).toBe(true)
    expect(result.is_recommendation).toBe(false)
  })

  it('fires at exactly the buy price (price <= buy)', () => {
    const result = evaluateWatchlistBuyWindow(freshGateCleanCase(), { current_price: 100, now: NOW })
    expect(result.buy_window_alert).toBe(true)
    expect(result.discount_to_buy_pct).toBeCloseTo(0, 5)
  })

  it('does NOT fire when price is above the buy price', () => {
    const result = evaluateWatchlistBuyWindow(freshGateCleanCase(), { current_price: 120, now: NOW })
    expect(result.buy_window_alert).toBe(false)
    expect(result.suppressed).toBe(false)
  })

  it('SUPPRESSES the buy alert when the case is stale (>12mo) even though price is cheap', () => {
    const result = evaluateWatchlistBuyWindow(
      freshGateCleanCase({ updated_at: '2024-12-01T00:00:00.000Z' }),
      { current_price: 80, now: NOW },
    )
    expect(result.buy_window_alert).toBe(false)
    expect(result.suppressed).toBe(true)
    expect(result.rerun_needed).toBe(true)
    expect(result.suppression_reason).toContain('stale cheapness is not a signal')
  })

  it('flags re-run-needed when a newer annual report exists and suppresses the buy', () => {
    const result = evaluateWatchlistBuyWindow(freshGateCleanCase(), {
      current_price: 80,
      now: NOW,
      latest_annual_report_filed: '2026-04-01',
    })
    expect(result.buy_window_alert).toBe(false)
    expect(result.rerun_needed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Shariah re-screen (quarterly)
// ---------------------------------------------------------------------------

describe('evaluateShariahRescreen', () => {
  const cleanRatios = {
    interest_bearing_debt: 100,
    cash_and_securities: 100,
    total_revenue: 1000,
    market_cap: 1000,
    impermissible_income: 0,
  }

  it('does not flag when ratios remain clean (PASS)', () => {
    const result = evaluateShariahRescreen(cleanRatios)
    expect(result.flagged).toBe(false)
    expect(result.verdict).toBe('PASS')
  })

  it('flags a re-screen on a CONDITIONAL breach but does not propose removal', () => {
    const result = evaluateShariahRescreen({ ...cleanRatios, impermissible_income: 20 })
    expect(result.flagged).toBe(true)
    expect(result.verdict).toBe('CONDITIONAL')
    expect(result.propose_removal).toBe(false)
  })

  it('flags removal on a FAIL breach (debt ratio over threshold)', () => {
    const result = evaluateShariahRescreen({ ...cleanRatios, interest_bearing_debt: 400 })
    expect(result.flagged).toBe(true)
    expect(result.verdict).toBe('FAIL')
    expect(result.propose_removal).toBe(true)
  })

  it('is not computable (and not flagged) when inputs are missing', () => {
    const result = evaluateShariahRescreen({ ...cleanRatios, market_cap: 0 })
    expect(result.computable).toBe(false)
    expect(result.flagged).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Holdings tranche triggers (Module 7)
// ---------------------------------------------------------------------------

function openHolding(overrides: Partial<MonitorHoldingInput> = {}): MonitorHoldingInput {
  return {
    holding_id: 'hold_cprt_1',
    ticker: 'CPRT',
    research_case_id: 'rc_cprt_1',
    entry_buy_price: 100,
    market_value: 6000,
    case_updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('evaluateTrancheTriggers', () => {
  it('does not fire above the T2 (-10%) trigger', () => {
    const result = evaluateTrancheTriggers(buffettMungerStrategy, openHolding(), { current_price: 95 })
    expect(result.triggered_tranches).toEqual([])
    expect(result.tranche_review_alert).toBe(false)
  })

  it('fires a thesis-gated T2 review alert at exactly -10%', () => {
    const result = evaluateTrancheTriggers(buffettMungerStrategy, openHolding(), { current_price: 90 })
    expect(result.tranche_review_alert).toBe(true)
    expect(result.triggered_tranches).toContain('T2')
    expect(result.thesis_gated_note).toContain('thesis re-check FIRST')
    expect(result.is_recommendation).toBe(false)
  })

  it('fires both T2 and T3 at -20%', () => {
    const result = evaluateTrancheTriggers(buffettMungerStrategy, openHolding(), { current_price: 80 })
    expect(result.triggered_tranches).toContain('T2')
    expect(result.triggered_tranches).toContain('T3')
  })

  it('does not re-fire a tranche that is already filled', () => {
    const result = evaluateTrancheTriggers(
      buffettMungerStrategy,
      openHolding({ filled_tranche_ids: ['T2'] }),
      { current_price: 90 },
    )
    expect(result.triggered_tranches).not.toContain('T2')
    expect(result.tranche_review_alert).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Concentration (Module 7)
// ---------------------------------------------------------------------------

describe('evaluateConcentration — Phase 5 S3 winner-skew split (appreciation review, NOT the 15% deployment cap)', () => {
  // REGRESSION GUARD against the prior 15% auto-fire behavior (the exact class as the Phase-3
  // superseded→buy flip): the appreciation review now fires at ~22%, NOT at 15%. A winner that
  // appreciates to 18% NAV — between the 15% DEPLOYMENT cap and the ~22% APPRECIATION review — must
  // raise NOTHING (else it looks like an auto-trim-on-price signal, violating "don't move the number").
  it('REGRESSION: a winner at 18% NAV raises NO alert (between the 15% deployment cap and the ~22% review)', () => {
    const result = evaluateConcentration(openHolding({ market_value: 1800 }), { portfolio_nav: 10_000 })
    expect(result.weight_pct).toBeCloseTo(18, 5)
    expect(result.trim_review_alert).toBe(false)
  })

  it('does not alert at or below the ~22% appreciation-review threshold (e.g. 15%, the old deployment cap)', () => {
    const result = evaluateConcentration(openHolding({ market_value: 1500 }), { portfolio_nav: 10_000 })
    expect(result.trim_review_alert).toBe(false)
    expect(result.weight_pct).toBeCloseTo(15, 5)
  })

  it('raises a REVIEW (never a sale) above the ~22% appreciation threshold with a winners-run note', () => {
    const result = evaluateConcentration(openHolding({ market_value: 2500 }), { portfolio_nav: 10_000 })
    expect(result.trim_review_alert).toBe(true)
    expect(result.weight_pct).toBeCloseTo(25, 5)
    expect(result.note).toContain('winners run')
    // NEITHER threshold auto-trims — this is a review-only observation, never a recommendation/sale.
    expect(result.is_recommendation).toBe(false)
    expect(result.is_observation).toBe(true)
  })

  it('the binding point is config-driven: tightening concentration_review_threshold makes 18% fire', () => {
    const result = evaluateConcentration(
      openHolding({ market_value: 1800 }),
      {
        portfolio_nav: 10_000,
        params: { ...SIZING_PARAMS, concentration_review_threshold: 0.15 },
      },
    )
    expect(result.trim_review_alert).toBe(true)
  })

  it('does not alert when NAV is unavailable', () => {
    const result = evaluateConcentration(openHolding(), { portfolio_nav: 0 })
    expect(result.trim_review_alert).toBe(false)
    expect(result.computable).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Shariah grace -> DIVEST (Module 7)
// ---------------------------------------------------------------------------

describe('evaluateShariahGrace', () => {
  const breach = {
    interest_bearing_debt: 400,
    cash_and_securities: 100,
    total_revenue: 1000,
    market_cap: 1000,
    impermissible_income: 0,
  }

  it('starts a 90-day grace period on a fresh breach with no open grace', () => {
    const result = evaluateShariahGrace(openHolding(), {
      ratios: breach,
      now: NOW,
    })
    expect(result.verdict).toBe('FAIL')
    expect(result.start_grace).toBe(true)
    expect(result.divest_required_draft).toBe(false)
    // 90 days after now.
    expect(result.grace_deadline).toBe('2026-09-08')
  })

  it('does not start a new grace if one is already open and not yet expired', () => {
    const result = evaluateShariahGrace(openHolding(), {
      ratios: breach,
      now: NOW,
      open_grace: { started_at: '2026-05-01T00:00:00.000Z', deadline: '2026-07-30' },
    })
    expect(result.start_grace).toBe(false)
    expect(result.divest_required_draft).toBe(false)
  })

  it('emits a DIVEST-REQUIRED draft when an open grace is unresolved past its deadline', () => {
    const result = evaluateShariahGrace(openHolding(), {
      ratios: breach,
      now: NOW,
      open_grace: { started_at: '2026-01-01T00:00:00.000Z', deadline: '2026-04-01' },
    })
    expect(result.divest_required_draft).toBe(true)
    expect(result.start_grace).toBe(false)
    expect(result.draft).toBeDefined()
    expect(result.draft?.is_execution).toBe(false)
    expect(result.draft?.reason_code).toBe('unresolvable_shariah_breach')
  })

  it('does nothing when ratios are clean (no breach)', () => {
    const result = evaluateShariahGrace(openHolding(), {
      ratios: { ...breach, interest_bearing_debt: 100 },
      now: NOW,
    })
    expect(result.verdict).toBe('PASS')
    expect(result.start_grace).toBe(false)
    expect(result.divest_required_draft).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Annual deep re-run (Module 6 + 7)
// ---------------------------------------------------------------------------

describe('evaluateAnnualRerun', () => {
  it('does not flag a case younger than 12 months', () => {
    expect(evaluateAnnualRerun('2026-01-01T00:00:00.000Z', { now: NOW }).rerun_needed).toBe(false)
  })

  it('flags a case older than 12 months', () => {
    expect(evaluateAnnualRerun('2024-12-01T00:00:00.000Z', { now: NOW }).rerun_needed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// SELL-REVIEW scaffold
// ---------------------------------------------------------------------------

describe('buildSellReviewScaffold', () => {
  it('builds a human-authored draft scaffold (never an execution) for a Shariah-grace expiry', () => {
    const draft = buildSellReviewScaffold(openHolding(), {
      reason_code: 'unresolvable_shariah_breach',
      detail: 'AAOIFI debt ratio breached and unresolved past the 90-day grace deadline.',
    })
    expect(draft.is_execution).toBe(false)
    expect(draft.is_recommendation).toBe(false)
    expect(draft.requires_user_authoring).toBe(true)
    expect(draft.reasons).toContain('thesis_broken')
    expect(draft.reasons).toContain('materially_better_opportunity')
    expect(draft.reasons).toContain('unresolvable_shariah_breach')
    // overvaluation alone is flagged as the weakest reason.
    expect(draft.weakest_reason).toBe('overvaluation_alone')
  })

  it('marks the thesis-break detection as a deferred T3 seam for a stubbed thesis-break case', () => {
    const draft = buildSellReviewScaffold(openHolding(), {
      reason_code: 'thesis_broken',
      detail: 'Stubbed thesis-break trigger fired.',
      thesis_break_trigger_stubbed: true,
    })
    expect(draft.deferred_detection_note).toContain('T3')
  })
})
