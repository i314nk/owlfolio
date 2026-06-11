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

/** Per-ladder deployment-ratio metric (position-sizing-spec §7), as carried in the run payload. */
export type CalibrationDeploymentRatioSummary = {
  ladder_id: string
  episodes: number
  avg_deployment_ratio: number
}

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
  /** Per-ladder deployment ratio for this name (position-sizing-spec §7). */
  deployment_ratios?: CalibrationDeploymentRatioSummary[]
}

/**
 * Coverage classification for one universe name (valuation-recalibration-spec non-US handling): which
 * fundamentals lane resolved the name, or that it is unresolved (needs operator-entered annual-report
 * figures). The non-US gap, made honest — never fabricated.
 */
export type CalibrationCoverageSummary = {
  ticker: string
  company?: string
  market?: string
  fundamentals_hint?: string
  status: 'resolved_edgar' | 'resolved_local_manual' | 'unresolved'
  currency?: string
  reason?: string
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
  /** Version of the user-curated calibration universe the run used (reproducibility). */
  universe_version?: string
  /** Tickers backtested. */
  universe: string[]
  /** Per-name signal-log summaries. */
  summaries: CalibrationNameSummary[]
  /** Per-name coverage classification (resolved_edgar / resolved_local_manual / unresolved). */
  coverage?: CalibrationCoverageSummary[]
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
  /** Version of the user-curated universe used (reproducibility). */
  universe_version?: string
  /**
   * The tickers in the universe the run was scoped to. Defaults to the summaries' tickers, but should be
   * passed explicitly so UNRESOLVED names (which have no summary) still appear in the recorded universe.
   */
  universe?: string[]
  /** Per-name coverage classification (the non-US gap, made honest). */
  coverage?: CalibrationCoverageSummary[]
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
      ...(args.universe_version === undefined ? {} : { universe_version: args.universe_version }),
      universe: args.universe ?? args.summaries.map((s) => s.ticker),
      summaries: args.summaries,
      ...(args.coverage === undefined ? {} : { coverage: args.coverage }),
      target: args.target,
    },
    source_ids: args.source_ids ?? [],
    created_at: args.created_at ?? new Date().toISOString(),
    schema_version: 1,
  }
}
