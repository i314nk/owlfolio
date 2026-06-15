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
import { SIZING_PARAMS, type LadderId, type SizingParams } from '@owlfolio/strategies/sizingParams'
import {
  evaluateSizingTranche,
  suggestLadder,
  type SizingCaseStatus,
  type SizingTrancheAlert,
} from './positionSizingEngine'

/** Case is "fresh" only when younger than this many months (spec: <12 mo). */
export const CASE_STALENESS_MONTHS = 12
/** AAOIFI-practice default grace window before a divest draft (spec: 90 days). */
export const SHARIAH_GRACE_DAYS = 90
/**
 * Concentration APPRECIATION-review threshold, in % of NAV (Phase 5 S3 winner-skew split).
 *
 * THIS IS NOT THE 15% DEPLOYMENT CAP. Two DISTINCT thresholds now exist and must not be conflated:
 *   - 15% per_name_cap (DEPLOYMENT): binds NEW buys/adds only, enforced in the sizing engine's
 *     `per_name_cap_reached` gate (evaluateSizingTranche). It does NOT fire on appreciation.
 *   - ~22% concentration_review_threshold (APPRECIATION): a HELD position whose PRICE appreciated past
 *     this raises a FLAGGED HUMAN-REVIEW (logged/signed, "don't move the number").
 *
 * The Phase-5 model fires the appreciation review at ~22%, NOT at 15%. A winner appreciating to 18% NAV
 * (between the deployment cap and the review threshold) raises NOTHING — firing it at 15% would look like
 * an auto-trim-on-price signal (a SILENT failure that violates winner-skew while looking like a feature).
 * NEITHER threshold auto-trims; both are review-only/advisory. The number is config-driven (read from
 * SIZING_PARAMS.concentration_review_threshold); this constant is the default for display/back-compat.
 */
export const CONCENTRATION_REVIEW_THRESHOLD_PCT = SIZING_PARAMS.concentration_review_threshold * 100

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
  /**
   * The position's confirmed, IMMUTABLE ladder id (position-sizing-spec §2). Chosen + human-confirmed at
   * T1; fixed thereafter. When absent, the engine falls back to the configured default ladder via the
   * temperature hook (temperature input deferred until the Marks overlay lands).
   */
  ladder_id?: LadderId
  /**
   * Months since the last tranche FILL (or last re-anchor — whichever reset the clock most recently;
   * spec §4). Drives time-completion. Undefined → time-completion is not evaluated.
   */
  months_since_last_fill?: number
  /** Current position weight as a fraction of investable capital (spec §1/§5 per-name cap check). */
  current_weight?: number
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
// Holdings Monitor (Module 7): position-sizing tranche engine (position-sizing-spec §2–§5)
// ---------------------------------------------------------------------------

/**
 * The richer, config-driven tranche evaluation (position-sizing-spec §2–§5). Bridges the holding/case
 * monitor inputs to the pure positionSizingEngine: re-anchored levels (§3), time-completion (§4), the
 * discipline gates (thesis-break / stale / per-name cap, §5), and deployed-% reporting (§5.5). Every
 * output is a DRAFT/observation carrying the lot-tag fields (tranche_id, trigger_type, buy_price_version)
 * so the human's confirm event can record them. Never an auto-fill.
 *
 * Inputs:
 *   - the holding's confirmed ladder (defaulted via the temperature hook when absent), filled tranches,
 *     months-since-last-fill, and current weight;
 *   - the case's CURRENT (already re-anchored) buy price + version, staleness, thesis-break status, and
 *     whether the most recent scheduled re-check is clean.
 *
 * Re-anchoring is the caller's responsibility (recompute FV/buy on a thesis re-check, then pass the new
 * buy price + version + a reset clock here) — see positionSizingEngine.reanchorTrancheLevels.
 */
