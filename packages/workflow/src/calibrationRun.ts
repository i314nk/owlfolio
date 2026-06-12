// Calibration backtest run over the user-curated universe (valuation-recalibration-spec §3 + position-
// sizing-spec §7).
//
// This is the DETERMINISTIC (T0), OBSERVATION-ONLY aggregation the worker drives on-demand (enqueued, not
// a default schedule — calibration is deliberate). For each universe name it:
//   1. resolves PRIMARY annual fundamentals through the TIERED resolver, classified by which lane resolved
//      so the run can produce an honest COVERAGE report:
//        - local-manual store hit            → resolved_local_manual
//        - EDGAR hit (US us-gaap, or foreign 20-F/40-F ifrs-full) → resolved_edgar
//        - neither, or a currency mismatch     → unresolved (an ACTIVE name that failed — a real problem)
//      Names marked status:'deferred' (non-SEC filers with no automated source) are SKIPPED entirely and
//      classified `deferred` — expected, never attempted, never fabricated. The owner does not manual-enter.
//   2. fetches the ~10yr month-end price series in the SAME currency as the fundamentals (fail-closed on a
//      mismatch — no DKK-fundamentals vs USD-ADR-price mixing),
//   3. runs the pure `runValuationBacktest` engine → per-name signal summary + buys/yr + sanity windows +
//      the per-ladder DEPLOYMENT-RATIO metric.
//
// It RECORDS evidence; it NEVER changes parameters. The non-US gap is made visible (unresolved names need
// operator-entered annual-report fundamentals in config/fundamentals/{TICKER}.json) — no third-party
// aggregator, no fabrication.

import {
  EdgarFundamentalsProvider,
  LocalManualFundamentalsProvider,
  type FundamentalsProvider,
  type ResolveFundamentalsDeps,
} from './fundamentalsProvider'
import { fetchMonthEndPriceSeries, fetchSplitEvents, type PriceHistoryResult, type SplitEventsResult } from './marketData'
import { adjustFundamentalsForSplits, runValuationBacktest, type DeploymentRatioByLadder } from './backtest'
import type { CalibrationUniverse, CalibrationUniverseName } from './calibrationUniverse'
import { buffettMungerStrategy } from '@owlfolio/strategies/buffettMunger'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import type { StrategyContract } from '@owlfolio/strategies/strategyContract'
import type { ValuationParams } from '@owlfolio/strategies/valuationParams'
import type { MoatClass, Runway } from '@owlfolio/strategies/strategyContract'

/**
 * Coverage classification for one universe name in a calibration run.
 *   - `resolved_edgar` / `resolved_local_manual`: a primary fundamentals lane resolved the name.
 *   - `deferred`: intentionally NOT run — a non-SEC filer with no automated fundamentals source (the
 *     owner does not manual-enter, we do not use a keyed aggregator). EXPECTED, not a problem.
 *   - `unresolved`: an ACTIVE name that unexpectedly failed to resolve (a real problem to investigate).
 */
export type CoverageStatus = 'resolved_edgar' | 'resolved_local_manual' | 'deferred' | 'unresolved'

export type CalibrationCoverageEntry = {
  ticker: string
  company: string
  market: CalibrationUniverseName['market']
  /** The automated lane the operator expected (active names); absent for deferred names. */
  fundamentals_hint?: CalibrationUniverseName['fundamentals_hint']
  status: CoverageStatus
  /** Resolved currency (when resolved); the value/price currency the backtest used. */
  currency?: string
  /** Honest reason a name is unresolved (active, failed) or deferred (no automated source). */
  reason?: string
}

/** Per-name signal summary carried into the calibration_run event (mirrors CalibrationNameSummary + ratios). */
export type CalibrationNameRunSummary = {
  ticker: string
  moat_class: MoatClass
  runway: Runway
  total_months: number
  buy_months: number
  buys_per_year: number
  buy_episodes: Array<{ start: string; end: string; months: number }>
  sanity_windows: Array<{ window: string; kind: string; signalled: boolean; passed: boolean; covered: boolean }>
  deployment_ratios: DeploymentRatioByLadder[]
  /** Split-consistency / sanity-guard notes (§split-fix C): fiscal years dropped for an implausible share basis. */
  data_quality_notes: string[]
}

