import { describe, expect, it } from 'vitest'
import { buffettMungerStrategy } from '../buffettMunger'
import { evaluateGates } from '../evaluateGates'

describe('Buffett-Munger default strategy', () => {
  it('defines the default core policy', () => {
    expect(buffettMungerStrategy.id).toBe('buffett-munger')
    expect(buffettMungerStrategy.certification_status).toBe('draft')
    expect(buffettMungerStrategy.shariah.required).toBe(true)
    expect(buffettMungerStrategy.research.required_specialists.map((s) => s.id)).toEqual(['moat', 'financials', 'risk', 'management', 'valuation', 'synthesis'])
    expect(buffettMungerStrategy.valuation.hurdle_rates).toEqual({ inevitable: 0.12, monopoly: 0.13, wide_moat: 0.15 })
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
