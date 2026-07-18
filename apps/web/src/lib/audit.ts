import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { EventStore } from '@owlfolio/ledger/eventStore'

export type ActorCategory = 'user' | 'provider' | 'worker' | 'system'

export type AuditActivityEvent = {
  event_id: string
  event_type: string
  event_summary: string
  aggregate_type: string
  aggregate_id: string
  aggregate_label: string
  entity_label: string
  actor_label: string
  actor_category: ActorCategory
  created_at: string
  created_at_display: string
  source_count: number
  source_ids: string[]
  causation_id?: string
  correlation_id?: string
  research_case_id?: string
  schema_version: number
  raw_event_json: string
  context_explanation: string
  before_json?: string
  after_json?: string
}

export type AuditActivityFilters = {
  correlationId?: string
  dateFrom?: string
  dateTo?: string
  eventId?: string
  eventType?: string
  actor?: string
  entity?: string
  query?: string
  schemaVersion?: string
  sourceId?: string
  timeOrder?: 'asc' | 'desc'
  /** 'decisions' (default) = the curated decision trail; 'full' = every ledger event. */
  view?: 'decisions' | 'full'
}

// ── The decision trail (owner-approved 2026-07-18) ────────────────────────────
// The audit page DEFAULTS to what carries fiduciary weight: every USER-authored transition, plus
// the decision-grade milestones below (gates, verdicts, failures, reviews). Machinery events
// (progress breadcrumbs, price snapshots, harvests, task lifecycle, provider runs, source
// captures) stay in the LEDGER untouched and are one click away via view=full — a curated VIEW,
// never a curated record. Any targeted filter (event id / correlation / source / type / raw query)
// bypasses the curation so causation/source trace links always resolve.
const DECISION_GRADE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'shariah_gate_judged',
  'shariah_gate_decision_recorded',
  'circle_competence_judged',
  'quick_screen_drafted', // legacy (pre-restructure) gate
  'decision_drafted',
  'strategy_decision_drafted',
  'buffett_munger_analysis_drafted',
  'valuation_judgment_drafted',
  'admit_judgment_recorded',
  'research_case_re_review_recorded',
  'research_run_failed',
  'position_post_mortem_recorded',
  'holding_sell_review_drafted',
  'holding_shariah_grace_started',
  'deep_dive_approval_pending',
])

function isDecisionGradeEvent(event: AuditActivityEvent): boolean {
  return event.actor_category === 'user' || DECISION_GRADE_EVENT_TYPES.has(event.event_type)
}

export type AuditActivityFilterOptions = {
  eventTypes: string[]
  actors: string[]
  entities: string[]
  schemaVersions: string[]
}

export type AuditCaseGroup = {
  correlation_id: string
  ticker: string
  earliest_date: string
  event_count: number
  events: AuditActivityEvent[]
}

export type AuditActivityView = {
  activeFilters: string[]
  /** The view actually applied: 'decisions' (curated default) or 'full' (explicit or targeted lookup). */
  effectiveView: 'decisions' | 'full'
  events: AuditActivityEvent[]
  caseGroups: AuditCaseGroup[]
  ungroupedEvents: AuditActivityEvent[]
  filterOptions: AuditActivityFilterOptions
}

export async function getAuditActivityEventsFromStore(store: EventStore): Promise<AuditActivityEvent[]> {
  return projectAuditActivityEvents(await store.list())
}

export function projectAuditActivityEvents(events: LedgerEventEnvelope<unknown>[]): AuditActivityEvent[] {
  return events
    .map((event) => {
      const aggregateLabel = `${event.aggregate_type} / ${event.aggregate_id}`
      const entityLabel = entityLabelFor(event)
      const beforeAfter = beforeAfterPayload(event.payload)
      const researchCaseId = extractResearchCaseId(event)

      return {
        event_id: event.event_id,
        event_type: event.event_type,
        event_summary: auditSummarizeEvent(event, entityLabel, aggregateLabel),
        aggregate_type: event.aggregate_type,
        aggregate_id: event.aggregate_id,
        aggregate_label: aggregateLabel,
        entity_label: entityLabel,
        actor_label: actorLabel(event),
        actor_category: event.actor_type as ActorCategory,
        created_at: event.created_at,
        created_at_display: formatDisplayTimestamp(event.created_at),
        source_count: event.source_ids.length,
        source_ids: [...event.source_ids],
        ...(event.causation_id === undefined ? {} : { causation_id: event.causation_id }),
        ...(event.correlation_id === undefined ? {} : { correlation_id: event.correlation_id }),
        ...(researchCaseId === undefined ? {} : { research_case_id: researchCaseId }),
        schema_version: event.schema_version,
        raw_event_json: JSON.stringify(event, null, 2),
        context_explanation: contextExplanation(event, beforeAfter),
        ...(beforeAfter === undefined ? {} : beforeAfter),
      }
    })
    .sort(compareAuditEventsAsc)
}

