import type { LedgerEventEnvelope } from '../eventEnvelope'

/**
 * One human checklist answer as projected for audit. Structurally identical to the `ChecklistAnswer`
 * shape in `@owlfolio/strategies/checklist`, redeclared here because `@owlfolio/ledger` must NOT depend
 * on `@owlfolio/strategies` (same reason `reason_code` is typed as a string in the event contracts).
 */
export type WatchlistChecklistAnswer = {
  addressed: boolean
  note: string
}

/**
 * The harness-marshaled audit as projected for the audit-and-decide sign-off. Structurally identical to
 * the `ChecklistAudit` shape in `@owlfolio/strategies/checklistParams`, redeclared here because
 * `@owlfolio/ledger` must NOT depend on `@owlfolio/strategies`.
 */
export type WatchlistChecklistAudit = {
  version: string
  business_findings: Record<string, string>
  cognitive_acknowledged: boolean
}

export type WatchlistProjection = {
  watchlist_item_id: string
  research_case_id: string
  company_id?: string
  ticker?: string
  strategy_id?: string
  strategy_version?: string
  user_approved: boolean
  created_by_actor_type?: string
  created_by_actor_id?: string
  confirmed_by_actor_type?: string
  confirmed_by_actor_id?: string
  thesis_summary?: string
  /** Locked buy-below FROZEN at admit (snapshot, not a live valuation reference). */
  locked_buy_below?: number
  /** `VALUATION_PARAMS.version` the locked buy-below was frozen under (valuation provenance). */
  buy_below_valuation_version?: string
  /**
   * The SIGN-OFF-FROZEN sustainable-growth band LOW edge (valuation-core revision). Frozen verbatim from the
   * admit event; only a re-underwrite changes it. Absent on legacy events (they carry only frozen_iv).
   */
  frozen_band_low?: number
  /**
   * The SIGN-OFF-FROZEN sustainable-growth band HIGH edge (valuation-core revision) — the ceiling the
   * rekeyed valuation-inverted SELL keys off. Frozen verbatim; only a re-underwrite changes it. Absent on
   * legacy events (the sell then falls back to cannot_assess via the derived path).
   */
  frozen_band_high?: number
  /**
   * The SIGN-OFF-FROZEN normalized owner-earnings/share (valuation-core revision) the reverse-DCF solves
   * implied growth against. Frozen verbatim; only a re-underwrite changes it. Absent on legacy events.
   */
  frozen_oe_ps?: number
  /**
   * The UNDISCOUNTED intrinsic value (fair value per share) — RETAINED for one release as a DERIVED price
   * anchor (valuation-core revision: derived-from-the-frozen-band, no longer the primary sell key). The
   * anchoring bias guard (which reasons in PRICE units) reads it. Projected verbatim; NEVER backfilled from
   * the discounted buy-below. Legacy events carry only this field (no band/oe_ps).
   */
  frozen_iv?: number
  /**
   * `VALUATION_PARAMS.version` the frozen band/oe_ps (+ the derived frozen_iv) were frozen under — pins the
   * valuation params the reverse-DCF uses (sign-off provenance).
   */
  frozen_iv_valuation_version?: string
  /** The human's signed FINAL plain-language thesis (Gate 0 `[Hu]`), distinct from the agent-drafted thesis_summary. */
  signed_thesis?: string
  /** The agent-drafted thesis the human reviewed (the audit-and-decide draft) — present on new events. */
  signed_thesis_draft?: string
  /** Whether the human amended the agent draft (`signed_thesis` !== `signed_thesis_draft`) — present on new events. */
  thesis_amended?: boolean
  /**
   * The harness-marshaled audit (business findings + cognitive acknowledgement), captured at sign-off
   * alongside `signed_thesis` — so a name's audit travels with its thesis (auditable). DECISION-NEUTRAL:
   * no score/count is derived here. Present on NEW (audit-and-decide) events.
   */
  checklist_audit?: WatchlistChecklistAudit
  /**
   * LEGACY: the human's per-item checklist answers captured under the OLD sign-off model. Retained so
   * existing ledgers written before the audit-and-decide migration still project. New events carry
   * `checklist_audit` instead. DECISION-NEUTRAL verbatim audit projection.
   */
  checklist_answers?: Record<string, WatchlistChecklistAnswer>
  shariah_gate_decision_id?: string
  shariah_gate_status?: string
  shariah_gate_allowed?: boolean
  shariah_gate_reasons?: string[]
  shariah_required_source_ids?: string[]
  shariah_missing_evidence?: string[]
  updated_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function getBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key]
  return typeof value === 'boolean' ? value : undefined
}

function getNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Extract the human checklist answers map from a payload, decision-neutrally — verbatim, no scoring.
 * Only well-formed `{ addressed: boolean; note: string }` entries are kept. Returns undefined when the
 * field is absent or not an object (older events have no checklist).
 */
