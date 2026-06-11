import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../../eventEnvelope'
import { projectPendingCalibrationRuns } from '../calibrationRunQueueProjection'

function requested(id: string, version?: string): LedgerEventEnvelope<Record<string, unknown>> {
  return {
    event_id: `evt_cal_req_${id}`,
    event_type: 'calibration_run_requested',
    aggregate_type: 'strategy',
    aggregate_id: 'buffett-munger',
    correlation_id: id,
    actor_type: 'user',
    actor_id: 'user_local',
    payload: {
      calibration_run_id: id,
      strategy_id: 'buffett-munger',
      ...(version === undefined ? {} : { universe_version: version }),
      requested_by: 'user_local',
    },
    source_ids: [],
    created_at: '2026-06-01T00:00:00.000Z',
    schema_version: 1,
  }
}

function completed(id: string): LedgerEventEnvelope<Record<string, unknown>> {
  return {
    event_id: `evt_cal_run_${id}`,
    event_type: 'calibration_run',
    aggregate_type: 'strategy',
    aggregate_id: 'buffett-munger',
    correlation_id: id,
    actor_type: 'worker',
    actor_id: 'owlfolio-worker',
    payload: { calibration_run_id: id, params_version: 'v', universe: [], summaries: [], target: {} },
    source_ids: [],
    created_at: '2026-06-01T01:00:00.000Z',
    schema_version: 1,
  }
}

describe('projectPendingCalibrationRuns', () => {
  it('returns requested runs that have no recorded calibration_run yet', () => {
    const pending = projectPendingCalibrationRuns([requested('cal_1', 'universe-v1')])
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ calibration_run_id: 'cal_1', strategy_id: 'buffett-munger', universe_version: 'universe-v1', requested_event_id: 'evt_cal_req_cal_1' })
  })

  it('excludes a run that already has a recorded calibration_run (matched by correlation id)', () => {
    const pending = projectPendingCalibrationRuns([requested('cal_1'), completed('cal_1')])
    expect(pending).toEqual([])
  })

  it('returns empty when there are no requests', () => {
    expect(projectPendingCalibrationRuns([completed('cal_x')])).toEqual([])
  })
})
