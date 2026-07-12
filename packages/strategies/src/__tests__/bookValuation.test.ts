import { describe, expect, it } from 'vitest'
import { fcfImpliedExitMultiple, fcfImpliedGrowth, fcfIntrinsicValuePerShare, resolveExitMultiple } from '../bookValuation'
import { VALUATION_PARAMS } from '../valuationParams'

// Phase 4 (book alignment): the book's valuation mechanics — 10y FCF projection, exit-multiple
// terminal, flat required-return discount, net-cash adjustment, 30/50 margins. Pins the owner-locked
// params and the deterministic arithmetic (hand-checked below).

describe('VALUATION_PARAMS — the book-aligned knobs (owner-locked 2026-07-11)', () => {
  it('pins 30% required margin, 50% load-up, 15% default required return, the absurdity guard + 12× fallback', () => {
    expect(VALUATION_PARAMS.required_margin_of_safety).toBe(0.30)
    expect(VALUATION_PARAMS.load_up_margin).toBe(0.50)
    expect(VALUATION_PARAMS.required_return_default).toBe(0.15)
    // Owner rule (2026-07-12): the fixed [8, 20] clamp is retired — the book's band was an example.
    // Only the units-error absurdity guard remains hard.
    expect(VALUATION_PARAMS.exit_multiple_absurd_min).toBe(3)
    expect(VALUATION_PARAMS.exit_multiple_absurd_max).toBe(40)
    expect(VALUATION_PARAMS.exit_multiple_fallback).toBe(12)
    expect(VALUATION_PARAMS.version).toBe('valuation-2026-07-book-alignment-2')
  })
})

describe('resolveExitMultiple — model-judged, comps-anchored, fail-closed on absurdity', () => {
  it('honors a grounded multiple; labels an uncited one model_asserted', () => {
    expect(resolveExitMultiple({ proposed: 18, grounded: true, comps_median: 20 })).toEqual({ multiple: 18, source: 'model_grounded', flags: [] })
    expect(resolveExitMultiple({ proposed: 18, grounded: false, comps_median: 20 })).toEqual({ multiple: 18, source: 'model_asserted', flags: [] })
  })
  it('no fixed clamp — comps-median discipline + the absurdity guard', () => {
    // Owner rule: NO fixed clamp — a judged 35× (inside the absurdity guard) is honored as judged;
    // the discipline is the comps-median check, not a ceiling.
    expect(resolveExitMultiple({ proposed: 35, grounded: true })).toEqual({ multiple: 35, source: 'model_grounded', flags: expect.arrayContaining([expect.stringContaining('comps_unstructured')]) })
    expect(resolveExitMultiple({ proposed: 4, grounded: true, comps_median: 5 })).toEqual({ multiple: 4, source: 'model_grounded', flags: [] })
    // The ABSURDITY guard (units/scale error) still falls back hard.
    expect(resolveExitMultiple({ proposed: 55, grounded: true })).toEqual({ multiple: 12, source: 'fallback', flags: expect.arrayContaining([expect.stringContaining('exit_multiple_absurd')]) })
    // Comps-median self-consistency: choosing ABOVE the model's own named-comps median flags.
    const above = resolveExitMultiple({ proposed: 24, grounded: false, comps_median: 22 })
    expect(above.multiple).toBe(24)
    expect(above.flags.some((f) => f.includes('above_comps_median'))).toBe(true)
  })
  it('falls back to the conservative 12× when absent or invalid', () => {
    expect(resolveExitMultiple({ grounded: false })).toEqual({ multiple: 12, source: 'fallback', flags: [] })
    expect(resolveExitMultiple({ proposed: -3, grounded: true })).toEqual({ multiple: 12, source: 'fallback', flags: [] })
  })
})