function getChecklistAnswers(
  payload: Record<string, unknown>,
  key: string,
): Record<string, WatchlistChecklistAnswer> | undefined {
  const value = payload[key]
  if (!isRecord(value)) {
    return undefined
  }
  const answers: Record<string, WatchlistChecklistAnswer> = {}
  for (const [id, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      continue
    }
    const addressed = entry['addressed']
    const note = entry['note']
    if (typeof addressed === 'boolean' && typeof note === 'string') {
      answers[id] = { addressed, note }
    }
  }
  return answers
}

/**
 * Extract the harness-marshaled audit from a payload, decision-neutrally — verbatim, no scoring. Returns
 * undefined when the field is absent or malformed (older events carry `checklist_answers` instead).
 */
function getChecklistAudit(
  payload: Record<string, unknown>,
  key: string,
): WatchlistChecklistAudit | undefined {
  const value = payload[key]
  if (!isRecord(value)) {
    return undefined
  }
  const version = value['version']
  const businessFindings = value['business_findings']
  const cognitiveAcknowledged = value['cognitive_acknowledged']
  if (typeof version !== 'string' || !isRecord(businessFindings) || typeof cognitiveAcknowledged !== 'boolean') {
    return undefined
  }
  const findings: Record<string, string> = {}
  for (const [id, finding] of Object.entries(businessFindings)) {
    if (typeof finding === 'string') {
      findings[id] = finding
    }
  }
  return { version, business_findings: findings, cognitive_acknowledged: cognitiveAcknowledged }
}

function getStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key]
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}

type ShariahGateDecisionProjection = {
  decision_id: string
  target_id: string
  status?: string
  allowed?: boolean
  reasons: string[]
  required_source_ids: string[]
  missing_evidence: string[]
  created_at: string
}

function projectShariahGateDecisions(events: LedgerEventEnvelope<unknown>[]): Map<string, ShariahGateDecisionProjection> {
  const decisions = new Map<string, ShariahGateDecisionProjection>()

  for (const event of events) {
    if (event.event_type !== 'shariah_gate_decision_recorded' || !isRecord(event.payload)) {
      continue
    }
    const targetId = getString(event.payload, 'target_id')
    if (targetId === undefined) {
      continue
    }
    const existing = decisions.get(targetId)
    if (existing !== undefined && existing.created_at > event.created_at) {
      continue
    }
    const decision: ShariahGateDecisionProjection = {
      decision_id: getString(event.payload, 'gate_decision_id') ?? event.aggregate_id,
      target_id: targetId,
      reasons: getStringArray(event.payload, 'reasons'),
      required_source_ids: getStringArray(event.payload, 'required_source_ids'),
      missing_evidence: getStringArray(event.payload, 'missing_evidence'),
      created_at: event.created_at,
    }
    const status = getString(event.payload, 'status')
    if (status !== undefined) {
      decision.status = status
    }
    const allowed = getBoolean(event.payload, 'allowed')
    if (allowed !== undefined) {
      decision.allowed = allowed
    }
    decisions.set(targetId, decision)
  }

  return decisions
}

function applyShariahGateDecision(target: WatchlistProjection, decision: ShariahGateDecisionProjection | undefined): void {
  if (decision === undefined) {
    return
  }
  target.shariah_gate_decision_id = decision.decision_id
  if (decision.status !== undefined) {
    target.shariah_gate_status = decision.status
  }
  if (decision.allowed !== undefined) {
    target.shariah_gate_allowed = decision.allowed
  }
  target.shariah_gate_reasons = decision.reasons
  target.shariah_required_source_ids = decision.required_source_ids
  target.shariah_missing_evidence = decision.missing_evidence
}

