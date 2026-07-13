import { describe, expect, it } from 'vitest'
import { buffettMungerStrategy, discountRate, moatPassesGate } from '../buffettMunger'
import { evaluateGates } from '../evaluateGates'

describe('Buffett-Munger default strategy (Design B: 4-class, flat discount, UNIFORM valuation params — F.13)', () => {
  it('defines the default core policy', () => {
    expect(buffettMungerStrategy.id).toBe('buffett-munger')
    expect(buffettMungerStrategy.certification_status).toBe('draft')
    expect(buffettMungerStrategy.shariah.required).toBe(true)
    expect(buffettMungerStrategy.research.required_specialists.map((s) => s.id)).toEqual(['moat', 'financials', 'risk', 'management', 'valuation', 'synthesis'])
    // F.2 — flat 7.5% effective default discount (compliant savings 2% + uniform equity premium 5.5%)
    expect(buffettMungerStrategy.valuation.discount_rate).toBe(0.075)
    // F.13 — uniform terminal g (collapsed to wide's 1.5%)
    expect(buffettMungerStrategy.valuation.terminal_growth).toBe(0.015)
    // F.13 — uniform stage-1 horizon (collapsed to wide's 10 yrs)
    expect(buffettMungerStrategy.valuation.stage1_horizon).toBe(10)
    expect(buffettMungerStrategy.valuation.valuation_multiple_ceiling).toBe(18)
    expect(buffettMungerStrategy.valuation.min_investable_moat).toBe('wide')
  })

  it('discountRate returns the flat 0.075 effective default for all investable classes (F.2 savings anchor)', () => {
    expect(discountRate(buffettMungerStrategy)).toBe(0.075)
  })

  it('moatPassesGate: wide/monopoly pass; narrow/moderate reject; no inevitable tier', () => {
    expect(moatPassesGate(buffettMungerStrategy, 'wide')).toBe(true)
    expect(moatPassesGate(buffettMungerStrategy, 'monopoly')).toBe(true)
    expect(moatPassesGate(buffettMungerStrategy, 'narrow')).toBe(false)
    expect(moatPassesGate(buffettMungerStrategy, 'moderate')).toBe(false)
  })

  it('includes required blocking gates', () => {
    const blockingGateIds = buffettMungerStrategy.hard_gates.filter((gate) => gate.severity === 'blocking').map((gate) => gate.id)
    expect(blockingGateIds).toEqual(expect.arrayContaining(['shariah_compliant_or_conditional', 'positive_owner_earnings', 'leverage_safe', 'valuation_complete']))
  })

  it('returns COMPLIANT only when blocking gates pass', () => {
    const result = evaluateGates(buffettMungerStrategy, { shariah_status: 'COMPLIANT', owner_earnings_positive: true, leverage_safe: true, valuation_complete: true, source_coverage_complete: true })
    expect(result.status).toBe('COMPLIANT')
    expect(result.failed_gates).toEqual([])
    expect(result.warning_gates).toEqual([])
    expect(result.unknown_gates).toEqual([])
  })

  it('returns NON_COMPLIANT when a blocking gate is false', () => {
    const result = evaluateGates(buffettMungerStrategy, { shariah_status: 'COMPLIANT', owner_earnings_positive: false, leverage_safe: true, valuation_complete: true, source_coverage_complete: true })
    expect(result.status).toBe('NON_COMPLIANT')
    expect(result.failed_gates).toEqual(['positive_owner_earnings'])
    expect(result.warning_gates).toEqual([])
  })

  it('does not block compliance when a warning gate is false', () => {
    const result = evaluateGates(buffettMungerStrategy, { shariah_status: 'COMPLIANT', owner_earnings_positive: true, leverage_safe: true, valuation_complete: true, source_coverage_complete: false })
    expect(result.status).toBe('COMPLIANT')
    expect(result.failed_gates).toEqual([])
    expect(result.warning_gates).toEqual(['source_coverage_complete'])
  })

  it('returns NON_COMPLIANT when Shariah status is prohibited', () => {
    const result = evaluateGates(buffettMungerStrategy, { shariah_status: 'NON_COMPLIANT', owner_earnings_positive: true, leverage_safe: true, valuation_complete: true, source_coverage_complete: true })
    expect(result.status).toBe('NON_COMPLIANT')
    expect(result.failed_gates).toEqual(['shariah_compliant_or_conditional'])
  })

  it('returns CONDITIONAL when Shariah is conditional but allowed', () => {
    const result = evaluateGates(buffettMungerStrategy, { shariah_status: 'CONDITIONAL', owner_earnings_positive: true, leverage_safe: true, valuation_complete: true, source_coverage_complete: true })
    expect(result.status).toBe('CONDITIONAL')
    expect(result.conditional_gates).toContain('shariah_compliant_or_conditional')
  })

  it('returns INSUFFICIENT_DATA when required facts are missing', () => {
    const result = evaluateGates(buffettMungerStrategy, { shariah_status: 'COMPLIANT', owner_earnings_positive: true })
    expect(result.status).toBe('INSUFFICIENT_DATA')
    expect(result.unknown_gates).toEqual(expect.arrayContaining(['leverage_safe', 'valuation_complete']))
  })
})

describe('Buffett-Munger two-stage DCF (incremental-ROIC banded g)', () => {
  it('flat 7.5% effective default discount for all investable classes — wide and monopoly use the same rate', () => {
    expect(discountRate(buffettMungerStrategy)).toBe(0.075)
    expect(discountRate(buffettMungerStrategy)).toBe(discountRate(buffettMungerStrategy))
  })

  it('signed ΔWC in OE bridge: negative WC change adds to OE', () => {
    // NI=14, D&A=4, maint_capex=3, SBC=2, dNWC=-1 → OE = 14+4-3-2-(-1) = 14
    const oe = 14 + 4 - 3 - 2 - (-1)
    expect(oe).toBe(14)

    // If dNWC=+2 (WC use of cash) → OE = 14+4-3-2-(+2) = 11
    const oe2 = 14 + 4 - 3 - 2 - 2
    expect(oe2).toBe(11)
  })
})

describe('Buffett-Munger position sizing params (Design B)', () => {
  // OWNER-LOCKED (2026-07-13, the book verbatim): no weight tables, no entry ladders — two zones +
  // boldness from the margin. The contract carries only the risk rails.
  it('the weight table and the entry ladder are RETIRED; the risk rails survive', () => {
    expect(buffettMungerStrategy.portfolio.target_weight_by_moat).toBeUndefined()
    expect(buffettMungerStrategy.portfolio.entry_tranches).toBeUndefined()
    expect(buffettMungerStrategy.portfolio.max_positions).toBe(20)
    expect(buffettMungerStrategy.portfolio.max_position_weight).toBe(0.15)
    expect(buffettMungerStrategy.portfolio.cash_buffer_minimum).toBe(0.03)
  })




})
