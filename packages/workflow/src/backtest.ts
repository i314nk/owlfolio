// Calibration backtest engine (valuation-recalibration-spec §3, acceptance #4).
//
// Replays the config-driven two-stage Buffett valuation over ~10 years of month-end prices. For each
// month-end it computes Owner Earnings from the 10-K an analyst would have HAD as-of that month (the
// latest annual_series entry whose `filed` date <= the month), values it with VALUATION_PARAMS, and maps
// price → BUY / WATCH-FAIR / WATCH (the recalibration verdict mapping). Consecutive BUY months collapse
// into one episode; the summary reports buys/yr + the spec §3.1 sanity-window checks.
//
// PURE + DETERMINISTIC: no fetch inside the engine. It takes `fundamentals` + `price_series` as inputs so
// it is fully testable with fixtures. The runner (backtest.runner-style backtestName) does the fetching.
//
// Backtest approximations (documented, honest — see §"Approximations"):
//   - maintenance_capex = min(D&A, capex) for the period. Historically we have no per-period LLM
//     maintenance-fraction tier, so this is the conservative structural default.
//   - ΔNWC = 0 (recurring working-capital investment not modelled in the backtest).
//   - moat_class + runway are fixed across history (an analyst's classification today applied backward) —
//     the backtest validates the price/valuation signal, not a time-varying quality re-classification.

import {
  creditedGrowth,
  moatPassesGate,
  stage1HorizonForMoat,
  terminalGrowthForMoat,
  twoStageValuation,
  widenedMarginOfSafety,
} from '@owlfolio/strategies/buffettMunger'
import type { MoatClass, Runway, StrategyContract } from '@owlfolio/strategies/strategyContract'
import type { ValuationParams } from '@owlfolio/strategies/valuationParams'
import { maintenanceCapexLowConfidence, demonstratedOwnerEarningsGrowth, type AnnualFacts, type Fundamentals, type SecEdgarDeps } from './secEdgar'
import { resolveFundamentalsForTicker, type ResolveFundamentalsDeps } from './fundamentalsProvider'
import {
  cumulativeSplitFactorAfter,
  fetchMonthEndPriceSeries,
  fetchSplitEvents,
  type MarketDataDeps,
  type PriceHistoryPoint,
  type SplitEvent,
} from './marketData'
import { buffettMungerStrategy } from '@owlfolio/strategies/buffettMunger'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import {
  SIZING_PARAMS,
  TRANCHE_TRIGGER_MULTIPLIER,
  type LadderId,
  type SizingParams,
} from '@owlfolio/strategies/sizingParams'

/** The recalibration verdict mapping (spec §2 + the gate). */
export type Signal = 'BUY' | 'WATCH-FAIR' | 'WATCH' | 'PASS'

/** One month-end observation in the signal log. */
export type SignalLogEntry = {
  /** Month-end date (YYYY-MM-DD) of the price observation. */
  date: string
  /** Month-end close used. */
  price: number
  /** Owner earnings per share computed from the as-of filing. */
  oe_ps: number
  /** Credited growth g used for the two-stage DCF. */
  credited_g: number
  /** Fair value per share (two-stage DCF, UNCAPPED — Phase 1.6; the cap is a surfaced flag, not a truncation). */
  fair_value_ps: number
  /** Buy price per share (FV × (1 − widened MOS)). */
  buy_price_ps: number
  /** Implied FV multiple (fair_value_ps / oe_ps). */
  implied_multiple: number
  /** Phase 1.6: true when the fair value exceeds the 18× OE sanity-flag threshold (surfaced, not truncated). */
  cap_exceeded: boolean
  /** Verdict for this month. */
  signal: Signal
  /** Fiscal year of the 10-K that was available as-of this month. */
  filing_fy: number
}

/** A contiguous run of BUY months (one dislocation episode). */
export type BuyEpisode = {
  start: string
  end: string
  months: number
  /** Lowest price observed during the episode. */
  min_price: number
}

/** Result of checking the spec §3.1 sanity windows against the actual BUY months. */
export type SanityWindowCheck = {
  /** Window label, e.g. '2020-03..2020-05'. */
  window: string
  /** Whether this window is a must-signal anchor or a must-not-signal region. */
  kind: 'must_signal' | 'must_not_signal'
  /** Whether any BUY month fell inside the window. */
  signalled: boolean
  /** Whether the observed behaviour matches the spec target (must_signal→true, must_not→false). */
  passed: boolean
  /** Whether the price_series actually covered any month inside the window. */
  covered: boolean
}

