// Lifecycle Cadence Engine — Phase 3, Task 3.2.
//
// Phase 3 collapses the workflow to "one list of names, each in a STATE (candidate|watched|held|exited),
// one cadence engine." This module is that engine. It runs over the unified name-list read model
// (`nameLifecycleProjection`, Task 3.1) on a quarterly (10-Q / falsifier) and annual (10-K / re-underwrite)
// cadence, reusing the existing pure monitors in `lifecycleMonitors.ts`.
//
// THE LOAD-BEARING DISCIPLINE:
//   Detection is STATE-INDEPENDENT; only the ACTION branches on state.
//
//   - `detectSignals(name, asOfData)` takes NO `state` parameter. It computes a uniform set of atomic,
//     grounded signals from the name's data + as-of inputs. The same name-data yields the same signals
//     regardless of the name's state. (Data-absence simply does not raise a signal — that is NOT a
//     state-branch.)
//   - `selectAction(signal, state)` is the ONLY place state appears. It is written as a TOTAL
//     `(signal × state)` lookup table: every pair resolves to an explicit action or an explicit no_op,
//     and an unknown pair THROWS.
//
// Everything here is PURE and deterministic: the clock (`now`) is injected via `asOfData`; no module-level
// `new Date()` / `Date.now()`; no network. No events are emitted here — the worker adapter (a later task)
// maps actions → ledger events.

import type {
  NameLifecycleProjection,
  NameLifecycleState,
} from '@owlfolio/ledger/projections/nameLifecycleProjection'
import type { ShariahFinancialRatioInputs } from '@owlfolio/strategies/shariahFinancialRatios'
import {
  evaluateAnnualRerun,
  evaluateCaseFreshness,
  evaluateConcentration,
  evaluateShariahRescreen,
  isGateClean,
} from './lifecycleMonitors'

// ---------------------------------------------------------------------------
// Signals (atomic, grounded; state-independent)
// ---------------------------------------------------------------------------

export type LifecycleSignal =
  | 'stale'
  | 'gated'
  | 'price_crossed_buybelow'
  | 'shariah_breach'
  | 'reunderwrite_due'
  | 'falsifier_tripped'
  | 'over_concentrated'

/** The full signal vocabulary — used for the totality table and its tests. */
export const LIFECYCLE_SIGNALS: readonly LifecycleSignal[] = [
  'stale',
  'gated',
  'price_crossed_buybelow',
  'shariah_breach',
  'reunderwrite_due',
  'falsifier_tripped',
  'over_concentrated',
] as const

/** The full state vocabulary — used for the totality table and its tests. */
export const LIFECYCLE_STATES: readonly NameLifecycleState[] = [
  'candidate',
  'watched',
  'held',
  'exited',
] as const

/**
 * As-of inputs the caller injects for a cadence pass. All are optional except the clock: an absent input
 * simply means the dependent signal is not raised (fail-closed; absence is NOT a state-branch).
 */
