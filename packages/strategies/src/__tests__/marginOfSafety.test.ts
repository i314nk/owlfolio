import { describe, expect, it } from 'vitest'
import { marginOfSafetyForMoat, widenedMarginOfSafety, buffettMungerStrategy } from '../buffettMunger'

// Phase 1.6: ONE end-stage margin-of-safety knob. The base floor is the moat-tiered value; it WIDENS
// (toward a cap, ~0.50) with the documented inputs: high terminal-value share, low maint-capex confidence,
// weak moat durability (above-GDP growth), sensitivity dispersion (when available). The 18× cap is gone
// from here (it is a surfaced cap_exceeded flag in twoStageValuation).
describe('widenedMarginOfSafety (Phase 1.6 — single conservatism knob with widening)', () => {
  it('returns the moat base floor when no widening inputs are present', () => {
    const base = marginOfSafetyForMoat(buffettMungerStrategy, 'monopoly') // 0.15
    const r = widenedMarginOfSafety(buffettMungerStrategy, { moat_class: 'monopoly' })
    expect(r.margin_of_safety).toBeCloseTo(base, 10)
    expect(r.widened).toBe(false)
    expect(r.widening_reasons).toEqual([])
  })

  it('widens for a high terminal-value share (> flag threshold)', () => {
    const base = marginOfSafetyForMoat(buffettMungerStrategy, 'wide') // 0.25
    const r = widenedMarginOfSafety(buffettMungerStrategy, { moat_class: 'wide', terminal_value_pct_of_iv: 0.80 })
    expect(r.margin_of_safety).toBeGreaterThan(base)
    expect(r.widened).toBe(true)
    expect(r.widening_reasons.join(' ')).toMatch(/terminal/i)
  })

  it('widens for low maintenance-capex confidence', () => {
    const r = widenedMarginOfSafety(buffettMungerStrategy, { moat_class: 'wide', low_maint_capex_confidence: true })
    expect(r.widened).toBe(true)
    expect(r.widening_reasons.join(' ')).toMatch(/maintenance|maint/i)
  })

  it('widens for weak moat durability (above-GDP growth = a moat-durability claim)', () => {
    const r = widenedMarginOfSafety(buffettMungerStrategy, { moat_class: 'wide', weak_moat_durability: true })
    expect(r.widened).toBe(true)
    expect(r.widening_reasons.join(' ')).toMatch(/moat|durab/i)
  })

  it('stacks multiple widening inputs but never exceeds the ~0.50 cap', () => {
    const r = widenedMarginOfSafety(buffettMungerStrategy, {
      moat_class: 'wide',
      terminal_value_pct_of_iv: 0.90,
      low_maint_capex_confidence: true,
      weak_moat_durability: true,
      sensitivity_dispersion: 0.9,
    })
    expect(r.margin_of_safety).toBeLessThanOrEqual(0.50 + 1e-9)
    expect(r.margin_of_safety).toBeGreaterThan(marginOfSafetyForMoat(buffettMungerStrategy, 'wide'))
    expect(r.widening_reasons.length).toBeGreaterThanOrEqual(2)
  })
})