export function evaluateHoldingTranche(
  holding: MonitorHoldingInput,
  caseStatus: {
    buy_price: number
    buy_price_version: string
    thesis_break_unresolved: boolean
    stale: boolean
    stale_reason?: string
    recheck_clean: boolean
  },
  opts: { current_price: number; sleeve_id?: string; params?: SizingParams },
): SizingTrancheAlert {
  // Ladder: the position's confirmed immutable ladder, else the temperature-hook default (normal).
  const ladderId: LadderId = holding.ladder_id ?? suggestLadder(undefined, opts.params)
  const sizingCase: SizingCaseStatus = {
    buy_price: caseStatus.buy_price,
    buy_price_version: caseStatus.buy_price_version,
    thesis_break_unresolved: caseStatus.thesis_break_unresolved,
    stale: caseStatus.stale,
    ...(caseStatus.stale_reason === undefined ? {} : { stale_reason: caseStatus.stale_reason }),
    recheck_clean: caseStatus.recheck_clean,
  }
  return evaluateSizingTranche({
    case_status: sizingCase,
    position: {
      ladder_id: ladderId,
      filled_tranche_ids: holding.filled_tranche_ids ?? [],
      ...(holding.months_since_last_fill === undefined ? {} : { months_since_last_fill: holding.months_since_last_fill }),
      ...(holding.current_weight === undefined ? {} : { current_weight: holding.current_weight }),
    },
    current_price: opts.current_price,
    ...(holding.ticker === undefined ? {} : { ticker: holding.ticker }),
    holding_id: holding.holding_id,
    ...(opts.sleeve_id === undefined ? {} : { sleeve_id: opts.sleeve_id }),
    ...(opts.params === undefined ? {} : { params: opts.params }),
  })
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
 * Module 7 concentration check (Phase 5 S3 winner-skew split): position_value / portfolio_NAV.
 *
 * Fires an APPRECIATION-review alert when the weight exceeds the ~22% `concentration_review_threshold`
 * — NOT the 15% deployment cap. The 15% per-name cap is a DEPLOYMENT ceiling on new buys/adds, enforced
 * in the sizing engine; it does NOT belong here and does NOT fire on appreciation. So a winner that
 * appreciated to 18% of NAV (between the two thresholds) raises NOTHING; only at ~22%+ does this raise a
 * FLAGGED HUMAN-REVIEW. NEITHER threshold auto-trims — this is review-only ("winners run; alert ≠
 * auto-trim; never a sale"). Fail-closed: a non-positive NAV → not computable. The threshold is read from
 * config (SizingParams.concentration_review_threshold); mutating it changes the binding point.
 */
export function evaluateConcentration(
  holding: MonitorHoldingInput,
  opts: { portfolio_nav: number; params?: SizingParams },
): ConcentrationResult {
  const reviewThresholdPct = (opts.params ?? SIZING_PARAMS).concentration_review_threshold * 100
  const base = {
    holding_id: holding.holding_id,
    ...(holding.ticker === undefined ? {} : { ticker: holding.ticker }),
    note: 'winners run; this is an appreciation-review alert, never an auto-trim or a sale. The human decides.',
    is_observation: true as const,
    is_recommendation: false as const,
  }
  const value = holding.market_value
  if (!isFiniteNumber(value) || value < 0 || !isFiniteNumber(opts.portfolio_nav) || opts.portfolio_nav <= 0) {
    return { ...base, computable: false, trim_review_alert: false, message: `${holding.ticker ?? holding.holding_id}: NAV / position value unavailable — concentration not computable` }
  }
  const weightPct = Number(((value / opts.portfolio_nav) * 100).toFixed(4))
  // Appreciation review fires at the ~22% review threshold, NOT the 15% deployment cap. A winner between
  // the two thresholds (e.g. 18%) raises NOTHING — firing at 15% on appreciation is the forbidden
  // auto-trim-on-price signal.
  const alert = weightPct > reviewThresholdPct
  return {
    ...base,
    computable: true,
    weight_pct: weightPct,
    trim_review_alert: alert,
    message: alert
      ? `${holding.ticker ?? holding.holding_id}: concentration ${weightPct}% of NAV exceeds the ${reviewThresholdPct}% appreciation-review threshold — flagged human-review (winners run; alert ≠ auto-trim, never a sale). Observation only.`
      : `${holding.ticker ?? holding.holding_id}: concentration ${weightPct}% of NAV within the ${reviewThresholdPct}% appreciation-review threshold`,
  }
}

// ---------------------------------------------------------------------------
// SELL-REVIEW scaffold (drafted, never executed)
// ---------------------------------------------------------------------------

/**
 * The valid SELL-REVIEW reasons (spec sell discipline). `valuation_inverted` (price reached the
 * SIGN-OFF-FROZEN intrinsic value) is the weakest reason to sell a true compounder — it REPLACES the
 * retired `overvaluation_alone` (which compared against a movable/recomputed fair value; the frozen-IV
 * comparison is the don't-move-the-number version). `minimum_hold_released` marks a broken thesis that
 * fired THROUGH the minimum-hold window; `better_opportunity_under_constraint` is the churn-prone switch
 * trigger (always human-signed-off); `original_mistake` is a recognized never-valid-thesis override.
 */
export type SellReviewReasonCode =
  | 'thesis_broken'
  | 'valuation_inverted'
  | 'better_opportunity_under_constraint'
  | 'original_mistake'
  | 'minimum_hold_released'
  | 'unresolvable_shariah_breach'

export type SellReviewDraft = {
  holding_id: string
  ticker?: string
  reason_code: SellReviewReasonCode
  detail: string
  /** All sell-discipline reasons, surfaced so the human weighs them. */
  reasons: SellReviewReasonCode[]
  /**
   * The weakest reason to sell a true compounder — flagged as such. `valuation_inverted` (price reached
   * the sign-off-frozen IV) replaces the retired `overvaluation_alone`.
   */
  weakest_reason: 'valuation_inverted'
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
  'better_opportunity_under_constraint',
  'unresolvable_shariah_breach',
  'valuation_inverted',
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
    weakest_reason: 'valuation_inverted',
    weakest_reason_note: 'Valuation inversion alone (price reached the sign-off-frozen intrinsic value) of a true compounder is the weakest reason to sell — flagged as such.',
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
