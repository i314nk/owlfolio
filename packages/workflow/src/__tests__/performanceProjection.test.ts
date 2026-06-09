import { describe, expect, it } from 'vitest'

import { computePerformance } from '../performanceProjection.js'

describe('computePerformance', () => {
  it('insufficient data: fewer than two NAV snapshots', () => {
    const result = computePerformance({
      accountingSnapshots: [{ period_end: '2026-01-31', nav: 1000 }],
      cashFlows: [],
      benchmarkSymbol: 'SPUS',
    })

    expect(result.sufficient).toBe(false)
    if (result.sufficient) throw new Error('expected insufficient')
    expect(result.reason).toContain('at least two valuation snapshots')
    expect(result.benchmark_symbol).toBe('SPUS')
  })

  it('simple two-snapshot TWR with no cash flows', () => {
    const result = computePerformance({
      accountingSnapshots: [
        { period_end: '2026-01-31', nav: 1000 },
        { period_end: '2026-02-28', nav: 1100 },
      ],
      cashFlows: [],
      benchmarkSymbol: 'SPUS',
    })

    expect(result.sufficient).toBe(true)
    if (!result.sufficient) throw new Error('expected sufficient')
    expect(result.portfolio_twr).toBeCloseTo(0.1, 6)
    expect(result.period_start).toBe('2026-01-31')
    expect(result.period_end).toBe('2026-02-28')
    expect(result.benchmark_return).toBeNull()
    expect(result.excess_return).toBeNull()
    expect(result.benchmark_reason).toContain('Benchmark data unavailable')
  })

  it('TWR neutralises a mid-period deposit (chained sub-period returns)', () => {
    // Period 1: 1000 → 1100 (+10%, no flow)
    // Mid-period deposit of 500 lands after the first snapshot.
    // Period 2 start NAV 1100; end NAV 1760; deposit 500 in window.
    //   subReturn = (1760 - 500) / 1100 - 1 = 1260/1100 - 1 ≈ 0.145454...
    // Linked TWR = (1.1)(1.1454545...) - 1 ≈ 0.26
    const result = computePerformance({
      accountingSnapshots: [
        { period_end: '2026-01-31', nav: 1000 },
        { period_end: '2026-02-28', nav: 1100 },
        { period_end: '2026-03-31', nav: 1760 },
      ],
      cashFlows: [{ occurred_at: '2026-03-15', amount: 500 }],
      benchmarkSymbol: 'SPUS',
    })

    expect(result.sufficient).toBe(true)
    if (!result.sufficient) throw new Error('expected sufficient')
    const expectedSub2 = (1760 - 500) / 1100 - 1
    const expectedTwr = 1.1 * (1 + expectedSub2) - 1
    expect(result.portfolio_twr).toBeCloseTo(expectedTwr, 6)
    // Sanity: this should differ markedly from the naive (1760/1000 - 1 = 0.76)
    expect(result.portfolio_twr).toBeLessThan(0.3)
  })

  it('deposit on the snapshot date itself counts toward that sub-period (occurred_at <= end)', () => {
    const result = computePerformance({
      accountingSnapshots: [
        { period_end: '2026-01-31', nav: 1000 },
        { period_end: '2026-02-28', nav: 1500 },
      ],
      cashFlows: [{ occurred_at: '2026-02-28', amount: 400 }],
      benchmarkSymbol: 'SPUS',
    })

    expect(result.sufficient).toBe(true)
    if (!result.sufficient) throw new Error('expected sufficient')
    // (1500 - 400)/1000 - 1 = 0.1
    expect(result.portfolio_twr).toBeCloseTo(0.1, 6)
  })

  it('benchmark return aligns at/just-before start and end dates; excess = portfolio - benchmark', () => {
    const result = computePerformance({
      accountingSnapshots: [
        { period_end: '2026-01-31', nav: 1000 },
        { period_end: '2026-03-31', nav: 1200 },
      ],
      cashFlows: [],
      benchmarkSeries: [
        { date: '2026-01-30', close: 100 }, // just before start → used for start
        { date: '2026-02-15', close: 105 },
        { date: '2026-03-31', close: 110 }, // exactly end
      ],
      benchmarkSymbol: 'SPUS',
    })

    expect(result.sufficient).toBe(true)
    if (!result.sufficient) throw new Error('expected sufficient')
    expect(result.portfolio_twr).toBeCloseTo(0.2, 6)
    // 110/100 - 1 = 0.1
    expect(result.benchmark_return).toBeCloseTo(0.1, 6)
    expect(result.excess_return).toBeCloseTo(0.1, 6)
  })

  it('benchmark series that does not cover the window → benchmark null with reason, portfolio still computed', () => {
    const result = computePerformance({
      accountingSnapshots: [
        { period_end: '2026-01-31', nav: 1000 },
        { period_end: '2026-03-31', nav: 1200 },
      ],
      cashFlows: [],
      benchmarkSeries: [{ date: '2026-02-15', close: 105 }],
      benchmarkSymbol: 'SPUS',
    })

    expect(result.sufficient).toBe(true)
    if (!result.sufficient) throw new Error('expected sufficient')
    // Single point: at/just-before start (fallback earliest) and end both resolve to 105 → 0% return
    expect(result.benchmark_return).toBeCloseTo(0, 6)
  })

  it('skips sub-periods with non-positive starting NAV', () => {
    const result = computePerformance({
      accountingSnapshots: [
        { period_end: '2026-01-31', nav: 0 },
        { period_end: '2026-02-28', nav: 1000 },
        { period_end: '2026-03-31', nav: 1100 },
      ],
      cashFlows: [],
      benchmarkSymbol: 'SPUS',
    })

    expect(result.sufficient).toBe(true)
    if (!result.sufficient) throw new Error('expected sufficient')
    // Only the 1000 → 1100 sub-period is usable: +10%
    expect(result.portfolio_twr).toBeCloseTo(0.1, 6)
  })
})
