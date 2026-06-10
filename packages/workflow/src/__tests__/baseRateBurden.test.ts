import { describe, expect, it } from 'vitest'
import { evaluateBaseRateBurden } from '../baseRateBurden'

const structural = [
  { claim: 'Long-term take-or-pay contracts cover 70% of FY2027-2031 revenue (10-K Note 14).', citation_hash: 'sha256:abc' },
  { claim: 'M3/M4 moat rows scored 2: documented +6% price with share gains vs a funded entrant.', citation_hash: 'sha256:def' },
]
const narrative = [
  { claim: 'Strong execution and a great management team.', citation_hash: 'sha256:xyz' },
]

describe('evaluateBaseRateBurden', () => {
  it('flags monopoly + credited_g 4-5% with NO structural justification as base_rate_burden_unmet', () => {
    const result = evaluateBaseRateBurden({
      moat_class: 'monopoly',
      credited_growth_rate: 0.045,
      exceptionality_justifications: [],
    })
    const ids = result.flags.map((f) => f.base_rate_id)
    expect(ids).toContain('monopoly_classification')
    expect(ids).toContain('credited_g_4_5')
    expect(result.flags.every((f) => f.status === 'unmet')).toBe(true)
  })

  it('does NOT flag when a STRUCTURAL exceptionality_justification is present', () => {
    const result = evaluateBaseRateBurden({
      moat_class: 'monopoly',
      credited_growth_rate: 0.045,
      exceptionality_justifications: structural,
    })
    expect(result.flags.every((f) => f.status === 'met')).toBe(true)
    expect(result.unmet_count).toBe(0)
  })

  it('treats inside-view narrative ("strong execution"/"great management") as insufficient → still unmet', () => {
    const result = evaluateBaseRateBurden({
      moat_class: 'monopoly',
      credited_growth_rate: 0.045,
      exceptionality_justifications: narrative,
    })
    expect(result.unmet_count).toBeGreaterThan(0)
    const monopoly = result.flags.find((f) => f.base_rate_id === 'monopoly_classification')
    expect(monopoly?.status).toBe('unmet')
  })

  it('flags >20% ROIC sustained + margin expansion claims', () => {
    const result = evaluateBaseRateBurden({
      moat_class: 'wide',
      credited_growth_rate: 0.02,
      roic_forecast_gt_20: true,
      margin_expansion_claimed: true,
      exceptionality_justifications: [],
    })
    const ids = result.flags.map((f) => f.base_rate_id)
    expect(ids).toContain('roic_gt_20_decade')
    expect(ids).toContain('margin_expansion')
  })

  it('does NOT flag an ordinary wide-moat case at a sub-band growth rate', () => {
    const result = evaluateBaseRateBurden({
      moat_class: 'wide',
      credited_growth_rate: 0.02,
      exceptionality_justifications: [],
    })
    expect(result.flags.length).toBe(0)
    expect(result.unmet_count).toBe(0)
  })

  it('more-exceptional claim needs more structural items: 1 structural item meets margin-expansion but not monopoly', () => {
    const oneStructural = [structural[0]!]
    const result = evaluateBaseRateBurden({
      moat_class: 'monopoly',
      credited_growth_rate: 0.02,
      margin_expansion_claimed: true,
      exceptionality_justifications: oneStructural,
    })
    const monopoly = result.flags.find((f) => f.base_rate_id === 'monopoly_classification')
    const margin = result.flags.find((f) => f.base_rate_id === 'margin_expansion')
    expect(margin?.status).toBe('met')
    expect(monopoly?.status).toBe('unmet')
  })
})
