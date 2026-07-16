import { describe, expect, it } from 'vitest'

import { evaluateDeploymentHurdle } from '../deploymentHurdle'

describe('evaluateDeploymentHurdle', () => {
  it('computes hurdle_rate = savings_expected_profit_rate + equity_risk_margin', () => {
    const result = evaluateDeploymentHurdle({
      fcf_yield: 0.1,
      savings_expected_profit_rate: 0.02,
      equity_risk_margin: 0.05,
    })
    expect(result.hurdle_rate).toBeCloseTo(0.07, 10)
  })

  it('clears when OE yield >= savings_rate + equity_risk_margin', () => {
    const result = evaluateDeploymentHurdle({
      fcf_yield: 0.07,
      savings_expected_profit_rate: 0.02,
      equity_risk_margin: 0.05,
    })
    expect(result.clears).toBe(true)
    expect(result.posture).toBe('deploy')
  })

  it('does NOT clear when OE yield only beats zero / the savings rate but not the full hurdle', () => {
    // 6% yield beats both zero AND the 2% savings rate, but is below the 7% hurdle — beating zero is not enough.
    const result = evaluateDeploymentHurdle({
      fcf_yield: 0.06,
      savings_expected_profit_rate: 0.02,
      equity_risk_margin: 0.05,
    })
    expect(result.clears).toBe(false)
  })

  it('CASH-IS-CORRECT framing: a non-clearing candidate is hold_in_savings (CORRECT posture), not a warning/error', () => {
    const result = evaluateDeploymentHurdle({
      fcf_yield: 0.03,
      savings_expected_profit_rate: 0.02,
      equity_risk_margin: 0.05,
    })
    expect(result.clears).toBe(false)
    // The no-deploy outcome is the ACTIVE form of fat-pitch discipline — a positive posture.
    expect(result.posture).toBe('hold_in_savings')
    expect(result.severity).toBe('ok')
    // Never framed as an under-deployment warning/error.
    expect(result.severity).not.toBe('warning')
    expect(result.severity).not.toBe('error')
    // The reason frames holding as correct, not as a shortfall to be fixed.
    expect(result.reason.toLowerCase()).toContain('correct')
  })

  it('clears exactly at the hurdle (>= is inclusive)', () => {
    const result = evaluateDeploymentHurdle({
      fcf_yield: 0.07,
      savings_expected_profit_rate: 0.03,
      equity_risk_margin: 0.04,
    })
    expect(result.clears).toBe(true)
  })

  it('is pure/deterministic — same inputs give the same result', () => {
    const args = { fcf_yield: 0.09, savings_expected_profit_rate: 0.02, equity_risk_margin: 0.05 }
    expect(evaluateDeploymentHurdle(args)).toEqual(evaluateDeploymentHurdle(args))
  })

  it('fails closed (does not deploy) on non-finite OE yield', () => {
    const result = evaluateDeploymentHurdle({
      fcf_yield: Number.NaN,
      savings_expected_profit_rate: 0.02,
      equity_risk_margin: 0.05,
    })
    expect(result.clears).toBe(false)
    expect(result.posture).toBe('hold_in_savings')
    expect(result.severity).toBe('ok')
  })
})