function applyString(
  target: WatchlistProjection,
  key: keyof Pick<
    WatchlistProjection,
    | 'company_id'
    | 'ticker'
    | 'strategy_id'
    | 'strategy_version'
    | 'thesis_summary'
    | 'signed_thesis'
    | 'signed_thesis_draft'
    | 'buy_below_valuation_version'
    | 'frozen_iv_valuation_version'
  >,
  value: string | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

export function projectWatchlist(events: LedgerEventEnvelope<unknown>[]): WatchlistProjection[] {
  const watchlist = new Map<string, WatchlistProjection>()
  const shariahGateDecisions = projectShariahGateDecisions(events)

  for (const event of events) {
    if (
      (event.event_type !== 'watchlist_draft_created' && event.event_type !== 'watchlist_draft_confirmed')
      || !isRecord(event.payload)
    ) {
      continue
    }

    const researchCaseId = getString(event.payload, 'research_case_id') ?? event.correlation_id
    if (researchCaseId === undefined) {
      continue
    }

    const existing = watchlist.get(event.aggregate_id)
    const watchlistItem =
      existing ??
      {
        watchlist_item_id: event.aggregate_id,
        research_case_id: researchCaseId,
        user_approved: false,
        updated_at: event.created_at,
      }

    watchlistItem.research_case_id = researchCaseId
    watchlistItem.updated_at = event.created_at

    const userApproved = event.event_type === 'watchlist_draft_confirmed'
      ? true
      : getBoolean(event.payload, 'user_approved')
    if (userApproved !== undefined) {
      watchlistItem.user_approved = userApproved
    }

    applyString(watchlistItem, 'company_id', getString(event.payload, 'company_id'))
    applyString(watchlistItem, 'ticker', getString(event.payload, 'ticker'))
    applyString(watchlistItem, 'strategy_id', getString(event.payload, 'strategy_id'))
    applyString(watchlistItem, 'strategy_version', getString(event.payload, 'strategy_version'))
    applyString(watchlistItem, 'thesis_summary', getString(event.payload, 'thesis_summary'))
    applyString(watchlistItem, 'signed_thesis', getString(event.payload, 'signed_thesis'))
    applyString(watchlistItem, 'signed_thesis_draft', getString(event.payload, 'signed_thesis_draft'))
    const thesisAmended = getBoolean(event.payload, 'thesis_amended')
    if (thesisAmended !== undefined) {
      watchlistItem.thesis_amended = thesisAmended
    }
    // NEW (audit-and-decide): the harness-marshaled audit. LEGACY: per-item checklist answers — read both
    // so existing ledgers written before the migration still project. New events carry only the audit.
    const checklistAudit = getChecklistAudit(event.payload, 'checklist_audit')
    if (checklistAudit !== undefined) {
      watchlistItem.checklist_audit = checklistAudit
    }
    const checklistAnswers = getChecklistAnswers(event.payload, 'checklist_answers')
    if (checklistAnswers !== undefined) {
      watchlistItem.checklist_answers = checklistAnswers
    }
    applyString(watchlistItem, 'buy_below_valuation_version', getString(event.payload, 'buy_below_valuation_version'))
    applyString(watchlistItem, 'frozen_iv_valuation_version', getString(event.payload, 'frozen_iv_valuation_version'))

    const lockedBuyBelow = getNumber(event.payload, 'locked_buy_below')
    if (lockedBuyBelow !== undefined) {
      watchlistItem.locked_buy_below = lockedBuyBelow
    }
    // The sign-off-frozen band edges + oe_ps (valuation-core revision) — projected verbatim. Legacy events
    // (frozen_iv only) leave these absent; the sell then fails closed to cannot_assess.
    const frozenBandLow = getNumber(event.payload, 'frozen_band_low')
    if (frozenBandLow !== undefined) {
      watchlistItem.frozen_band_low = frozenBandLow
    }
    const frozenBandHigh = getNumber(event.payload, 'frozen_band_high')
    if (frozenBandHigh !== undefined) {
      watchlistItem.frozen_band_high = frozenBandHigh
    }
    const frozenOePs = getNumber(event.payload, 'frozen_oe_ps')
    if (frozenOePs !== undefined) {
      watchlistItem.frozen_oe_ps = frozenOePs
    }
    // The DERIVED frozen_iv price anchor — projected verbatim; NEVER backfilled from locked_buy_below.
    const frozenIv = getNumber(event.payload, 'frozen_iv')
    if (frozenIv !== undefined) {
      watchlistItem.frozen_iv = frozenIv
    }
    // The provisional-MoS flag (buy_below_mos_provisional) is RETIRED — conservatism now lives in the
    // required_growth_gap. Legacy events that still carry it are tolerated; the field is simply ignored.

    if (event.event_type === 'watchlist_draft_created') {
      watchlistItem.created_by_actor_type = getString(event.payload, 'created_by_actor_type') ?? event.actor_type
      const createdByActorId = getString(event.payload, 'created_by_actor_id') ?? event.actor_id
      if (createdByActorId !== undefined) {
        watchlistItem.created_by_actor_id = createdByActorId
      }
    }

    if (event.event_type === 'watchlist_draft_confirmed') {
      watchlistItem.confirmed_by_actor_type = getString(event.payload, 'confirmed_by_actor_type') ?? event.actor_type
      const confirmedByActorId = getString(event.payload, 'confirmed_by_actor_id') ?? event.actor_id
      if (confirmedByActorId !== undefined) {
        watchlistItem.confirmed_by_actor_id = confirmedByActorId
      }
    }

    watchlist.set(event.aggregate_id, watchlistItem)
  }

  for (const item of watchlist.values()) {
    applyShariahGateDecision(item, shariahGateDecisions.get(item.watchlist_item_id))
  }

  return [...watchlist.values()]
}