describe('fcfIntrinsicValuePerShare — the book steps 1–5 (hand-checked)', () => {
  it("matches the book's lemonade-stand shape: zero growth, r=15%, M=20 → IV/share = FCF/share × (PV annuity + PV exit)", () => {
    // FCF $100M flat, 100M shares, no cash/debt. Hand math: PV(annuity 10y @15%) = 5.0188;
    // PV(20× exit @ yr10) = 20/1.15^10 = 4.9444. IV/share = 1 × (5.0188 + 4.9444) = 9.9631…
    const r = fcfIntrinsicValuePerShare({ fcf_musd: 100, growth: 0, required_return: 0.15, exit_multiple: 20, shares_m: 100 })
    expect(r).toBeDefined()
    if (r === undefined) return
    expect(r.intrinsic_value_per_share).toBeCloseTo(9.963, 2)
    expect(r.pv_stage1_per_share).toBeCloseTo(5.019, 2)
    expect(r.pv_terminal_per_share).toBeCloseTo(4.944, 2)
    expect(r.terminal_value_pct_of_iv).toBeCloseTo(4.944 / 9.963, 3)
  })

  it('applies growth to every projected year (year-1 already grows) and the terminal on year-10 FCF', () => {
    // g=6%, r=15%, M=12, FCF 100, shares 100. fcf10 = 100×1.06^10 = 179.085; terminal = 179.085×12/1.15^10.
    const r = fcfIntrinsicValuePerShare({ fcf_musd: 100, growth: 0.06, required_return: 0.15, exit_multiple: 12, shares_m: 100 })
    expect(r).toBeDefined()
    if (r === undefined) return
    expect(r.pv_terminal_per_share).toBeCloseTo((100 * Math.pow(1.06, 10) * 12) / Math.pow(1.15, 10) / 100, 3)
  })

  it('adjusts for net cash and debt (book step 5), which can push IV below the pre-cash value', () => {
    const base = fcfIntrinsicValuePerShare({ fcf_musd: 100, growth: 0, required_return: 0.15, exit_multiple: 12, shares_m: 100 })!
    const cashRich = fcfIntrinsicValuePerShare({ fcf_musd: 100, growth: 0, required_return: 0.15, exit_multiple: 12, shares_m: 100, cash_musd: 200 })!
    const levered = fcfIntrinsicValuePerShare({ fcf_musd: 100, growth: 0, required_return: 0.15, exit_multiple: 12, shares_m: 100, total_debt_musd: 300 })!
    expect(cashRich.intrinsic_value_per_share).toBeCloseTo(base.intrinsic_value_per_share + 2, 6)
    expect(levered.intrinsic_value_per_share).toBeCloseTo(base.intrinsic_value_per_share - 3, 6)
    expect(levered.net_cash_per_share).toBeCloseTo(-3, 6)
  })

  it('fails closed on non-positive FCF/shares/required return (undefined, never a fabricated value)', () => {
    expect(fcfIntrinsicValuePerShare({ fcf_musd: -5, growth: 0.05, required_return: 0.15, exit_multiple: 12, shares_m: 100 })).toBeUndefined()
    expect(fcfIntrinsicValuePerShare({ fcf_musd: 100, growth: 0.05, required_return: 0, exit_multiple: 12, shares_m: 100 })).toBeUndefined()
    expect(fcfIntrinsicValuePerShare({ fcf_musd: 100, growth: 0.05, required_return: 0.15, exit_multiple: 12, shares_m: 0 })).toBeUndefined()
  })
})

// E2 (owner-locked 2026-07-12): OE is retired — the sanity lenses invert the SAME book model the
// valuation uses. fcfImpliedGrowth = the growth TODAY'S price implies under the book model (round-trips
// with fcfIntrinsicValuePerShare); fcfImpliedExitMultiple = the exit multiple the price demands at the
// horizon given the model's growth (flag input when above the book band).
describe('fcfImpliedGrowth (E2 — reverse of the book model)', () => {
  const base = { fcf_musd: 7837, required_return: 0.15, exit_multiple: 20, cash_musd: 15284, total_debt_musd: 5788, shares_m: 444.803 }

  it('round-trips: the growth implied by the IV computed at g=6% is ~6%', () => {
    const iv = fcfIntrinsicValuePerShare({ ...base, growth: 0.06 })!
    const g = fcfImpliedGrowth({ ...base, price_per_share: iv.intrinsic_value_per_share })
    expect(g).toBeCloseTo(0.06, 3)
  })

  it('a price far above the g-cap solution still solves (high implied growth) and a bargain implies low/negative growth', () => {
    const rich = fcfImpliedGrowth({ ...base, price_per_share: 550 })
    expect(rich).toBeGreaterThan(0.13)
    const cheap = fcfImpliedGrowth({ ...base, price_per_share: 120 })
    expect(cheap).toBeLessThan(0.0)
  })

  it('fails closed on unusable inputs (no FCF, no shares, price at/below the net-cash floor)', () => {
    expect(fcfImpliedGrowth({ ...base, fcf_musd: 0, price_per_share: 300 })).toBeUndefined()
    expect(fcfImpliedGrowth({ ...base, shares_m: 0, price_per_share: 300 })).toBeUndefined()
    // Price below net cash per share (~21.35): no growth (even deeply negative) explains it — undefined.
    expect(fcfImpliedGrowth({ ...base, price_per_share: 5 })).toBeUndefined()
  })
})

describe('fcfImpliedExitMultiple (E2)', () => {
  const base = { fcf_musd: 7837, growth: 0.06, required_return: 0.15, cash_musd: 15284, total_debt_musd: 5788, shares_m: 444.803 }

  it('round-trips: the multiple implied by the IV computed at 20× is ~20', () => {
    const iv = fcfIntrinsicValuePerShare({ ...base, exit_multiple: 20 })!
    const m = fcfImpliedExitMultiple({ ...base, price_per_share: iv.intrinsic_value_per_share })
    expect(m).toBeCloseTo(20, 2)
  })

  it('a rich price implies a multiple above the book band (the flag input)', () => {
    const m = fcfImpliedExitMultiple({ ...base, price_per_share: 550 })
    expect(m).toBeGreaterThan(20)
  })

  it('fails closed on unusable inputs', () => {
    expect(fcfImpliedExitMultiple({ ...base, fcf_musd: 0, price_per_share: 300 })).toBeUndefined()
    expect(fcfImpliedExitMultiple({ ...base, shares_m: -1, price_per_share: 300 })).toBeUndefined()
  })
})
