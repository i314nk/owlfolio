import { describe, expect, it } from 'vitest'

import { buffettMungerStrategy, discountRate, twoStageValuation } from '../buffettMunger'
import { SELL_PARAMS } from '../sellParams'
import { evaluateValuationInverted } from '../valuationInverted'
import { VALUATION_PARAMS } from '../valuationParams'

// ---------------------------------------------------------------------------
// valuation-core revision — the "valuation-inverted" sell trigger, REKEYED to implied-growth-vs-FROZEN-band
// (the MIRROR of the reverse-DCF-vs-band BUY). Pure, deterministic, no I/O, no LLM.
//
// A held name's margin of safety is gone when the market now implies growth ABOVE what the business can
// sustain. The trigger solves the market-IMPLIED growth off the LIVE price against the SIGN-OFF-FROZEN
// band/oe_ps, and fires `inverted` when `implied_growth ≥ frozen_band_high × sell_band_fraction`.
//
// Two hard constraints encoded here:
//   1. DON'T MOVE THE NUMBER (F.9/F.10). The band/oe_ps the implied growth is solved against are the
//      SIGN-OFF-FROZEN values — never a recomputed LIVE band. The function does not even accept a live band.
//   2. PABRAI RECANT. The trigger fires only at/above the FULL frozen band ceiling (sell_band_fraction,
//      default 1.0 — a HARD threshold, NOT a wider band): biased to HOLD below the ceiling.
// FAIL-CLOSED: a missing frozen band/oe_ps, or an implied growth that cannot be solved → cannot_assess
// (never manufactures or suppresses a sell).
// ---------------------------------------------------------------------------

// A reference OE/share and the forward FV at a given near-term growth (against the FROZEN params). We build
// LIVE prices from this so a chosen price implies a known growth off the frozen oe_ps. This MIRRORS the
// forward valuation the reverse-DCF inverts — it is test scaffolding, not a live band.
const FROZEN_OE_PS = 10
const DISCOUNT = discountRate(buffettMungerStrategy)
const fvAt = (g: number): number =>
  twoStageValuation({
    oe_ps: FROZEN_OE_PS,
    g,
    terminal_g: VALUATION_PARAMS.terminal_growth,
    discount: DISCOUNT,
    ceiling_multiple: VALUATION_PARAMS.fv_cap_multiple,
    absurd_multiple: VALUATION_PARAMS.fv_absurd_multiple,
    horizon: VALUATION_PARAMS.stage1_horizon,
    fade_years: VALUATION_PARAMS.growth_fade_years,
  }).fair_value as number