/**
 * Deployment-ratio metric (position-sizing-spec §7): the mean % of the target position actually
 * deployed across historical BUY signals, per ladder type. Computed by simulating the ladder fills
 * against the historical price path (which tranches would have triggered by price or time-completion →
 * what fraction deployed). Surfaced so the calibration review can tune fractions / N against evidence.
 */
export type DeploymentRatioByLadder = {
  ladder_id: LadderId
  /** Number of BUY episodes simulated. */
  episodes: number
  /** Mean deployed fraction of target across those episodes (0..1). */
  avg_deployment_ratio: number
}

export type BacktestSummary = {
  total_months: number
  /** Months skipped because no 10-K had been filed yet. */
  skipped_months_no_filing: number
  buy_months: number
  watch_fair_months: number
  watch_months: number
  pass_months: number
  buy_episodes: BuyEpisode[]
  /** BUY months per year over the covered span. */
  buys_per_year: number
  /** First and last dates actually evaluated (signal log span). */
  span_start?: string
  span_end?: string
  sanity_windows: SanityWindowCheck[]
  /** position-sizing-spec §7 deployment-ratio metric, per ladder type. */
  deployment_ratios: DeploymentRatioByLadder[]
}

export type BacktestResult = {
  ticker: string
  moat_class: MoatClass
  runway: Runway
  params_version: string
  signal_log: SignalLogEntry[]
  summary: BacktestSummary
  /**
   * Visible data-quality notes from the split-consistency / sanity guard (§split-fix C): each entry names
   * a fiscal year whose share basis was implausible (a near-zero units artifact, or an unexplained >1.5×
   * adjusted-share discontinuity) and was therefore SKIPPED rather than allowed to emit a spurious BUY.
   * Empty when the series is clean. Surfaced so a calibration run never silently swallows a dropped year.
   */
  data_quality_notes: string[]
}

export type RunValuationBacktestArgs = {
  ticker: string
  moat_class: MoatClass
  runway: Runway
  fundamentals: Fundamentals
  price_series: PriceHistoryPoint[]
  strategy: StrategyContract
  params: ValuationParams
  /** runway_exceptional flag forwarded to creditedGrowth (default false). */
  runway_exceptional?: boolean
  /** Per-name fallback incremental ROIC when the as-of EDGAR series can't compute one. */
  fallback_incremental_roic?: number
  /** Per-name reinvestment rate for the credited-growth raw capacity (default 0.5). */
  reinvestment_rate?: number
}

/** The spec §3.1 sanity windows (inclusive month boundaries, YYYY-MM). */
const SANITY_WINDOWS: ReadonlyArray<{ window: string; kind: 'must_signal' | 'must_not_signal'; from: string; to: string }> = [
  { window: '2020-03..2020-05', kind: 'must_signal', from: '2020-03', to: '2020-05' },
  { window: '2022-09..2023-01', kind: 'must_signal', from: '2022-09', to: '2023-01' },
  // "2021 broad US large-cap quality at peak multiples" — a system buying here is loose.
  { window: '2021-01..2021-12', kind: 'must_not_signal', from: '2021-01', to: '2021-12' },
]

/**
 * Pick the latest annual_series entry whose `filed` date is <= the given month-end date — the 10-K an
 * analyst would have HAD as-of that month. Returns undefined when no filing had been filed yet (or none
 * of the entries carry a filed date), so the caller skips the month.
 */
export function asOfFiling(annual_series: AnnualFacts[], monthEnd: string): AnnualFacts | undefined {
  let best: AnnualFacts | undefined
  for (const a of annual_series) {
    if (typeof a.filed !== 'string' || a.filed === '') continue
    if (a.filed <= monthEnd) {
      if (best === undefined || a.filed > (best.filed ?? '')) best = a
    }
  }
  return best
}

/**
 * Owner earnings per share from one filing (buffett-valuation-method-v2 Step 2):
 *   OE_total = NI + D&A − maintenance_capex − SBC − ΔNWC
 *   maintenance_capex = min(D&A, capex)  (backtest default — no per-period LLM tier available historically)
 *   ΔNWC = 0  (backtest default)
 *   OE_ps = OE_total / diluted_shares (that filing's shares)
 * Returns undefined when NI or diluted shares are missing/non-positive.
 */