export function deriveAuditActivityView(
  events: AuditActivityEvent[],
  filters: AuditActivityFilters = {},
): AuditActivityView {
  const filterOptions = {
    eventTypes: uniqueSorted(events.map((event) => event.event_type)),
    actors: uniqueSorted(events.map((event) => event.actor_label)),
    entities: uniqueSorted(events.map((event) => event.entity_label)),
    schemaVersions: uniqueSorted(events.map((event) => String(event.schema_version))),
  }

  const correlationId = normalizeFilter(filters.correlationId)
  const dateFrom = normalizeFilter(filters.dateFrom)
  const dateTo = normalizeFilter(filters.dateTo)
  const eventId = normalizeFilter(filters.eventId)
  const eventType = normalizeFilter(filters.eventType)
  const actor = normalizeFilter(filters.actor)
  const entity = normalizeFilter(filters.entity)
  const query = normalizeFilter(filters.query)
  const schemaVersion = normalizeFilter(filters.schemaVersion)
  const sourceId = normalizeFilter(filters.sourceId)

  // Targeted lookups always search the FULL record — a causation/source trace link must resolve
  // even when its target is a machinery event the decision trail hides.
  const targeted = eventId !== undefined || correlationId !== undefined || sourceId !== undefined
    || eventType !== undefined || query !== undefined
  const effectiveView: 'decisions' | 'full' = filters.view === 'full' || targeted ? 'full' : 'decisions'

  const filteredEvents = events
    .filter((event) => effectiveView === 'full' || isDecisionGradeEvent(event))
    .filter((event) => eventId === undefined || includesCaseInsensitive(event.event_id, eventId))
    .filter((event) => correlationId === undefined || includesCaseInsensitive(event.correlation_id ?? '', correlationId))
    .filter((event) => sourceId === undefined || event.source_ids.some((source) => includesCaseInsensitive(source, sourceId)))
    .filter((event) => schemaVersion === undefined || String(event.schema_version) === schemaVersion)
    .filter((event) => dateFrom === undefined || event.created_at.slice(0, 10) >= dateFrom)
    .filter((event) => dateTo === undefined || event.created_at.slice(0, 10) <= dateTo)
    .filter((event) => eventType === undefined || event.event_type === eventType)
    .filter((event) => actor === undefined || event.actor_label === actor)
    .filter((event) => entity === undefined || matchesSearch(event, entity))
    .filter((event) => query === undefined || matchesSearch(event, query))
    .sort(filters.timeOrder === 'desc' ? compareAuditEventsDesc : compareAuditEventsAsc)

  const { caseGroups, ungroupedEvents } = groupEventsByCorrelation(filteredEvents)

  return { activeFilters: activeFilterLabels(filters), effectiveView, events: filteredEvents, caseGroups, ungroupedEvents, filterOptions }
}

export function groupEventsByCorrelation(events: AuditActivityEvent[]): {
  caseGroups: AuditCaseGroup[]
  ungroupedEvents: AuditActivityEvent[]
} {
  const groupMap = new Map<string, AuditActivityEvent[]>()
  const ungrouped: AuditActivityEvent[] = []

  for (const event of events) {
    const key = event.correlation_id
    if (key === undefined) {
      ungrouped.push(event)
    } else {
      const existing = groupMap.get(key)
      if (existing === undefined) {
        groupMap.set(key, [event])
      } else {
        existing.push(event)
      }
    }
  }

  const caseGroups: AuditCaseGroup[] = []
  for (const [correlationId, groupEvents] of groupMap.entries()) {
    const ticker = groupEvents.find((e) => e.entity_label !== e.aggregate_id)?.entity_label
      ?? groupEvents[0]?.entity_label
      ?? correlationId
    const earliest_date = groupEvents.reduce(
      (min, e) => (e.created_at < min ? e.created_at : min),
      groupEvents[0]?.created_at ?? '',
    )
    caseGroups.push({
      correlation_id: correlationId,
      ticker,
      earliest_date,
      event_count: groupEvents.length,
      events: groupEvents,
    })
  }

  caseGroups.sort((a, b) => a.earliest_date.localeCompare(b.earliest_date) || a.correlation_id.localeCompare(b.correlation_id))

  return { caseGroups, ungroupedEvents: ungrouped }
}