export type CalibrationBacktestResult = {
  universe_version: string
  params_version: string
  summaries: CalibrationNameRunSummary[]
  coverage: CalibrationCoverageEntry[]
  coverage_counts: Record<CoverageStatus, number>
}

export type RunCalibrationBacktestDeps = {
  /** Local-manual provider (default reads config/fundamentals). Tests inject an offline stub. */
  localProvider?: FundamentalsProvider
  /** EDGAR provider (default live). Tests inject an offline stub. */
  edgarProvider?: FundamentalsProvider
  /** Price-series fetcher: (symbol, years) -> result. Default fetchMonthEndPriceSeries. */
  priceFetcher?: (symbol: string, years: number) => Promise<PriceHistoryResult>
  /**
   * Stock-split fetcher: (symbol, years) -> split events, for the §split-fix B share-basis adjustment.
   * Default fetchSplitEvents. Tests inject an offline stub; a fetch failure fails open to the unadjusted
   * series plus the always-on sanity guard (C).
   */
  splitFetcher?: (symbol: string, years: number) => Promise<SplitEventsResult>
  /** Optional resolver-dep passthrough (store dir / sec deps) when default providers are used. */
  resolveDeps?: ResolveFundamentalsDeps
  strategy?: StrategyContract
  params?: ValuationParams
  /** Years of month-end prices (default 10). */
  years?: number
  /** Default moat/runway used to value each name (the analyst classification is applied uniformly in the
   *  backtest — see backtest.ts header). Per-name overrides could be added to the universe later. */
  moat_class?: MoatClass
  runway?: Runway
}

const EMPTY_COUNTS = (): Record<CoverageStatus, number> => ({ resolved_edgar: 0, resolved_local_manual: 0, deferred: 0, unresolved: 0 })

/**
 * Run the calibration backtest over the user-curated universe. Deterministic + observation-only: returns
 * the per-name summaries + the coverage report + the universe/params versions. The caller records this as
 * a `calibration_run` ledger event (it never mutates params).
 */