export function ownerEarningsPerShare(a: AnnualFacts): number | undefined {
  const ni = a.net_income_musd
  const shares = a.diluted_shares_m
  if (ni === undefined || !Number.isFinite(ni)) return undefined
  if (shares === undefined || !Number.isFinite(shares) || shares <= 0) return undefined
  const da = a.d_and_a_musd ?? 0
  const capex = a.capex_musd ?? 0
  const sbc = a.sbc_musd ?? 0
  const maintenance_capex = Math.min(da, capex)
  const oe_total = ni + da - maintenance_capex - sbc // − ΔNWC (0)
  return oe_total / shares
}

// ---------------------------------------------------------------------------
// Split-consistency (§split-fix B) — put as-reported EDGAR shares on TODAY's split-adjusted basis
// ---------------------------------------------------------------------------

/**
 * Adjust each annual entry's `diluted_shares_m` to TODAY's split-adjusted basis so OE-per-share is on the
 * SAME basis as Yahoo's split-adjusted price series (the calibration backtest's core comparison).
 *
 * The EDGAR as-reported share count for a year reflects the share basis AS OF THE FILING — a 10-K's
 * comparatives are all on the filing-date basis, and the filer restates prior-year comparatives after a
 * split but does NOT re-file the older 10-Ks. So a year's reported count is on the basis of its `filed`
 * date; multiplying by the product of every split that took effect AFTER that filed date brings it onto
 * today's basis. (Using `filed` — not `period_end` — is what makes a restated post-split comparative,
 * filed after the split, correctly carry factor 1 while the original pre-split filing carries the full
 * factor.) OE_total is a currency flow and is split-invariant, so only the share denominator is scaled.
 *
 * Pure: returns a new Fundamentals (entries cloned) and never mutates the input. A no-split list is a
 * no-op (every factor is 1).
 */
export function adjustFundamentalsForSplits(fundamentals: Fundamentals, splits: ReadonlyArray<SplitEvent>): Fundamentals {
  const adjust = (a: AnnualFacts): AnnualFacts => {
    if (a.diluted_shares_m === undefined || !Number.isFinite(a.diluted_shares_m)) return { ...a }
    const ref = (typeof a.filed === 'string' && a.filed !== '') ? a.filed : (a.period_end ?? '')
    const factor = ref === '' ? 1 : cumulativeSplitFactorAfter(splits, ref)
    return { ...a, diluted_shares_m: a.diluted_shares_m * factor }
  }
  const annual_series = fundamentals.annual_series.map(adjust)
  return {
    ...fundamentals,
    latest_annual: adjust(fundamentals.latest_annual),
    annual_series,
  }
}

// Phase 1.6: the legacy IMPLAUSIBLE_BUY_PRICE_PS net is superseded by twoStageValuation's absurd-error
// guard (≥ params.fv_absurd_multiple × OE → value discarded), which keys off the OE multiple directly.
// An adjusted-share count this far below the series median is a units artifact (not a real buyback) — the
// C-guard mirror of the EDGAR power-of-ten share normalization, catching anything that slipped through
// AFTER split adjustment (e.g. CPRT fy2012 = 0.13M).
const IMPLAUSIBLE_SHARE_RATIO = 100

/**
 * Identify fiscal years whose (already split-adjusted) share basis is implausible — a near-zero units
 * artifact (≥100× below the series median diluted-share count) — and must be SKIPPED in the backtest so a
 * division-by-near-zero never produces a spurious BUY (the CPRT-fy2012 / MCD-near-zero class of bug). Pure;
 * returns the set of suspect fiscal years plus a human-readable note per dropped year.
 */
function findSuspectShareYears(series: ReadonlyArray<AnnualFacts>): { years: Set<number>; notes: string[] } {
  const shares = series
    .map((a) => a.diluted_shares_m)
    .filter((v): v is number => v !== undefined && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b)
  const years = new Set<number>()
  const notes: string[] = []
  if (shares.length < 2) return { years, notes }
  const median = shares[Math.floor(shares.length / 2)]!
  if (!(median > 0)) return { years, notes }
  for (const a of series) {
    const s = a.diluted_shares_m
    if (s === undefined || !Number.isFinite(s) || s <= 0 || median / s >= IMPLAUSIBLE_SHARE_RATIO) {
      if (a.diluted_shares_m !== undefined) {
        years.add(a.fiscal_year)
        notes.push(`FY${a.fiscal_year}: implausible diluted-share basis (${formatShares(a.diluted_shares_m)} vs series median ${formatShares(median)}) — units artifact; year skipped`)
      }
    }
  }
  return { years, notes }
}

