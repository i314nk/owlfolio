import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { CalibrationUniverse } from '@owlfolio/workflow/calibrationUniverse'

import { projectCalibrationView } from '../calibration'

const universe: CalibrationUniverse = {
  version: 'calibration-universe-test-1',
  names: [
    { ticker: 'CPRT', company: 'Copart', market: 'US', fundamentals_hint: 'edgar' },
    { ticker: 'TABREED', company: 'Tabreed', market: 'intl', fundamentals_hint: 'local_manual' },
    { ticker: 'GHOST', company: 'Unresolvable', market: 'intl', fundamentals_hint: 'local_manual' },
  ],
}

function calibrationRunEvent(): LedgerEventEnvelope<Record<string, unknown>> {
  return {
    event_id: 'evt_calibration_run_cal_1',
    event_type: 'calibration_run',
    aggregate_type: 'strategy',
    aggregate_id: 'buffett-munger',
    correlation_id: 'cal_1',
    actor_type: 'worker',
    actor_id: 'owlfolio-worker',
    payload: {
      params_version: 'valuation-test-1',
      universe_version: 'calibration-universe-test-1',
      universe: ['CPRT', 'TABREED', 'GHOST'],
      summaries: [
        {
          ticker: 'CPRT', moat_class: 'wide', runway: 'proven',
          total_months: 120, buy_months: 8, buys_per_year: 0.8,
          deployment_ratios: [
            { ladder_id: 'cold', episodes: 2, avg_deployment_ratio: 0.5 },
            { ladder_id: 'normal', episodes: 2, avg_deployment_ratio: 0.7 },
          ],
        },
      ],
      coverage: [
        { ticker: 'CPRT', company: 'Copart', market: 'US', status: 'resolved_edgar', currency: 'USD' },
        { ticker: 'TABREED', company: 'Tabreed', market: 'intl', status: 'resolved_local_manual', currency: 'AED' },
        { ticker: 'GHOST', company: 'Unresolvable', market: 'intl', status: 'unresolved', reason: 'no fundamentals' },
      ],
      target: { buys_per_year_min: 1, buys_per_year_max: 3 },
    },
    source_ids: [],
    created_at: '2026-06-01T01:00:00.000Z',
    schema_version: 1,
  }
}

describe('projectCalibrationView — calibration run with coverage', () => {
  it('parses coverage, universe_version, and aggregated deployment ratios from the run', () => {
    const view = projectCalibrationView([calibrationRunEvent()])
    const run = view.runs[0]
    expect(run?.universe_version).toBe('calibration-universe-test-1')
    expect(run?.coverage.map((c) => `${c.ticker}:${c.status}`)).toEqual([
      'CPRT:resolved_edgar',
      'TABREED:resolved_local_manual',
      'GHOST:unresolved',
    ])
    // Aggregated from the per-name summaries (no explicit run-level deployment_ratios payload).
    expect(run?.deployment_ratios.find((d) => d.ladder_id === 'cold')?.avg_deployment_ratio).toBe(0.5)
    expect(run?.deployment_ratios.find((d) => d.ladder_id === 'normal')?.avg_deployment_ratio).toBe(0.7)
  })

  it('joins the curated universe with latest-run coverage + carries suggestions', () => {
    const view = projectCalibrationView([calibrationRunEvent()], {
      universe,
      suggestions: [{ ticker: 'FDS', company: 'FactSet', sources: ['researched'] }],
    })
    expect(view.universe?.version).toBe('calibration-universe-test-1')
    const ghost = view.universe?.names.find((n) => n.ticker === 'GHOST')
    expect(ghost?.coverage_status).toBe('unresolved')
    expect(ghost?.coverage_reason).toMatch(/no fundamentals/)
    expect(view.universe?.suggestions.map((s) => s.ticker)).toEqual(['FDS'])
  })

  it('renders the universe even when no run has been recorded (coverage status undefined)', () => {
    const view = projectCalibrationView([], { universe })
    expect(view.universe?.names).toHaveLength(3)
    expect(view.universe?.names[0]?.coverage_status).toBeUndefined()
    expect(view.runs).toEqual([])
  })
})