export type CadenceAsOfData = {
  /** Injected clock (deterministic). */
  now: Date
  /** Latest observed price for the name (price feed; fail-closed when absent). */
  current_price?: number
  /** AAOIFI re-screen ratio inputs (EDGAR fundamentals + market cap), when available. */
  shariah_ratios?: ShariahFinancialRatioInputs
  /** Latest market value of the position (price × shares) — feeds concentration. */
  market_value?: number
  /** Portfolio NAV — feeds concentration; concentration is not computable without it. */
  portfolio_nav?: number
  /** A newer annual report filed since the case (ISO YYYY-MM-DD) — feeds the freshness/staleness rule. */
  latest_annual_report_filed?: string
  /**
   * DEFERRED T3 SEAM: an event-driven thesis-break trigger firing. The scanner that DETECTS a
   * thesis_break_triggers firing (news/filing scan against the RISKS lane) is NOT built here. This is a
   * visible, explicit input that defaults to false — detection is not fabricated. When true, it raises
   * `falsifier_tripped` exactly as the projection's own `falsifier_tripped` flag does.
   */
  thesis_break?: boolean
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Compute the uniform set of grounded signals for a name from its data + as-of inputs.
 *
 * STATE-INDEPENDENT BY CONSTRUCTION: there is NO `state` parameter. Two names with identical data but
 * different `state` produce identical signals. The state-invariance test guards this; do NOT add a state
 * argument here (or to the monitors) — branching on state belongs only in `selectAction`.
 */
export function detectSignals(name: NameLifecycleProjection, asOfData: CadenceAsOfData): LifecycleSignal[] {
  const signals: LifecycleSignal[] = []

  // stale ← case freshness rule (>12mo / superseded / newer annual report). The projection's name-level
  // `updated_at` is the freshness clock and `superseded` is a freshness FACT (a superseded case is stale
  // regardless of age); both are name-data, so the SIGNAL is raised uniformly — only the action (see
  // selectAction) is state-sensitive. `superseded` is NOT a state-branch.
  const freshness = evaluateCaseFreshness(
    { updated_at: name.updated_at, ...(name.superseded === undefined ? {} : { superseded: name.superseded }) },
    {
      now: asOfData.now,
      ...(asOfData.latest_annual_report_filed === undefined
        ? {}
        : { latest_annual_report_filed: asOfData.latest_annual_report_filed }),
    },
  )
  if (freshness.fresh === false) {
    signals.push('stale')
  }

  // gated ← the name is not gate-clean. The projection already folds gate cleanliness; when present we
  // trust it directly, otherwise fall back to the monitor over the projected shariah gate status.
  const gateClean =
    name.gate_clean ??
    isGateClean(name.shariah_gate_status === undefined ? {} : { shariah_status: name.shariah_gate_status }).clean
  if (gateClean === false) {
    signals.push('gated')
  }

  // price_crossed_buybelow ← current price at/below the locked buy-below price.
  if (
    isFiniteNumber(asOfData.current_price) &&
    isFiniteNumber(name.buy_price_per_share) &&
    asOfData.current_price <= name.buy_price_per_share
  ) {
    signals.push('price_crossed_buybelow')
  }

  // shariah_breach ← a re-screen FLAG over supplied ratios, OR the name's embedded shariah gate is FAIL.
  const ratioBreach =
    asOfData.shariah_ratios !== undefined && evaluateShariahRescreen(asOfData.shariah_ratios).flagged
  const embeddedFail = name.shariah_gate_status?.toUpperCase() === 'FAIL'
  if (ratioBreach || embeddedFail) {
    signals.push('shariah_breach')
  }

  // reunderwrite_due ← the case is >= 12 months old → an annual deep re-run is due.
  if (evaluateAnnualRerun(name.updated_at, { now: asOfData.now }).rerun_needed) {
    signals.push('reunderwrite_due')
  }

  // falsifier_tripped ← the projection's own honesty bit OR the deferred thesis_break seam (default false).
  if (name.falsifier_tripped === true || asOfData.thesis_break === true) {
    signals.push('falsifier_tripped')
  }

  // over_concentrated ← position weight past the ~22% appreciation-review threshold (Phase 5 S3 — NOT
  // the 15% deployment cap; review-only, never an auto-trim). Only computable with market value + NAV.
  if (isFiniteNumber(asOfData.market_value) && isFiniteNumber(asOfData.portfolio_nav)) {
    const concentration = evaluateConcentration(
      { holding_id: name.holding_id ?? name.ticker, market_value: asOfData.market_value },
      { portfolio_nav: asOfData.portfolio_nav },
    )
    if (concentration.trim_review_alert) {
      signals.push('over_concentrated')
    }
  }

  return signals
}

// ---------------------------------------------------------------------------
// Actions + the total (signal × state) lookup table
// ---------------------------------------------------------------------------

export type LifecycleActionKind =
  | 'buy_eval'
  | 'sell_review'
  | 'reprice_or_prune_review'
  | 'shariah_grace_or_divest'
  | 'removal_review'
  | 're_underwrite'
  | 'trim_review'
  | 'suppress'
  | 'no_op'

export type LifecycleAction = {
  kind: LifecycleActionKind
  reason?: string
  /** Present on a reprice_or_prune_review: there is no prune event in the ledger yet (Phase 6.6). */
  prune_action_available?: boolean
}

function noOp(reason: string): LifecycleAction {
  return { kind: 'no_op', reason }
}

/**
 * The TOTAL `(signal × state)` action table, keyed by `${signal}:${state}`. Every cell is explicit — an
 * actionable kind OR an explicit `no_op` with a reason. A missing/unknown pair makes `selectAction` throw
 * (the totality guard). This is deliberately NOT a `switch (state)` with the signal handled inside; the
 * pair is the unit of decision so every cell is visible and reviewable.
 */
const ACTION_TABLE: Record<string, LifecycleAction> = {
  // price_crossed_buybelow: only a watched name evaluates a buy. candidate is not admitted; a held
  // add-tranche is Phase 5; an exited name is inert.
  'price_crossed_buybelow:watched': { kind: 'buy_eval', reason: 'price at/below the locked buy-below on a watched name — evaluate a buy (human authors).' },
  'price_crossed_buybelow:candidate': noOp('candidate not admitted to the watchlist; no buy evaluation.'),
  'price_crossed_buybelow:held': noOp('add-tranche on a held name is Phase 5; no buy evaluation here.'),
  'price_crossed_buybelow:exited': noOp('exited name is inert; price crossings do not act.'),

  // falsifier_tripped: a held name goes to sell-review; a watched name to reprice-or-prune (prune
  // unavailable until Phase 6.6); candidate/exited inert.
  'falsifier_tripped:held': { kind: 'sell_review', reason: 'falsifier tripped on a held name — open a sell-review (human authors the exit).' },
  'falsifier_tripped:watched': { kind: 'reprice_or_prune_review', reason: 'falsifier tripped on a watched name — reprice or prune review.', prune_action_available: false },
  'falsifier_tripped:candidate': noOp('candidate has no thesis to falsify into a sell; no action.'),
  'falsifier_tripped:exited': noOp('exited name is inert; falsifier does not act.'),

  // shariah_breach: held → 90-day grace / divest path; watched → removal review; candidate/exited inert.
  'shariah_breach:held': { kind: 'shariah_grace_or_divest', reason: 'Shariah breach on a held name — start the 90-day grace clock / divest review.' },
  'shariah_breach:watched': { kind: 'removal_review', reason: 'Shariah breach on a watched name — propose watchlist removal (human authors).' },
  'shariah_breach:candidate': noOp('candidate Shariah breach is handled by the gate at admission; no action here.'),
  'shariah_breach:exited': noOp('exited name is inert; Shariah breach does not act.'),

  // reunderwrite_due: held + watched both re-underwrite; candidate/exited inert.
  'reunderwrite_due:held': { kind: 're_underwrite', reason: 'annual re-run due on a held name — re-underwrite the case.' },
  'reunderwrite_due:watched': { kind: 're_underwrite', reason: 'annual re-run due on a watched name — re-underwrite the case.' },
  'reunderwrite_due:candidate': noOp('candidate re-underwrite is part of admission research; no separate action.'),
  'reunderwrite_due:exited': noOp('exited name is inert; no re-underwrite.'),

  // over_concentrated: only meaningful on a held name → trim review; others inert.
  'over_concentrated:held': { kind: 'trim_review', reason: 'position past the ~22% appreciation-review threshold — flagged human-review (winners run; alert ≠ auto-trim, never a sale).' },
  'over_concentrated:candidate': noOp('candidate holds no position; concentration does not apply.'),
  'over_concentrated:watched': noOp('watched name holds no position; concentration does not apply.'),
  'over_concentrated:exited': noOp('exited name holds no position; concentration does not apply.'),

  // stale: a watched name with a stale case suppresses its buy signal; others inert (stale is folded into
  // re-underwrite cadence for held, and is irrelevant to candidate/exited at this layer).
  'stale:watched': { kind: 'suppress', reason: 'watched name on a stale case — suppress buy signals until re-run (stale cheapness is not a signal).' },
  'stale:candidate': noOp('candidate staleness is handled by admission research; no suppress action.'),
  'stale:held': noOp('held staleness is driven through the re-underwrite cadence, not a suppress.'),
  'stale:exited': noOp('exited name is inert; staleness does not act.'),

  // gated: a watched name that is not gate-clean suppresses any buy signal; others inert.
  'gated:watched': { kind: 'suppress', reason: 'watched name is not gate-clean — suppress buy signals (no gate is price-overridable).' },
  'gated:candidate': noOp('candidate gate failure blocks admission upstream; no suppress action.'),
  'gated:held': noOp('a held name being gated is surfaced via re-underwrite/sell paths, not a suppress.'),
  'gated:exited': noOp('exited name is inert; gating does not act.'),
}

function isLifecycleSignal(value: string): value is LifecycleSignal {
  return (LIFECYCLE_SIGNALS as readonly string[]).includes(value)
}

function isLifecycleState(value: string): value is NameLifecycleState {
  return (LIFECYCLE_STATES as readonly string[]).includes(value)
}

/**
 * Resolve the action for a `(signal, state)` pair. THE ONLY place state appears. Total: every valid pair
 * has an explicit cell in `ACTION_TABLE`; an unknown signal, unknown state, or missing cell THROWS — the
 * function is total over the declared vocabularies and refuses to silently degrade.
 */
export function selectAction(signal: LifecycleSignal, state: NameLifecycleState): LifecycleAction {
  if (!isLifecycleSignal(signal)) {
    throw new Error(`selectAction: unknown lifecycle signal "${signal}"`)
  }
  if (!isLifecycleState(state)) {
    throw new Error(`selectAction: unknown lifecycle state "${state}"`)
  }
  const action = ACTION_TABLE[`${signal}:${state}`]
  if (action === undefined) {
    throw new Error(`selectAction: no action defined for (${signal}, ${state}) — totality violated`)
  }
  return action
}

// ---------------------------------------------------------------------------
// Pass orchestrators (pure; no events emitted)
// ---------------------------------------------------------------------------

export type CadencePassRow = {
  ticker: string
  /** Every grounded signal raised for the name (state-independent). */
  signals: LifecycleSignal[]
  /** The actionable (non-no_op) actions for this name, after applying state to each signal. */
  actions: LifecycleAction[]
}

/**
 * Shared pass body: detect signals (state-independent), then map each signal through the
 * `(signal × state)` table; surface only the actionable (non-no_op) actions.
 */
function runPass(names: NameLifecycleProjection[], asOfData: CadenceAsOfData): CadencePassRow[] {
  return names.map((name) => {
    const signals = detectSignals(name, asOfData)
    const actions = signals
      .map((signal) => selectAction(signal, name.state))
      .filter((action) => action.kind !== 'no_op')
    return { ticker: name.ticker, signals, actions }
  })
}

/**
 * Quarterly (10-Q) falsifier-check pass. Runs the full state-independent detection over the name list and
 * resolves each signal against the name's state. Emphasizes the falsifier/price/Shariah/concentration
 * signals that the quarterly cadence watches, but uses the same uniform detection — the cadence label does
 * not change WHAT is detected, only WHEN the pass runs.
 */
export function runFalsifierCheck(
  names: NameLifecycleProjection[],
  asOfData: CadenceAsOfData,
): CadencePassRow[] {
  return runPass(names, asOfData)
}

/**
 * Annual (10-K) re-underwrite pass. Same uniform detection + `(signal × state)` resolution; the annual
 * cadence emphasizes the `reunderwrite_due` / falsifier signals, but detection stays state-independent.
 */
export function runReUnderwrite(
  names: NameLifecycleProjection[],
  asOfData: CadenceAsOfData,
): CadencePassRow[] {
  return runPass(names, asOfData)
}
