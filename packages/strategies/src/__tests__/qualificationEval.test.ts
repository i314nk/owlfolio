import { describe, expect, it } from 'vitest'

import { GOLDEN_SET } from '../goldenSet'
import {
  scoreQualification,
  type LaneQualificationOutput,
} from '../qualificationEval'

// A lane output that exactly matches the COST reference. Schema-valid on first attempt 100%.
function exactCostOutput(overrides: Partial<LaneQualificationOutput> = {}): LaneQualificationOutput {
  return {
    ticker: 'COST',
    moat_class: 'wide',
    shariah_status: 'non_compliant',
    oe_bridge: {
      net_income_musd: 8099,
      d_and_a_musd: 2426,
      sbc_musd: 860,
      diluted_shares_m: 444.8,
    },
    fabricated_citation_count: 0,
    schema_valid_first_attempt: true,
    ...overrides,
  }
}

// An exact-match lane output for every golden-set company (so the aggregate can qualify).
function allGoldenSetOutputs(): LaneQualificationOutput[] {
  return GOLDEN_SET.companies.map((c) => ({
    ticker: c.ticker,
    moat_class: c.expected_moat_class,
    shariah_status: c.expected_shariah_status,
    oe_bridge: {
      net_income_musd: c.expected_oe_bridge.net_income_musd,
      d_and_a_musd: c.expected_oe_bridge.d_and_a_musd,
      ...(c.expected_oe_bridge.maintenance_capex_musd === undefined ? {} : { maintenance_capex_musd: c.expected_oe_bridge.maintenance_capex_musd }),
      sbc_musd: c.expected_oe_bridge.sbc_musd,
      diluted_shares_m: c.expected_oe_bridge.diluted_shares_m,
    },
    fabricated_citation_count: 0,
    schema_valid_first_attempt: true,
  }))
}

