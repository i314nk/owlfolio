import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from './researchCaseProjection'
import { projectWatchlist } from './watchlistProjection'

export type CommandCenterRecentActivity = {
  event_id: string
  label: string
}

export type CommandCenterSummary = {
  pipeline_counts: {
    research_cases: number
    watchlist_drafts: number
    pending_user_actions: number
  }
  primary_research_case_id?: string
  next_recommended_action: string
  recent_activity: CommandCenterRecentActivity[]
}

function actorLabel(event: LedgerEventEnvelope<unknown>): string {
  return event.actor_id === undefined ? event.actor_type : `${event.actor_type}:${event.actor_id}`
}

export function projectCommandCenterSummary(events: LedgerEventEnvelope<unknown>[]): CommandCenterSummary {
  const researchCases = projectResearchCases(events)
  const watchlist = projectWatchlist(events)
  const pendingDrafts = watchlist.filter((item) => !item.user_approved).length

  return {
    pipeline_counts: {
      research_cases: researchCases.length,
      watchlist_drafts: watchlist.length,
      pending_user_actions: pendingDrafts,
    },
    ...(researchCases[0] === undefined ? {} : { primary_research_case_id: researchCases[0].research_case_id }),
    next_recommended_action: researchCases[0]?.next_required_action ?? 'Review the demo workflow status',
    recent_activity: events
      .slice(-3)
      .reverse()
      .map((event) => ({
        event_id: event.event_id,
        label: `${event.event_type} by ${actorLabel(event)}`,
      })),
  }
}
