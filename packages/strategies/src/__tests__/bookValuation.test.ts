import { describe, expect, it } from 'vitest'
import { fcfIntrinsicValuePerShare, resolveExitMultiple } from '../bookValuation'
import { VALUATION_PARAMS } from '../valuationParams'

// Phase 4 (book alignment): the book's valuation mechanics — 10y FCF projection, exit-multiple
// terminal, flat required-return discount, net-cash adjustment, 30/50 margins. Pins the owner-locked
// params and the deterministic arithmetic (hand-checked below).

describe('VALUATION_PARAMS — the book-aligned knobs (owner-locked 2026-07-11)', () => {
  it('pins 30% required margin, 50% load-up, 15% default required return, the 8–20× clamp + 12× fallback', () => {
    expect(VALUATION_PARAMS.required_margin_of_safety).toBe(0.30)
    expect(VALUATION_PARAMS.load_up_margin).toBe(0.50)
    expect(VALUATION_PARAMS.required_return_default).toBe(0.15)
    expect(VALUATION_PARAMS.exit_multiple_min).toBe(8)
    expect(VALUATION_PARAMS.exit_multiple_max).toBe(20)
    expect(VALUATION_PARAMS.exit_multiple_fallback).toBe(12)
    expect(VALUATION_PARAMS.version).toBe('valuation-2026-07-book-alignment-1')
  })
})

describe('resolveExitMultiple — model-judged, clamped, fail-closed', () => {
  it('honors a grounded in-band multiple; labels an uncited one model_asserted', () => {
    expect(resolveExitMultiple({ proposed: 18, grounded: true })).toEqual({ multiple: 18, source: 'model_grounded' })
    expect(resolveExitMultiple({ proposed: 18, grounded: false })).toEqual({ multiple: 18, source: 'model_asserted' })
  })
  it('clamps out-of-band values into [8, 20]', () => {
    expect(resolveExitMultiple({ proposed: 35, grounded: true })).toEqual({ multiple: 20, source: 'model_clamped' })
    expect(resolveExitMultiple({ proposed: 4, grounded: true })).toEqual({ multiple: 8, source: 'model_clamped' })
  })
  it('falls back to the conservative 12× when absent or invalid', () => {
    expect(resolveExitMultiple({ grounded: false })).toEqual({ multiple: 12, source: 'fallback' })
    expect(resolveExitMultiple({ proposed: -3, grounded: true })).toEqual({ multiple: 12, source: 'fallback' })
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
