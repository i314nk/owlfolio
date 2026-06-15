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
 *               (exit_provenance: 'screened_out').
 *
 * Precedence for the live state when a name has multiple entities: held > watched > candidate. An exit
 * fact (holding_closed, or research-case rejected/pass) moves the name to `exited`. If an exited name is
 * later re-discovered it returns to `candidate` while RETAINING the prior exit_provenance as history.
 */
export type NameLifecycleState = 'candidate' | 'watched' | 'held' | 'exited'

export type NameLifecycleExitProvenance = 'sold' | 'screened_out'

export type NameLifecycleProjection = {
  ticker: string
  company?: string
  state: NameLifecycleState
  /**
   * For an `exited` name, which kind of exit it was (sold former holding vs screened-out reject). For a
   * re-discovered name now back in an earlier state, this is RETAINED as the prior exit's provenance so
   * the history is not lost.
   */
  exit_provenance?: NameLifecycleExitProvenance
  research_case_id?: string
  watchlist_item_id?: string
  holding_id?: string
  /** Locked buy-below price from the research case valuation. */
  buy_price_per_share?: number
  /** Fair value per share from the research case valuation. */
  fair_value_per_share?: number
  /** True when every gate the name has is clean (Shariah gate allowed / not FAIL). */
  gate_clean?: boolean
  /** The Shariah gate status carried by the live entity (watchlist/holding), when present. */
  shariah_gate_status?: string
  /**
   * Honesty bit (owner refinement #1): a `watched` name whose falsifier has tripped (Shariah gate FAIL,
   * or a staleness / Shariah re-screen alert) MUST still project as `watched` but be flagged here. It must
   * NOT look healthy and must NOT be synthesized into `exited` — there is no prune event yet (later phase),
   * so the gap is kept VISIBLE.
   */
  falsifier_tripped?: boolean
  falsifier_reason?: string
  /**
   * There is no prune/remove event in the ledger yet (later phase). Always false today — surfaced so the
   * UI can show the gap rather than hide it.
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

type Accumulator = {
  ticker: string
  company?: string
  state: NameLifecycleState
  exit_provenance?: NameLifecycleExitProvenance
  research_case_id?: string
  watchlist_item_id?: string
  holding_id?: string
  buy_price_per_share?: number
  fair_value_per_share?: number
  gate_clean?: boolean
  shariah_gate_status?: string
  falsifier_tripped?: boolean
  falsifier_reason?: string
  /**
   * Internal: the only research case for this name is the watchlist/holding lineage itself (stage
   * `watchlist`/`holding`), i.e. there is no independent pre-watchlist re-discovery. Used to distinguish a
   * sold holding (lineage-only → exited) from a genuine re-discovery (a new live case → candidate).
   */
  fromLineageOnly?: boolean
  updated_at: string
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

  // Closed holdings: a holding is closed once a holding_closed event exists for it.
  const closedHoldingIds = new Set<string>()
  for (const event of events) {
    if (event.event_type !== 'holding_closed') {
      continue
    }
    const holdingId = (isRecord(event.payload) ? getString(event.payload, 'holding_id') : undefined)
      ?? event.aggregate_id
    closedHoldingIds.add(holdingId)
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
    const created: Accumulator = { ticker: upper, state: 'candidate', updated_at: updatedAt }
    rows.set(upper, created)
    return created
  }

  // 1) Seed CANDIDATE / EXITED(screened_out) from research cases. Skip superseded cases.
  for (const researchCase of researchCases) {
    if (researchCase.superseded) {
      continue
    }
    const ticker = caseTicker(researchCase)
    if (ticker === undefined) {
      continue
    }
    const row = ensure(ticker, researchCase.updated_at)
    row.research_case_id = researchCase.research_case_id
    if (researchCase.company_id !== undefined) {
      row.company = researchCase.company_id
    }
    if (researchCase.valuation?.buy_price_per_share !== undefined) {
      row.buy_price_per_share = researchCase.valuation.buy_price_per_share
    }
    if (researchCase.valuation?.fair_value_per_share !== undefined) {
      row.fair_value_per_share = researchCase.valuation.fair_value_per_share
    }

    if (isScreenedOutStage(researchCase.stage)) {
      row.state = 'exited'
      row.exit_provenance = 'screened_out'
    } else if (researchCase.stage === 'watchlist' || researchCase.stage === 'holding') {
      // These stages are the watchlist/holding LINEAGE, not an independent candidate. Leave state as-is
      // (default candidate) — the watchlist/holding folds below derive the real live state. We must NOT
      // assert `candidate` here, or a sold holding whose case is at stage `holding` would look re-discovered.
      row.fromLineageOnly = true
    }
    // Any other (pre-watchlist) stage leaves the row at its default `candidate`; the folds below promote it.
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
    const row = ensure(ticker, item.updated_at)
    row.watchlist_item_id = item.watchlist_item_id
    if (row.research_case_id === undefined) {
      row.research_case_id = item.research_case_id
    }
    if (item.shariah_gate_status !== undefined) {
      row.shariah_gate_status = item.shariah_gate_status
    }
    if (row.state !== 'exited') {
      row.state = 'watched'
    }
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

  // 3) HELD / EXITED(sold) from holdings (highest precedence for the live state).
  for (const holding of holdings) {
    const ticker = holding.ticker ?? caseTicker(caseById.get(holding.research_case_id))
    if (ticker === undefined) {
      continue
    }
    const row = ensure(ticker, holding.updated_at)
    row.holding_id = holding.holding_id
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

    if (closedHoldingIds.has(holding.holding_id)) {
      // Exited via sale: retain the provenance as history regardless of what happens next.
      row.exit_provenance = 'sold'
      // A re-discovery after a sale is a NEW, non-superseded research case in a live stage; steps 1+2
      // will already have set this row to candidate/watched. In that case keep the live state (retaining
      // provenance). Otherwise the sale is the latest fact → exited.
      const rediscoveredLive = (row.state === 'candidate' || row.state === 'watched') && row.fromLineageOnly !== true
      if (!rediscoveredLive) {
        row.state = 'exited'
      }
    } else {
      // Open holding → held (overrides candidate/watched).
      row.state = 'held'
    }
  }

  return [...rows.values()].map((row) => {
    const projected: NameLifecycleProjection = {
      ticker: row.ticker,
      state: row.state,
      prune_action_available: false,
      updated_at: row.updated_at,
    }
    if (row.company !== undefined) projected.company = row.company
    if (row.exit_provenance !== undefined) projected.exit_provenance = row.exit_provenance
    if (row.research_case_id !== undefined) projected.research_case_id = row.research_case_id
    if (row.watchlist_item_id !== undefined) projected.watchlist_item_id = row.watchlist_item_id
    if (row.holding_id !== undefined) projected.holding_id = row.holding_id
    if (row.buy_price_per_share !== undefined) projected.buy_price_per_share = row.buy_price_per_share
    if (row.fair_value_per_share !== undefined) projected.fair_value_per_share = row.fair_value_per_share
    if (row.gate_clean !== undefined) projected.gate_clean = row.gate_clean
    if (row.shariah_gate_status !== undefined) projected.shariah_gate_status = row.shariah_gate_status
    if (row.falsifier_tripped !== undefined) projected.falsifier_tripped = row.falsifier_tripped
    if (row.falsifier_reason !== undefined) projected.falsifier_reason = row.falsifier_reason
    return projected
  })
}