export async function runCalibrationBacktest(
  universe: CalibrationUniverse,
  deps: RunCalibrationBacktestDeps = {},
): Promise<CalibrationBacktestResult> {
  const strategy = deps.strategy ?? buffettMungerStrategy
  const params = deps.params ?? VALUATION_PARAMS
  const years = deps.years ?? 10
  const moat_class = deps.moat_class ?? 'wide'
  const runway = deps.runway ?? 'proven'

  const localProvider = deps.localProvider
    ?? deps.resolveDeps?.localProvider
    ?? new LocalManualFundamentalsProvider(deps.resolveDeps?.localStoreDir)
  const edgarProvider = deps.edgarProvider
    ?? deps.resolveDeps?.edgarProvider
    ?? new EdgarFundamentalsProvider(deps.resolveDeps?.fetchEdgar, deps.resolveDeps?.secDeps)
  const priceFetcher = deps.priceFetcher
    ?? ((symbol: string, yrs: number) => fetchMonthEndPriceSeries(symbol, yrs))
  const splitFetcher = deps.splitFetcher
    ?? ((symbol: string, yrs: number) => fetchSplitEvents(symbol, yrs))

  const summaries: CalibrationNameRunSummary[] = []
  const coverage: CalibrationCoverageEntry[] = []
  const coverage_counts = EMPTY_COUNTS()

  for (const name of universe.names) {
    const base = {
      ticker: name.ticker,
      company: name.company,
      market: name.market,
      ...(name.fundamentals_hint === undefined ? {} : { fundamentals_hint: name.fundamentals_hint }),
    }

    // Deferred names (non-SEC filers with no automated fundamentals source) are intentionally NOT run:
    // we do not attempt resolution and we do not fabricate. They are classified as `deferred` (expected),
    // distinct from `unresolved` (an active name that unexpectedly failed). The owner does not manual-enter.
    if (name.status === 'deferred') {
      coverage.push({
        ...base,
        status: 'deferred',
        reason: name.defer_reason ?? 'Non-SEC filer — no automated fundamentals source; manual entry intentionally not used.',
      })
      coverage_counts.deferred += 1
      continue
    }

    // Tiered resolution, lane-classified (local-manual override wins, then EDGAR).
    let status: CoverageStatus
    let fundamentals = await safeResolve(localProvider, name.ticker)
    if (fundamentals !== undefined) {
      status = 'resolved_local_manual'
    } else {
      fundamentals = await safeResolve(edgarProvider, name.ticker)
      status = fundamentals === undefined ? 'unresolved' : 'resolved_edgar'
    }

    if (fundamentals === undefined) {
      coverage.push({ ...base, status: 'unresolved', reason: 'no fundamentals (no local-manual entry + no EDGAR coverage) — needs operator-entered annual-report figures' })
      coverage_counts.unresolved += 1
      continue
    }

    const hasFiled = fundamentals.annual_series.some((a) => typeof a.filed === 'string' && a.filed !== '')
    if (!hasFiled) {
      coverage.push({ ...base, status: 'unresolved', currency: fundamentals.currency, reason: 'fundamentals series carries no per-year filed dates — cannot run as-of backtest' })
      coverage_counts.unresolved += 1
      continue
    }

    const priceSeries = await priceFetcher(name.ticker, years).catch(() => ({ available: false as const, reason: 'price fetch threw' }))
    if (!priceSeries.available) {
      coverage.push({ ...base, status: 'unresolved', currency: fundamentals.currency, reason: `no month-end price series: ${priceSeries.reason}` })
      coverage_counts.unresolved += 1
      continue
    }

    // Currency consistency: OE_ps (fundamentals currency) and price MUST be the same currency.
    if (priceSeries.currency !== fundamentals.currency) {
      coverage.push({ ...base, status: 'unresolved', currency: fundamentals.currency, reason: `currency mismatch: fundamentals in ${fundamentals.currency} but price in ${priceSeries.currency} — supply a local-listing price or local-manual fundamentals in a matching currency` })
      coverage_counts.unresolved += 1
      continue
    }

    // §split-fix B: adjust the EDGAR as-reported share series to the SAME split-adjusted basis as the
    // (Yahoo, split-adjusted) price series. Fail open to the unadjusted series + the always-on sanity
    // guard (C) when splits can't be fetched, so a split-fetch outage degrades rather than fabricates.
    const splitEvents = await splitFetcher(name.ticker, years + 6).catch(() => ({ available: false as const, reason: 'split fetch threw' }))
    const valuationFundamentals = splitEvents.available
      ? adjustFundamentalsForSplits(fundamentals, splitEvents.splits)
      : fundamentals

    const result = runValuationBacktest({
      ticker: name.ticker,
      moat_class,
      runway,
      fundamentals: valuationFundamentals,
      price_series: priceSeries.points,
      strategy,
      params,
    })

    summaries.push({
      ticker: name.ticker,
      moat_class: result.moat_class,
      runway: result.runway,
      total_months: result.summary.total_months,
      buy_months: result.summary.buy_months,
      buys_per_year: result.summary.buys_per_year,
      buy_episodes: result.summary.buy_episodes.map((e) => ({ start: e.start, end: e.end, months: e.months })),
      sanity_windows: result.summary.sanity_windows.map((w) => ({ window: w.window, kind: w.kind, signalled: w.signalled, passed: w.passed, covered: w.covered })),
      deployment_ratios: result.summary.deployment_ratios,
      data_quality_notes: result.data_quality_notes,
    })
    coverage.push({ ...base, status, currency: fundamentals.currency })
    coverage_counts[status] += 1
  }

  return {
    universe_version: universe.version,
    params_version: params.version,
    summaries,
    coverage,
    coverage_counts,
  }
}

async function safeResolve(provider: FundamentalsProvider, ticker: string) {
  try {
    return await provider.resolve(ticker)
  } catch {
    return undefined
  }
}
