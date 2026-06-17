import { describe, expect, it } from 'vitest'

import { SELL_PARAMS } from '../sellParams'
import { evaluateValuationInverted } from '../valuationInverted'

// ---------------------------------------------------------------------------
// scope-reframe — the "valuation-inverted" sell is now a LIGHT price-vs-reference SANITY FLAG (advisory),
// NOT a band engine. Pure, deterministic, no I/O, no LLM.
//
// The band/gap decision engine was removed. The sell no longer keys off a frozen sustainable-growth BAND.
// It keys off a frozen REFERENCE fair value (`frozen_reference_fair_value`) + the frozen oe_ps, and fires
// `inverted` (an ADVISORY FLAG feeding the sell decision + the model's hold/trim) when the LIVE price runs
// FAR above what the frozen reference assumed:
//
//   inverted IFF  current_price >= frozen_reference_fair_value × sell_fraction  (default fraction 1.0)
//
// This is arithmetic + a flag + the human boundary — NOT an auto-sell. The human decides the irreversible.
//
// Two hard constraints survive:
//   1. DON'T MOVE THE NUMBER (F.9/F.10). The reference + oe_ps are the SIGN-OFF-FROZEN values — never a
//      recomputed live band (there is none). The function does not even accept a live band.
//   2. HOLD BIAS. The flag fires only at/above the FULL frozen reference (sell_fraction default 1.0 — a
//      HARD threshold, NOT a wider band): biased to HOLD below the reference.
// FAIL-CLOSED: a missing frozen reference / oe_ps → cannot_assess (never `inverted`; never manufactures or
// suppresses a sell).
// ---------------------------------------------------------------------------

const FROZEN_OE_PS = 10
const FROZEN_REFERENCE_FAIR_VALUE = 150

describe('evaluateValuationInverted — light price-vs-frozen-reference sanity FLAG (advisory)', () => {
  it('SELL FLAG (advisory): inverts when the live price runs ABOVE the frozen reference fair value', () => {
    // DIRECTION: a HIGH live price (above the frozen reference) = the market prices the name absurdly rich
    // vs the signed-off reference = a sell-FLAG (advisory, not auto-sell). The human decides.
    const result = evaluateValuationInverted({
      current_price: FROZEN_REFERENCE_FAIR_VALUE * 1.3,
      frozen_reference_fair_value: FROZEN_REFERENCE_FAIR_VALUE,
      frozen_oe_ps: FROZEN_OE_PS,
    })
    expect(result.status).toBe('inverted')
  })

  it('SELL FLAG: inverts when the live price is EXACTLY at the frozen reference (fraction 1.0)', () => {
    const result = evaluateValuationInverted({
      current_price: FROZEN_REFERENCE_FAIR_VALUE,
      frozen_reference_fair_value: FROZEN_REFERENCE_FAIR_VALUE,
      frozen_oe_ps: FROZEN_OE_PS,
    })
    expect(result.status).toBe('inverted')
  })

  it('HOLD: does NOT invert when the live price is BELOW the frozen reference (HOLD bias)', () => {
    const result = evaluateValuationInverted({
      current_price: FROZEN_REFERENCE_FAIR_VALUE * 0.5,
      frozen_reference_fair_value: FROZEN_REFERENCE_FAIR_VALUE,
      frozen_oe_ps: FROZEN_OE_PS,
    })
    expect(result.status).toBe('not_inverted')
  })

  it("DON'T MOVE THE NUMBER: keys ONLY off the frozen reference/oe_ps + live price (no live-band input)", () => {
    // Two calls with IDENTICAL frozen inputs + price must be IDENTICAL. A hypothetical live-band field is
    // NOT part of the signature, so it cannot move the verdict.
    const base = {
      current_price: FROZEN_REFERENCE_FAIR_VALUE * 1.3,
      frozen_reference_fair_value: FROZEN_REFERENCE_FAIR_VALUE,
      frozen_oe_ps: FROZEN_OE_PS,
    }
    const withSpuriousLiveBand = {
      ...base,
      live_band_high: 0.30,
      live_band_low: 0.20,
    } as typeof base
    const a = evaluateValuationInverted(base)
    const b = evaluateValuationInverted(withSpuriousLiveBand)
    expect(b.status).toBe(a.status)
    expect(a.status).toBe('inverted')
  })

  it('FAIL-CLOSED: cannot assess when frozen_reference_fair_value is undefined (never inverts)', () => {
    const result = evaluateValuationInverted({
      current_price: FROZEN_REFERENCE_FAIR_VALUE * 1.3,
      frozen_reference_fair_value: undefined,
      frozen_oe_ps: FROZEN_OE_PS,
    })
    expect(result.status).toBe('cannot_assess')
    expect(result.status).not.toBe('inverted')
  })

  it('FAIL-CLOSED: cannot assess when frozen_oe_ps is missing/≤0 (never inverts)', () => {
    const undef = evaluateValuationInverted({
      current_price: FROZEN_REFERENCE_FAIR_VALUE * 1.3,
      frozen_reference_fair_value: FROZEN_REFERENCE_FAIR_VALUE,
      frozen_oe_ps: undefined,
    })
    expect(undef.status).toBe('cannot_assess')
    const nonpos = evaluateValuationInverted({
      current_price: FROZEN_REFERENCE_FAIR_VALUE * 1.3,
      frozen_reference_fair_value: FROZEN_REFERENCE_FAIR_VALUE,
      frozen_oe_ps: 0,
    })
    expect(nonpos.status).toBe('cannot_assess')
  })

  it('FAIL-CLOSED: cannot assess when the live price is not a usable positive number (never a spurious sell)', () => {
    const result = evaluateValuationInverted({
      current_price: 0,
      frozen_reference_fair_value: FROZEN_REFERENCE_FAIR_VALUE,
      frozen_oe_ps: FROZEN_OE_PS,
    })
    expect(result.status).toBe('cannot_assess')
    expect(result.status).not.toBe('inverted')
  })

  it('reads the threshold fraction from SELL_PARAMS — overriding sell_band_fraction changes behaviour', () => {
    // Default fraction is 1.0, so at-reference inverts (see above). Mutate the config to 1.2 → a price at
    // the reference (150) no longer clears 150×1.2=180 → not_inverted (no code change), proving the constant
    // is single-sourced in SELL_PARAMS.
    const params = { ...SELL_PARAMS, sell_band_fraction: 1.2 }
    const atReference = evaluateValuationInverted({
      current_price: FROZEN_REFERENCE_FAIR_VALUE,
      frozen_reference_fair_value: FROZEN_REFERENCE_FAIR_VALUE,
      frozen_oe_ps: FROZEN_OE_PS,
      params,
    })
    expect(atReference.status).toBe('not_inverted')
    const wellAbove = evaluateValuationInverted({
      current_price: FROZEN_REFERENCE_FAIR_VALUE * 1.3,
      frozen_reference_fair_value: FROZEN_REFERENCE_FAIR_VALUE,
      frozen_oe_ps: FROZEN_OE_PS,
      params,
    })
    expect(wellAbove.status).toBe('inverted')
  })

  it('defaults sell_band_fraction to 1.0', () => {
    expect(SELL_PARAMS.sell_band_fraction).toBe(1.0)
  })
})
