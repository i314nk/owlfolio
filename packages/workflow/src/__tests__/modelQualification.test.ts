import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GOLDEN_SET } from '@owlfolio/strategies/goldenSet'

import {
  isModelQualified,
  qualificationReportFileStem,
  runModelQualification,
  type ModelQualificationReport,
} from '../modelQualification'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'owlfolio-qual-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('runModelQualification', () => {
  it('runs each golden-set name via the injected lane runner and writes a qualified report', async () => {
    const seen: string[] = []
    const report = await runModelQualification(
      { provider_id: 'mock-provider', model_id: 'mock-buffett-munger-demo' },
      {
        goldenSet: GOLDEN_SET,
        runLane: async (ticker) => {
          seen.push(ticker)
          const c = GOLDEN_SET.companies.find((x) => x.ticker === ticker)!
          return {
            ticker,
            moat_class: c.expected_moat_class,
            shariah_status: c.expected_shariah_status,
            oe_bridge: {
              net_income_musd: c.expected_oe_bridge.net_income_musd,
              d_and_a_musd: c.expected_oe_bridge.d_and_a_musd,
              sbc_musd: c.expected_oe_bridge.sbc_musd,
              diluted_shares_m: c.expected_oe_bridge.diluted_shares_m,
            },
            fabricated_citation_count: 0,
            schema_valid_first_attempt: true,
          }
        },
        generated_at: '2026-06-09T00:00:00.000Z',
      },
    )
    expect(seen.sort()).toEqual(GOLDEN_SET.companies.map((c) => c.ticker).sort())
    expect(report.provider_id).toBe('mock-provider')
    expect(report.run_status).toBe('completed')
    expect(report.qualified).toBe(true)
    expect(report.result.qualified).toBe(true)
  })

  it('records a NON-qualified report (fail-closed) when a lane runner throws for one name', async () => {
    const report = await runModelQualification(
      { provider_id: 'mock-provider', model_id: 'mock' },
      {
        goldenSet: GOLDEN_SET,
        runLane: async (ticker) => {
          if (ticker === 'NVO') throw new Error('lane timed out')
          const c = GOLDEN_SET.companies.find((x) => x.ticker === ticker)!
          return {
            ticker,
            moat_class: c.expected_moat_class,
            shariah_status: c.expected_shariah_status,
            oe_bridge: {
              net_income_musd: c.expected_oe_bridge.net_income_musd,
              d_and_a_musd: c.expected_oe_bridge.d_and_a_musd,
              sbc_musd: c.expected_oe_bridge.sbc_musd,
              diluted_shares_m: c.expected_oe_bridge.diluted_shares_m,
            },
            fabricated_citation_count: 0,
            schema_valid_first_attempt: true,
          }
        },
      },
    )
    // NVO threw → no lane output → missing → fail-closed (not qualified).
    expect(report.qualified).toBe(false)
    expect(report.result.companies.find((c) => c.ticker === 'NVO')!.missing).toBe(true)
  })
})

describe('isModelQualified — fail-closed gate', () => {
  it('returns false when NO qualification report exists', async () => {
    const result = await isModelQualified('mock-provider', { dir })
    expect(result.qualified).toBe(false)
    expect(result.has_report).toBe(false)
  })

  it('returns true when a passing report exists', async () => {
    const report: ModelQualificationReport = {
      qualification_report_id: 'qual_mock_x',
      provider_id: 'mock-provider',
      model_id: 'mock',
      golden_set_version: GOLDEN_SET.version,
      run_status: 'completed',
      generated_at: '2026-06-09T00:00:00.000Z',
      qualified: true,
      result: {
        golden_set_version: GOLDEN_SET.version,
        schema_valid_first_attempt_rate: 1,
        schema_valid_criterion: { pass: true, detail: 'ok' },
        companies: [],
        qualified: true,
      },
      summary: 'qualified',
    }
    await writeFile(join(dir, qualificationReportFileStem({ provider_id: 'mock-provider' }) + '.latest.json'), JSON.stringify(report), 'utf8')
    const result = await isModelQualified('mock-provider', { dir })
    expect(result.qualified).toBe(true)
    expect(result.has_report).toBe(true)
  })

  it('returns false when a report exists but is NOT qualified', async () => {
    const report: ModelQualificationReport = {
      qualification_report_id: 'qual_mock_y',
      provider_id: 'mock-provider',
      model_id: 'mock',
      golden_set_version: GOLDEN_SET.version,
      run_status: 'completed',
      generated_at: '2026-06-09T00:00:00.000Z',
      qualified: false,
      result: {
        golden_set_version: GOLDEN_SET.version,
        schema_valid_first_attempt_rate: 0.5,
        schema_valid_criterion: { pass: false, detail: 'below threshold' },
        companies: [],
        qualified: false,
      },
      summary: 'not qualified',
    }
    await writeFile(join(dir, qualificationReportFileStem({ provider_id: 'mock-provider' }) + '.latest.json'), JSON.stringify(report), 'utf8')
    const result = await isModelQualified('mock-provider', { dir })
    expect(result.qualified).toBe(false)
    expect(result.has_report).toBe(true)
  })
})