function formatShares(v: number): string {
  return `${v.toFixed(v < 1 ? 4 : 1)}M`
}

/**
 * Group a date-ordered signal log into BUY episodes: each maximal run of consecutive BUY months is one
 * episode. Exported for direct unit testing. Input entries must already be in ascending date order.
 */
export function groupBuyEpisodes(
  entries: ReadonlyArray<{ date: string; signal: Signal; price?: number }>,
): BuyEpisode[] {
  const episodes: BuyEpisode[] = []
  let current: { start: string; end: string; months: number; min_price: number } | undefined
  for (const e of entries) {
    if (e.signal === 'BUY') {
      const price = e.price ?? Number.POSITIVE_INFINITY
      if (current === undefined) {
        current = { start: e.date, end: e.date, months: 1, min_price: price }
      } else {
        current.end = e.date
        current.months += 1
        if (price < current.min_price) current.min_price = price
      }
    } else if (current !== undefined) {
      episodes.push(current)
      current = undefined
    }
  }
  if (current !== undefined) episodes.push(current)
  return episodes
}

/** Map (price, buy, fv) → verdict. Gated names never BUY. */
function classify(price: number, buy: number, fv: number, gated: boolean): Signal {
  if (gated) {
    // Below-wide moats are gated out: never a harness BUY. WATCH while cheap-ish, PASS when expensive.
    return price <= fv ? 'PASS' : 'WATCH'
  }
  if (price <= buy) return 'BUY'
  if (price <= fv) return 'WATCH-FAIR'
  return 'WATCH'
}

function monthInWindow(date: string, fromMonth: string, toMonth: string): boolean {
  const month = date.slice(0, 7)
  return month >= fromMonth && month <= toMonth
}

/**
 * Run the calibration backtest over a 10-year month-end price series. Pure: takes fundamentals + price
 * series, returns the signal log + summary. See file header for approximations.
 */
