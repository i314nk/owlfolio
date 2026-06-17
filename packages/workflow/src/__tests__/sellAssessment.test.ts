import { describe, expect, it } from 'vitest'
import { buffettMungerStrategy, discountRate, twoStageValuation } from '@owlfolio/strategies/buffettMunger'
import { SELL_PARAMS } from '@owlfolio/strategies/sellParams'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'

import { computeSellDecision, type SellAssessmentArgs } from '../sellAssessment'

// ---------------------------------------------------------------------------
// Phase 6 S6 — the SELL ASSEMBLER. Pure orchestrator: composes the held-impairment judgment, the
// minimum-hold clock (S1) + guard (S2), the per-trigger triggers (S3 valuation-inverted, S4
// better-opportunity), the bias caveats (S5), and the SELL-REVIEW scaffold into ONE advisory sell
// decision. All gate-first, fail-closed, PURE. worst_case is ALWAYS attached.
//
// Crux invariant under test: a sell_review NEVER results from a raw price comparison alone. The ONLY
// price-driven sell_review is `valuation_inverted` (valuation-core revision — the MIRROR of the BUY):
// it solves the live price's IMPLIED growth against the SIGN-OFF-FROZEN band/oe_ps and fires only when the
// implied growth reaches the FROZEN sustainable-band ceiling.
// ---------------------------------------------------------------------------

// Reference frozen oe_ps + the forward FV at a near-term growth (against the frozen params) — we build the
// live current_price from this so a chosen price implies a known growth off the frozen oe_ps.
const FROZEN_OE_PS = 10
const FROZEN_BAND_HIGH = 0.10
const fvAt = (g: number): number =>
  twoStageValuation({
    oe_ps: FROZEN_OE_PS,
    g,
    terminal_g: VALUATION_PARAMS.terminal_growth,
    discount: discountRate(buffettMungerStrategy),
    ceiling_multiple: VALUATION_PARAMS.fv_cap_multiple,
    absurd_multiple: VALUATION_PARAMS.fv_absurd_multiple,
    horizon: VALUATION_PARAMS.stage1_horizon,
    fade_years: VALUATION_PARAMS.growth_fade_years,
  }).fair_value as number

// A baseline inside the minimum-hold window (opened recently), at a loss (price < cost). Each test
// perturbs ONE field to exercise a chosen path.
const baseArgs = (): SellAssessmentArgs => ({
  trigger: 'thesis_broke',
  opened_at: '2025-06-01T00:00:00Z', // ~12 mo before `now` → inside the 30-mo window
  now: '2026-06-01T00:00:00Z',
  current_price: 80, // below cost → at_loss
  cost_basis_per_share: 100,
  // fresh impairment judgment inputs
  uncertainty: 'low',
  permanent_loss_risk: 'low',
  quality_verdict_passes: true,
  // valuation-inverted reference (sign-off-frozen band/oe_ps + the derived frozen_iv price anchor)
  frozen_band_high: FROZEN_BAND_HIGH,
  frozen_oe_ps: FROZEN_OE_PS,
  frozen_iv: 150,
  // worst-case (persisted admit floor — Phase 5 floor)
  downside_floor_per_share: 60,
  downside_floor_basis: 'net_cash',
  downside_floor_reliability: 'sound',
})

// Force a particular impairment_call via the grounded inputs (mirrors classifyAdmit's forcing rules).
const permanentInputs = { permanent_loss_risk: 'high' as const, uncertainty: 'high' as const, quality_verdict_passes: false }
const fixableInputs = { permanent_loss_risk: 'low' as const, uncertainty: 'low' as const, quality_verdict_passes: true }
const unresolvedInputs = { permanent_loss_risk: 'medium' as const, uncertainty: 'high' as const, quality_verdict_passes: true }

