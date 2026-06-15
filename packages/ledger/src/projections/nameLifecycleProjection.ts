import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases, type ResearchCaseProjection, type ResearchCaseStage } from './researchCaseProjection'
import { projectWatchlist } from './watchlistProjection'
import { projectHoldings } from './holdingProjection'

/**
 * Phase 3 unified name-list READ MODEL.
 *
 * One row per ticker, each in exactly one derived lifecycle STATE, composed from the three existing
 * projections (research case / watchlist / holding) over EXISTING EVENTS ONLY. No new event types are
 * introduced and no existing projection behavior is changed — this is a pure fold/derivation on top.
 *
 *   candidate → a research case in a pre-watchlist stage (or a fresh 13F-discovered candidate):
 *               not confirmed to the watchlist, not rejected/pass.
 *   watched   → watchlist_draft_confirmed (user-approved) AND no open holding.
 *   held      → holding_opened with no later holding_closed.
 *   exited    → holding_closed (exit_provenance: 'sold') OR research-case rejected/pass
 *               (exit_provenance: 'screened_out') OR a watched name pruned out of the watchlist
 *               (watchlist_item_pruned → exit_provenance: 'pruned', the Phase-6 S9 softer exit).
 *
 * Precedence for the live state when a name has multiple entities: held > watched > candidate.
 *
 * Exit honesty (owner refinements #1/#2): a name is `exited` ONLY when it has NO live entity. An exit
 * fact (holding_closed → 'sold', or a non-superseded research case rejected/pass → 'screened_out') does
 * NOT by itself force `exited` — if the same ticker also has a live entity (held/watched/candidate) the
 * live state WINS. `exit_provenance` is therefore present IFF `state === 'exited'`; it must never leak
 * onto a live row. The re-entry history of a live name is carried separately by `prior_exit_provenance`
 * (the most-recent prior exit fact for that ticker), so the history is preserved without being misread
 * as a current exit.
 */
export type NameLifecycleState = 'candidate' | 'watched' | 'held' | 'exited'

export type NameLifecycleExitProvenance = 'sold' | 'screened_out' | 'pruned'