export function runValuationBacktest(args: RunValuationBacktestArgs): BacktestResult {
  const { ticker, moat_class, runway, fundamentals, price_series, strategy, params } = args
  // Phase 1.3: growth is the demonstrated OE/share CAGR — reinvestment_rate/incremental_roic no longer
  // feed the growth path (the args fields are retained on the public type for back-compat / callers).
  const gated = !moatPassesGate(strategy, moat_class)

  // Ascending date order so as-of stepping + episode grouping are correct.
  const ordered = [...price_series].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  const signal_log: SignalLogEntry[] = []
  let skipped_months_no_filing = 0

  // §split-fix C: identify fiscal years whose (split-adjusted) share basis is a units artifact, so months
  // whose as-of filing is such a year are skipped VISIBLY rather than emitting a division-by-near-zero BUY.
  const { years: suspectYears, notes: data_quality_notes } = findSuspectShareYears(fundamentals.annual_series)

  for (const point of ordered) {
    const filing = asOfFiling(fundamentals.annual_series, point.date)
    if (filing === undefined) {
      skipped_months_no_filing += 1
      continue
    }
    if (suspectYears.has(filing.fiscal_year)) {
      // As-of a units-artifact filing year — skip (the note already records why).
      skipped_months_no_filing += 1
      continue
    }
    const oe_ps = ownerEarningsPerShare(filing)
    if (oe_ps === undefined || oe_ps <= 0) {
      // No usable owner earnings as-of this filing — cannot value; skip.
      skipped_months_no_filing += 1
      continue
    }

    // Demonstrated owner-earnings growth (Phase 1.3) from the OE/share series available AS-OF this filing.
    // Uses the ROBUST log-linear measure (split-adjustment + outlier-resistant) — the SAME measure the live
    // researchSwarm uses, so the calibration freezes MoS against production's growth input, not a stale one.
    // (Fundamentals are already split-adjusted upstream in calibrationRun; the internal split-detect is a no-op.)
    const asOfSeries = fundamentals.annual_series.filter((a) => a.fiscal_year <= filing.fiscal_year)
    const growthMeasure = demonstratedOwnerEarningsGrowth(asOfSeries)
    if (growthMeasure.growth === undefined) {
      // Fail-closed: too little OE/share history (<3 usable points) for a robust growth estimate. SKIP the
      // month rather than valuing at g=0 — a zero-growth fallback crushes FV and emits a misleading WATCH/PASS
      // (the GOOGL-pre-2021 artifact: D&A is untagged before FY2021, so its series is too short to value then).
      skipped_months_no_filing += 1
      const note = `FY${filing.fiscal_year}: insufficient OE/share history (<3 points) for a robust growth estimate — month skipped`
      if (!data_quality_notes.includes(note)) data_quality_notes.push(note)
      continue
    }
    const demonstrated_growth = growthMeasure.growth

    // For gated names we still compute a nominal FV/buy (using monopoly tier as a neutral basis) purely
    // to bucket WATCH/PASS; the verdict can never be BUY (classify() enforces the gate).
    const tierForValuation: MoatClass = gated ? 'monopoly' : moat_class
    // ONE growth path: the named cap + above-GDP coupling flag (Phase 1.3). Agent may argue lower (no agent
    // in the backtest → demonstrated growth flows straight through the cap).
    const growthResult = creditedGrowth(strategy, { demonstrated_growth })
    const credited_g = growthResult.growth
    // Phase 1.6 (1.9 finding): the one-knob engine — the 18× OE cap is a SURFACED flag, NOT a silent
    // truncation; only an absurd (≥100× OE) value is discarded as a units bug. Conservatism is carried by
    // the single MoS knob, which WIDENS for the documented uncertainties (above-GDP moat-durability claim,
    // genuine maint-capex dispersion, high terminal-value share).
    const valuation = twoStageValuation({
      oe_ps,
      g: credited_g,
      terminal_g: terminalGrowthForMoat(strategy, tierForValuation),
      discount: params.discount_rate,
      ceiling_multiple: params.fv_cap_multiple,
      absurd_multiple: params.fv_absurd_multiple,
      horizon: stage1HorizonForMoat(strategy, tierForValuation),
    })
    // Absurd-value guard (replaces the legacy IMPLAUSIBLE_BUY_PRICE net): a units-bug fair value is
    // discarded VISIBLY rather than emitting a bogus signal for the month.
    if (valuation.absurd || valuation.fair_value === undefined) {
      skipped_months_no_filing += 1
      const note = `FY${filing.fiscal_year}: absurd fair value (≥${params.fv_absurd_multiple}× OE) — likely collapsed share basis; month skipped`
      if (!data_quality_notes.includes(note)) data_quality_notes.push(note)
      continue
    }
    const fair_value_ps = valuation.fair_value
    // Single MoS knob, widened by the documented uncertainties (no live agent → derive inputs from the data).
    const widened = widenedMarginOfSafety(strategy, {
      moat_class: tierForValuation,
      terminal_value_pct_of_iv: valuation.terminal_value_pct_of_iv,
      low_maint_capex_confidence: maintenanceCapexLowConfidence(asOfSeries),
      weak_moat_durability: growthResult.above_gdp,
    })
    const buy_price_ps = fair_value_ps * (1 - widened.margin_of_safety)
    const signal = classify(point.close, buy_price_ps, fair_value_ps, gated)

    signal_log.push({
      date: point.date,
      price: point.close,
      oe_ps,
      credited_g,
      fair_value_ps,
      buy_price_ps,
      implied_multiple: fair_value_ps / oe_ps,
      cap_exceeded: valuation.cap_exceeded,
      signal,
      filing_fy: filing.fiscal_year,
    })
  }

  const summary = buildSummary(signal_log, skipped_months_no_filing)
  return {
    ticker,
    moat_class,
    runway,
    params_version: params.version,
    signal_log,
    summary,
    data_quality_notes,
  }
}

/** A minimal month-end observation the deployment simulation needs (date, price, the as-of buy price). */
type DeploymentStep = { date: string; price: number; buy_price_ps: number; signal: Signal }

function monthsBetweenDates(fromIso: string, toIso: string): number {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
}

/**
 * Simulate one ladder's deployment over the price path that FOLLOWS a BUY signal (position-sizing-spec
 * §7). Starting at the BUY month (T1 fires at buy by definition), step forward month-by-month: a
 * subsequent rung fills when the price reaches its (re-anchored-to-the-as-of-buy) level OR by
 * time-completion (price at/below buy for ≥ N months since the last fill, clean re-check assumed in the
 * backtest). Returns the deployed fraction of target for this episode (0..1).
 *
 * Re-anchoring is honoured by using each month's as-of buy_price_ps for the level math; the clock resets
 * on every fill. The backtest assumes a clean re-check at each step (it is a price/parameter calibration,
 * not a thesis-health re-derivation — see file header).
 */