function activeFilterLabels(filters: AuditActivityFilters): string[] {
  const labels: string[] = []
  const eventId = normalizeFilter(filters.eventId)
  const correlationId = normalizeFilter(filters.correlationId)
  const sourceId = normalizeFilter(filters.sourceId)
  const schemaVersion = normalizeFilter(filters.schemaVersion)
  const dateFrom = normalizeFilter(filters.dateFrom)
  const dateTo = normalizeFilter(filters.dateTo)
  const eventType = normalizeFilter(filters.eventType)
  const actor = normalizeFilter(filters.actor)
  const entity = normalizeFilter(filters.entity)
  const query = normalizeFilter(filters.query)

  if (eventId !== undefined) labels.push(`Event ID contains ${eventId}`)
  if (correlationId !== undefined) labels.push(`Correlation ID contains ${correlationId}`)
  if (sourceId !== undefined) labels.push(`Source ID contains ${sourceId}`)
  if (schemaVersion !== undefined) labels.push(`Schema v${schemaVersion}`)
  if (dateFrom !== undefined) labels.push(`From ${dateFrom}`)
  if (dateTo !== undefined) labels.push(`To ${dateTo}`)
  if (eventType !== undefined) labels.push(`Event type ${eventType}`)
  if (actor !== undefined) labels.push(`Actor ${actor}`)
  if (entity !== undefined) labels.push(`Entity/search ${entity}`)
  if (query !== undefined) labels.push(`Raw evidence contains ${query}`)
  if (filters.timeOrder === 'desc') labels.push('Newest first')

  return labels
}

function compareAuditEventsAsc(left: AuditActivityEvent, right: AuditActivityEvent) {
  return left.created_at.localeCompare(right.created_at) || left.event_id.localeCompare(right.event_id)
}

function compareAuditEventsDesc(left: AuditActivityEvent, right: AuditActivityEvent) {
  return right.created_at.localeCompare(left.created_at) || right.event_id.localeCompare(left.event_id)
}

function actorLabel(event: LedgerEventEnvelope<unknown>): string {
  return event.actor_id === undefined ? event.actor_type : `${event.actor_type}:${event.actor_id}`
}

function humanizeEventType(eventType: string): string {
  const label = eventType
    .split('_')
    .filter((part) => part.length > 0)
    .join(' ')

  return label.length === 0 ? eventType : label.charAt(0).toUpperCase() + label.slice(1)
}

function entityLabelFor(event: LedgerEventEnvelope<unknown>): string {
  const payloadEntity = payloadString(event.payload, [
    'ticker',
    'symbol',
    'company_id',
    'company_name',
    'holding_id',
    'watchlist_item_id',
    'decision_id',
    'research_case_id',
    'snapshot_id',
  ])

  return payloadEntity ?? event.aggregate_id
}

function payloadString(payload: unknown, keys: string[]): string | undefined {
  if (!isRecord(payload)) {
    return undefined
  }

  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }

  return undefined
}

function beforeAfterPayload(payload: unknown): Pick<AuditActivityEvent, 'before_json' | 'after_json'> | undefined {
  if (!isRecord(payload) || payload.before === undefined || payload.after === undefined) {
    return undefined
  }

  return {
    before_json: JSON.stringify(payload.before, null, 2),
    after_json: JSON.stringify(payload.after, null, 2),
  }
}

function contextExplanation(
  event: LedgerEventEnvelope<unknown>,
  beforeAfter: Pick<AuditActivityEvent, 'before_json' | 'after_json'> | undefined,
): string {
  if (beforeAfter !== undefined) {
    return 'Before → after payload is present in the ledger event; values below are copied directly from the event payload.'
  }

  const causalLinks = [
    ...(event.causation_id === undefined ? [] : [`caused by ${event.causation_id}`]),
    ...(event.correlation_id === undefined ? [] : [`correlated as ${event.correlation_id}`]),
    ...(event.source_ids.length === 0 ? [] : [`sourced from ${event.source_ids.join(', ')}`]),
  ]

  if (causalLinks.length > 0) {
    return `Causal chain: ${causalLinks.join('; ')}.`
  }

  return ''
}

function matchesSearch(event: AuditActivityEvent, searchValue: string): boolean {
  return [
    event.event_id,
    event.event_type,
    event.event_summary,
    event.aggregate_type,
    event.aggregate_id,
    event.aggregate_label,
    event.entity_label,
    event.actor_label,
    event.causation_id ?? '',
    event.correlation_id ?? '',
    ...event.source_ids,
    event.raw_event_json,
  ].some((value) => includesCaseInsensitive(value, searchValue))
}

