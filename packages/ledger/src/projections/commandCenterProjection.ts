import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectHoldings } from './holdingProjection'
import { projectResearchCases } from './researchCaseProjection'
import { projectWatchlist } from './watchlistProjection'

export type CommandCenterRecentActivity = {
  event_id: string
  label: string
}

export type CommandCenterApprovalQueueItem = {
  id: string
  // REVIEW RETIRED (2026-07-14): 'holding_review' items are no longer produced (legacy union value kept for readers).
  decision_type: 'watchlist_confirmation' | 'holding_review' | 'worker_proposal'
  group_label: string
  title: string
  actor_label: string
  target_label?: string
  provider_report_id?: string
  provider_run_ids?: string[]
  href: string
  audit_event_id: string
  source_ids: string[]
  before_summary: string
  after_summary: string
  shariah_impact: string
  accounting_impact: string
  approve_action_label?: string
  reject_action_label?: string
  override_action_label?: string
}

export type CommandCenterSummary = {
  pipeline_counts: {
    research_cases: number
    watchlist_drafts: number
    confirmed_watchlist_items: number
    open_holdings: number
    pending_user_actions: number
  }
  primary_research_case_id?: string
  next_recommended_action: string
  approval_queue: CommandCenterApprovalQueueItem[]
  recent_activity: CommandCenterRecentActivity[]
}

export type CommandCenterProjectionOptions = {
  as_of?: string
}

type WatchlistItem = ReturnType<typeof projectWatchlist>[number]

function actorLabel(event: LedgerEventEnvelope<unknown>): string {
  return event.actor_id === undefined ? event.actor_type : `${event.actor_type}:${event.actor_id}`
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

function getStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key]
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function watchlistItemLabel(item: WatchlistItem): string {
  return item.ticker ?? item.company_id ?? item.watchlist_item_id
}


function shariahImpact(status: string | undefined, allowed: boolean | undefined): string {
  if (status === undefined) {
    return 'Shariah gate decision pending.'
  }

  if (allowed === true) {
    return `${status} — allowed.`
  }

  if (allowed === false) {
    return `${status} — blocked.`
  }

  return `${status}.`
}

function auditHref(eventId: string): string {
  return `/audit?event_id=${eventId}#${eventId}`
}





function buildWatchlistApprovalItems(
  pendingDraftItems: WatchlistItem[],
  events: LedgerEventEnvelope<unknown>[],
): CommandCenterApprovalQueueItem[] {
  return pendingDraftItems.map((item) => {
    const draftEvent = events.find((event) => event.event_type === 'watchlist_draft_created' && event.aggregate_id === item.watchlist_item_id)
    const label = watchlistItemLabel(item)
    const providerReportId = isRecord(draftEvent?.payload) ? getString(draftEvent.payload, 'provider_report_id') : undefined
    const fallbackActor = item.created_by_actor_id === undefined
      ? item.created_by_actor_type ?? 'unknown'
      : `${item.created_by_actor_type ?? 'unknown'}:${item.created_by_actor_id}`

    return {
      id: `watchlist:${item.watchlist_item_id}`,
      decision_type: 'watchlist_confirmation',
      group_label: 'Watchlist confirmations',
      title: `${label} watchlist draft`,
      actor_label: draftEvent === undefined ? fallbackActor : actorLabel(draftEvent),
      target_label: label,
      ...(providerReportId === undefined ? {} : { provider_report_id: providerReportId }),
      href: `/watchlist#${item.watchlist_item_id}`,
      audit_event_id: draftEvent?.event_id ?? item.watchlist_item_id,
      source_ids: draftEvent?.source_ids ?? [],
      before_summary: `${label} is not user-confirmed for monitoring yet.`,
      after_summary: `Confirm ${label} as a user-approved watchlist item before worker monitoring or portfolio actions.`,
      shariah_impact: shariahImpact(item.shariah_gate_status, item.shariah_gate_allowed),
      accounting_impact: 'No accounting or holding state changes until a user opens a holding.',
      // Phase 8 S6: the standalone "confirm watchlist draft" affordance was removed in S4 (admit now emits
      // the draft + confirmation atomically). This item only appears for a LEGACY partial ledger with an
      // unconfirmed draft the new flow can no longer produce, so the label points at a neutral legacy state
      // rather than the deleted confirm action.
      approve_action_label: 'Legacy unconfirmed draft — re-admit from research',
    }
  })
}


