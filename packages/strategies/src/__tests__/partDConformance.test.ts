import { describe, expect, it } from 'vitest'
import {
  buffettMungerStrategy,
  creditedGrowth,
  discountRate,
  stage1HorizonForMoat,
  terminalGrowthForMoat,
  twoStageValuation,
  twoStageFairValuePerShare,
} from '../buffettMunger'
import { VALUATION_PARAMS } from '../valuationParams'

// ---------------------------------------------------------------------------------------------------
// Part-D valuation CONFORMANCE guardrail (strategies side).
//
// This is a deliberate tripwire, not a unit test of new behavior. Each `it` block asserts that one
// step of the authoritative Buffett-Munger valuation method ("Part D", Steps 1–6 + the F.13 uniform
// params rule) is actually WIRED end-to-end. Four Part-D mechanics were recently found absent/degraded
// only by calibration accident; this file exists so the NEXT silently-missing mechanic fails a test on
// purpose. Each assertion names the Part-D step it guards. Fixtures are synthetic + deterministic.
//
// Steps that live in workflow (Step 1 owner-earnings formula, Step 2 robust-growth live/backtest
// consistency) are guarded in the sibling packages/workflow/src/__tests__/partDConformance.test.ts.
// ---------------------------------------------------------------------------------------------------

const strat = buffettMungerStrategy

describe('Part-D conformance: Step 2 — named growth cap (F.3 single_growth_cap)', () => {
  it('credited growth is CLAMPED at single_growth_cap when demonstrated growth exceeds it', () => {
    // Part D Step 2 / F.3: the ONE named forecasting-humility ceiling bites over-optimism only.
    const r = creditedGrowth(strat, { demonstrated_growth: VALUATION_PARAMS.single_growth_cap + 0.40 })
    expect(r.growth).toBeCloseTo(VALUATION_PARAMS.single_growth_cap, 10)
    expect(r.cap_binds).toBe(true)
  })

  it('credited growth BELOW the cap is passed through unchanged (the cap is a backstop, not a haircut)', () => {
    // Part D Step 2: the cap only catches the fluent-but-wrong case; it never lowers an honest sub-cap rate.
    const below = VALUATION_PARAMS.single_growth_cap - 0.05
    const r = creditedGrowth(strat, { demonstrated_growth: below })
    expect(r.growth).toBeCloseTo(below, 10)
    expect(r.cap_binds).toBe(false)
  })

  it('the agent may argue growth LOWER but NEVER higher', () => {
    // Part D Step 2: burden of proof stays on justifying growth; an agent can only reduce the rate.
    const demonstrated = 0.10
    expect(creditedGrowth(strat, { demonstrated_growth: demonstrated, agent_proposed_growth: 0.04 }).growth)
      .toBeCloseTo(0.04, 10)
    expect(creditedGrowth(strat, { demonstrated_growth: demonstrated, agent_proposed_growth: 0.30 }).growth)
      .toBeCloseTo(demonstrated, 10) // higher argument ignored
  })
})

describe('Part-D conformance: Step 2 — linear growth fade to terminal over the trailing years', () => {
  // A high-growth name (g well above terminal). Same inputs except fade_years.
  const base = { oe_ps: 100, g: 0.14, terminal_g: VALUATION_PARAMS.terminal_growth, discount: 0.10, ceiling_multiple: 1e9 }

  it('a faded path produces a STRICTLY LOWER fair value than the no-fade flat path (g ≫ terminal)', () => {
    // Part D Step 2: flat compounding over a long horizon over-values quality compounders; the fade is the
    // forecasting-humility mechanism inside the explicit window.
    const faded = twoStageValuation({ ...base, fade_years: 5, horizon: 10 }).fair_value
    const flat = twoStageValuation({ ...base, fade_years: 0, horizon: 10 }).fair_value
    expect(faded).toBeDefined()
    expect(flat).toBeDefined()
    expect(faded!).toBeLessThan(flat!)
  })

  it('a low/no-growth name (g ≤ terminal) is UNAFFECTED by the fade (never glided upward)', () => {
    // Part D Step 2: fade applies only downward; a 1% grower is not inflated toward the terminal rate.
    const lowG = { oe_ps: 100, g: VALUATION_PARAMS.terminal_growth - 0.005, terminal_g: VALUATION_PARAMS.terminal_growth, discount: 0.10, ceiling_multiple: 1e9 }
    const faded = twoStageValuation({ ...lowG, fade_years: 5, horizon: 10 }).fair_value
    const flat = twoStageValuation({ ...lowG, fade_years: 0, horizon: 10 }).fair_value
    expect(faded).toBeCloseTo(flat!, 6)
  })

  it('config wires growth_fade_years as a scalar (default fade window)', () => {
    // Part D Step 2: the fade window is config-driven (years 6–10 of a 10-yr horizon, F=5).
    expect(VALUATION_PARAMS.growth_fade_years).toBe(5)
    expect(strat.valuation.growth_fade_years).toBe(VALUATION_PARAMS.growth_fade_years)
  })
})