function includesCaseInsensitive(value: string, searchValue: string): boolean {
  return value.toLowerCase().includes(searchValue.toLowerCase())
}

function normalizeFilter(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized === undefined || normalized.length === 0 ? undefined : normalized
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function extractResearchCaseId(event: LedgerEventEnvelope<unknown>): string | undefined {
  if (event.aggregate_type === 'research_case') {
    return event.aggregate_id
  }

  return payloadString(event.payload, ['research_case_id'])
}

function formatDisplayTimestamp(isoString: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(isoString))
  } catch {
    return isoString
  }
}

function auditSummarizeEvent(event: LedgerEventEnvelope<unknown>, entityLabel: string, aggregateLabel: string): string {
  const payload = isRecord(event.payload) ? event.payload : undefined

  // Live-run breadcrumbs (2026-07-18): worker observability, never a decision — say so plainly.
  if (event.event_type === 'research_run_progress_recorded' && payload !== undefined) {
    const lane = typeof payload.lane === 'string' ? payload.lane : 'run'
    const message = typeof payload.message === 'string' ? payload.message : 'progress'
    return `Run progress — ${lane} · ${message}`
  }

  if (event.event_type === 'buffett_munger_analysis_drafted' && payload !== undefined) {
    const verdict = typeof payload.investment_verdict === 'string' ? payload.investment_verdict : undefined
    const compliance = typeof payload.strategy_compliance === 'string' ? payload.strategy_compliance : undefined
    const shariah = typeof payload.shariah_status === 'string' ? payload.shariah_status : undefined
    if (verdict !== undefined || compliance !== undefined || shariah !== undefined) {
      const parts = [verdict, compliance, shariah !== undefined ? `Shariah ${shariah}` : undefined].filter(Boolean)
      return `Buffett 4-Pillar analysis: ${parts.join(' / ')} for ${entityLabel}`
    }
  }

  if (event.event_type === 'strategy_decision_drafted' && payload !== undefined) {
    const decision = typeof payload.decision === 'string' ? payload.decision : undefined
    if (decision !== undefined) {
      return `Strategy decision drafted: ${decision} for ${entityLabel}`
    }
  }

  if (event.event_type === 'decision_drafted' && payload !== undefined) {
    const decision = typeof payload.decision === 'string' ? payload.decision : undefined
    if (decision !== undefined) {
      return `Drafted ${decision} decision for ${entityLabel}`
    }
  }

  if (event.event_type === 'specialist_finding_recorded' && payload !== undefined) {
    const lane = typeof payload.specialist_lane === 'string' ? payload.specialist_lane : undefined
    if (lane !== undefined) {
      return `Specialist finding recorded: ${lane} for ${entityLabel}`
    }
  }

  if (event.event_type === 'shariah_gate_judged' && payload !== undefined) {
    const sector = typeof payload.sector_status === 'string' ? payload.sector_status : 'undetermined'
    return `Shariah gate ${payload.allowed === true ? 'OPEN' : 'CLOSED'} (${sector}) for ${entityLabel}`
  }

  if (event.event_type === 'quick_screen_drafted' && payload !== undefined) {
    const result = typeof payload.screening_result === 'string' ? payload.screening_result : undefined
    if (result !== undefined) {
      return `Quick screen drafted: ${result} for ${entityLabel}`
    }
  }

  if (event.event_type === 'deep_dive_started' && payload !== undefined) {
    const lanes = Array.isArray(payload.specialist_lanes) ? (payload.specialist_lanes as unknown[]).filter((l): l is string => typeof l === 'string') : []
    if (lanes.length > 0) {
      return `Deep dive started for ${lanes.length} ${lanes.length === 1 ? 'specialist' : 'specialists'} (${entityLabel})`
    }
  }

  if (event.event_type === 'watchlist_draft_created' && payload !== undefined) {
    return `Watchlist draft created for ${entityLabel}`
  }

  if (event.event_type === 'research_case_created') {
    if (payload !== undefined) {
      const strategyId = typeof payload.strategy_id === 'string' ? payload.strategy_id : undefined
      const strategyVersion = typeof payload.strategy_version === 'string' ? payload.strategy_version : undefined
      if (strategyId !== undefined && strategyVersion !== undefined) {
        return `Research case created for ${entityLabel} using strategy ${strategyId}@${strategyVersion}`
      }
    }
    return `Research case created for ${entityLabel}`
  }

  return `${humanizeEventType(event.event_type)} for ${entityLabel} on ${aggregateLabel}`
}
