import { describe, expect, it } from 'vitest'

import { computeReAnalysisDiff } from '../reAnalysisDiff.js'

describe('computeReAnalysisDiff (what changed since last case)', () => {
  const prior = {
    research_case_id: 'rc_v1',
    investment_verdict: 'WATCH',
    verdict_state: 'WATCH-FAIR',
    moat_class: 'wide',
    credited_g: 0.03,
    fair_value_per_share: 100,
    buy_price_per_share: 70,
    shariah_status: 'PASS',
    gate_pass: ['competence', 'moat', 'oe_positive', 'shariah'],
    gate_fail: [],
  }

  it('detects verdict, tier, g, fair-value and buy-price changes', () => {
    const diff = computeReAnalysisDiff(prior, {
      ...prior,
      research_case_id: 'rc_v2',
      investment_verdict: 'BUY',
      verdict_state: 'BUY-WINDOW',
      moat_class: 'monopoly',
      credited_g: 0.05,
      fair_value_per_share: 130,
      buy_price_per_share: 104,
    })

    expect(diff.has_changes).toBe(true)
    const fields = diff.changes.map((change) => change.field)
    expect(fields).toContain('investment_verdict')
    expect(fields).toContain('verdict_state')
    expect(fields).toContain('moat_class')
    expect(fields).toContain('credited_g')
    expect(fields).toContain('fair_value_per_share')
    expect(fields).toContain('buy_price_per_share')

    const verdictChange = diff.changes.find((change) => change.field === 'investment_verdict')
    expect(verdictChange).toMatchObject({ from: 'WATCH', to: 'BUY' })
    const gChange = diff.changes.find((change) => change.field === 'credited_g')
    expect(gChange).toMatchObject({ from: 0.03, to: 0.05 })
  })

  it('detects gate pass/fail set changes (a gate that newly fails)', () => {
    const diff = computeReAnalysisDiff(prior, {
      ...prior,
      research_case_id: 'rc_v2',
      gate_pass: ['competence', 'oe_positive', 'shariah'],
      gate_fail: ['moat'],
    })
    const gateChange = diff.changes.find((change) => change.field === 'gates')
    expect(gateChange).toBeDefined()
    if (gateChange === undefined) throw new Error('no gate change')
    expect(gateChange.note).toMatch(/moat/)
  })

  it('detects a Shariah status change', () => {
    const diff = computeReAnalysisDiff(prior, {
      ...prior,
      research_case_id: 'rc_v2',
      shariah_status: 'CONDITIONAL',
    })
    const shariahChange = diff.changes.find((change) => change.field === 'shariah_status')
    expect(shariahChange).toMatchObject({ from: 'PASS', to: 'CONDITIONAL' })
  })

  it('reports no changes when the new case is identical', () => {
    const diff = computeReAnalysisDiff(prior, { ...prior, research_case_id: 'rc_v2' })
    expect(diff.has_changes).toBe(false)
    expect(diff.changes).toEqual([])
  })

  it('carries the prior and new case ids', () => {
    const diff = computeReAnalysisDiff(prior, { ...prior, research_case_id: 'rc_v2', investment_verdict: 'PASS' })
    expect(diff.prior_research_case_id).toBe('rc_v1')
    expect(diff.new_research_case_id).toBe('rc_v2')
  })
})
