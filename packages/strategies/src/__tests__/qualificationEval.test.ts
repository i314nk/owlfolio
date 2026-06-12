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
      ...(c.expected_oe_bridge.reporting_currency === undefined ? {} : { reporting_currency: c.expected_oe_bridge.reporting_currency }),
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

describe('OE-bridge currency consistency (the NVO DKK/USD scaling fix)', () => {
  // NVO reports in DKK (IFRS 20-F filer). The golden reference is now frozen in DKK from the real 20-F,
  // and the lane output must declare its reporting currency. The scorer compares ONLY in a matching
  // currency — it never compares a DKK observation against a USD reference (the prior bug, which made
  // net income look 375% off purely from the FX scale).
  function exactNvoDkkOutput(overrides: Partial<LaneQualificationOutput> = {}): LaneQualificationOutput {
    const ref = GOLDEN_SET.companies.find((c) => c.ticker === 'NVO')!.expected_oe_bridge
    return {
      ticker: 'NVO',
      moat_class: 'wide',
      shariah_status: 'compliant',
      oe_bridge: {
        reporting_currency: 'DKK',
        net_income_musd: ref.net_income_musd,
        d_and_a_musd: ref.d_and_a_musd,
        sbc_musd: ref.sbc_musd,
        diluted_shares_m: ref.diluted_shares_m,
      },
      fabricated_citation_count: 0,
      schema_valid_first_attempt: true,
      ...overrides,
    }
  }

  it('the NVO golden reference is frozen in DKK', () => {
    const nvo = GOLDEN_SET.companies.find((c) => c.ticker === 'NVO')!
    expect(nvo.expected_oe_bridge.reporting_currency).toBe('DKK')
  })

  it('passes OE when a DKK observation matches the DKK reference', () => {
    const report = scoreQualification([exactNvoDkkOutput()], GOLDEN_SET)
    const row = report.companies.find((c) => c.ticker === 'NVO')!
    expect(row.oe_bridge.pass).toBe(true)
  })

  it('FAILS (currency mismatch, not a scale near-miss) when the observation is in USD but the reference is DKK', () => {
    // A USD-scaled observation (~1/6.9 of the DKK figures) must NOT be silently compared; it fails on
    // currency, with a detail that names the mismatch rather than reporting a bogus huge deviation.
    const report = scoreQualification([exactNvoDkkOutput({
      oe_bridge: {
        reporting_currency: 'USD',
        net_income_musd: 14800,
        d_and_a_musd: 2120,
        sbc_musd: 207,
        diluted_shares_m: 4447.7,
      },
    })], GOLDEN_SET)
    const row = report.companies.find((c) => c.ticker === 'NVO')!
    expect(row.oe_bridge.pass).toBe(false)
    expect(row.oe_bridge.detail.toLowerCase()).toContain('currency')
  })

  it('treats an absent observed currency as matching a USD reference (back-compat for COST)', () => {
    const report = scoreQualification([exactCostOutput()], GOLDEN_SET)
    const row = report.companies.find((c) => c.ticker === 'COST')!
    expect(row.oe_bridge.pass).toBe(true)
  })
})