export function simulateLadderDeployment(
  steps: ReadonlyArray<DeploymentStep>,
  ladderId: LadderId,
  params: SizingParams = SIZING_PARAMS,
): number {
  if (steps.length === 0) return 0
  const rungs = params.ladders[ladderId].rungs
  const monthsThreshold = params.ladders[ladderId].time_completion_months ?? params.time_completion_months
  const filled = new Set<string>()
  let lastFillDate = steps[0]?.date ?? ''
  // T1 fires at buy by definition (this is the BUY episode entry).
  const t1 = rungs.find((r) => r.trigger === 'buy')
  if (t1 !== undefined) filled.add(t1.id)

  for (const step of steps) {
    // The next untriggered non-T1 rung (config order).
    const next = rungs.find((r) => r.trigger !== 'buy' && !filled.has(r.id))
    if (next === undefined) break
    const level = step.buy_price_ps * TRANCHE_TRIGGER_MULTIPLIER[next.trigger]
    const priceHit = step.price <= level
    const monthsSinceFill = monthsBetweenDates(lastFillDate, step.date)
    const timeHit = step.price <= step.buy_price_ps && monthsSinceFill >= monthsThreshold
    if (priceHit || timeHit) {
      filled.add(next.id)
      lastFillDate = step.date
    }
  }

  const deployed = rungs.filter((r) => filled.has(r.id)).reduce((sum, r) => sum + r.fraction, 0)
  return Number(deployed.toFixed(4))
}

/**
 * Compute the deployment-ratio metric for a ladder across all BUY episodes in a signal log (spec §7).
 * Each maximal run of BUY months is one episode; the simulation steps from the episode's first BUY month
 * to the end of the available history (the price path the position would have laddered into). The result
 * is the mean deployed fraction across episodes.
 */
export function computeDeploymentRatio(
  signal_log: ReadonlyArray<SignalLogEntry>,
  ladderId: LadderId,
  params: SizingParams = SIZING_PARAMS,
): DeploymentRatioByLadder {
  const buyStartIdxs: number[] = []
  for (let i = 0; i < signal_log.length; i += 1) {
    const isBuy = signal_log[i]?.signal === 'BUY'
    const prevBuy = i > 0 && signal_log[i - 1]?.signal === 'BUY'
    if (isBuy && !prevBuy) buyStartIdxs.push(i)
  }
  if (buyStartIdxs.length === 0) {
    return { ladder_id: ladderId, episodes: 0, avg_deployment_ratio: 0 }
  }
  const ratios = buyStartIdxs.map((startIdx) => {
    const steps: DeploymentStep[] = signal_log.slice(startIdx).map((e) => ({
      date: e.date,
      price: e.price,
      buy_price_ps: e.buy_price_ps,
      signal: e.signal,
    }))
    return simulateLadderDeployment(steps, ladderId, params)
  })
  const mean = ratios.reduce((sum, r) => sum + r, 0) / ratios.length
  return { ladder_id: ladderId, episodes: buyStartIdxs.length, avg_deployment_ratio: Number(mean.toFixed(4)) }
}

