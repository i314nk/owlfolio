// Lifecycle Monitors — Module 6 (Watchlist) + Module 7 (Holdings) of buffett-agent-lifecycle-spec-v3.
//
// These are the DETERMINISTIC (T0, model-tiering-spec) parts of the "keep watching" loop: price math,
// the freshness/staleness rule, the AAOIFI ratio re-screen, tranche-trigger price math, concentration,
// and the Shariah 90-day grace clock. Every output is an OBSERVATION or a human-authored-decision DRAFT
// — NEVER an auto-trade, an auto-state-advance, or a recommendation to act (§ Non-Negotiables 8).
//
// The EVENT-DRIVEN thesis-break-trigger DETECTION (scanning news/filings for the RISKS-lane
// thesis_break_triggers) is the T3 model part and is DEFERRED — see buildSellReviewScaffold's
// deferred_detection_note and the TODO seam below. The monitors here ACT on a fired trigger (→ a
// SELL-REVIEW scaffold) but do not DETECT firing.
//
// All functions are pure: callers inject the current price, the EDGAR fundamentals / ratio inputs, and
// the clock. No live fetch happens here, mirroring the test-mode-gated / fail-closed price-feed posture.

import {
  computeShariahFinancialRatios,
  type ShariahFinancialRatioInputs,
  type ShariahFinancialVerdict,
} from '@owlfolio/strategies/shariahFinancialRatios'
import type { StrategyContract } from '@owlfolio/strategies/strategyContract'

/** Case is "fresh" only when younger than this many months (spec: <12 mo). */
export const CASE_STALENESS_MONTHS = 12
/** AAOIFI-practice default grace window before a divest draft (spec: 90 days). */
export const SHARIAH_GRACE_DAYS = 90
/** Concentration trim-review threshold (spec: > 15% NAV). */
export const CONCENTRATION_TRIM_THRESHOLD_PCT = 15

// ---------------------------------------------------------------------------
// Shared input shapes (already-projected; callers pull these from projections)
// ---------------------------------------------------------------------------

export type MonitorResearchCaseInput = {
  research_case_id: string
  ticker?: string
  /** When the latest research case version was last updated (ISO). Drives the staleness clock. */
  updated_at: string
  buy_price_per_share?: number
  fair_value_per_share?: number
  moat_class?: string
  /** valuation-recalibration-spec §2 verdict band: BUY-WINDOW | WATCH-FAIR | WATCH (informational). */
  verdict_state?: string
  /** Synthesis investment verdict (BUY/WATCH draft vs PASS/GATED). PASS/GATED is not gate-clean. */
  investment_verdict?: string
  /** Harness/lane Shariah status; only PASS/CONDITIONAL is gate-clean. */
  shariah_status?: string
  /** True when a newer version supersedes this case (stale). */
  superseded?: boolean
}

export type MonitorHoldingInput = {
  holding_id: string
  ticker?: string
  research_case_id?: string
  /** The holding's entry buy price (cost-basis reference) — anchors the tranche ladder. */
  entry_buy_price?: number
  /** Latest market value of this position (price × shares). */
  market_value?: number
  /** When the holding's research case was last updated (ISO) — drives the annual re-run flag. */
  case_updated_at?: string
  /** Tranche ids already filled for this holding (so a filled tranche does not re-fire). */
  filled_tranche_ids?: string[]
}

// ---------------------------------------------------------------------------
// Date helpers (deterministic; clock is always injected)
// ---------------------------------------------------------------------------

function monthsBetween(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12
    + (to.getUTCMonth() - from.getUTCMonth())
    + (to.getUTCDate() >= from.getUTCDate() ? 0 : -1)
}

