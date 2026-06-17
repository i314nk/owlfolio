// Lifecycle Cadence Engine ADAPTER (Task 3.2b) — thin, behavior-preserving glue between the worker's
// monitor task handlers and the PURE cadence engine (`@owlfolio/workflow/lifecycleCadence`).
//
// THE DISCIPLINE: the engine is the DECISION SOURCE. Each adapted handler builds a
// `NameLifecycleProjection`-shaped row from the SAME monitor inputs it already has (research-case
// updated_at, buy price, gate/shariah status, market value, NAV, clock), feeds it to `detectSignals`
// + `selectAction`, and maps the resulting action(s) back to the handler's EXISTING event(s). The
// handler still calls the pure monitors to fill the event payload DETAIL (message, discount, deadlines,
// lot-tags) — but WHICH branch is taken is decided by the engine, not by an inline monitor `if`.
//
// IMPORTANT freshness note: the row's `updated_at` is set to the RESEARCH CASE's updated_at (the
// freshness clock the buy-window / annual-rerun monitors use), NOT the projected name-level
// max(updated_at). `projectNameLifecycle` folds case/watchlist/holding into a single name-level
// `updated_at` (the max), which would mask a stale case whenever the live entity is newer. To stay
// behavior-equivalent to the monitors, this adapter constructs the row directly from the case-level
// inputs rather than from `projectNameLifecycle`'s output.
//
// Everything here is PURE: the clock is injected; no events emitted; no network.

import type { NameLifecycleProjection, NameLifecycleState } from '@owlfolio/ledger/projections/nameLifecycleProjection'
import {
  detectSignals,
  selectAction,
  type CadenceAsOfData,
  type LifecycleAction,
  type LifecycleActionKind,
  type LifecycleSignal,
} from '@owlfolio/workflow/lifecycleCadence'

/** The engine decision for one name: every grounded signal + the actionable (non-no_op) actions. */
export type EngineDecision = {
  signals: LifecycleSignal[]
  actions: LifecycleAction[]
  has: (kind: LifecycleActionKind) => boolean
}

/**
 * Run the engine's detect → decide step for a single name row. Returns the raised signals and the
 * actionable (non-no_op) actions after applying the name's state to each signal. This is the ONLY
 * decision step the adapted handlers consult.
 */
export function decideForName(row: NameLifecycleProjection, asOfData: CadenceAsOfData): EngineDecision {
  const signals = detectSignals(row, asOfData)
  const actions = signals
    .map((signal) => selectAction(signal, row.state))
    .filter((action) => action.kind !== 'no_op')
  return {
    signals,
    actions,
    has: (kind) => actions.some((action) => action.kind === kind),
  }
}

/**
 * Build a `NameLifecycleProjection` row for a WATCHED watchlist item directly from the buy-window
 * monitor inputs. `updated_at` is the research case's updated_at (the freshness clock).
 */
export function watchlistRow(args: {
  ticker: string
  research_case_id: string
  case_updated_at: string
  buy_price_per_share?: number
  fair_value_per_share?: number
  investment_verdict?: string
  shariah_status?: string
  superseded?: boolean
}): NameLifecycleProjection {
  const gateClean = isGateCleanRow(args.investment_verdict, args.shariah_status)
  const row: NameLifecycleProjection = {
    ticker: args.ticker,
    state: 'watched',
    prune_action_available: false,
    updated_at: args.case_updated_at,
    research_case_id: args.research_case_id,
    gate_clean: gateClean,
  }
  if (args.buy_price_per_share !== undefined) row.buy_price_per_share = args.buy_price_per_share
  if (args.fair_value_per_share !== undefined) row.fair_value_per_share = args.fair_value_per_share
  if (args.shariah_status !== undefined) row.shariah_gate_status = args.shariah_status
  // `superseded` is a freshness fact: a watchlist item still referencing a superseded research case is
  // stale regardless of age. Wire it onto the row so the engine's `stale` signal honors it (restores
  // equivalence with the pre-route evaluateWatchlistBuyWindow, which folded superseded → stale → suppress).
  if (args.superseded !== undefined) row.superseded = args.superseded
  return row
}

/**
 * Build a `NameLifecycleProjection` row for a HELD holding from the shariah-rescreen inputs. The
 * shariah breach is surfaced via the supplied `shariah_ratios` in `asOfData`, so the row carries no
 * embedded FAIL gate (the breach is the re-screen result, mirroring the monitor's evaluation).
 */
export function holdingRow(args: {
  ticker: string
  holding_id: string
  research_case_id?: string
  updated_at: string
  state?: NameLifecycleState
  frozen_oe_ps?: number
  frozen_reference_fair_value?: number
}): NameLifecycleProjection {
  const row: NameLifecycleProjection = {
    ticker: args.ticker,
    state: args.state ?? 'held',
    prune_action_available: false,
    updated_at: args.updated_at,
    holding_id: args.holding_id,
  }
  if (args.research_case_id !== undefined) row.research_case_id = args.research_case_id
  // The sign-off-frozen REFERENCE fair value + oe_ps (scope-reframe) let the engine's valuation_inverted
  // FLAG fire when the live price runs at/above the frozen reference; never a recomputed live band. The
  // frozen reference is also the anchoring guard's price anchor.
  if (args.frozen_oe_ps !== undefined) row.frozen_oe_ps = args.frozen_oe_ps
  if (args.frozen_reference_fair_value !== undefined) {
    row.frozen_reference_fair_value = args.frozen_reference_fair_value
  }
  return row
}

/** Gate cleanliness mirror of lifecycleMonitors.isGateClean, for populating the row's gate_clean bit. */
function isGateCleanRow(investmentVerdict: string | undefined, shariahStatus: string | undefined): boolean {
  const verdict = investmentVerdict?.toUpperCase()
  if (verdict === 'PASS' || verdict === 'GATED' || verdict === 'REJECT' || verdict === 'REJECTED') {
    return false
  }
  const shariah = shariahStatus?.toUpperCase()
  if (shariah !== undefined && shariah !== 'PASS' && shariah !== 'CONDITIONAL' && shariah !== 'COMPLIANT') {
    return false
  }
  return true
}
