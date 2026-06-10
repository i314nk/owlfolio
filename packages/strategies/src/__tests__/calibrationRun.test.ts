import { describe, expect, it } from 'vitest'
import { VALUATION_PARAMS } from '../valuationParams'
import {
  buildCalibrationRunEvent,
  CALIBRATION_RUN_EVENT_TYPE,
  type CalibrationNameSummary,
  type CalibrationTarget,
} from '../calibrationRunEvent'

const summaries: CalibrationNameSummary[] = [
  {
    ticker: 'CPRT',
    moat_class: 'wide',
    runway: 'proven',
    total_months: 120,
    buy_months: 4,
    buys_per_year: 0.4,
    buy_episodes: [{ start: '2020-03-31', end: '2020-04-30', months: 2 }],
    sanity_windows: [
      { window: '2020-03..2020-05', kind: 'must_signal', signalled: true, passed: true, covered: true },
    ],
  },
]

const target: CalibrationTarget = {
  buys_per_year_min: 1,
  buys_per_year_max: 3,
  must_signal_windows: ['2020-03..2020-05', '2022-09..2023-01'],
  must_not_signal_windows: ['2021-01..2021-12'],
}

describe('buildCalibrationRunEvent', () => {
  it('builds an append-only strategy/audit event carrying params version + summaries + target', () => {
    const event = buildCalibrationRunEvent({
      event_id: 'evt-1',
      strategy_id: 'buffett-munger',
      params: VALUATION_PARAMS,
      summaries,
      target,
      created_at: '2026-06-09T00:00:00.000Z',
    })

    expect(event.event_type).toBe(CALIBRATION_RUN_EVENT_TYPE)
    expect(event.aggregate_type).toBe('strategy')
    expect(event.actor_type).toBe('user')
    expect(event.aggregate_id).toBe('buffett-munger')
    expect(event.payload.params_version).toBe(VALUATION_PARAMS.version)
    expect(event.payload.params).toEqual(VALUATION_PARAMS)
    expect(event.payload.universe).toEqual(['CPRT'])
    expect(event.payload.summaries).toEqual(summaries)
    expect(event.payload.target).toEqual(target)
    expect(event.source_ids).toEqual([])
    expect(event.schema_version).toBe(1)
    expect(event.created_at).toBe('2026-06-09T00:00:00.000Z')
  })

  it('omits actor_id when not provided and includes it when given', () => {
    const without = buildCalibrationRunEvent({
      event_id: 'evt-2', strategy_id: 'buffett-munger', params: VALUATION_PARAMS, summaries, target,
    })
    expect('actor_id' in without).toBe(false)

    const withActor = buildCalibrationRunEvent({
      event_id: 'evt-3', strategy_id: 'buffett-munger', params: VALUATION_PARAMS, summaries, target, actor_id: 'analyst-1',
    })
    expect(withActor.actor_id).toBe('analyst-1')
  })

  it('derives the universe from the summary tickers', () => {
    const event = buildCalibrationRunEvent({
      event_id: 'evt-4',
      strategy_id: 'buffett-munger',
      params: VALUATION_PARAMS,
      summaries: [...summaries, { ...summaries[0]!, ticker: 'FDS' }],
      target,
    })
    expect(event.payload.universe).toEqual(['CPRT', 'FDS'])
  })
})