describe('Part-D conformance: Step 3 — discount = compliant savings rate + a UNIFORM equity premium, no moat knob', () => {
  it('discountRate = savings_rate_default + equity_premium when no risk-free rate is supplied (F.2)', () => {
    // Part D Step 3 / F.2: compliant risk-free (savings) anchor + a fixed equity premium; fail-closed to the
    // config default savings rate (Treasury anchor retired — interest-bearing, not compliantly holdable).
    expect(discountRate(strat)).toBeCloseTo(
      strat.valuation.savings_rate_default + strat.valuation.equity_premium,
      10,
    )
  })

  it('a compliant risk-free (savings) override flows through (savings + the same uniform premium)', () => {
    // Part D Step 3 / F.2: the discount tracks the compliant risk-free rate; the premium stays fixed.
    expect(discountRate(strat, 0.025)).toBeCloseTo(0.025 + strat.valuation.equity_premium, 10)
    expect(discountRate(strat, 0.03)).toBeCloseTo(0.03 + strat.valuation.equity_premium, 10)
  })

  it('the discount has NO moat/quality knob (no per-moat parameter; same rate for every business)', () => {
    // Part D Step 3 / G: the single biggest divergence the method expels is a quality-adjusted discount.
    // discountRate takes no moat argument at all, and there is no _by_moat discount table in the config.
    expect(discountRate).toHaveLength(2) // (strategy, riskFreeRate?) — no moat parameter
    expect(Object.keys(VALUATION_PARAMS)).not.toContain('discount_rate_by_moat')
    expect(Object.keys(VALUATION_PARAMS)).not.toContain('equity_premium_by_moat')
  })
})

describe('Part-D conformance: F.13 — uniform valuation params (no per-moat loosening)', () => {
  it('terminalGrowthForMoat returns the SAME value for wide and monopoly (uniform post-F.13)', () => {
    // F.13: the monopoly tier was a relocated quality-knob; collapsed to one scalar.
    expect(terminalGrowthForMoat(strat, 'wide')).toBe(terminalGrowthForMoat(strat, 'monopoly'))
    expect(terminalGrowthForMoat(strat, 'wide')).toBe(VALUATION_PARAMS.terminal_growth)
  })

  it('stage1HorizonForMoat returns the SAME value for wide and monopoly (uniform post-F.13)', () => {
    // F.13: a stronger moat must not silently extend the optimistic-extrapolation horizon.
    expect(stage1HorizonForMoat(strat, 'wide')).toBe(stage1HorizonForMoat(strat, 'monopoly'))
    expect(stage1HorizonForMoat(strat, 'wide')).toBe(VALUATION_PARAMS.stage1_horizon)
  })

  it('each per-moat lookup still THROWS for non-investable moats (narrow, moderate)', () => {
    // F.13: uniform params loosen NOTHING — the investability gate is unchanged; non-investable moats
    // never reach valuation.
    for (const fn of [terminalGrowthForMoat, stage1HorizonForMoat]) {
      expect(() => fn(strat, 'narrow')).toThrow()
      expect(() => fn(strat, 'moderate')).toThrow()
    }
  })

  it('VALUATION_PARAMS exposes SCALAR uniform fields, not _by_moat tables', () => {
    // F.13: the old terminal_growth_by_moat / stage1_horizon_by_moat / margin_of_safety_by_moat tier
    // tables were collapsed to scalars. Their presence would mean a per-moat loosening lever returned.
    expect(typeof VALUATION_PARAMS.terminal_growth).toBe('number')
    expect(typeof VALUATION_PARAMS.stage1_horizon).toBe('number')
    expect(typeof VALUATION_PARAMS.growth_fade_years).toBe('number')
    const keys = Object.keys(VALUATION_PARAMS)
    expect(keys).not.toContain('terminal_growth_by_moat')
    expect(keys).not.toContain('stage1_horizon_by_moat')
    expect(keys).not.toContain('margin_of_safety_by_moat')
  })
})