describe('computeSellDecision — thesis_broke trigger', () => {
  it('permanent impairment, in-window, at-loss → sell_review released THROUGH the window (minimum_hold_released)', () => {
    const result = computeSellDecision({ ...baseArgs(), trigger: 'thesis_broke', ...permanentInputs })
    expect(result.status).toBe('sell_review')
    expect(result.recommendation?.reason_code).toBe('minimum_hold_released')
    expect(result.recommendation?.impairment_call).toBe('permanent_impairment')
    expect(result.recommendation?.minimum_hold_decision).toBe('release_through_guard')
    // worst_case ALWAYS present.
    expect(result.recommendation?.worst_case).toBeDefined()
    expect(result.recommendation?.worst_case.realistic_downside).toBe(40) // 100 - 60
  })

  it('fixable/temporary, in-window, at-loss → hold (the guard held — correct posture)', () => {
    const result = computeSellDecision({ ...baseArgs(), trigger: 'thesis_broke', ...fixableInputs })
    expect(result.status).toBe('hold')
    expect(result.recommendation?.minimum_hold_decision).toBe('hold_blocks_sell')
    expect(result.recommendation?.impairment_call).toBe('fixable_temporary')
    // worst_case + caveats still attached on a hold.
    expect(result.recommendation?.worst_case).toBeDefined()
    // disposition caveat fires on a fixable-temporary loss sale.
    expect(result.recommendation?.bias_caveats.some((c) => c.kind === 'disposition')).toBe(true)
  })

  it('unresolved, in-window, at-loss → escalate_review (the Horsehead trap, never defaulted)', () => {
    const result = computeSellDecision({ ...baseArgs(), trigger: 'thesis_broke', ...unresolvedInputs })
    expect(result.status).toBe('escalate_review')
    expect(result.recommendation?.minimum_hold_decision).toBe('escalate_human_review')
    expect(result.recommendation?.requires_human_signoff).toBe(true)
    expect(result.recommendation?.worst_case).toBeDefined()
  })

  it('permanent impairment but PAST the window (guard inactive) → sell_review with reason_code thesis_broken', () => {
    const result = computeSellDecision({
      ...baseArgs(),
      trigger: 'thesis_broke',
      ...permanentInputs,
      opened_at: '2020-01-01T00:00:00Z', // far outside the 30-mo window
    })
    expect(result.status).toBe('sell_review')
    expect(result.recommendation?.reason_code).toBe('thesis_broken')
    expect(result.recommendation?.minimum_hold_decision).toBe('inactive')
  })

  it('not at a loss + past window (guard inactive) → sell_review thesis_broken', () => {
    const result = computeSellDecision({
      ...baseArgs(),
      trigger: 'thesis_broke',
      ...permanentInputs,
      opened_at: '2020-01-01T00:00:00Z',
      current_price: 200, // above cost → not at loss
    })
    expect(result.status).toBe('sell_review')
    expect(result.recommendation?.reason_code).toBe('thesis_broken')
    expect(result.recommendation?.minimum_hold_decision).toBe('inactive')
  })
})

describe('computeSellDecision — valuation_inverted trigger (implied-growth-vs-FROZEN-band)', () => {
  it('implied growth ≥ frozen band ceiling (a gain, guard inactive) → sell_review (valuation_inverted)', () => {
    const result = computeSellDecision({
      ...baseArgs(),
      trigger: 'valuation_inverted',
      current_price: fvAt(0.12), // implies ~12% growth ≥ band ceiling 10% → inverted; ~210 is a gain vs cost 100
    })
    expect(result.status).toBe('sell_review')
    expect(result.recommendation?.reason_code).toBe('valuation_inverted')
    expect(result.recommendation?.frozen_band_high).toBe(FROZEN_BAND_HIGH)
    expect(result.recommendation?.frozen_oe_ps).toBe(FROZEN_OE_PS)
    expect(result.recommendation?.minimum_hold_decision).toBe('inactive') // not a loss → guard inactive
    expect(result.recommendation?.worst_case).toBeDefined()
  })

  it('implied growth < frozen band ceiling → hold (the market has not priced above the ceiling; no sale)', () => {
    const result = computeSellDecision({
      ...baseArgs(),
      trigger: 'valuation_inverted',
      current_price: fvAt(0.05), // implies ~5% growth < band ceiling 10% → not inverted; ~144 is above cost 100
    })
    expect(result.status).toBe('hold')
    expect(result.recommendation?.worst_case).toBeDefined()
  })

  it('frozen band/oe_ps absent → cannot_assess (price alone cannot drive a sell)', () => {
    const result = computeSellDecision({
      ...baseArgs(),
      trigger: 'valuation_inverted',
      current_price: 999_999, // a huge price move, but no frozen band/oe_ps to solve against
      frozen_band_high: undefined,
      frozen_oe_ps: undefined,
      // not at loss so the guard is inactive and we reach the trigger logic.
      cost_basis_per_share: 100,
    })
    expect(result.status).toBe('cannot_assess')
    // CRITICAL: never a sell_review off a raw price move with no frozen band.
    expect(result.status).not.toBe('sell_review')
  })
})

describe('computeSellDecision — better_opportunity trigger', () => {
  const warranted = { candidate_oe_yield: 0.2, held_oe_yield: 0.1, switching_friction: 0.01 } // net 0.09 ≥ 0.05
  const notWarranted = { candidate_oe_yield: 0.12, held_oe_yield: 0.1, switching_friction: 0.01 } // net 0.01 < 0.05

  it('warranted switch (not at loss, guard inactive) → sell_review requires_human_signoff:true', () => {
    const result = computeSellDecision({
      ...baseArgs(),
      trigger: 'better_opportunity',
      current_price: 120, // gain → guard inactive → reach trigger logic
      ...warranted,
    })
    expect(result.status).toBe('sell_review')
    expect(result.recommendation?.reason_code).toBe('better_opportunity_under_constraint')
    expect(result.recommendation?.requires_human_signoff).toBe(true)
    expect(result.recommendation?.worst_case).toBeDefined()
  })

  it('not warranted → hold', () => {
    const result = computeSellDecision({
      ...baseArgs(),
      trigger: 'better_opportunity',
      current_price: 120,
      ...notWarranted,
    })
    expect(result.status).toBe('hold')
  })

  it('missing candidate/held yields → cannot_assess', () => {
    const result = computeSellDecision({
      ...baseArgs(),
      trigger: 'better_opportunity',
      current_price: 120,
      // no candidate_oe_yield / held_oe_yield supplied
    })
    expect(result.status).toBe('cannot_assess')
  })

  it('inside-window AND at-loss → hold (the guard blocks the churn BEFORE trigger logic)', () => {
    const result = computeSellDecision({
      ...baseArgs(),
      trigger: 'better_opportunity',
      current_price: 80, // at a loss, inside window
      ...warranted, // even a warranted switch is blocked by the guard
    })
    expect(result.status).toBe('hold')
    expect(result.recommendation?.minimum_hold_decision).toBe('hold_blocks_sell')
  })
})

