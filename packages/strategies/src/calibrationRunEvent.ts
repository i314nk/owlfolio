// Calibration-run ledger event (valuation-recalibration-spec §3.3).
//
// "Log the calibration run (parameters tried, final values, signal log) as a ledger artifact." When the
// calibration backtest is run before go-live (and at the annual review per §3.4 anti-drift), the run is
// recorded as an append-only `calibration_run` event capturing: the valuation_params version + values
// used, the universe/name(s) backtested, and the signal-log summary (buys/yr, BUY episodes, sanity-window
// results). This is the pure event-construction helper; persisting it uses the normal EventStore.append.
//
// Mirrors valuationConfigEvent.ts: aggregate `strategy`, projection owner `audit`, actor `user`.

import type { ValuationParams } from './valuationParams'

export const CALIBRATION_RUN_EVENT_TYPE = 'calibration_run' as const

/** Summary of one name's backtest, as carried in the calibration-run payload. */
export type CalibrationNameSummary = {
  ticker: string
  moat_class: string
  runway: string
  total_months: number
  buy_months: number
  buys_per_year: number
  buy_episodes: Array<{ start: string; end: string; months: number }>
  sanity_windows: Array<{ window: string; kind: string; signalled: boolean; passed: boolean; covered: boolean }>
}

/** The pre-stated calibration target (spec §3.1), recorded alongside the run for audit. */
export type CalibrationTarget = {
  buys_per_year_min: number
  buys_per_year_max: number
  must_signal_windows: string[]
  must_not_signal_windows: string[]
}

export type CalibrationRunEventPayload = {
  /** Version of the valuation params used for the run. */
  params_version: string
  /** Full param values used (frozen snapshot for the audit trail). */
  params: ValuationParams
  /** Tickers backtested. */
  universe: string[]
  /** Per-name signal-log summaries. */
  summaries: CalibrationNameSummary[]
  /** Pre-stated target the run is calibrated against. */
  target: CalibrationTarget
}

/** Minimal envelope shape (mirrors @owlfolio/ledger LedgerEventEnvelope without importing it). */
export type CalibrationRunEvent = {
  event_id: string
  event_type: typeof CALIBRATION_RUN_EVENT_TYPE
  aggregate_type: 'strategy'
  aggregate_id: string
  actor_type: 'user'
  actor_id?: string
  payload: CalibrationRunEventPayload
  source_ids: string[]
  created_at: string
  schema_version: number
}

/**
 * Build an append-only `calibration_run` ledger event capturing the params version + values, the
 * universe, the per-name signal summaries, and the pre-stated target. Returns the event envelope; the
 * caller appends it to the EventStore. The aggregate is the strategy whose valuation was calibrated.
 */
export function buildCalibrationRunEvent(args: {
  event_id: string
  strategy_id: string
  params: ValuationParams
  summaries: CalibrationNameSummary[]
  target: CalibrationTarget
  actor_id?: string
  source_ids?: string[]
  created_at?: string
}): CalibrationRunEvent {
  return {
    event_id: args.event_id,
    event_type: CALIBRATION_RUN_EVENT_TYPE,
    aggregate_type: 'strategy',
    aggregate_id: args.strategy_id,
    actor_type: 'user',
    ...(args.actor_id === undefined ? {} : { actor_id: args.actor_id }),
    payload: {
      params_version: args.params.version,
      params: args.params,
      universe: args.summaries.map((s) => s.ticker),
      summaries: args.summaries,
      target: args.target,
    },
    source_ids: args.source_ids ?? [],
    created_at: args.created_at ?? new Date().toISOString(),
    schema_version: 1,
  }
}
