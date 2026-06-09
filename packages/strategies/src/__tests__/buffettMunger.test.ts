import { describe, expect, it } from 'vitest'
import { buffettMungerStrategy, hurdleRateForMoatClass, moatPassesGate } from '../buffettMunger'
import { evaluateGates } from '../evaluateGates'

describe('Buffett-Munger default strategy', () => {
  it('defines the default core policy', () => {
    expect(buffettMungerStrategy.id).toBe('buffett-munger')
    expect(buffettMungerStrategy.certification_status).toBe('draft')
    expect(buffettMungerStrategy.shariah.required).toBe(true)
    expect(buffettMungerStrategy.research.required_specialists.map((s) => s.id)).toEqual(['moat', 'financials', 'risk', 'management', 'valuation', 'synthesis'])
    expect(buffettMungerStrategy.valuation.hurdle_rates).toEqual({ wide: 0.15, monopoly: 0.12, inevitable: 0.10 })
    expect(buffettMungerStrategy.valuation.min_investable_moat).toBe('wide')
  })

  it('looks up hurdle rate by investable moat class', () => {
    expect(hurdleRateForMoatClass(buffettMungerStrategy, 'wide')).toBe(0.15)
    expect(hurdleRateForMoatClass(buffettMungerStrategy, 'monopoly')).toBe(0.12)
    expect(hurdleRateForMoatClass(buffettMungerStrategy, 'inevitable')).toBe(0.10)
  })

  it('throws for non-investable moat classes (narrow, moderate)', () => {
    expect(() => hurdleRateForMoatClass(buffettMungerStrategy, 'narrow')).toThrow()
    expect(() => hurdleRateForMoatClass(buffettMungerStrategy, 'moderate')).toThrow()
  })

  it('moatPassesGate: wide/monopoly/inevitable pass; narrow/moderate reject', () => {
    expect(moatPassesGate(buffettMungerStrategy, 'wide')).toBe(true)
    expect(moatPassesGate(buffettMungerStrategy, 'monopoly')).toBe(true)
    expect(moatPassesGate(buffettMungerStrategy, 'inevitable')).toBe(true)
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