describe('Part-D conformance: Step 4 — terminal-value share is surfaced + feeds the MoS', () => {
  it('twoStageValuation returns terminal_value_pct_of_iv (the dominant-uncertainty flag)', () => {
    // Part D Step 4: the harness computes + surfaces terminal value as a % of total intrinsic value.
    const r = twoStageValuation({ oe_ps: 100, g: 0.04, terminal_g: 0.025, discount: 0.10, ceiling_multiple: 1e9, horizon: 15 })
    expect(r.terminal_value_pct_of_iv).toBeGreaterThan(0)
    expect(r.terminal_value_pct_of_iv).toBeLessThan(1)
  })

  it('a high-TV case (> terminal_value_share_flag) is detectable', () => {
    // Part D Step 4: when TV share exceeds ~65%, it must be visible (it raises the Step-6 MoS requirement).
    // Low discount headroom over terminal g + low near-term g pushes most of IV into the terminal block.
    const r = twoStageValuation({ oe_ps: 100, g: 0.02, terminal_g: 0.025, discount: 0.06, ceiling_multiple: 1e9, horizon: 10 })
    expect(r.terminal_value_pct_of_iv).toBeGreaterThan(VALUATION_PARAMS.terminal_value_share_flag)
  })
})

describe('Part-D conformance: Step 4/6 — 18× surfaced flag (value kept) vs 100× absurd discard', () => {
  it('cap_exceeded is set and the value is KEPT above fv_cap_multiple × OE (a flag, not a truncation)', () => {
    // Part D Step 4/6: the OE multiple is a SURFACED sanity flag (it widens the MoS), not a silent cut.
    const oe = 20
    const r = twoStageValuation({ oe_ps: oe, g: 0.14, terminal_g: 0.025, discount: 0.10, ceiling_multiple: VALUATION_PARAMS.fv_cap_multiple, horizon: 15 })
    expect(r.cap_exceeded).toBe(true)
    expect(r.fair_value).toBeDefined()
    expect(r.fair_value!).toBeGreaterThan(VALUATION_PARAMS.fv_cap_multiple * oe) // value preserved, not clipped to 18×
  })

  it('a value at/above fv_absurd_multiple × OE is DISCARDED (fair_value undefined, absurd true)', () => {
    // Part D Step 4/6: an absurd multiple signals a units/scale bug (discount ≈ terminal_g) → discard.
    const r = twoStageValuation({ oe_ps: 10, g: 0.20, terminal_g: 0.024, discount: 0.025, ceiling_multiple: VALUATION_PARAMS.fv_cap_multiple, horizon: 15 })
    expect(r.absurd).toBe(true)
    expect(r.fair_value).toBeUndefined()
  })

  it('the legacy scalar twoStageFairValuePerShare still truncates at the ceiling (back-compat)', () => {
    // Part D Step 4: the rich path keeps-and-flags; the legacy scalar path clips for /strategy worked examples.
    const oe = 20
    const fv = twoStageFairValuePerShare({ oe_ps: oe, g: 0.14, terminal_g: 0.025, discount: 0.10, ceiling_multiple: VALUATION_PARAMS.fv_cap_multiple, horizon: 15 })
    expect(fv).toBeCloseTo(VALUATION_PARAMS.fv_cap_multiple * oe, 6)
  })
})
