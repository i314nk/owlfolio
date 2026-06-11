import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CalibrationPanel } from '../CalibrationPanel'
import { projectCalibrationView } from '../../lib/calibration'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import { SIZING_PARAMS } from '@owlfolio/strategies/sizingParams'

import type { CalibrationUniverse } from '@owlfolio/workflow/calibrationUniverse'

const testUniverse: CalibrationUniverse = {
  version: 'calibration-universe-test-1',
  names: [
    { ticker: 'CPRT', company: 'Copart', market: 'US', fundamentals_hint: 'edgar' },
    { ticker: 'TABREED', company: 'Tabreed', market: 'intl', fundamentals_hint: 'local_manual' },
  ],
}

function render(
  events: LedgerEventEnvelope<unknown>[],
  options?: Parameters<typeof projectCalibrationView>[1],
): string {
  return renderToStaticMarkup(createElement(CalibrationPanel, { view: projectCalibrationView(events, options) }))
}

function evt(overrides: Partial<LedgerEventEnvelope<unknown>> & { event_type: string; event_id: string }): LedgerEventEnvelope<unknown> {
  return {
    event_id: overrides.event_id,
    event_type: overrides.event_type,
    aggregate_type: 'strategy',
    aggregate_id: 'buffett-munger',
    actor_type: 'user',
    payload: overrides.payload ?? {},
    source_ids: [],
    created_at: overrides.created_at ?? '2026-06-01T00:00:00.000Z',
    schema_version: 1,
  } as LedgerEventEnvelope<unknown>
}

describe('CalibrationPanel', () => {
  it('renders current param versions read from config (not hardcoded)', () => {
    const html = render([])
    expect(html).toContain(VALUATION_PARAMS.version)
    expect(html).toContain(SIZING_PARAMS.version)
  })

  it('renders an honest empty state when no backtest has been recorded', () => {
    const html = render([])
    expect(html).toContain('No calibration run has been recorded')
    expect(html).toContain('No backtest has recorded a deployment-ratio metric yet')
    // both configured ladders still framed
    expect(html).toContain('cold')
    expect(html).toContain('normal')
  })

  it('renders the deployment-ratio metric per ladder from a recorded run', () => {
    const html = render([
      evt({
        event_type: 'calibration_run',
        event_id: 'cal_1',
        created_at: '2026-06-05T00:00:00.000Z',
        payload: {
          params_version: VALUATION_PARAMS.version,
          universe: ['MSFT'],
          summaries: [{ ticker: 'MSFT', moat_class: 'monopoly', runway: 'proven', total_months: 120, buy_months: 8, buys_per_year: 0.8 }],
          deployment_ratios: [
            { ladder_id: 'cold', episodes: 2, avg_deployment_ratio: 0.45 },
            { ladder_id: 'normal', episodes: 2, avg_deployment_ratio: 0.85 },
          ],
        },
      }),
    ])
    expect(html).toContain('data-calibration-run="cal_1"')
    expect(html).toContain('45.0%')
    expect(html).toContain('85.0%')
    expect(html).toContain('MSFT')
  })

  it('renders the user-curated universe, suggestions, and the Run-backtest action', () => {
    const html = render([], {
      universe: testUniverse,
      suggestions: [{ ticker: 'FDS', company: 'FactSet', sources: ['researched'] }],
    })
    expect(html).toContain('calibration-universe-test-1')
    expect(html).toContain('CPRT')
    expect(html).toContain('TABREED')
    // Suggested addition surfaced (human curates).
    expect(html).toContain('FDS')
    expect(html).toContain('Suggested additions')
    // The deliberate Run-backtest button.
    expect(html).toContain('Run backtest')
    // Anti-drift framing for the gated config-change path.
    expect(html).toContain('Parameters are frozen')
  })

  it('renders the non-US coverage report from a recorded run', () => {
    const html = render([
      evt({
        event_type: 'calibration_run',
        event_id: 'cal_cov',
        created_at: '2026-06-05T00:00:00.000Z',
        payload: {
          params_version: VALUATION_PARAMS.version,
          universe_version: 'calibration-universe-test-1',
          universe: ['CPRT', 'TABREED', 'GHOST'],
          summaries: [],
          coverage: [
            { ticker: 'CPRT', company: 'Copart', market: 'US', status: 'resolved_edgar', currency: 'USD' },
            { ticker: 'TABREED', company: 'Tabreed', market: 'intl', status: 'resolved_local_manual', currency: 'AED' },
            { ticker: 'GHOST', company: 'Ghost', market: 'intl', status: 'unresolved', reason: 'no fundamentals' },
          ],
        },
      }),
    ], { universe: testUniverse })
    expect(html).toContain('Resolved · EDGAR')
    expect(html).toContain('Resolved · local-manual')
    expect(html).toContain('Unresolved · needs fundamentals')
    expect(html).toContain('no fundamentals')
  })

  it('renders valuation_config param-change history', () => {
    const html = render([
      evt({
        event_type: 'valuation_config',
        event_id: 'vc_1',
        created_at: '2026-05-01T00:00:00.000Z',
        payload: { previous_version: 'valuation-2026-05-x', new_version: 'valuation-2026-06-y', changes: [{ path: 'discount_rate' }] },
      }),
    ])
    expect(html).toContain('valuation-2026-05-x → valuation-2026-06-y')
    expect(html).toContain('1 param changed')
  })
})