describe('evaluateValuationInverted — implied-growth-vs-FROZEN-band (mirror of the BUY)', () => {
  it('SELL: inverts when the live price implies growth ABOVE the frozen band ceiling (margin gone)', () => {
    // frozen_band_high 0.10; a HIGH live price implies ~0.12 growth off the frozen oe_ps → 0.12 ≥ 0.10.
    // DIRECTION: high implied growth = the market prices growth above the sustainable ceiling = overvalued
    // = sell-signal. This is the mirror of the BUY (low implied below the band = cheap).
    const result = evaluateValuationInverted({
      current_price: fvAt(0.12),
      frozen_band_high: 0.10,
      frozen_oe_ps: FROZEN_OE_PS,
    })
    expect(result.status).toBe('inverted')
    expect(result.implied_growth).toBeCloseTo(0.12, 3)
  })

  it('SELL: inverts when the implied growth is EXACTLY at the frozen band ceiling (fraction 1.0)', () => {
    const result = evaluateValuationInverted({
      current_price: fvAt(0.10),
      frozen_band_high: 0.10,
      frozen_oe_ps: FROZEN_OE_PS,
    })
    expect(result.status).toBe('inverted')
    expect(result.implied_growth).toBeCloseTo(0.10, 3)
  })

  it('HOLD: does NOT invert when the implied growth is BELOW the frozen band ceiling (HOLD bias)', () => {
    // A lower live price implies ~0.05 growth < 0.10 ceiling → still held (margin of safety intact).
    const result = evaluateValuationInverted({
      current_price: fvAt(0.05),
      frozen_band_high: 0.10,
      frozen_oe_ps: FROZEN_OE_PS,
    })
    expect(result.status).toBe('not_inverted')
    expect(result.implied_growth).toBeCloseTo(0.05, 3)
  })

  it("DON'T MOVE THE NUMBER: keys ONLY off the frozen band/oe_ps + live price (no live-band input)", () => {
    // Two calls with IDENTICAL frozen inputs + price must be IDENTICAL. A hypothetical live-band field is
    // NOT part of the signature, so it cannot affect the result; we assert the function ignores any extra
    // property and that the result depends purely on (price, frozen_band_high, frozen_oe_ps).
    const base = {
      current_price: fvAt(0.12),
      frozen_band_high: 0.10,
      frozen_oe_ps: FROZEN_OE_PS,
    }
    const withSpuriousLiveBand = {
      ...base,
      // A "live band" the caller might wrongly try to pass — it must NOT move the verdict.
      live_band_high: 0.30,
      live_band_low: 0.20,
    } as typeof base
    const a = evaluateValuationInverted(base)
    const b = evaluateValuationInverted(withSpuriousLiveBand)
    expect(b.status).toBe(a.status)
    expect(b.implied_growth).toBe(a.implied_growth)
    expect(a.status).toBe('inverted')
  })

  it('FAIL-CLOSED: cannot assess when frozen_band_high is undefined (never inverts)', () => {
    const result = evaluateValuationInverted({
      current_price: fvAt(0.12),
      frozen_band_high: undefined,
      frozen_oe_ps: FROZEN_OE_PS,
    })
    expect(result.status).toBe('cannot_assess')
    expect(result.implied_growth).toBeUndefined()
  })

  it('FAIL-CLOSED: cannot assess when frozen_oe_ps is missing/≤0 (never inverts)', () => {
    const undef = evaluateValuationInverted({
      current_price: fvAt(0.12),
      frozen_band_high: 0.10,
      frozen_oe_ps: undefined,
    })
    expect(undef.status).toBe('cannot_assess')
    const nonpos = evaluateValuationInverted({
      current_price: fvAt(0.12),
      frozen_band_high: 0.10,
      frozen_oe_ps: 0,
    })
    expect(nonpos.status).toBe('cannot_assess')
  })

  it('FAIL-CLOSED: cannot assess when the implied growth is not solvable (never a spurious sell)', () => {
    // A non-finite / ≤0 live price makes the reverse-DCF not-computable → cannot_assess, never inverted.
    const result = evaluateValuationInverted({
      current_price: 0,
      frozen_band_high: 0.10,
      frozen_oe_ps: FROZEN_OE_PS,
    })
    expect(result.status).toBe('cannot_assess')
    expect(result.implied_growth).toBeUndefined()
  })

  it('reads the threshold fraction from SELL_PARAMS — overriding sell_band_fraction changes behaviour', () => {
    // Default fraction is 1.0, so at-ceiling inverts (see above). Mutate the config to 1.2 → an implied
    // growth at the band ceiling (0.10) no longer clears 0.10×1.2=0.12 → not_inverted (no code change),
    // proving the constant is single-sourced in SELL_PARAMS.
    const params = { ...SELL_PARAMS, sell_band_fraction: 1.2 }
    const atCeiling = evaluateValuationInverted({
      current_price: fvAt(0.10),
      frozen_band_high: 0.10,
      frozen_oe_ps: FROZEN_OE_PS,
      params,
    })
    expect(atCeiling.status).toBe('not_inverted')
    const wellAbove = evaluateValuationInverted({
      current_price: fvAt(0.12),
      frozen_band_high: 0.10,
      frozen_oe_ps: FROZEN_OE_PS,
      params,
    })
    expect(wellAbove.status).toBe('inverted')
  })

  it('defaults sell_band_fraction to 1.0', () => {
    expect(SELL_PARAMS.sell_band_fraction).toBe(1.0)
  })
})
