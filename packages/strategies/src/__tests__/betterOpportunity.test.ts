import { describe, expect, it } from 'vitest'

import { evaluateBetterOpportunity } from '../betterOpportunity'
import { SELL_PARAMS } from '../sellParams'

// ---------------------------------------------------------------------------
// Phase 6 S4 — the "better opportunity under capital constraint" sell trigger (pure, deterministic).
//
// You'd sell a holding only to FUND a materially better one. This is the most churn-prone of the four
// sell triggers (Buffett/Pabrai: "patient holding dies by a thousand switches") — taxes/frictions plus an
// easy-to-get-wrong comparative judgment. So it carries a HIGH hurdle (better_opportunity_min_margin,
// default 0.05) AND ALWAYS requires human sign-off — there is no mechanical-switch path.
//
//   margin = candidate_oe_yield - held_oe_yield - switching_friction
//   switch_warranted = margin >= params.better_opportunity_min_margin
//   requires_human_signoff = literal true on EVERY return
// ---------------------------------------------------------------------------

describe('evaluateBetterOpportunity', () => {
  it('does NOT warrant a switch when the net margin is below the hurdle', () => {
    // candidate 0.08, held 0.06, friction 0.01 → margin 0.01 < 0.05.
    const result = evaluateBetterOpportunity({
      held_oe_yield: 0.06,
      candidate_oe_yield: 0.08,
      switching_friction: 0.01,
    })
    expect(result.switch_warranted).toBe(false)
    expect(result.margin).toBeCloseTo(0.01)
  })

  it('warrants a switch when the net margin clears the hurdle', () => {
    // candidate 0.14, held 0.05, friction 0.01 → margin 0.08 >= 0.05.
    const result = evaluateBetterOpportunity({
      held_oe_yield: 0.05,
      candidate_oe_yield: 0.14,
      switching_friction: 0.01,
    })
    expect(result.switch_warranted).toBe(true)
    expect(result.margin).toBeCloseTo(0.08)
  })

  it('ALWAYS requires human sign-off — on the NOT-warranted return shape', () => {
    const result = evaluateBetterOpportunity({
      held_oe_yield: 0.06,
      candidate_oe_yield: 0.08,
      switching_friction: 0.01,
    })
    expect(result.switch_warranted).toBe(false)
    expect(result.requires_human_signoff).toBe(true)
  })

  it('ALWAYS requires human sign-off — on the WARRANTED return shape (no mechanical-switch path)', () => {
    const result = evaluateBetterOpportunity({
      held_oe_yield: 0.05,
      candidate_oe_yield: 0.14,
      switching_friction: 0.01,
    })
    expect(result.switch_warranted).toBe(true)
    expect(result.requires_human_signoff).toBe(true)
  })

  it('friction REDUCES the effective margin — higher friction flips warranted → not-warranted', () => {
    // Same yields (candidate 0.14, held 0.05 → gross 0.09). Low friction clears the hurdle; high friction
    // (a heavy tax/spread drag) eats the edge and flips it.
    const low = evaluateBetterOpportunity({
      held_oe_yield: 0.05,
      candidate_oe_yield: 0.14,
      switching_friction: 0.01,
    })
    expect(low.switch_warranted).toBe(true)

    const high = evaluateBetterOpportunity({
      held_oe_yield: 0.05,
      candidate_oe_yield: 0.14,
      switching_friction: 0.06,
    })
    expect(high.switch_warranted).toBe(false)
    expect(high.margin).toBeCloseTo(0.03)
  })

  it('reads the hurdle from SELL_PARAMS — overriding better_opportunity_min_margin moves the boundary', () => {
    // margin 0.03 (candidate 0.10, held 0.06, friction 0.01). Below the default 0.05 hurdle → not
    // warranted; raise the config to 0.02 → the same margin now clears it (proving single-sourcing).
    const args = { held_oe_yield: 0.06, candidate_oe_yield: 0.1, switching_friction: 0.01 }

    const atDefault = evaluateBetterOpportunity(args)
    expect(atDefault.switch_warranted).toBe(false)
    expect(atDefault.margin).toBeCloseTo(0.03)

    const params = { ...SELL_PARAMS, better_opportunity_min_margin: 0.02 }
    const lowered = evaluateBetterOpportunity({ ...args, params })
    expect(lowered.switch_warranted).toBe(true)
  })

  it('defaults better_opportunity_min_margin to 0.05', () => {
    expect(SELL_PARAMS.better_opportunity_min_margin).toBe(0.05)
  })
})
