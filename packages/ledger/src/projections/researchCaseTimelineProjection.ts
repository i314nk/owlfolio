import type { LedgerEventEnvelope } from '../eventEnvelope'

export type ResearchCaseTimelineEntry = {
  event_id: string
  event_type: string
  actor_type: LedgerEventEnvelope<unknown>['actor_type']
  actor_id?: string
  actor_label: string
  created_at: string
  summary: string
  source_ids: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function getStringArray(payload: Record<string, unknown>, key: string): string[] | undefined {
  const value = payload[key]
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return undefined
  }

  return value
}

function strategyLabel(payload: Record<string, unknown>): string | undefined {
  const strategyId = getString(payload, 'strategy_id')
  const strategyVersion = getString(payload, 'strategy_version')

  if (strategyId === undefined || strategyVersion === undefined) {
    return undefined
  }

  return `${strategyId}@${strategyVersion}`
}

function eventBelongsToResearchCase(event: LedgerEventEnvelope<unknown>, researchCaseId: string): boolean {
  if (event.aggregate_type === 'research_case' && event.aggregate_id === researchCaseId) {
    return true
  }

  if (event.correlation_id === researchCaseId) {
    return true
  }

  return isRecord(event.payload) && getString(event.payload, 'research_case_id') === researchCaseId
}

function actorLabel(event: LedgerEventEnvelope<unknown>): string {
  return event.actor_id === undefined ? event.actor_type : `${event.actor_type}:${event.actor_id}`
}

function summarizeEvent(event: LedgerEventEnvelope<unknown>): string {
  if (!isRecord(event.payload)) {
    return event.event_type
  }

  if (event.event_type === 'research_case_created') {
    const selectedStrategy = strategyLabel(event.payload)
    if (selectedStrategy !== undefined) {
      return `Discovered research case for ${getString(event.payload, 'ticker') ?? event.aggregate_id} using strategy ${selectedStrategy}`
    }

    return `Created research case for ${getString(event.payload, 'ticker') ?? event.aggregate_id}`
  }

  if (event.event_type === 'shariah_gate_judged') {
    // SCREENING OFF: a DISABLED gate is a recorded non-verdict — never presented as an OPEN pass.
    if (event.payload['status'] === 'DISABLED' || event.payload['sector_status'] === 'DISABLED') {
      return 'Shariah gate: OFF by setting (not screened)'
    }
    return `Shariah gate judged: ${event.payload['allowed'] === true ? 'OPEN' : 'CLOSED'} (${getString(event.payload, 'sector_status') ?? 'undetermined'})`
  }

  // Legacy (pre-restructure) cases still carry quick-screen events.
  if (event.event_type === 'quick_screen_drafted') {
    return `Quick screen drafted: ${getString(event.payload, 'screening_result') ?? 'UNKNOWN'}`
  }

  if (event.event_type === 'queued_for_deep_dive') {
    return 'Queued for deep dive'
  }

  if (event.event_type === 'deep_dive_started') {
    const specialistCount = getStringArray(event.payload, 'specialist_lanes')?.length ?? 0
    return `Deep dive started for ${specialistCount} ${specialistCount === 1 ? 'specialist' : 'specialists'}`
  }

  if (event.event_type === 'specialist_finding_recorded') {
    return `Specialist finding recorded: ${getString(event.payload, 'specialist_lane') ?? 'UNKNOWN'}`
  }

  if (event.event_type === 'deep_dive_synthesis_drafted') {
    return 'Deep dive synthesis drafted'
  }

  if (event.event_type === 'deep_dive_completed') {
    return 'Deep dive completed'
  }

  if (event.event_type === 'strategy_decision_drafted') {
    return `Strategy decision drafted: ${getString(event.payload, 'decision') ?? 'UNKNOWN'}`
  }

  if (event.event_type === 'buffett_munger_analysis_drafted') {
    return `${getString(event.payload, 'investment_verdict') ?? 'UNKNOWN'} / ${
      getString(event.payload, 'strategy_compliance') ?? 'UNKNOWN'
    } / Shariah ${getString(event.payload, 'shariah_status') ?? 'UNKNOWN'}`
  }

  if (event.event_type === 'decision_drafted') {
    return `Drafted ${getString(event.payload, 'decision') ?? 'UNKNOWN'} decision`
  }

  if (event.event_type === 'watchlist_draft_created') {
    return `Created watchlist draft for ${getString(event.payload, 'ticker') ?? event.aggregate_id}`
  }

  return event.event_type
}

export function projectResearchCaseTimeline(
  events: LedgerEventEnvelope<unknown>[],
  researchCaseId: string,
): ResearchCaseTimelineEntry[] {
  return events.filter((event) => eventBelongsToResearchCase(event, researchCaseId)).map((event) => ({
    event_id: event.event_id,
    event_type: event.event_type,
    actor_type: event.actor_type,
    ...(event.actor_id === undefined ? {} : { actor_id: event.actor_id }),
    actor_label: actorLabel(event),
    created_at: event.created_at,
    summary: summarizeEvent(event),
    source_ids: [...event.source_ids],
  }))
}
