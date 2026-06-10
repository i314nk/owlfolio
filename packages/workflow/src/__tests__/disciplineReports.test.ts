import { describe, expect, it } from 'vitest'

import {
  computeDisciplineReports,
  type DisciplineHoldingInput,
  type GateOverrideCheckInput,
} from '../disciplineReports.js'

describe('computeDisciplineReports', () => {
  const cleanHoldings: DisciplineHoldingInput[] = [
    {
      holding_id: 'h_1',
      ticker: 'AAA',
      fair_value_per_share: 100,
      buy_price_per_share: 70,
      entry_cost_basis_per_share: 68,
      one_year_price_per_share: 92,
      latest_price_per_share: 110,
    },
    {
      holding_id: 'h_2',
      ticker: 'BBB',
      fair_value_per_share: 50,
      buy_price_per_share: 35,
      entry_cost_basis_per_share: 34,
      latest_price_per_share: 40,
    },
  ]

  it('discount-at-purchase table: entry discount to FV + subsequent outcome', () => {
    const report = computeDisciplineReports({ holdings: cleanHoldings, cases: [] })
    const row = report.discount_at_purchase.find((entry) => entry.holding_id === 'h_1')
    expect(row).toBeDefined()
    if (row === undefined) throw new Error('no row')
    // entry 68 vs FV 100 → 0.32 discount
    expect(row.entry_discount_to_fv).toBeCloseTo(0.32, 6)
    // 1yr 92 vs cost 68 → (92-68)/68 = 0.352941
    expect(row.one_year_outcome).toBeCloseTo(0.352941, 5)
    // since: 110 vs 68 → 0.617647
    expect(row.since_outcome).toBeCloseTo(0.617647, 5)
  })

  it('discount-at-purchase: marks not-computable outcome when no price available', () => {
    const report = computeDisciplineReports({
      holdings: [{ holding_id: 'h_x', ticker: 'XXX', fair_value_per_share: 100, buy_price_per_share: 70, entry_cost_basis_per_share: 68 }],
      cases: [],
    })
    const row = report.discount_at_purchase.find((entry) => entry.holding_id === 'h_x')
    if (row === undefined) throw new Error('no row')
    expect(row.since_outcome).toBeUndefined()
    expect(row.one_year_outcome).toBeUndefined()
  })

  it('gate-override count is ZERO on clean data (integrity green)', () => {
    const cases: GateOverrideCheckInput[] = [
      { research_case_id: 'rc_1', investment_verdict: 'BUY', failing_hard_gates: [] },
      { research_case_id: 'rc_2', investment_verdict: 'WATCH', failing_hard_gates: ['moat'] }, // not a BUY → fine
      { research_case_id: 'rc_3', investment_verdict: 'PASS', failing_hard_gates: [] },
    ]
    const report = computeDisciplineReports({ holdings: cleanHoldings, cases })
    expect(report.gate_override.count).toBe(0)
    expect(report.gate_override.integrity_ok).toBe(true)
    expect(report.gate_override.violations).toEqual([])
  })

  it('gate-override count is >0 on a synthesized violation (BUY with a failing hard gate)', () => {
    const cases: GateOverrideCheckInput[] = [
      { research_case_id: 'rc_1', investment_verdict: 'BUY', failing_hard_gates: [] },
      { research_case_id: 'rc_bad', investment_verdict: 'BUY', failing_hard_gates: ['shariah', 'moat'] },
    ]
    const report = computeDisciplineReports({ holdings: cleanHoldings, cases })
    expect(report.gate_override.count).toBe(1)
    expect(report.gate_override.integrity_ok).toBe(false)
    expect(report.gate_override.violations[0]).toMatchObject({
      research_case_id: 'rc_bad',
      failing_hard_gates: ['shariah', 'moat'],
    })
  })

  it('thesis-review latency: days from a thesis-break/staleness trigger to the review', () => {
    const report = computeDisciplineReports({
      holdings: cleanHoldings,
      cases: [],
      thesisReviewLatencies: [
        { holding_id: 'h_1', ticker: 'AAA', triggered_at: '2025-01-01', reviewed_at: '2025-01-15' },
        { holding_id: 'h_2', ticker: 'BBB', triggered_at: '2025-03-01' }, // still open
      ],
    })
    const resolved = report.thesis_review_latency.find((entry) => entry.holding_id === 'h_1')
    if (resolved === undefined) throw new Error('no resolved latency')
    expect(resolved.latency_days).toBe(14)
    expect(resolved.resolved).toBe(true)

    const open = report.thesis_review_latency.find((entry) => entry.holding_id === 'h_2')
    if (open === undefined) throw new Error('no open latency')
    expect(open.resolved).toBe(false)
    expect(open.latency_days).toBeUndefined()
  })
})
