// Calibration page projection (UI-continuity-spec Rule 2 — new Calibration page).
//
// Operator-facing view of the valuation/sizing calibration evidence held in the ledger:
//   - recorded `calibration_run` events (the backtest signal-log summaries + deployment-ratio metric, when
//     the recorded run carries one) and the pre-stated calibration target;
//   - the parameter VERSION HISTORY from `valuation_config` config-change events;
//   - the CURRENT live parameter versions read from VALUATION_PARAMS + SIZING_PARAMS (config, not hardcoded).
//
// PURE: folds an event list into a structured view. The page passes the demo/personal events in. We do NOT
// run a live backtest inside the page render (that needs network fetches); the page renders recorded runs
// and an honest empty state when none exist.

import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import { SIZING_PARAMS, type LadderId } from '@owlfolio/strategies/sizingParams'

export type CalibrationDeploymentRatio = {
  ladder_id: string
  episodes: number
  avg_deployment_ratio: number
}

export type CalibrationSignalSummary = {
  ticker: string
  moat_class?: string
  runway?: string
  total_months?: number
  buy_months?: number
  buys_per_year?: number
}

export type CalibrationRunView = {
  event_id: string
  recorded_at: string
  params_version: string
  universe: string[]
  summaries: CalibrationSignalSummary[]
  deployment_ratios: CalibrationDeploymentRatio[]
  target?: {
    buys_per_year_min?: number
    buys_per_year_max?: number
  }
}

export type CalibrationParamVersion = {
  /** Which parameter set changed. */
  param_set: 'valuation'
  previous_version: string
  new_version: string
  changed_count: number
  recorded_at: string
  event_id: string
}

export type CalibrationLadderSpec = {
  ladder_id: LadderId
  rungs: Array<{ id: string; fraction: number; trigger: string }>
}

export type CalibrationView = {
  /** Current live param versions (config, not hardcoded). */
  current_valuation_version: string
  current_sizing_version: string
  /** The configured ladders (for the deployment-ratio metric's "per ladder" framing). */
  ladders: CalibrationLadderSpec[]
  time_completion_months: number
  /** Recorded backtest runs, most recent first. */
  runs: CalibrationRunView[]
  /** Valuation parameter version history (config-change events), most recent first. */
  param_history: CalibrationParamVersion[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function getNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseSummaries(value: unknown): CalibrationSignalSummary[] {
  if (!Array.isArray(value)) return []
  const summaries: CalibrationSignalSummary[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const ticker = getString(entry, 'ticker')
    if (ticker === undefined) continue
    const summary: CalibrationSignalSummary = { ticker }
    const moatClass = getString(entry, 'moat_class')
    if (moatClass !== undefined) summary.moat_class = moatClass
    const runway = getString(entry, 'runway')
    if (runway !== undefined) summary.runway = runway
    const totalMonths = getNumber(entry, 'total_months')
    if (totalMonths !== undefined) summary.total_months = totalMonths
    const buyMonths = getNumber(entry, 'buy_months')
    if (buyMonths !== undefined) summary.buy_months = buyMonths
    const buysPerYear = getNumber(entry, 'buys_per_year')
    if (buysPerYear !== undefined) summary.buys_per_year = buysPerYear
    summaries.push(summary)
  }
  return summaries
}

function parseDeploymentRatios(value: unknown): CalibrationDeploymentRatio[] {
  if (!Array.isArray(value)) return []
  const ratios: CalibrationDeploymentRatio[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const ladderId = getString(entry, 'ladder_id')
    if (ladderId === undefined) continue
    ratios.push({
      ladder_id: ladderId,
      episodes: getNumber(entry, 'episodes') ?? 0,
      avg_deployment_ratio: getNumber(entry, 'avg_deployment_ratio') ?? 0,
    })
  }
  return ratios
}

/** Fold the ledger events into the Calibration page view. */
export function projectCalibrationView(events: ReadonlyArray<LedgerEventEnvelope<unknown>>): CalibrationView {
  const runs: CalibrationRunView[] = []
  const param_history: CalibrationParamVersion[] = []

  for (const event of events) {
    const payload = isRecord(event.payload) ? event.payload : {}
    if (event.event_type === 'calibration_run') {
      const universe = Array.isArray(payload['universe'])
        ? payload['universe'].filter((u): u is string => typeof u === 'string')
        : []
      const run: CalibrationRunView = {
        event_id: event.event_id,
        recorded_at: event.created_at,
        params_version: getString(payload, 'params_version') ?? 'unknown',
        universe,
        summaries: parseSummaries(payload['summaries']),
        deployment_ratios: parseDeploymentRatios(payload['deployment_ratios']),
      }
      const targetRaw = isRecord(payload['target']) ? payload['target'] : undefined
      if (targetRaw !== undefined) {
        const target: NonNullable<CalibrationRunView['target']> = {}
        const min = getNumber(targetRaw, 'buys_per_year_min')
        if (min !== undefined) target.buys_per_year_min = min
        const max = getNumber(targetRaw, 'buys_per_year_max')
        if (max !== undefined) target.buys_per_year_max = max
        run.target = target
      }
      runs.push(run)
    } else if (event.event_type === 'valuation_config') {
      const changes = payload['changes']
      param_history.push({
        param_set: 'valuation',
        previous_version: getString(payload, 'previous_version') ?? 'unknown',
        new_version: getString(payload, 'new_version') ?? 'unknown',
        changed_count: Array.isArray(changes) ? changes.length : 0,
        recorded_at: event.created_at,
        event_id: event.event_id,
      })
    }
  }

  runs.sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : 0))
  param_history.sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : 0))

  const ladders: CalibrationLadderSpec[] = (Object.keys(SIZING_PARAMS.ladders) as LadderId[]).map((ladderId) => ({
    ladder_id: ladderId,
    rungs: SIZING_PARAMS.ladders[ladderId].rungs.map((rung) => ({ id: rung.id, fraction: rung.fraction, trigger: rung.trigger })),
  }))

  return {
    current_valuation_version: VALUATION_PARAMS.version,
    current_sizing_version: SIZING_PARAMS.version,
    ladders,
    time_completion_months: SIZING_PARAMS.time_completion_months,
    runs,
    param_history,
  }
}