function buildSummary(signal_log: SignalLogEntry[], skipped: number): BacktestSummary {
  const buy_months = signal_log.filter((e) => e.signal === 'BUY').length
  const watch_fair_months = signal_log.filter((e) => e.signal === 'WATCH-FAIR').length
  const watch_months = signal_log.filter((e) => e.signal === 'WATCH').length
  const pass_months = signal_log.filter((e) => e.signal === 'PASS').length
  const buy_episodes = groupBuyEpisodes(signal_log)

  const span_start = signal_log[0]?.date
  const span_end = signal_log[signal_log.length - 1]?.date
  let buys_per_year = 0
  if (span_start !== undefined && span_end !== undefined) {
    const years = Math.max(
      (Date.parse(span_end) - Date.parse(span_start)) / (365.25 * 24 * 3600 * 1000),
      1 / 12,
    )
    buys_per_year = buy_months / years
  }

  const buyDates = signal_log.filter((e) => e.signal === 'BUY').map((e) => e.date)
  const coveredDates = signal_log.map((e) => e.date)
  const sanity_windows: SanityWindowCheck[] = SANITY_WINDOWS.map((w) => {
    const covered = coveredDates.some((d) => monthInWindow(d, w.from, w.to))
    const signalled = buyDates.some((d) => monthInWindow(d, w.from, w.to))
    const passed = w.kind === 'must_signal' ? signalled : !signalled
    return { window: w.window, kind: w.kind, signalled, passed, covered }
  })

  // position-sizing-spec §7: deployment ratio per ladder type (cold 40/30/30, normal 60/40).
  const deployment_ratios: DeploymentRatioByLadder[] = (['cold', 'normal'] as LadderId[]).map((ladderId) =>
    computeDeploymentRatio(signal_log, ladderId),
  )

  return {
    total_months: signal_log.length,
    skipped_months_no_filing: skipped,
    buy_months,
    watch_fair_months,
    watch_months,
    pass_months,
    buy_episodes,
    buys_per_year,
    ...(span_start === undefined ? {} : { span_start }),
    ...(span_end === undefined ? {} : { span_end }),
    sanity_windows,
    deployment_ratios,
  }
}

// ---------------------------------------------------------------------------
// Runner — fetch EDGAR + Yahoo, then run the pure engine (Part 2)
// ---------------------------------------------------------------------------

export type BacktestNameArgs = {
  ticker: string
  moat_class: MoatClass
  runway: Runway
  /** Years of month-end prices to fetch (default 10). */
  years?: number
  runway_exceptional?: boolean
  fallback_incremental_roic?: number
  reinvestment_rate?: number
  /** Optional non-US market hint for Yahoo (e.g. for an ambiguous symbol). */
  market?: string
  /**
   * Explicit Yahoo price SYMBOL to fetch instead of `ticker`. Required for currency consistency when a
   * name's fundamentals are non-USD: e.g. Novo Nordisk reports in DKK (ifrs-full 20-F), so pass the
   * Copenhagen listing `NOVO-B.CO` (DKK) rather than letting Yahoo default to the USD `NVO` ADR. OE_ps
   * (fundamentals currency) and price MUST be the same currency or the verdict is meaningless.
   */
  price_symbol?: string
  /**
   * Expected price currency. When set, the backtest asserts the fetched price series currency AND the
   * fundamentals currency both equal this — fail-closed (returns { ok:false }) on any mismatch so a DKK
   * fundamental is never silently valued against a USD ADR price. When unset, the backtest still rejects
   * a mismatch between the fundamentals currency and the price-series currency.
   */
  price_currency?: string
  strategy?: StrategyContract
  params?: ValuationParams
  secDeps?: SecEdgarDeps
  marketDeps?: MarketDataDeps
  /** Override the fundamentals resolver chain (tests inject offline fixtures). */
  fundamentalsDeps?: ResolveFundamentalsDeps
}

export type BacktestNameResult =
  | { ok: true; result: BacktestResult }
  | { ok: false; reason: string }

/**
 * Runner: resolve fundamentals (local-manual store -> EDGAR: us-gaap/USD + ifrs-full/non-USD, 10-K/20-F/
 * 40-F) + ~10yr Yahoo month-end prices for one reference name and run the pure backtest. Fail-closed:
 * returns { ok: false } when fundamentals or price data is unavailable, OR when the price currency does
 * not match the fundamentals currency (no silent DKK-fundamentals vs USD-ADR-price mixing).
 *
 * Currency consistency: international names report in their functional currency (Novo Nordisk = DKK).
 * Pass `price_symbol` (e.g. 'NOVO-B.CO') so the price is fetched in the SAME currency as the
 * fundamentals; the runner asserts currency equality and rejects a mismatch.
 */
