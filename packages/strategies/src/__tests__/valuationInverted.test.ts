import { describe, expect, it } from 'vitest'

import { SELL_PARAMS } from '../sellParams'
import { evaluateValuationInverted } from '../valuationInverted'

// ---------------------------------------------------------------------------
// Phase 6 S3 — the "valuation-inverted" sell trigger (pure, deterministic, no I/O, no LLM).
//
// The trigger fires when the current price has RISEN to the position's SIGN-OFF-FROZEN undiscounted
// intrinsic value (IV) — the margin of safety is gone. Two hard constraints encoded here:
//   1. The IV is the FROZEN undiscounted IV (given as `frozen_iv`); the function never recomputes a live
//      fair value. The CAUSE is "price reached the frozen IV", with price as the comparison INPUT.
//   2. Pabrai recant: selling winners at 90–95% of IV was his documented biggest mistake. The trigger is
//      a HARD threshold at FULL IV (fraction = 1.0, NOT a band) — biased to HOLD below IV.
// FAIL-CLOSED: a missing/≤0 frozen IV → cannot_assess (never manufactures or suppresses a sell).
// ---------------------------------------------------------------------------

describe('evaluateValuationInverted', () => {
  it('does NOT invert when price is below the frozen IV', () => {
    const result = evaluateValuationInverted({ current_price: 80, frozen_iv: 100 })
    expect(result.status).toBe('not_inverted')
    expect(result.fraction_of_iv).toBeCloseTo(0.8)
  })

  it('inverts when price is EXACTLY at the frozen IV (fraction 1.0)', () => {
    const result = evaluateValuationInverted({ current_price: 100, frozen_iv: 100 })
    expect(result.status).toBe('inverted')
    expect(result.fraction_of_iv).toBeCloseTo(1.0)
  })

  it('inverts when price is above the frozen IV', () => {
    const result = evaluateValuationInverted({ current_price: 120, frozen_iv: 100 })
    expect(result.status).toBe('inverted')
    expect(result.fraction_of_iv).toBeCloseTo(1.2)
  })

  it('does NOT invert at 0.95x IV — the band is CLOSED (encodes the Pabrai recant)', () => {
    // Selling a winner at 90-95% of IV was Pabrai's documented biggest mistake: the trigger must NOT
    // fire below FULL IV. 0.95x stays held.
    const result = evaluateValuationInverted({ current_price: 95, frozen_iv: 100 })
    expect(result.status).toBe('not_inverted')
    expect(result.fraction_of_iv).toBeCloseTo(0.95)
  })

  it('cannot assess when frozen_iv is undefined (fail-closed, never falls back)', () => {
    const result = evaluateValuationInverted({ current_price: 120, frozen_iv: undefined })
    expect(result.status).toBe('cannot_assess')
    expect(result.fraction_of_iv).toBeUndefined()
  })

  it('cannot assess when frozen_iv is <= 0 (fail-closed)', () => {
    const result = evaluateValuationInverted({ current_price: 120, frozen_iv: 0 })
    expect(result.status).toBe('cannot_assess')
  })

  it('reads the threshold fraction from SELL_PARAMS — overriding sell_iv_fraction changes behaviour', () => {
    // Default fraction is 1.0, so at-IV inverts (see above). Mutate the config to 1.1 → at-IV no longer
    // inverts (no code change), proving the constant is single-sourced in SELL_PARAMS.
    const params = { ...SELL_PARAMS, sell_iv_fraction: 1.1 }
    const atIv = evaluateValuationInverted({ current_price: 100, frozen_iv: 100, params })
    expect(atIv.status).toBe('not_inverted')
    const aboveThreshold = evaluateValuationInverted({ current_price: 110, frozen_iv: 100, params })
    expect(aboveThreshold.status).toBe('inverted')
  })

  it('defaults sell_iv_fraction to 1.0', () => {
    expect(SELL_PARAMS.sell_iv_fraction).toBe(1.0)
  })
})