describe('computeSellDecision — original_mistake trigger', () => {
  it('in-window, at-loss → sell_review (release through guard override)', () => {
    const result = computeSellDecision({ ...baseArgs(), trigger: 'original_mistake', ...permanentInputs })
    expect(result.status).toBe('sell_review')
    expect(result.recommendation?.reason_code).toBe('original_mistake')
    expect(result.recommendation?.minimum_hold_decision).toBe('release_through_guard')
    expect(result.recommendation?.worst_case).toBeDefined()
  })

  it('past-window (guard inactive) → sell_review original_mistake', () => {
    const result = computeSellDecision({
      ...baseArgs(),
      trigger: 'original_mistake',
      opened_at: '2020-01-01T00:00:00Z',
    })
    expect(result.status).toBe('sell_review')
    expect(result.recommendation?.reason_code).toBe('original_mistake')
    expect(result.recommendation?.minimum_hold_decision).toBe('inactive')
  })
})

describe('computeSellDecision — structural invariants', () => {
  it('every sell_review carries a non-empty worst_case and a reason_code', () => {
    const sellReviews = [
      computeSellDecision({ ...baseArgs(), trigger: 'thesis_broke', ...permanentInputs }),
      computeSellDecision({ ...baseArgs(), trigger: 'valuation_inverted', current_price: fvAt(0.12) }),
      computeSellDecision({ ...baseArgs(), trigger: 'original_mistake', ...permanentInputs }),
    ].filter((r) => r.status === 'sell_review')
    expect(sellReviews.length).toBeGreaterThan(0)
    for (const r of sellReviews) {
      expect(r.recommendation).toBeDefined()
      expect(r.recommendation?.reason_code).toBeTruthy()
      expect(r.recommendation?.worst_case).toBeDefined()
    }
  })

  it('realistic_downside = max(cost - floor, 0) when the floor is known', () => {
    const result = computeSellDecision({
      ...baseArgs(),
      trigger: 'thesis_broke',
      ...permanentInputs,
      cost_basis_per_share: 100,
      downside_floor_per_share: 70,
    })
    expect(result.recommendation?.worst_case.realistic_downside).toBe(30)
  })

  it('realistic_downside clamps to 0 when the floor exceeds cost', () => {
    const result = computeSellDecision({
      ...baseArgs(),
      trigger: 'thesis_broke',
      ...permanentInputs,
      cost_basis_per_share: 100,
      downside_floor_per_share: 120, // floor above cost
    })
    expect(result.recommendation?.worst_case.realistic_downside).toBe(0)
  })

  it('worst_case is present even when the floor is unknown (no realistic_downside computed)', () => {
    // Build args WITHOUT the floor fields (omitted, not set to undefined — exactOptionalPropertyTypes).
    const { downside_floor_per_share, downside_floor_basis, downside_floor_reliability, ...noFloor } = baseArgs()
    void downside_floor_per_share
    void downside_floor_basis
    void downside_floor_reliability
    const result = computeSellDecision({ ...noFloor, trigger: 'thesis_broke', ...permanentInputs })
    expect(result.recommendation?.worst_case).toBeDefined()
    expect(result.recommendation?.worst_case.realistic_downside).toBeUndefined()
  })

  it('PRICE ALONE CANNOT DRIVE A SELL: a price move with no frozen band/oe_ps and no thesis-break/mistake → cannot_assess, never sell_review', () => {
    const result = computeSellDecision({
      ...baseArgs(),
      trigger: 'valuation_inverted',
      current_price: 10_000_000, // an enormous price move
      frozen_band_high: undefined, // but no signed-off band/oe_ps to solve against
      frozen_oe_ps: undefined,
    })
    expect(result.status).toBe('cannot_assess')
    expect(result.status).not.toBe('sell_review')
  })

  it('reads the threshold from SELL_PARAMS (valuation-inverted fires at the frozen band ceiling × sell_band_fraction)', () => {
    // Default sell_band_fraction is 1.0, so an implied growth exactly at the frozen band ceiling inverts.
    expect(SELL_PARAMS.sell_band_fraction).toBe(1.0)
    const atThreshold = computeSellDecision({
      ...baseArgs(),
      trigger: 'valuation_inverted',
      current_price: fvAt(FROZEN_BAND_HIGH), // implies exactly the band ceiling
    })
    expect(atThreshold.status).toBe('sell_review')
    expect(atThreshold.recommendation?.reason_code).toBe('valuation_inverted')
  })
})
