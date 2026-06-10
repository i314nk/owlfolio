import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectForecasts, projectForecastCalibration } from '../projections/forecastCalibrationProjection'

function recordedForecast(id: string, caseId: string, lane: string, p: number, createdAt: string): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_${id}`,
    event_type: 'forecast_recorded',
    aggregate_type: 'research_case',
    aggregate_id: caseId,
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      forecast_id: id,
      research_case_id: caseId,
      ticker: 'AAA',
      lane,
      claim: `${lane} claim`,
      p,
      resolves_on: 'FY2028 annual report',
    },
    source_ids: [],
    created_at: createdAt,
    schema_version: 1,
  }
}

function resolvedForecast(forecastId: string, caseId: string, lane: string, p: number, outcome: boolean, createdAt: string): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_res_${forecastId}`,
    event_type: 'forecast_resolved',
    aggregate_type: 'research_case',
    aggregate_id: caseId,
    actor_type: 'worker',
    actor_id: 'worker_local',
    payload: {
      resolution_id: `res_${forecastId}`,
      forecast_id: forecastId,
      research_case_id: caseId,
      ticker: 'AAA',
      lane,
      p,
      outcome,
      brier_score: (p - (outcome ? 1 : 0)) ** 2,
      resolved_on: '2028-02-01',
    },
    source_ids: [],
    created_at: createdAt,
    schema_version: 1,
  }
}

describe('projectForecasts', () => {
  it('lists recorded forecasts with their resolution status', () => {
    const events = [
      recordedForecast('f1', 'rc_1', 'MOAT', 0.8, '2026-01-01T00:00:00.000Z'),
      recordedForecast('f2', 'rc_1', 'VALUATION', 0.6, '2026-01-01T00:00:00.000Z'),
      resolvedForecast('f1', 'rc_1', 'MOAT', 0.8, true, '2028-02-01T00:00:00.000Z'),
    ]
    const forecasts = projectForecasts(events)
    expect(forecasts).toHaveLength(2)
    const f1 = forecasts.find((f) => f.forecast_id === 'f1')
    if (f1 === undefined) throw new Error('no f1')
    expect(f1.resolved).toBe(true)
    expect(f1.outcome).toBe(true)
    const f2 = forecasts.find((f) => f.forecast_id === 'f2')
    expect(f2?.resolved).toBe(false)
  })
})

describe('projectForecastCalibration', () => {
  it('builds per-lane calibration from resolved forecasts', () => {
    const events = [
      recordedForecast('f1', 'rc_1', 'MOAT', 0.8, '2026-01-01T00:00:00.000Z'),
      recordedForecast('f2', 'rc_2', 'MOAT', 0.8, '2026-01-01T00:00:00.000Z'),
      resolvedForecast('f1', 'rc_1', 'MOAT', 0.8, true, '2028-02-01T00:00:00.000Z'),
      resolvedForecast('f2', 'rc_2', 'MOAT', 0.8, false, '2028-02-01T00:00:00.000Z'),
    ]
    const calibration = projectForecastCalibration(events)
    expect(calibration.total_resolved).toBe(2)
    expect(calibration.shading_active).toBe(false)
    const moat = calibration.lanes.find((lane) => lane.lane === 'MOAT')
    if (moat === undefined) throw new Error('no MOAT lane')
    expect(moat.resolved_count).toBe(2)
    // (0.04 + 0.64) / 2 = 0.34
    expect(moat.mean_brier).toBeCloseTo(0.34, 6)
  })

  it('returns empty calibration when nothing is resolved', () => {
    const calibration = projectForecastCalibration([
      recordedForecast('f1', 'rc_1', 'MOAT', 0.8, '2026-01-01T00:00:00.000Z'),
    ])
    expect(calibration.total_resolved).toBe(0)
    expect(calibration.lanes).toEqual([])
  })
})
