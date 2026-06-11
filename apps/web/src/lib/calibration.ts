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
import type {
  CalibrationUniverse,
  CalibrationUniverseSuggestion,
} from '@owlfolio/workflow/calibrationUniverse'

export type CalibrationDeploymentRatio = {
  ladder_id: string
  episodes: number
  avg_deployment_ratio: number
}

/** Coverage classification for a universe name in the latest recorded run (the non-US gap, made honest). */
export type CalibrationCoverageView = {
  ticker: string
  company?: string
  market?: string
  status: 'resolved_edgar' | 'resolved_local_manual' | 'unresolved'
  currency?: string
  reason?: string
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
  /** Version of the user-curated universe the run used (reproducibility). */
  universe_version?: string
  universe: string[]
  summaries: CalibrationSignalSummary[]
  deployment_ratios: CalibrationDeploymentRatio[]
  /** Per-name coverage classification recorded with the run (the non-US gap, made visible). */
  coverage: CalibrationCoverageView[]
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

/** One name in the user-curated calibration universe, joined with its latest-run coverage status. */
export type CalibrationUniverseNameView = {
  ticker: string
  company: string
  market: string
  fundamentals_hint: string
  /** Coverage from the latest recorded run (undefined when no run has covered this name yet). */
  coverage_status?: CalibrationCoverageView['status']
  coverage_reason?: string
}

export type CalibrationUniverseView = {
  version: string
  names: CalibrationUniverseNameView[]
  /** Researched / 13F-discovered tickers NOT yet in the universe (page suggests; human curates). */
  suggestions: CalibrationUniverseSuggestion[]
}

export type CalibrationView = {
  /** Current live param versions (config, not hardcoded). */
  current_valuation_version: string
  current_sizing_version: string
  /** The configured ladders (for the deployment-ratio metric's "per ladder" framing). */
  ladders: CalibrationLadderSpec[]
  time_completion_months: number
  /** The user-curated universe + suggestions (undefined when the config file is missing/invalid). */
  universe?: CalibrationUniverseView
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

function parseCoverage(value: unknown): CalibrationCoverageView[] {
  if (!Array.isArray(value)) return []
  const coverage: CalibrationCoverageView[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const ticker = getString(entry, 'ticker')
    const status = getString(entry, 'status')
    if (ticker === undefined || (status !== 'resolved_edgar' && status !== 'resolved_local_manual' && status !== 'unresolved')) continue
    const item: CalibrationCoverageView = { ticker, status }
    const company = getString(entry, 'company')
    if (company !== undefined) item.company = company
    const market = getString(entry, 'market')
    if (market !== undefined) item.market = market
    const currency = getString(entry, 'currency')
    if (currency !== undefined) item.currency = currency
    const reason = getString(entry, 'reason')
    if (reason !== undefined) item.reason = reason
    coverage.push(item)
  }
  return coverage
}

/**
 * Aggregate the per-name deployment ratios in a run's summaries into a run-level mean per ladder (the
 * §7 metric "per ladder type" across the universe). A name with zero BUY episodes contributes 0.
 */
function aggregateDeploymentRatios(summaries: unknown): CalibrationDeploymentRatio[] {
  if (!Array.isArray(summaries)) return []
  const byLadder = new Map<string, { sum: number; episodes: number; count: number }>()
  for (const summary of summaries) {
    if (!isRecord(summary)) continue
    for (const ratio of parseDeploymentRatios(summary['deployment_ratios'])) {
      const acc = byLadder.get(ratio.ladder_id) ?? { sum: 0, episodes: 0, count: 0 }
      acc.sum += ratio.avg_deployment_ratio
      acc.episodes += ratio.episodes
      acc.count += 1
      byLadder.set(ratio.ladder_id, acc)
    }
  }
  return [...byLadder.entries()].map(([ladder_id, acc]) => ({
    ladder_id,
    episodes: acc.episodes,
    avg_deployment_ratio: acc.count === 0 ? 0 : Number((acc.sum / acc.count).toFixed(4)),
  }))
}

export type ProjectCalibrationViewOptions = {
  /** The user-curated universe (loaded from config) to render + join with latest-run coverage. */
  universe?: CalibrationUniverse
  /** Suggested additions (researched / 13F-discovered tickers not yet in the universe). */
  suggestions?: CalibrationUniverseSuggestion[]
}

/** Fold the ledger events into the Calibration page view. */
export function projectCalibrationView(
  events: ReadonlyArray<LedgerEventEnvelope<unknown>>,
  options: ProjectCalibrationViewOptions = {},
): CalibrationView {
  const runs: CalibrationRunView[] = []
  const param_history: CalibrationParamVersion[] = []

  for (const event of events) {
    const payload = isRecord(event.payload) ? event.payload : {}
    if (event.event_type === 'calibration_run') {
      const universe = Array.isArray(payload['universe'])
        ? payload['universe'].filter((u): u is string => typeof u === 'string')
        : []
      // Prefer an explicit run-level deployment_ratios payload; else aggregate from the per-name summaries.
      const explicitRatios = parseDeploymentRatios(payload['deployment_ratios'])
      const universeVersion = getString(payload, 'universe_version')
      const run: CalibrationRunView = {
        event_id: event.event_id,
        recorded_at: event.created_at,
        params_version: getString(payload, 'params_version') ?? 'unknown',
        ...(universeVersion === undefined ? {} : { universe_version: universeVersion }),
        universe,
        summaries: parseSummaries(payload['summaries']),
        deployment_ratios: explicitRatios.length > 0 ? explicitRatios : aggregateDeploymentRatios(payload['summaries']),
        coverage: parseCoverage(payload['coverage']),
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

  // Join the curated universe with the latest run's coverage so each name shows its resolution status.
  let universeView: CalibrationUniverseView | undefined
  if (options.universe !== undefined) {
    const latestCoverage = new Map(runs[0]?.coverage.map((c) => [c.ticker.toUpperCase(), c]) ?? [])
    universeView = {
      version: options.universe.version,
      names: options.universe.names.map((name) => {
        const cov = latestCoverage.get(name.ticker.toUpperCase())
        return {
          ticker: name.ticker,
          company: name.company,
          market: name.market,
          fundamentals_hint: name.fundamentals_hint,
          ...(cov === undefined ? {} : { coverage_status: cov.status }),
          ...(cov?.reason === undefined ? {} : { coverage_reason: cov.reason }),
        }
      }),
      suggestions: options.suggestions ?? [],
    }
  }

  return {
    current_valuation_version: VALUATION_PARAMS.version,
    current_sizing_version: SIZING_PARAMS.version,
    ladders,
    time_completion_months: SIZING_PARAMS.time_completion_months,
    ...(universeView === undefined ? {} : { universe: universeView }),
    runs,
    param_history,
  }
}
