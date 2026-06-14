import { describe, expect, it } from 'vitest'
import { twoStageValuation, twoStageFairValuePerShare, buffettMungerStrategy } from '../buffettMunger'

// Phase 1.5: twoStageValuation also returns terminal_value_pct_of_iv (Gordon terminal ÷ total IV).
// Phase 1.6: the 18× OE cap becomes a SURFACED sanity flag (cap_exceeded), NOT a silent truncation; only
// an absurd-error guard (≥ absurd multiple) discards the value.
describe('twoStageValuation (Phase 1.5 terminal share + Phase 1.6 cap flag)', () => {
  it('returns the same fair value as twoStageFairValuePerShare when the cap does not bind', () => {
    const args = { oe_ps: 18.97, g: 0.03, terminal_g: 0.01, discount: 0.10, ceiling_multiple: 18, horizon: 10 }
    const rich = twoStageValuation(args)
    // Phase 1.6: no silent truncation — fair_value is the RAW two-stage value.
    expect(rich.fair_value).toBeCloseTo(twoStageFairValuePerShare(args), 6)
    expect(rich.cap_exceeded).toBe(false)
  })

  it('surfaces terminal_value_pct_of_iv (terminal ÷ total) in (0,1)', () => {
    const rich = twoStageValuation({ oe_ps: 100, g: 0.04, terminal_g: 0.025, discount: 0.10, ceiling_multiple: 18, horizon: 15 })
    expect(rich.terminal_value_pct_of_iv).toBeGreaterThan(0)
    expect(rich.terminal_value_pct_of_iv).toBeLessThan(1)
    // For the monopoly reference: stage1 986.04, terminal 589.21 → terminal share ≈ 0.374.
    expect(rich.terminal_value_pct_of_iv).toBeCloseTo(589.2131 / 1575.2518, 3)
  })

  it('flags cap_exceeded WITHOUT truncating when raw fair value exceeds the cap multiple (Phase 1.6)', () => {
    // High g drives raw fair value above 18× OE.
    const rich = twoStageValuation({ oe_ps: 20, g: 0.12, terminal_g: 0.025, discount: 0.10, ceiling_multiple: 18, horizon: 15 })
    expect(rich.cap_exceeded).toBe(true)
    // NOT truncated to 18× — the raw value is preserved (the flag carries the conservatism, not a cut).
    expect(rich.fair_value).toBeGreaterThan(18 * 20)
  })

  it('discards only an ABSURD value (≥ absurd multiple) as a units-error guard', () => {
    // discount barely above terminal_g + huge g → an absurd multiple. Guard returns not-computable.
    const rich = twoStageValuation({ oe_ps: 10, g: 0.20, terminal_g: 0.024, discount: 0.025, ceiling_multiple: 18, horizon: 15 })
    expect(rich.absurd).toBe(true)
    expect(rich.fair_value).toBeUndefined()
  })

  it('exposes the absurd-guard multiple at 100× (kept; the 18× hard cap is gone)', () => {
    expect(buffettMungerStrategy.valuation.fv_absurd_multiple).toBe(100)
  })
})