export async function backtestName(args: BacktestNameArgs): Promise<BacktestNameResult> {
  const fundamentals = await resolveFundamentalsForTicker(args.ticker, {
    ...(args.secDeps === undefined ? {} : { secDeps: args.secDeps }),
    ...(args.fundamentalsDeps ?? {}),
  })
  if (fundamentals === undefined) {
    return { ok: false, reason: `no fundamentals for ${args.ticker} (no local-manual entry + no EDGAR coverage)` }
  }
  const hasFiled = fundamentals.annual_series.some((a) => typeof a.filed === 'string' && a.filed !== '')
  if (!hasFiled) {
    return { ok: false, reason: `fundamentals series for ${args.ticker} carries no per-year filed dates` }
  }
  const priceSymbol = args.price_symbol ?? args.ticker
  const priceSeries = await fetchMonthEndPriceSeries(priceSymbol, args.years ?? 10, args.marketDeps, args.market)
  if (!priceSeries.available) {
    return { ok: false, reason: `no month-end price series for ${priceSymbol}: ${priceSeries.reason}` }
  }

  // §split-fix B: put the EDGAR as-reported share series on the SAME split-adjusted basis as the price
  // series. Yahoo's prices are split-adjusted; without this the OE-per-share denominator carries split
  // discontinuities (GOOGL 20:1, CPRT/NKE/MA) that fabricate BUY runs. Fetch the split events for the
  // PRICE symbol (same instrument as the price series) over a long-enough window to cover the history;
  // fail-open to the unadjusted series + the always-on sanity guard (C) when splits can't be fetched.
  const splitYears = (args.years ?? 10) + 6
  const splitEvents = await fetchSplitEvents(priceSymbol, splitYears, args.marketDeps, args.market)
  const adjustedFundamentals = splitEvents.available
    ? adjustFundamentalsForSplits(fundamentals, splitEvents.splits)
    : fundamentals

  // Currency consistency: OE_ps (fundamentals currency) and price MUST be the same currency.
  if (priceSeries.currency !== fundamentals.currency) {
    return {
      ok: false,
      reason: `currency mismatch: fundamentals in ${fundamentals.currency} but price ${priceSymbol} in ${priceSeries.currency} — pass a price_symbol on the local listing (e.g. NOVO-B.CO for DKK) to match`,
    }
  }
  if (args.price_currency !== undefined && args.price_currency !== fundamentals.currency) {
    return {
      ok: false,
      reason: `expected price_currency ${args.price_currency} but fundamentals are in ${fundamentals.currency}`,
    }
  }

  const result = runValuationBacktest({
    ticker: args.ticker,
    moat_class: args.moat_class,
    runway: args.runway,
    fundamentals: adjustedFundamentals,
    price_series: priceSeries.points,
    strategy: args.strategy ?? buffettMungerStrategy,
    params: args.params ?? VALUATION_PARAMS,
    ...(args.runway_exceptional === undefined ? {} : { runway_exceptional: args.runway_exceptional }),
    ...(args.fallback_incremental_roic === undefined ? {} : { fallback_incremental_roic: args.fallback_incremental_roic }),
    ...(args.reinvestment_rate === undefined ? {} : { reinvestment_rate: args.reinvestment_rate }),
  })
  return { ok: true, result }
}

/**
 * Render a backtest result as a human-readable signal-log report (operator entry point — the controller
 * can call this via tsx). Pure string builder; does NOT write files.
 */
export function formatBacktestReport(result: BacktestResult): string {
  const s = result.summary
  const lines: string[] = []
  lines.push(`Calibration backtest — ${result.ticker} (${result.moat_class}/${result.runway}) — params ${result.params_version}`)
  lines.push(`Span: ${s.span_start ?? 'n/a'} → ${s.span_end ?? 'n/a'} | months evaluated: ${s.total_months} | skipped (no filing): ${s.skipped_months_no_filing}`)
  lines.push(`BUY months: ${s.buy_months} | WATCH-FAIR: ${s.watch_fair_months} | WATCH: ${s.watch_months} | PASS: ${s.pass_months}`)
  lines.push(`Buys/year: ${s.buys_per_year.toFixed(2)} | BUY episodes: ${s.buy_episodes.length}`)
  for (const ep of s.buy_episodes) {
    lines.push(`  episode ${ep.start} → ${ep.end} (${ep.months} mo, min price ${ep.min_price.toFixed(2)})`)
  }
  for (const w of s.sanity_windows) {
    const cov = w.covered ? '' : ' [NOT COVERED by price history]'
    lines.push(`  sanity ${w.window} [${w.kind}]: signalled=${w.signalled} passed=${w.passed}${cov}`)
  }
  for (const d of s.deployment_ratios) {
    lines.push(`  deployment ${d.ladder_id} ladder: avg ${(d.avg_deployment_ratio * 100).toFixed(1)}% of target across ${d.episodes} BUY episode(s)`)
  }
  return lines.join('\n')
}