function buildWorkerProposalApprovalItems(events: LedgerEventEnvelope<unknown>[]): CommandCenterApprovalQueueItem[] {
  return events.flatMap((event) => {
    if (event.event_type !== 'scheduled_task_run_completed' || !isRecord(event.payload)) {
      return []
    }

    if (getBoolean(event.payload, 'human_approval_required') !== true) {
      return []
    }

    const scheduledTaskId = getString(event.payload, 'scheduled_task_id') ?? event.aggregate_id
    const taskKind = getString(event.payload, 'task_kind') ?? 'scheduled_task'
    const runId = getString(event.payload, 'run_id') ?? event.event_id
    const resultSummary = getString(event.payload, 'result_summary') ?? `${taskKind} dry-run completed and requires user approval before state changes.`
    const approvalGates = getStringArray(event.payload, 'approval_gates')
    const autoApprovedActions = getNumber(event.payload, 'auto_approved_actions') ?? 0
    const providerRunIds = getStringArray(event.payload, 'provider_run_ids')

    return [{
      id: `worker:${scheduledTaskId}:${runId}`,
      decision_type: 'worker_proposal',
      group_label: 'Worker proposals',
      title: `${taskKind} worker proposal`,
      actor_label: actorLabel(event),
      target_label: scheduledTaskId,
      href: auditHref(event.event_id),
      audit_event_id: event.event_id,
      source_ids: event.source_ids,
      ...(providerRunIds.length === 0 ? {} : { provider_run_ids: providerRunIds }),
      before_summary: 'Worker dry-run did not change portfolio, watchlist, accounting, or trading state.',
      after_summary: resultSummary,
      shariah_impact: approvalGates.length === 0
        ? 'No approval gates were reported by the worker.'
        : `Approval gates: ${approvalGates.join(', ')}.`,
      accounting_impact: `Auto-approved actions recorded by the worker: ${autoApprovedActions}.`,
    }]
  })
}

/**
 * Explicit urgency rank for the operating-priority queue (ascending = more urgent):
 *   1. Blocking gates — a Shariah gate that blocks/pends and stops a state change.
 *   2. Confirmations — watchlist confirmations, holding opens.
 *   3. Reviews — holding reviews / reanalysis.
 *   4. Reminders / informational — worker proposals and other informational drafts.
 */
export function priorityRank(item: CommandCenterApprovalQueueItem): number {
  if (item.decision_type === 'watchlist_confirmation') {
    // A blocked or pending Shariah gate must be cleared before the state change.
    const shariah = item.shariah_impact.toLowerCase()
    if (shariah.includes('blocked') || shariah.includes('pending')) {
      return 1
    }
    return 2
  }

  // worker_proposal and anything else: reminders / informational.
  return 4
}

function buildApprovalQueue(
  pendingDraftItems: WatchlistItem[],
  events: LedgerEventEnvelope<unknown>[],
): CommandCenterApprovalQueueItem[] {
  const items = [
    ...buildWatchlistApprovalItems(pendingDraftItems, events),
    ...buildWorkerProposalApprovalItems(events),
  ]

  // Stable sort by urgency rank; insertion order (recency within a rank) is preserved.
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => priorityRank(left.item) - priorityRank(right.item) || left.index - right.index)
    .map((entry) => entry.item)
}

export function projectCommandCenterSummary(
  events: LedgerEventEnvelope<unknown>[],
  _options: CommandCenterProjectionOptions = {},
): CommandCenterSummary {
  const researchCases = projectResearchCases(events)
  const watchlist = projectWatchlist(events)
  const holdings = projectHoldings(events)
  const heldWatchlistItemIds = new Set(holdings.map((holding) => holding.watchlist_item_id))
  const pendingDraftItems = watchlist.filter((item) => !item.user_approved)
  // REVIEW RETIRED (owner, 2026-07-14): the drafted holding review + its schedule are gone — the
  // quarterly check-in, the 10-K full-re-run prompt, and the zone board carry the duty. Legacy
  // pending drafts remain readable in the audit timeline; they are no longer an approval queue item
  // (the resolve routes were removed).
  const approvalQueue = buildApprovalQueue(pendingDraftItems, events)
  const confirmedWatchlistItems = watchlist.filter((item) => item.user_approved && !heldWatchlistItemIds.has(item.watchlist_item_id))
  const nextRecommendedAction = pendingDraftItems[0] !== undefined
    // Phase 8 S6: legacy-only path — an unconfirmed draft predates the S4 atomic admit+confirm flow; the
    // confirm action no longer exists, so surface the legacy state, not a promise to confirm it.
    ? `${watchlistItemLabel(pendingDraftItems[0])} is a legacy unconfirmed watchlist draft — re-admit from research`
    : confirmedWatchlistItems.length > 0
      ? 'Monitor confirmed watchlist items for buy-zone and thesis updates'
      : holdings.length > 0
        ? 'Check in held names against new filings (quarterly cadence)'
        : researchCases[0]?.next_required_action ?? 'Review the demo workflow status'
  const pendingUserActionCount = approvalQueue.length

  return {
    pipeline_counts: {
      research_cases: researchCases.length,
      watchlist_drafts: pendingDraftItems.length,
      confirmed_watchlist_items: confirmedWatchlistItems.length,
      open_holdings: holdings.length,
      pending_user_actions: pendingUserActionCount,
    },
    ...(researchCases[0] === undefined ? {} : { primary_research_case_id: researchCases[0].research_case_id }),
    next_recommended_action: nextRecommendedAction,
    approval_queue: approvalQueue,
    recent_activity: events
      .slice(-3)
      .reverse()
      .map((event) => ({
        event_id: event.event_id,
        label: `${event.event_type} by ${actorLabel(event)}`,
      })),
  }
}
