import { describe, expect, it } from 'vitest'

import { computeMoneyWeightedReturn } from '../mwr.js'

describe('computeMoneyWeightedReturn (IRR / XIRR)', () => {
  it('single buy then ending value one year later → 10% annualized', () => {
    const result = computeMoneyWeightedReturn([
      { occurred_at: '2025-01-01', amount: -1000 },
      { occurred_at: '2026-01-01', amount: 1100 },
    ])
    expect(result.computable).toBe(true)
    if (!result.computable) throw new Error('expected computable')
    // (1100/1000)^(365/365) - 1 = 0.10
    expect(result.mwr).toBeCloseTo(0.1, 6)
  })

  it('two-year hold doubling → ~41.42% annualized IRR', () => {
    const result = computeMoneyWeightedReturn([
      { occurred_at: '2024-01-01', amount: -1000 },
      { occurred_at: '2026-01-01', amount: 2000 },
    ])
    expect(result.computable).toBe(true)
    if (!result.computable) throw new Error('expected computable')
    // 731 days (2024 leap year) → 2^(365/731) - 1 = 0.4135432, pinned to the solver.
    expect(result.mwr).toBeCloseTo(0.4135432, 5)
  })

  it('intermediate dividend inflow lifts the IRR vs price-only', () => {
    // -1000 at t0, +50 dividend mid-year, +1050 ending → IRR pinned.
    const result = computeMoneyWeightedReturn([
      { occurred_at: '2025-01-01', amount: -1000 },
      { occurred_at: '2025-07-01', amount: 50 },
      { occurred_at: '2026-01-01', amount: 1050 },
    ])
    expect(result.computable).toBe(true)
    if (!result.computable) throw new Error('expected computable')
    // Verified numerically (pinned to the bisection solver): ~0.1025216
    expect(result.mwr).toBeCloseTo(0.1025216, 5)
  })

  it('a loss produces a negative IRR', () => {
    const result = computeMoneyWeightedReturn([
      { occurred_at: '2025-01-01', amount: -1000 },
      { occurred_at: '2026-01-01', amount: 800 },
    ])
    expect(result.computable).toBe(true)
    if (!result.computable) throw new Error('expected computable')
    expect(result.mwr).toBeCloseTo(-0.2, 6)
  })

  it('not-computable: fewer than two flows', () => {
    const result = computeMoneyWeightedReturn([{ occurred_at: '2025-01-01', amount: -1000 }])
    expect(result.computable).toBe(false)
    if (result.computable) throw new Error('expected not computable')
    expect(result.reason).toMatch(/at least two/i)
  })

  it('not-computable: all flows same sign (no sign change → no IRR)', () => {
    const result = computeMoneyWeightedReturn([
      { occurred_at: '2025-01-01', amount: -1000 },
      { occurred_at: '2026-01-01', amount: -500 },
    ])
    expect(result.computable).toBe(false)
    if (result.computable) throw new Error('expected not computable')
    expect(result.reason).toMatch(/sign change|no solution|opposing/i)
  })

  it('not-computable: net zero with no real positive-rate solution stays honest', () => {
    const result = computeMoneyWeightedReturn([
      { occurred_at: '2025-01-01', amount: 0 },
      { occurred_at: '2026-01-01', amount: 0 },
    ])
    expect(result.computable).toBe(false)
  })
})