describe('scoreQualification — per-criterion matrix', () => {
  it('passes every criterion on an exact match', () => {
    const report = scoreQualification([exactCostOutput()], GOLDEN_SET)
    const row = report.companies.find((c) => c.ticker === 'COST')!
    expect(row.moat.pass).toBe(true)
    expect(row.oe_bridge.pass).toBe(true)
    expect(row.shariah.pass).toBe(true)
    expect(row.fabricated_citations.pass).toBe(true)
    expect(row.qualified).toBe(true)
    // Aggregate stays false: only COST was supplied; CPRT/NVO are missing (fail-closed). The
    // per-company COST row qualifies; the whole golden set does not until every name is scored.
    expect(report.qualified).toBe(false)
    expect(report.schema_valid_first_attempt_rate).toBe(1)
    expect(report.schema_valid_criterion.pass).toBe(true)
  })

  it('marks the aggregate qualified when EVERY golden-set company passes', () => {
    const report = scoreQualification(allGoldenSetOutputs(), GOLDEN_SET)
    expect(report.companies).toHaveLength(GOLDEN_SET.companies.length)
    expect(report.companies.every((c) => c.qualified)).toBe(true)
    expect(report.qualified).toBe(true)
  })

  describe('moat = exact OR one tier MORE conservative', () => {
    it('passes when one tier MORE conservative (moderate vs reference wide)', () => {
      const report = scoreQualification([exactCostOutput({ moat_class: 'moderate' })], GOLDEN_SET)
      const row = report.companies.find((c) => c.ticker === 'COST')!
      expect(row.moat.pass).toBe(true)
    })

    it('passes when TWO tiers more conservative (narrow vs reference wide) — more conservative is allowed', () => {
      const report = scoreQualification([exactCostOutput({ moat_class: 'narrow' })], GOLDEN_SET)
      const row = report.companies.find((c) => c.ticker === 'COST')!
      expect(row.moat.pass).toBe(true)
    })

    it('FAILS when one tier MORE AGGRESSIVE (monopoly vs reference wide)', () => {
      const report = scoreQualification([exactCostOutput({ moat_class: 'monopoly' })], GOLDEN_SET)
      const row = report.companies.find((c) => c.ticker === 'COST')!
      expect(row.moat.pass).toBe(false)
      expect(row.qualified).toBe(false)
      expect(report.qualified).toBe(false)
    })
  })

  describe('OE bridge inputs within ±10%', () => {
    it('passes when every input is 9% off (within tolerance)', () => {
      const report = scoreQualification([exactCostOutput({
        oe_bridge: {
          net_income_musd: 8099 * 1.09,
          d_and_a_musd: 2426 * 0.91,
          sbc_musd: 860 * 1.09,
          diluted_shares_m: 444.8 * 0.91,
        },
      })], GOLDEN_SET)
      const row = report.companies.find((c) => c.ticker === 'COST')!
      expect(row.oe_bridge.pass).toBe(true)
    })

    it('FAILS when an input is 12% off (outside tolerance)', () => {
      const report = scoreQualification([exactCostOutput({
        oe_bridge: {
          net_income_musd: 8099 * 1.12,
          d_and_a_musd: 2426,
          sbc_musd: 860,
          diluted_shares_m: 444.8,
        },
      })], GOLDEN_SET)
      const row = report.companies.find((c) => c.ticker === 'COST')!
      expect(row.oe_bridge.pass).toBe(false)
      expect(row.qualified).toBe(false)
    })

    it('does not score maintenance_capex when the reference omits it', () => {
      const report = scoreQualification([exactCostOutput()], GOLDEN_SET)
      const row = report.companies.find((c) => c.ticker === 'COST')!
      const maint = row.oe_bridge.inputs.find((i) => i.field === 'maintenance_capex_musd')
      expect(maint).toBeUndefined()
    })
  })

  describe('Shariah status — exact match', () => {
    it('FAILS on any mismatch (compliant vs reference non_compliant)', () => {
      const report = scoreQualification([exactCostOutput({ shariah_status: 'compliant' })], GOLDEN_SET)
      const row = report.companies.find((c) => c.ticker === 'COST')!
      expect(row.shariah.pass).toBe(false)
      expect(row.qualified).toBe(false)
    })

    it('FAILS on the adjacent conditional mismatch (no one-tier leniency for Shariah)', () => {
      const report = scoreQualification([exactCostOutput({ shariah_status: 'conditional' })], GOLDEN_SET)
      const row = report.companies.find((c) => c.ticker === 'COST')!
      expect(row.shariah.pass).toBe(false)
    })
  })

  describe('fabricated citations == 0', () => {
    it('FAILS when any fabricated citation is reported', () => {
      const report = scoreQualification([exactCostOutput({ fabricated_citation_count: 1 })], GOLDEN_SET)
      const row = report.companies.find((c) => c.ticker === 'COST')!
      expect(row.fabricated_citations.pass).toBe(false)
      expect(row.qualified).toBe(false)
      expect(report.qualified).toBe(false)
    })
  })

  describe('schema-valid on first attempt ≥ 90% (aggregate criterion)', () => {
    it('passes at exactly 90% (9 of 10 valid)', () => {
      const outputs = Array.from({ length: 10 }, (_, i) =>
        exactCostOutput({ ticker: `COST`, schema_valid_first_attempt: i !== 0 }))
      const report = scoreQualification(outputs, GOLDEN_SET)
      expect(report.schema_valid_first_attempt_rate).toBeCloseTo(0.9, 5)
      expect(report.schema_valid_criterion.pass).toBe(true)
    })

    it('FAILS below 90% (8 of 10 valid) and drags the aggregate qualified to false', () => {
      const outputs = Array.from({ length: 10 }, (_, i) =>
        exactCostOutput({ schema_valid_first_attempt: i >= 2 }))
      const report = scoreQualification(outputs, GOLDEN_SET)
      expect(report.schema_valid_first_attempt_rate).toBeCloseTo(0.8, 5)
      expect(report.schema_valid_criterion.pass).toBe(false)
      expect(report.qualified).toBe(false)
    })
  })

  it('marks the aggregate report qualified only when every company passes AND schema rate ≥ 90%', () => {
    // Supply every golden-set name but flip CPRT to an aggressive moat — one company fails → aggregate fails.
    const outputs = allGoldenSetOutputs().map((o) => (o.ticker === 'CPRT' ? { ...o, moat_class: 'monopoly' as const } : o))
    const report = scoreQualification(outputs, GOLDEN_SET)
    expect(report.companies.find((c) => c.ticker === 'CPRT')!.qualified).toBe(false)
    expect(report.qualified).toBe(false)
    expect(report.companies).toHaveLength(GOLDEN_SET.companies.length)
  })

  it('fails-closed for a golden-set company with NO lane output (missing = not qualified)', () => {
    // Only COST supplied; the report still measures the whole golden set, so CPRT/NVO are missing.
    const report = scoreQualification([exactCostOutput()], GOLDEN_SET)
    const cprt = report.companies.find((c) => c.ticker === 'CPRT')
    expect(cprt?.qualified).toBe(false)
    expect(cprt?.missing).toBe(true)
    expect(report.qualified).toBe(false)
  })
})
