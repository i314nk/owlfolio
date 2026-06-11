// Pending-calibration-run queue projection (valuation-recalibration-spec §3 — calibration is a deliberate,
// enqueued action). Mirrors the research-run queue: a `calibration_run_requested` event with no matching
// recorded `calibration_run` (by calibration_run_id / correlation id) is "pending" for the worker to run.

import type { LedgerEventEnvelope } from '../eventEnvelope'

export type PendingCalibrationRun = {
  calibration_run_id: string
  strategy_id?: string
  universe_version?: string
  requested_by?: string
  requested_event_id: string
}

function runIdOf(event: LedgerEventEnvelope<unknown>): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>
  const id = payload['calibration_run_id']
  return typeof id === 'string' && id.length > 0 ? id : (event.correlation_id ?? event.aggregate_id)
}

export function projectPendingCalibrationRuns(
  events: ReadonlyArray<LedgerEventEnvelope<unknown>>,
): PendingCalibrationRun[] {
  const completed = new Set<string>()
  for (const event of events) {
    if (event.event_type === 'calibration_run') {
      completed.add(runIdOf(event))
      if (event.correlation_id !== undefined) completed.add(event.correlation_id)
    }
  }

  const pending: PendingCalibrationRun[] = []
  for (const event of events) {
    if (event.event_type !== 'calibration_run_requested') continue
    const id = runIdOf(event)
    if (completed.has(id) || (event.correlation_id !== undefined && completed.has(event.correlation_id))) continue
    const payload = (event.payload ?? {}) as Record<string, unknown>
    pending.push({
      calibration_run_id: id,
      ...(typeof payload['strategy_id'] === 'string' ? { strategy_id: payload['strategy_id'] as string } : {}),
      ...(typeof payload['universe_version'] === 'string' ? { universe_version: payload['universe_version'] as string } : {}),
      ...(typeof payload['requested_by'] === 'string' ? { requested_by: payload['requested_by'] as string } : {}),
      requested_event_id: event.event_id,
    })
  }
  return pending
}
