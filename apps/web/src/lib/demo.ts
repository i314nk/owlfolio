import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'

export type PipelineCounts = {
  research_cases: number
  watchlist_drafts: number
  pending_user_actions: number
}

export type DemoCommandCenter = {
  product_name: string
  setup_status: string
  provider_status: string
  strategy_status: string
  shariah_status: string
  pipeline_counts: PipelineCounts
  next_recommended_action: string
}

const demoEvents: LedgerEventEnvelope<unknown>[] = [
  {
    event_id: 'evt_demo_research_created_001',
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: 'rc_cost_001',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: {
      company_id: 'company_cost',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
    },
    source_ids: [],
    created_at: '2026-05-27T00:00:00.000Z',
    schema_version: 1,
  },
  {
    event_id: 'evt_demo_analysis_001',
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: 'rc_cost_001',
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'COMPLIANT',
      valuation_status: 'FAIR',
      next_required_action: 'Review COST research case and confirm the watchlist draft',
    },
    source_ids: ['src_cost_10k_2025'],
    created_at: '2026-05-27T00:01:00.000Z',
    schema_version: 1,
  },
  {
    event_id: 'evt_demo_decision_001',
    event_type: 'decision_drafted',
    aggregate_type: 'decision',
    aggregate_id: 'decision_cost_watch_001',
    causation_id: 'evt_demo_analysis_001',
    correlation_id: 'rc_cost_001',
    actor_type: 'system',
    payload: {
      research_case_id: 'rc_cost_001',
      decision: 'WATCH',
      user_approved: false,
      reason: 'Demo analysis says watch until margin of safety improves.',
    },
    source_ids: ['src_cost_10k_2025'],
    created_at: '2026-05-27T00:02:00.000Z',
    schema_version: 1,
  },
  {
    event_id: 'evt_demo_watchlist_001',
    event_type: 'watchlist_draft_created',
    aggregate_type: 'watchlist_item',
    aggregate_id: 'watch_cost_001',
    causation_id: 'evt_demo_decision_001',
    correlation_id: 'rc_cost_001',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: {
      research_case_id: 'rc_cost_001',
      company_id: 'company_cost',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      user_approved: false,
      thesis_summary: 'Durable quality compounder; wait for better margin of safety.',
    },
    source_ids: ['src_cost_10k_2025'],
    created_at: '2026-05-27T00:03:00.000Z',
    schema_version: 1,
  },
]

export function getDemoEvents(): LedgerEventEnvelope<unknown>[] {
  return demoEvents.map((event) => ({ ...event, source_ids: [...event.source_ids] }))
}

export function getDemoCommandCenter(): DemoCommandCenter {
  const events = getDemoEvents()
  const researchCases = projectResearchCases(events)
  const watchlist = projectWatchlist(events)
  const pendingDrafts = watchlist.filter((item) => !item.user_approved).length
  const nextRequiredAction = researchCases[0]?.next_required_action ?? 'Review the demo workflow status'

  return {
    product_name: 'Owlfolio',
    setup_status: 'Setup ready',
    provider_status: 'Mock provider / demo mode',
    strategy_status: 'Buffett-Munger certified',
    shariah_status: 'Shariah enabled by default',
    pipeline_counts: {
      research_cases: researchCases.length,
      watchlist_drafts: watchlist.length,
      pending_user_actions: pendingDrafts,
    },
    next_recommended_action: nextRequiredAction,
  }
}