export type NameLifecycleProjection = {
  ticker: string
  company?: string
  state: NameLifecycleState
  /**
   * For an `exited` name, which kind of exit it was (sold former holding vs screened-out reject). Present
   * IFF `state === 'exited'` — a live row (held/watched/candidate) must NOT carry exit_provenance, since
   * it has not exited. Re-entry history of a live name lives on `prior_exit_provenance` instead.
   */
  exit_provenance?: NameLifecycleExitProvenance
  /**
   * For a LIVE name (held/watched/candidate) that was previously exited, the most-recent prior exit's
   * provenance — so the re-discovery / re-acquisition history is not lost while keeping `exit_provenance`
   * honest (undefined on a live row). Undefined when the name has no prior exit fact, or when the name is
   * itself `exited` (then the exit fact is on `exit_provenance`).
   */
  prior_exit_provenance?: NameLifecycleExitProvenance
  research_case_id?: string
  watchlist_item_id?: string
  holding_id?: string
  /**
   * ISO timestamp from the `holding_opened` event (the date the open holding was opened). Present on a
   * `held` row; enables the Phase-6 minimum-hold clock (the guard reads it to compute holding age).
   */
  opened_at?: string
  /**
   * Locked buy-below price. For a `watched` name this is the value FROZEN at admit (the source of truth
   * for a watched name's buy-below); otherwise it is the research case valuation's buy_price_per_share.
   */
  buy_price_per_share?: number
  /** Fair value per share from the research case valuation. */
  fair_value_per_share?: number
  /**
   * Phase 5 S2 — the concrete per-share downside FLOOR from the newest admit recommendation (deterministic
   * balance-sheet arithmetic, GATED for reliability by the grounded permanent-loss level). Phase-5 sizing
   * (S3) reads this alongside `buy_price_per_share`. The `basis` (net_cash vs stressed_book) IS the
   * reliability signal and rides alongside the number — never flattened. Absent when the floor was not
   * computable (e.g. a HIGH permanent-loss level, or missing balance-sheet inputs). Newest-recorded wins.
   */
  downside_floor_per_share?: number
  downside_floor_basis?: string
  downside_floor_reliability?: string
  /**
   * The buy-below FROZEN at admit (snapshot, not a live reference). Present for a watched name admitted
   * with a locked buy-below. Mirrors `buy_price_per_share` for a watched name; carried explicitly so the
   * provenance below can be read alongside it.
   */
  locked_buy_below?: number
  /** `VALUATION_PARAMS.version` the locked buy-below was frozen under (MoS/valuation provenance). */
  buy_below_valuation_version?: string
  /** True while the MoS is provisional (#124) — a future MoS freeze that changes the buy-below is a visible re-price. */
  buy_below_mos_provisional?: boolean
  /**
   * Phase 6 S3 — the UNDISCOUNTED intrinsic value (fair value per share) FROZEN at sign-off, carried from
   * the watchlist lineage. This is the value the "valuation-inverted" sell trigger compares price against
   * (evaluateValuationInverted reads it off this row); it is DISTINCT from the MoS-discounted
   * `locked_buy_below`/`buy_price_per_share`. Don't-move-the-number (F.9/F.10): only a re-underwrite that
   * re-runs the freeze changes it. Absent when nothing was frozen — the trigger then returns cannot_assess
   * (it must NEVER be backfilled from the discounted buy-below).
   */
  frozen_iv?: number
  /** `VALUATION_PARAMS.version` the frozen undiscounted IV was frozen under (sign-off valuation provenance). */
  frozen_iv_valuation_version?: string
  /** True when every gate the name has is clean (Shariah gate allowed / not FAIL). */
  gate_clean?: boolean
  /** The Shariah gate status carried by the live entity (watchlist/holding), when present. */
  shariah_gate_status?: string
  /**
   * Freshness fact: the research case this name references has been superseded by a newer version. A
   * superseded case is STALE regardless of age ("stale cheapness is not a signal"). Optional and
   * non-breaking: `projectNameLifecycle` skips superseded cases for surfaced names so it leaves this
   * undefined/false, but a worker adapter that builds a row for the case a watchlist item references
   * supplies the real value so the cadence engine's `stale` signal honors it.
   */
  superseded?: boolean
  /**
   * Honesty bit (owner refinement #1): a `watched` name whose falsifier has tripped (Shariah gate FAIL,
   * or a staleness / Shariah re-screen alert) MUST still project as `watched` but be flagged here. It must
   * NOT look healthy and must NOT be synthesized into `exited` — there is no prune event yet (later phase),
   * so the gap is kept VISIBLE.
   */
  falsifier_tripped?: boolean
  falsifier_reason?: string
  /**
   * Phase 6 S9 — the human-authored PRUNE action is available for a WATCHED name whose falsifier has tripped
   * (`state === 'watched'` AND `falsifier_tripped === true`). Pruning removes the name from the watchlist via
   * the human-authored `watchlist_item_pruned` exit (pruneWatchlistItem) — the softer mirror of the holding
   * close. False otherwise: a clean watched name has nothing to prune, and a candidate/held/exited name is
   * not a prunable watch.
   */
  prune_action_available: boolean
  updated_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function getBoolean(payload: Record<string, unknown>, key: string): boolean {
  return payload[key] === true
}

function isScreenedOutStage(stage: ResearchCaseStage): boolean {
  return stage === 'rejected' || stage === 'pass'
}

function isShariahGateFail(status: string | undefined, allowed: boolean | undefined): boolean {
  if (allowed === false) {
    return true
  }
  return status !== undefined && status.toUpperCase() === 'FAIL'
}

/**
 * Resolve the upper-cased ticker for a research case. Watchlist/holding items often carry only a
 * research_case_id, so the case is the authoritative ticker source.
 */
function caseTicker(researchCase: ResearchCaseProjection | undefined): string | undefined {
  return researchCase?.ticker
}

/**
 * The live (non-exited) part of a name's lifecycle, plus everything carried by the live entity. Set only
 * by the candidate/watched/held folds — exit facts are tracked separately in `ExitFact`.
 */
type LiveState = 'candidate' | 'watched' | 'held'

type Accumulator = {
  ticker: string
  company?: string
  /** The live state if the name has a live entity, else undefined (→ resolves to `exited`). */
  liveState?: LiveState
  research_case_id?: string
  watchlist_item_id?: string
  holding_id?: string
  opened_at?: string
  buy_price_per_share?: number
  fair_value_per_share?: number
  downside_floor_per_share?: number
  downside_floor_basis?: string
  downside_floor_reliability?: string
  locked_buy_below?: number
  buy_below_valuation_version?: string
  buy_below_mos_provisional?: boolean
  frozen_iv?: number
  frozen_iv_valuation_version?: string
  gate_clean?: boolean
  shariah_gate_status?: string
  falsifier_tripped?: boolean
  falsifier_reason?: string
  /** The most-recent exit fact for this ticker (sold holding / screened-out case), independent of state. */
  exitProvenance?: NameLifecycleExitProvenance
  exitAt?: string
  updated_at: string
}

/** Promote the live state honoring precedence held > watched > candidate (never downgrades). */
function promoteLiveState(row: Accumulator, next: LiveState): void {
  const rank: Record<LiveState, number> = { candidate: 0, watched: 1, held: 2 }
  if (row.liveState === undefined || rank[next] > rank[row.liveState]) {
    row.liveState = next
  }
}

/** Record an exit fact, keeping only the most-recent one (by timestamp). */
function recordExit(row: Accumulator, provenance: NameLifecycleExitProvenance, at: string): void {
  if (row.exitAt === undefined || at >= row.exitAt) {
    row.exitProvenance = provenance
    row.exitAt = at
  }
}

/**
 * Existing-event signal that a watched name's falsifier has tripped: a worker-authored
 * watchlist_monitor_alert_recorded that is a staleness suppression (suppressed / rerun_needed) or a
 * Shariah re-screen flag. Keyed by research_case_id (the stable name key) -> reason.
 */
function projectWatchedFalsifierAlerts(events: LedgerEventEnvelope<unknown>[]): Map<string, string> {
  const reasons = new Map<string, string>()
  for (const event of events) {
    if (event.event_type !== 'watchlist_monitor_alert_recorded' || !isRecord(event.payload)) {
      continue
    }
    const researchCaseId = getString(event.payload, 'research_case_id')
    if (researchCaseId === undefined) {
      continue
    }
    if (getBoolean(event.payload, 'suppressed') || getBoolean(event.payload, 'rerun_needed')) {
      reasons.set(researchCaseId, getString(event.payload, 'suppression_reason')
        ?? 'Research case is stale on a newer filing — re-run before any buy signal.')
      continue
    }
    if (getString(event.payload, 'alert_kind') === 'shariah_rescreen') {
      const verdict = getString(event.payload, 'shariah_verdict') ?? 'flagged'
      if (verdict.toUpperCase() === 'FAIL' || getBoolean(event.payload, 'propose_removal')) {
        reasons.set(researchCaseId, `Shariah re-screen returned ${verdict}.`)
      }
    }
  }
  return reasons
}

export function projectNameLifecycle(events: LedgerEventEnvelope<unknown>[]): NameLifecycleProjection[] {
  const researchCases = projectResearchCases(events)
  const watchlist = projectWatchlist(events)
  const holdings = projectHoldings(events)
  const watchedFalsifierAlerts = projectWatchedFalsifierAlerts(events)

  const caseById = new Map<string, ResearchCaseProjection>()
  for (const researchCase of researchCases) {
    caseById.set(researchCase.research_case_id, researchCase)
  }

  // Watchlist items keyed by id, so the held fold can recover the sign-off-frozen IV from the originating
  // lineage: the WATCHED fold below SKIPS items that became holdings, so a held row would otherwise never
  // pick up `frozen_iv` (frozen at the watchlist admit). The valuation-inverted sell trigger reads
  // `frozen_iv` off the HELD row (S6/S8), so it must be carried through.
  const watchlistById = new Map<string, (typeof watchlist)[number]>()
  for (const item of watchlist) {
    watchlistById.set(item.watchlist_item_id, item)
  }

  // Closed holdings: a holding is closed once a holding_closed event exists for it. Keep the close
  // timestamp so the most-recent exit fact can be resolved across multiple exit kinds for one ticker.
  const closedHoldingAt = new Map<string, string>()
  for (const event of events) {
    if (event.event_type !== 'holding_closed') {
      continue
    }
    const holdingId = (isRecord(event.payload) ? getString(event.payload, 'holding_id') : undefined)
      ?? event.aggregate_id
    const existing = closedHoldingAt.get(holdingId)
    if (existing === undefined || event.created_at > existing) {
      closedHoldingAt.set(holdingId, event.created_at)
    }
  }

  // Pruned watchlist items (Phase 6 S9): a watched name is pruned out of the watchlist once a human-authored
  // watchlist_item_pruned event exists for it. Keyed by watchlist_item_id -> the prune timestamp. Mirrors
  // closedHoldingAt: the WATCHED fold demotes a pruned item to an exit fact ('pruned') rather than a live
  // watch — so the name folds to `exited` UNLESS some OTHER live entity still wins (live-wins preserved).
  const prunedWatchlistAt = new Map<string, string>()
  for (const event of events) {
    if (event.event_type !== 'watchlist_item_pruned') {
      continue
    }
    const watchlistItemId = (isRecord(event.payload) ? getString(event.payload, 'watchlist_item_id') : undefined)
      ?? event.aggregate_id
    const existing = prunedWatchlistAt.get(watchlistItemId)
    if (existing === undefined || event.created_at > existing) {
      prunedWatchlistAt.set(watchlistItemId, event.created_at)
    }
  }

  // Watchlist items / research cases whose lineage became a holding (open or closed). These must NOT be
  // counted as `watched`: the watchlist confirmation that fed a holding is not a live watch, and after a
  // sale only a genuinely NEW (non-superseded) research case re-discovers the name.
  const holdingWatchlistItemIds = new Set<string>()
  const holdingResearchCaseIds = new Set<string>()
  for (const holding of holdings) {
    holdingWatchlistItemIds.add(holding.watchlist_item_id)
    holdingResearchCaseIds.add(holding.research_case_id)
  }

  const rows = new Map<string, Accumulator>()

  function ensure(ticker: string, updatedAt: string): Accumulator {
    const upper = ticker.toUpperCase()
    const existing = rows.get(upper)
    if (existing !== undefined) {
      if (updatedAt > existing.updated_at) {
        existing.updated_at = updatedAt
      }
      return existing
    }
    const created: Accumulator = { ticker: upper, updated_at: updatedAt }
    rows.set(upper, created)
    return created
  }

  // 1) From research cases (skip superseded): a screened-out case (rejected/pass) is an EXIT FACT — it is
  //    NOT a live entity and does not assert any live state. A non-superseded case in a pre-watchlist /
  //    non-terminal stage is a live CANDIDATE. The watchlist/holding lineage stages are derived by the
  //    folds below, so they assert no live state here.
  for (const researchCase of researchCases) {
    if (researchCase.superseded) {
      continue
    }
    const ticker = caseTicker(researchCase)
    if (ticker === undefined) {
      continue
    }
    const row = ensure(ticker, researchCase.updated_at)
    if (row.research_case_id === undefined || !isScreenedOutStage(researchCase.stage)) {
      // Prefer a live case's id over a screened-out case's id when both exist for the ticker.
      row.research_case_id = researchCase.research_case_id
    }
    if (researchCase.company_id !== undefined) {
      row.company = researchCase.company_id
    }
    if (researchCase.valuation?.buy_price_per_share !== undefined) {
      row.buy_price_per_share = researchCase.valuation.buy_price_per_share
    }
    if (researchCase.valuation?.fair_value_per_share !== undefined) {
      row.fair_value_per_share = researchCase.valuation.fair_value_per_share
    }
    // Phase 5 S2 — surface the concrete downside floor from the newest admit recommendation (the
    // recommendation is recomputed on-demand; the projection keeps the latest). Carried alongside the
    // buy-below so Phase-5 sizing reads the floor + its basis/reliability together (never a bare number).
    const admit = researchCase.admit_recommendation
    if (admit?.downside_floor_per_share !== undefined) {
      row.downside_floor_per_share = admit.downside_floor_per_share
    }
    if (admit?.downside_floor_basis !== undefined) {
      row.downside_floor_basis = admit.downside_floor_basis
    }
    if (admit?.downside_floor_reliability !== undefined) {
      row.downside_floor_reliability = admit.downside_floor_reliability
    }

    if (isScreenedOutStage(researchCase.stage)) {
      // Exit fact only — never a live state. (If the same ticker has a live entity it will still win.)
      recordExit(row, 'screened_out', researchCase.updated_at)
    } else if (researchCase.stage === 'watchlist' || researchCase.stage === 'holding') {
      // Watchlist/holding LINEAGE — the live state is derived by the watchlist/holding folds below.
    } else {
      // A genuine pre-watchlist / non-terminal case → live candidate.
      promoteLiveState(row, 'candidate')
    }
  }

  // 2) WATCHED from user-approved watchlist items with no open holding (precedence over candidate).
  for (const item of watchlist) {
    if (!item.user_approved) {
      continue
    }
    // Skip the watchlist lineage that became a holding — that name is held/sold, not watched.
    if (holdingWatchlistItemIds.has(item.watchlist_item_id) || holdingResearchCaseIds.has(item.research_case_id)) {
      continue
    }
    const ticker = item.ticker ?? caseTicker(caseById.get(item.research_case_id))
    if (ticker === undefined) {
      continue
    }
    // Phase 6 S9: a pruned watched name is an EXIT FACT ('pruned'), not a live watch. Record the exit and do
    // NOT assert the `watched` live state — if some OTHER live entity exists for the ticker it still wins.
    const prunedAt = prunedWatchlistAt.get(item.watchlist_item_id)
    if (prunedAt !== undefined) {
      const prunedRow = ensure(ticker, item.updated_at)
      recordExit(prunedRow, 'pruned', prunedAt)
      continue
    }
    const row = ensure(ticker, item.updated_at)
    row.watchlist_item_id = item.watchlist_item_id
    if (row.research_case_id === undefined) {
      row.research_case_id = item.research_case_id
    }
    if (item.shariah_gate_status !== undefined) {
      row.shariah_gate_status = item.shariah_gate_status
    }
    // The buy-below is FROZEN at admit: for a watched name the locked admit value is the SOURCE OF TRUTH,
    // overriding any live research-case buy-below (which can drift). Its MoS/valuation provenance rides
    // along so a future MoS freeze that changes the number reads as a visible re-price, not a silent move.
    if (item.locked_buy_below !== undefined) {
      row.locked_buy_below = item.locked_buy_below
      row.buy_price_per_share = item.locked_buy_below
    }
    if (item.buy_below_valuation_version !== undefined) {
      row.buy_below_valuation_version = item.buy_below_valuation_version
    }
    if (item.buy_below_mos_provisional !== undefined) {
      row.buy_below_mos_provisional = item.buy_below_mos_provisional
    }
    // The sign-off-frozen undiscounted IV rides along from the watchlist lineage (its valuation-version
    // provenance with it). The held-name sell flow reads frozen_iv off this row for the valuation-inverted
    // trigger — DISTINCT from the discounted buy-below above; never derived from it.
    if (item.frozen_iv !== undefined) {
      row.frozen_iv = item.frozen_iv
    }
    if (item.frozen_iv_valuation_version !== undefined) {
      row.frozen_iv_valuation_version = item.frozen_iv_valuation_version
    }
    promoteLiveState(row, 'watched')
    // Falsifier honesty (#1): Shariah gate FAIL or a staleness/re-screen alert trips the falsifier.
    const gateFail = isShariahGateFail(item.shariah_gate_status, item.shariah_gate_allowed)
    const alertReason = watchedFalsifierAlerts.get(item.research_case_id)
    if (gateFail) {
      row.falsifier_tripped = true
      row.falsifier_reason = `Shariah gate FAIL on a watched name (status ${item.shariah_gate_status ?? 'FAIL'}).`
      row.gate_clean = false
    } else if (alertReason !== undefined) {
      row.falsifier_tripped = true
      row.falsifier_reason = alertReason
    } else if (row.gate_clean === undefined) {
      row.gate_clean = true
    }
  }

  // 3) HELD (open holding) / EXIT FACT 'sold' (closed holding) from holdings — held is the highest live
  //    precedence; a closed holding records an exit fact but never forces `exited` if a live entity exists.
  for (const holding of holdings) {
    const ticker = holding.ticker ?? caseTicker(caseById.get(holding.research_case_id))
    if (ticker === undefined) {
      continue
    }
    const row = ensure(ticker, holding.updated_at)
    const closedAt = closedHoldingAt.get(holding.holding_id)
    if (closedAt !== undefined) {
      // Closed holding → exit fact only; do not bind the live entity ids to this dead holding.
      recordExit(row, 'sold', closedAt)
    } else {
      // Open holding → held; bind the live entity.
      row.holding_id = holding.holding_id
      row.opened_at = holding.opened_at
      row.watchlist_item_id = holding.watchlist_item_id
      if (row.research_case_id === undefined) {
        row.research_case_id = holding.research_case_id
      }
      if (holding.company_id !== undefined && row.company === undefined) {
        row.company = holding.company_id
      }
      if (holding.shariah_gate_status !== undefined) {
        row.shariah_gate_status = holding.shariah_gate_status
      }
      // Carry the sign-off-frozen undiscounted IV from the originating watchlist lineage onto the held row
      // (the watched fold skipped this item because it became a holding). The valuation-inverted sell
      // trigger reads `frozen_iv` here; it is the value frozen at admit, never recomputed.
      const lineage = watchlistById.get(holding.watchlist_item_id)
      if (lineage?.frozen_iv !== undefined && row.frozen_iv === undefined) {
        row.frozen_iv = lineage.frozen_iv
      }
      if (lineage?.frozen_iv_valuation_version !== undefined && row.frozen_iv_valuation_version === undefined) {
        row.frozen_iv_valuation_version = lineage.frozen_iv_valuation_version
      }
      promoteLiveState(row, 'held')
    }
  }

  return [...rows.values()].map((row) => {
    // A name is `exited` ONLY when it has no live entity. Otherwise the live state wins and the exit fact
    // (if any) is carried as history on prior_exit_provenance — never leaked onto exit_provenance.
    const state: NameLifecycleState = row.liveState ?? 'exited'
    // Phase 6 S9: the human-authored prune is offered ONLY for a WATCHED name whose falsifier has tripped.
    const pruneActionAvailable = state === 'watched' && row.falsifier_tripped === true
    const projected: NameLifecycleProjection = {
      ticker: row.ticker,
      state,
      prune_action_available: pruneActionAvailable,
      updated_at: row.updated_at,
    }
    if (row.company !== undefined) projected.company = row.company
    if (state === 'exited') {
      if (row.exitProvenance !== undefined) projected.exit_provenance = row.exitProvenance
    } else if (row.exitProvenance !== undefined) {
      projected.prior_exit_provenance = row.exitProvenance
    }
    if (row.research_case_id !== undefined) projected.research_case_id = row.research_case_id
    if (row.watchlist_item_id !== undefined) projected.watchlist_item_id = row.watchlist_item_id
    if (row.holding_id !== undefined) projected.holding_id = row.holding_id
    if (row.opened_at !== undefined) projected.opened_at = row.opened_at
    if (row.buy_price_per_share !== undefined) projected.buy_price_per_share = row.buy_price_per_share
    if (row.fair_value_per_share !== undefined) projected.fair_value_per_share = row.fair_value_per_share
    if (row.downside_floor_per_share !== undefined) projected.downside_floor_per_share = row.downside_floor_per_share
    if (row.downside_floor_basis !== undefined) projected.downside_floor_basis = row.downside_floor_basis
    if (row.downside_floor_reliability !== undefined) {
      projected.downside_floor_reliability = row.downside_floor_reliability
    }
    if (row.locked_buy_below !== undefined) projected.locked_buy_below = row.locked_buy_below
    if (row.buy_below_valuation_version !== undefined) {
      projected.buy_below_valuation_version = row.buy_below_valuation_version
    }
    if (row.buy_below_mos_provisional !== undefined) {
      projected.buy_below_mos_provisional = row.buy_below_mos_provisional
    }
    if (row.frozen_iv !== undefined) projected.frozen_iv = row.frozen_iv
    if (row.frozen_iv_valuation_version !== undefined) {
      projected.frozen_iv_valuation_version = row.frozen_iv_valuation_version
    }
    if (row.gate_clean !== undefined) projected.gate_clean = row.gate_clean
    if (row.shariah_gate_status !== undefined) projected.shariah_gate_status = row.shariah_gate_status
    if (row.falsifier_tripped !== undefined) projected.falsifier_tripped = row.falsifier_tripped
    if (row.falsifier_reason !== undefined) projected.falsifier_reason = row.falsifier_reason
    return projected
  })
}