function addDaysIso(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// ---------------------------------------------------------------------------
// Case freshness / staleness (the load-bearing Non-Negotiable #5)
// ---------------------------------------------------------------------------

export type CaseFreshnessResult = {
  fresh: boolean
  age_months: number
  stale_reason?: string
}

/**
 * A case is FRESH when it is younger than 12 months, NOT superseded, and no newer annual report has
 * been filed since the case was last updated. Otherwise it is STALE — "stale cheapness is not a signal".
 */
export function evaluateCaseFreshness(
  researchCase: Pick<MonitorResearchCaseInput, 'updated_at' | 'superseded'>,
  opts: { now: Date; latest_annual_report_filed?: string },
): CaseFreshnessResult {
  const updatedAt = new Date(researchCase.updated_at)
  const ageMonths = Number.isFinite(updatedAt.getTime()) ? monthsBetween(updatedAt, opts.now) : Number.POSITIVE_INFINITY

  if (researchCase.superseded === true) {
    return { fresh: false, age_months: ageMonths, stale_reason: 'research case has been superseded by a newer version' }
  }
  if (ageMonths >= CASE_STALENESS_MONTHS) {
    return { fresh: false, age_months: ageMonths, stale_reason: `research case is older than 12 months (${ageMonths} mo)` }
  }
  if (opts.latest_annual_report_filed !== undefined && opts.latest_annual_report_filed > researchCase.updated_at.slice(0, 10)) {
    return {
      fresh: false,
      age_months: ageMonths,
      stale_reason: `a newer annual report (${opts.latest_annual_report_filed}) was filed since the research case`,
    }
  }
  return { fresh: true, age_months: ageMonths }
}

/**
 * Gate-clean = the synthesis verdict is NOT a PASS/GATED kill AND the Shariah status is PASS/CONDITIONAL.
 * No gate is price-overridable (Non-Negotiable #3): a cheap price never makes a gated case investable.
 */
export function isGateClean(
  researchCase: Pick<MonitorResearchCaseInput, 'investment_verdict' | 'shariah_status'>,
): { clean: boolean; reason?: string } {
  const verdict = researchCase.investment_verdict?.toUpperCase()
  if (verdict === 'PASS' || verdict === 'GATED' || verdict === 'REJECT' || verdict === 'REJECTED') {
    return { clean: false, reason: `synthesis verdict ${verdict} fails the hard gates (not price-overridable)` }
  }
  const shariah = researchCase.shariah_status?.toUpperCase()
  if (shariah !== undefined && shariah !== 'PASS' && shariah !== 'CONDITIONAL' && shariah !== 'COMPLIANT') {
    return { clean: false, reason: `Shariah status ${shariah} is not PASS/CONDITIONAL` }
  }
  return { clean: true }
}

// ---------------------------------------------------------------------------
// Watchlist Monitor (Module 6): buy-window
// ---------------------------------------------------------------------------

export type WatchlistBuyWindowResult = {
  research_case_id: string
  ticker?: string
  /** True only on a fresh + gate-clean + cheap case. */
  buy_window_alert: boolean
  /** True when a cheap price was seen but suppressed (stale and/or gated). */
  suppressed: boolean
  suppression_reason?: string
  /** True when the case must be re-run before any buy signal is valid. */
  rerun_needed: boolean
  /** Discount of current price to the buy price, in % (positive = below buy). Present when cheap. */
  discount_to_buy_pct?: number
  freshness: CaseFreshnessResult
  /** These outputs are observations, never recommendations. */
  is_observation: true
  is_recommendation: false
  message: string
}

/**
 * Module 6 buy-window check. Fetch-free: the caller injects the current price + clock.
 * Fires a BUY-WINDOW alert ONLY on a FRESH, gate-clean case whose price ≤ buy price. A stale case with a
 * cheap price is SUPPRESSED with a re-run-needed flag (Non-Negotiable #5). Fail-closed: missing buy price
 * or price → no alert.
 */
export function evaluateWatchlistBuyWindow(
  researchCase: MonitorResearchCaseInput,
  opts: { current_price: number; now: Date; latest_annual_report_filed?: string },
): WatchlistBuyWindowResult {
  const freshness = evaluateCaseFreshness(researchCase, {
    now: opts.now,
    ...(opts.latest_annual_report_filed === undefined ? {} : { latest_annual_report_filed: opts.latest_annual_report_filed }),
  })
  const base = {
    research_case_id: researchCase.research_case_id,
    ...(researchCase.ticker === undefined ? {} : { ticker: researchCase.ticker }),
    freshness,
    is_observation: true as const,
    is_recommendation: false as const,
  }

  const buyPrice = researchCase.buy_price_per_share
  if (!isFiniteNumber(buyPrice) || buyPrice <= 0 || !isFiniteNumber(opts.current_price) || opts.current_price <= 0) {
    return {
      ...base,
      buy_window_alert: false,
      suppressed: false,
      rerun_needed: false,
      message: `${researchCase.ticker ?? researchCase.research_case_id}: no buy price / price available — no buy-window evaluation`,
    }
  }

  const cheap = opts.current_price <= buyPrice
  const discountPct = Number((((buyPrice - opts.current_price) / buyPrice) * 100).toFixed(4))

  if (!cheap) {
    return {
      ...base,
      buy_window_alert: false,
      suppressed: false,
      rerun_needed: !freshness.fresh,
      message: `${researchCase.ticker ?? researchCase.research_case_id}: price ${opts.current_price} above buy price ${buyPrice}; no buy-window`,
    }
  }

  // Price is cheap. Now apply the staleness + gate gates.
  if (!freshness.fresh) {
    return {
      ...base,
      buy_window_alert: false,
      suppressed: true,
      rerun_needed: true,
      suppression_reason: `${freshness.stale_reason}; re-run needed before any buy signal — stale cheapness is not a signal`,
      discount_to_buy_pct: discountPct,
      message: `${researchCase.ticker ?? researchCase.research_case_id}: price ${opts.current_price} ≤ buy price ${buyPrice} but case is STALE — buy alert SUPPRESSED (re-run needed); observation only`,
    }
  }

  const gate = isGateClean(researchCase)
  if (!gate.clean) {
    return {
      ...base,
      buy_window_alert: false,
      suppressed: true,
      rerun_needed: false,
      suppression_reason: `${gate.reason}; no gate is price-overridable`,
      discount_to_buy_pct: discountPct,
      message: `${researchCase.ticker ?? researchCase.research_case_id}: price ≤ buy price but case is NOT gate-clean (${gate.reason}) — buy alert SUPPRESSED; observation only`,
    }
  }

  return {
    ...base,
    buy_window_alert: true,
    suppressed: false,
    rerun_needed: false,
    discount_to_buy_pct: discountPct,
    message: `${researchCase.ticker ?? researchCase.research_case_id}: BUY-WINDOW — price ${opts.current_price} is ${discountPct}% below the buy price ${buyPrice} on a fresh, gate-clean case. Observation only; opening a holding requires explicit human approval.`,
  }
}

// ---------------------------------------------------------------------------
// Shariah re-screen (quarterly) — watchlist
// ---------------------------------------------------------------------------

export type ShariahRescreenResult = {
  computable: boolean
  flagged: boolean
  verdict?: ShariahFinancialVerdict
  /** FAIL → propose watchlist removal; CONDITIONAL → re-screen only. */
  propose_removal: boolean
  purification_pct?: number
  reason?: string
  is_observation: true
  is_recommendation: false
}

/**
 * Module 6 quarterly Shariah financial re-screen. Recomputes the three AAOIFI ratios deterministically
 * (caller supplies EDGAR fundamentals + 36-mo-avg market cap). A breach flags a re-screen; a FAIL
 * proposes watchlist removal (a proposal — the human authors the removal). Fail-closed: non-computable
 * inputs → not flagged.
 */
export function evaluateShariahRescreen(ratios: ShariahFinancialRatioInputs): ShariahRescreenResult {
  const result = computeShariahFinancialRatios(ratios)
  if (!result.computable) {
    return {
      computable: false,
      flagged: false,
      propose_removal: false,
      reason: result.reason,
      is_observation: true,
      is_recommendation: false,
    }
  }
  const breached = result.verdict === 'FAIL' || result.verdict === 'CONDITIONAL'
  return {
    computable: true,
    flagged: breached,
    verdict: result.verdict,
    propose_removal: result.verdict === 'FAIL',
    purification_pct: result.purification_pct,
    ...(breached
      ? { reason: result.verdict === 'FAIL' ? 'AAOIFI ratio FAIL — propose watchlist removal (human authors)' : 'AAOIFI ratio CONDITIONAL — propose re-screen / purification refresh' }
      : {}),
    is_observation: true,
    is_recommendation: false,
  }
}

// ---------------------------------------------------------------------------
// Holdings Monitor (Module 7): tranche triggers (daily)
// ---------------------------------------------------------------------------

const TRANCHE_THESIS_GATED_NOTE =
  'thesis re-check FIRST, then deploy — never mechanical averaging-down. This alert is advisory; the human deploys.'

export type TrancheTriggerResult = {
  holding_id: string
  ticker?: string
  /** Tranche ids whose price trigger fired and which are not yet filled. */
  triggered_tranches: string[]
  tranche_review_alert: boolean
  thesis_gated_note: string
  trigger_prices: { id: string; trigger_price: number }[]
  is_observation: true
  is_recommendation: false
  message: string
}

/**
 * Module 7 daily tranche trigger. Using the strategy's price-laddered entry tranches (T1 @ buy, T2 @
 * −10%, T3 @ −20%) anchored to the holding's entry buy price: if the current price ≤ a tranche trigger
 * and that tranche is not yet filled → a thesis-gated tranche-review alert. The alert carries the spec's
 * rule (thesis re-check first); it never deploys capital.
 */
export function evaluateTrancheTriggers(
  strategy: StrategyContract,
  holding: MonitorHoldingInput,
  opts: { current_price: number },
): TrancheTriggerResult {
  const base = {
    holding_id: holding.holding_id,
    ...(holding.ticker === undefined ? {} : { ticker: holding.ticker }),
    thesis_gated_note: TRANCHE_THESIS_GATED_NOTE,
    is_observation: true as const,
    is_recommendation: false as const,
  }

  const entry = holding.entry_buy_price
  const tranches = strategy.portfolio.entry_tranches ?? []
  if (!isFiniteNumber(entry) || entry <= 0 || !isFiniteNumber(opts.current_price) || opts.current_price <= 0 || tranches.length === 0) {
    return { ...base, triggered_tranches: [], tranche_review_alert: false, trigger_prices: [], message: `${holding.ticker ?? holding.holding_id}: no entry price / tranches — no tranche evaluation` }
  }

  const filled = new Set(holding.filled_tranche_ids ?? [])
  const triggerPrices = tranches.map((tranche) => {
    const triggerPrice = tranche.trigger === 'pct_below_buy_price' ? entry * (1 - tranche.pct) : entry
    return { id: tranche.id, trigger_price: Number(triggerPrice.toFixed(4)) }
  })

  // Tranche-review alerts fire on the discount tranches (T2/T3). T1 @ buy is the initial entry, not a
  // pullback-review trigger, so it is excluded from the "averaging-down" review alert.
  const triggered = tranches
    .filter((tranche) => tranche.trigger === 'pct_below_buy_price')
    .filter((tranche) => !filled.has(tranche.id))
    .filter((tranche) => opts.current_price <= entry * (1 - tranche.pct))
    .map((tranche) => tranche.id)

  return {
    ...base,
    triggered_tranches: triggered,
    tranche_review_alert: triggered.length > 0,
    trigger_prices: triggerPrices,
    message: triggered.length > 0
      ? `${holding.ticker ?? holding.holding_id}: tranche-review — price ${opts.current_price} reached ${triggered.join('/')} trigger(s). ${TRANCHE_THESIS_GATED_NOTE} Observation only.`
      : `${holding.ticker ?? holding.holding_id}: no unfilled tranche trigger reached`,
  }
}

// ---------------------------------------------------------------------------
// Holdings Monitor (Module 7): concentration
// ---------------------------------------------------------------------------

export type ConcentrationResult = {
  holding_id: string
  ticker?: string
  computable: boolean
  weight_pct?: number
  trim_review_alert: boolean
  note: string
  is_observation: true
  is_recommendation: false
  message: string
}

/**
 * Module 7 concentration check: position_value / portfolio_NAV. > 15% → a trim-review alert ("winners
 * run; alert ≠ auto-trim"). Fail-closed: a non-positive NAV → not computable.
 */
export function evaluateConcentration(
  holding: MonitorHoldingInput,
  opts: { portfolio_nav: number },
): ConcentrationResult {
  const base = {
    holding_id: holding.holding_id,
    ...(holding.ticker === undefined ? {} : { ticker: holding.ticker }),
    note: 'winners run; this is a trim-review alert, never an auto-trim. The human decides.',
    is_observation: true as const,
    is_recommendation: false as const,
  }
  const value = holding.market_value
  if (!isFiniteNumber(value) || value < 0 || !isFiniteNumber(opts.portfolio_nav) || opts.portfolio_nav <= 0) {
    return { ...base, computable: false, trim_review_alert: false, message: `${holding.ticker ?? holding.holding_id}: NAV / position value unavailable — concentration not computable` }
  }
  const weightPct = Number(((value / opts.portfolio_nav) * 100).toFixed(4))
  const alert = weightPct > CONCENTRATION_TRIM_THRESHOLD_PCT
  return {
    ...base,
    computable: true,
    weight_pct: weightPct,
    trim_review_alert: alert,
    message: alert
      ? `${holding.ticker ?? holding.holding_id}: concentration ${weightPct}% of NAV exceeds the ${CONCENTRATION_TRIM_THRESHOLD_PCT}% cap — trim-review alert. Winners run; alert ≠ auto-trim. Observation only.`
      : `${holding.ticker ?? holding.holding_id}: concentration ${weightPct}% of NAV within the ${CONCENTRATION_TRIM_THRESHOLD_PCT}% cap`,
  }
}

// ---------------------------------------------------------------------------
// SELL-REVIEW scaffold (drafted, never executed)
// ---------------------------------------------------------------------------

/** The valid SELL-REVIEW reasons (spec sell discipline). overvaluation_alone is the weakest. */
export type SellReviewReasonCode =
  | 'thesis_broken'
  | 'materially_better_opportunity'
  | 'unresolvable_shariah_breach'
  | 'overvaluation_alone'

export type SellReviewDraft = {
  holding_id: string
  ticker?: string
  reason_code: SellReviewReasonCode
  detail: string
  /** All sell-discipline reasons, surfaced so the human weighs them. */
  reasons: SellReviewReasonCode[]
  /** Overvaluation alone of a true compounder is the weakest reason — flagged as such. */
  weakest_reason: 'overvaluation_alone'
  weakest_reason_note: string
  /** A SELL-REVIEW is a draft the human authors into an exit; it is never an execution. */
  is_execution: false
  is_recommendation: false
  requires_user_authoring: true
  /** Present when the trigger detection is the deferred T3 piece (a stub). */
  deferred_detection_note?: string
}

const SELL_REVIEW_REASONS: SellReviewReasonCode[] = [
  'thesis_broken',
  'materially_better_opportunity',
  'unresolvable_shariah_breach',
  'overvaluation_alone',
]

/**
 * Build the SELL-REVIEW draft scaffold (spec sell discipline). Emitted when a sell trigger fires — for
 * the Shariah-grace-expiry case (deterministic, built here) and the (stubbed) thesis-break case. The
 * DETECTION of a thesis-break trigger firing is the DEFERRED T3 scanner; this scaffold only structures
 * the human-authored exit proposal. It is a DRAFT, never an execution or a recommendation.
 */
export function buildSellReviewScaffold(
  holding: MonitorHoldingInput,
  args: { reason_code: SellReviewReasonCode; detail: string; thesis_break_trigger_stubbed?: boolean },
): SellReviewDraft {
  return {
    holding_id: holding.holding_id,
    ...(holding.ticker === undefined ? {} : { ticker: holding.ticker }),
    reason_code: args.reason_code,
    detail: args.detail,
    reasons: SELL_REVIEW_REASONS,
    weakest_reason: 'overvaluation_alone',
    weakest_reason_note: 'Overvaluation alone of a true compounder is the weakest reason to sell — flagged as such.',
    is_execution: false,
    is_recommendation: false,
    requires_user_authoring: true,
    ...(args.thesis_break_trigger_stubbed === true
      ? {
          // DEFERRED SEAM: the T3 model + news/filing source that DETECTS a thesis_break_triggers firing
          // is not built here. The monitor ACTS on a fired trigger; detection is a TODO.
          deferred_detection_note:
            'DEFERRED (T3): event-driven thesis-break-trigger detection (news/filing scan against the RISKS-lane thesis_break_triggers) is not implemented. This draft was raised by a stubbed trigger; wire the T3 scanner here.',
        }
      : {}),
  }
}

// ---------------------------------------------------------------------------
// Holdings Monitor (Module 7): Shariah ratio breach → 90-day grace → DIVEST draft
// ---------------------------------------------------------------------------

export type ShariahGraceResult = {
  holding_id: string
  ticker?: string
  computable: boolean
  verdict?: ShariahFinancialVerdict
  /** True when a fresh breach with no open grace should START a 90-day grace period. */
  start_grace: boolean
  /** Deadline (YYYY-MM-DD) of the grace period being started (present when start_grace). */
  grace_deadline?: string
  /** True when an open grace is unresolved past its deadline → emit a DIVEST-REQUIRED draft. */
  divest_required_draft: boolean
  draft?: SellReviewDraft
  is_observation: true
  is_recommendation: false
  message: string
}

/**
 * Module 7 quarterly Shariah breach handling with the AAOIFI-practice 90-day grace clock:
 *   - clean ratios → nothing.
 *   - breach (FAIL/CONDITIONAL→FAIL handled by verdict) + no open grace → START a 90-day grace.
 *   - breach + open grace not yet past deadline → wait (no new grace).
 *   - breach + open grace past deadline → a DIVEST-REQUIRED draft (a human-authored exit proposal).
 * The divest draft is a DRAFT, never an execution. Fail-closed: non-computable ratios → nothing.
 */
export function evaluateShariahGrace(
  holding: MonitorHoldingInput,
  opts: {
    ratios: ShariahFinancialRatioInputs
    now: Date
    open_grace?: { started_at: string; deadline: string }
  },
): ShariahGraceResult {
  const base = {
    holding_id: holding.holding_id,
    ...(holding.ticker === undefined ? {} : { ticker: holding.ticker }),
    is_observation: true as const,
    is_recommendation: false as const,
  }
  const result = computeShariahFinancialRatios(opts.ratios)
  if (!result.computable) {
    return { ...base, computable: false, start_grace: false, divest_required_draft: false, message: `${holding.ticker ?? holding.holding_id}: Shariah ratios not computable (${result.reason})` }
  }
  if (result.verdict !== 'FAIL') {
    return {
      ...base,
      computable: true,
      verdict: result.verdict,
      start_grace: false,
      divest_required_draft: false,
      message: `${holding.ticker ?? holding.holding_id}: Shariah ratio verdict ${result.verdict} — no grace action`,
    }
  }

  // Breach (FAIL). Drive the grace clock.
  if (opts.open_grace === undefined) {
    const deadline = addDaysIso(opts.now, SHARIAH_GRACE_DAYS)
    return {
      ...base,
      computable: true,
      verdict: 'FAIL',
      start_grace: true,
      grace_deadline: deadline,
      divest_required_draft: false,
      message: `${holding.ticker ?? holding.holding_id}: AAOIFI ratio breach — starting a ${SHARIAH_GRACE_DAYS}-day grace period (deadline ${deadline}). Observation only.`,
    }
  }

  const nowDate = opts.now.toISOString().slice(0, 10)
  const expired = nowDate > opts.open_grace.deadline
  if (!expired) {
    return {
      ...base,
      computable: true,
      verdict: 'FAIL',
      start_grace: false,
      divest_required_draft: false,
      message: `${holding.ticker ?? holding.holding_id}: AAOIFI breach unresolved but grace open until ${opts.open_grace.deadline} — no divest draft yet`,
    }
  }

  const draft = buildSellReviewScaffold(holding, {
    reason_code: 'unresolvable_shariah_breach',
    detail: `AAOIFI financial ratio breach unresolved past the ${SHARIAH_GRACE_DAYS}-day grace deadline ${opts.open_grace.deadline}. A divest is required; the human authors the exit.`,
  })
  return {
    ...base,
    computable: true,
    verdict: 'FAIL',
    start_grace: false,
    divest_required_draft: true,
    draft,
    message: `${holding.ticker ?? holding.holding_id}: DIVEST-REQUIRED draft — AAOIFI breach unresolved past grace deadline ${opts.open_grace.deadline}. Human-authored exit proposal (draft, not an execution).`,
  }
}

// ---------------------------------------------------------------------------
// Annual deep re-run (Module 6 + 7)
// ---------------------------------------------------------------------------

export type AnnualRerunResult = {
  rerun_needed: boolean
  age_months: number
  is_observation: true
}

/** A research case older than 12 months → flag a full annual deep re-run (supersedes the prior case). */
export function evaluateAnnualRerun(caseUpdatedAt: string, opts: { now: Date }): AnnualRerunResult {
  const updatedAt = new Date(caseUpdatedAt)
  const ageMonths = Number.isFinite(updatedAt.getTime()) ? monthsBetween(updatedAt, opts.now) : Number.POSITIVE_INFINITY
  return { rerun_needed: ageMonths >= CASE_STALENESS_MONTHS, age_months: ageMonths, is_observation: true }
}
