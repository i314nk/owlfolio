import { describe, expect, it } from 'vitest'

import { buffettMungerStrategy } from '../buffettMunger'
import { requiredGrowthGap } from '../requiredGrowthGap'

const strategy = buffettMungerStrategy
const g = strategy.valuation.required_growth_gap
const BASE = g.base_gap
const W = g.widening

describe('requiredGrowthGap — the single conservatism knob (growth-rate points)', () => {
  it('base only (no widening flags) → required_gap === base_gap, not widened, empty reasons', () => {
    const result = requiredGrowthGap(strategy, { moat_class: 'wide' })
    expect(result.required_gap).toBe(BASE)
    expect(result.base).toBe(BASE)
    expect(result.widened).toBe(false)
    expect(result.widening_reasons).toEqual([])
  })

  it('high terminal-value share (0.70 > flag 0.65) → base + high_terminal_value_share increment + reason', () => {
    const result = requiredGrowthGap(strategy, {
      moat_class: 'wide',
      terminal_value_pct_of_iv: 0.70,
    })
    expect(result.required_gap).toBeCloseTo(BASE + W.high_terminal_value_share, 12)
    expect(result.widened).toBe(true)
    expect(result.widening_reasons.length).toBe(1)
    expect(result.widening_reasons[0]).toMatch(/terminal-value share/i)
  })

  it('terminal-value share AT the flag (0.65) does NOT widen (strictly greater-than)', () => {
    const result = requiredGrowthGap(strategy, {
      moat_class: 'wide',
      terminal_value_pct_of_iv: strategy.valuation.terminal_value_share_flag,
    })
    expect(result.required_gap).toBe(BASE)
    expect(result.widened).toBe(false)
  })

  it('low maintenance-capex confidence widens by its increment', () => {
    const result = requiredGrowthGap(strategy, {
      moat_class: 'wide',
      low_maint_capex_confidence: true,
    })
    expect(result.required_gap).toBeCloseTo(BASE + W.low_maint_capex_confidence, 12)
    expect(result.widened).toBe(true)
    expect(result.widening_reasons[0]).toMatch(/maintenance-capex/i)
  })

  it('weak moat durability widens by its increment', () => {
    const result = requiredGrowthGap(strategy, {
      moat_class: 'wide',
      weak_moat_durability: true,
    })
    expect(result.required_gap).toBeCloseTo(BASE + W.weak_moat_durability, 12)
    expect(result.widened).toBe(true)
    expect(result.widening_reasons[0]).toMatch(/moat durability/i)
  })

  it('sensitivity_dispersion 0.5 → + sensitivity_dispersion_max × 0.5', () => {
    const result = requiredGrowthGap(strategy, {
      moat_class: 'wide',
      sensitivity_dispersion: 0.5,
    })
    expect(result.required_gap).toBeCloseTo(BASE + W.sensitivity_dispersion_max * 0.5, 12)
    expect(result.widened).toBe(true)
    expect(result.widening_reasons[0]).toMatch(/sensitivity dispersion/i)
  })

  it('sensitivity_dispersion 0 → no add (not widened)', () => {
    const result = requiredGrowthGap(strategy, {
      moat_class: 'wide',
      sensitivity_dispersion: 0,
    })
    expect(result.required_gap).toBe(BASE)
    expect(result.widened).toBe(false)
  })

  it('sensitivity_dispersion undefined → no add (not widened)', () => {
    const result = requiredGrowthGap(strategy, { moat_class: 'wide' })
    expect(result.required_gap).toBe(BASE)
    expect(result.widened).toBe(false)
  })

  it('all factors at once → clamped at base_gap + cap, reasons list all four', () => {
    const result = requiredGrowthGap(strategy, {
      moat_class: 'monopoly',
      terminal_value_pct_of_iv: 0.90,
      low_maint_capex_confidence: true,
      weak_moat_durability: true,
      sensitivity_dispersion: 1,
    })
    // Raw sum exceeds the cap, so the result is clamped.
    const rawSum = BASE
      + W.high_terminal_value_share
      + W.low_maint_capex_confidence
      + W.weak_moat_durability
      + W.sensitivity_dispersion_max
    expect(rawSum).toBeGreaterThan(BASE + W.cap)
    expect(result.required_gap).toBeCloseTo(BASE + W.cap, 12)
    expect(result.widened).toBe(true)
    expect(result.widening_reasons.length).toBe(4)
  })

  // ONE-KNOB SYMMETRY (F.13): conservatism inputs (terminal-value share, maint-capex confidence,
  // moat durability, sensitivity dispersion) live ONLY here — the sustainable-growth BAND engine
  // (sustainableGrowthBand.ts) carries none of them. That enforcement is a dedicated grep test from the
  // band slice (V1); not duplicated here. The decision layer buys when
  // market_implied_growth ≤ band_low − required_gap, so this gap is measured in growth-rate POINTS.
})
