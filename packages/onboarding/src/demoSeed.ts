import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'

export const DEMO_RESEARCH_CASE_ID = 'rc_cost_001'

const demoSeedEvents: LedgerEventEnvelope<unknown>[] = [
  {
    event_id: 'evt_demo_research_created_001',
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: DEMO_RESEARCH_CASE_ID,
    idempotency_key: 'demo:research_case:rc_cost_001:v1',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: {
      research_case_id: DEMO_RESEARCH_CASE_ID,
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
    aggregate_id: DEMO_RESEARCH_CASE_ID,
    correlation_id: DEMO_RESEARCH_CASE_ID,
    idempotency_key: 'demo:analysis:rc_cost_001:mock:v1',
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      research_case_id: DEMO_RESEARCH_CASE_ID,
      company_id: 'company_cost',
      ticker: 'COST',
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
    correlation_id: DEMO_RESEARCH_CASE_ID,
    idempotency_key: 'demo:decision:rc_cost_001:watch:v1',
    actor_type: 'system',
    payload: {
      research_case_id: DEMO_RESEARCH_CASE_ID,
      decision_id: 'decision_cost_watch_001',
      decision: 'WATCH',
      user_approved: false,
      reason: 'Demo analysis says watch until market-implied growth falls a required gap below the sustainable band.',
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
    correlation_id: DEMO_RESEARCH_CASE_ID,
    idempotency_key: 'demo:watchlist_draft:rc_cost_001:v1',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: {
      research_case_id: DEMO_RESEARCH_CASE_ID,
      watchlist_item_id: 'watch_cost_001',
      company_id: 'company_cost',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      user_approved: false,
      thesis_summary: 'Durable quality compounder; wait for the market-implied growth to fall below the sustainable band.',
      created_by_actor_type: 'user',
      created_by_actor_id: 'user_local',
    },
    source_ids: ['src_cost_10k_2025'],
    created_at: '2026-05-27T00:03:00.000Z',
    schema_version: 1,
  },
]

export function getDemoSeedEvents(): LedgerEventEnvelope<unknown>[] {
  return demoSeedEvents.map((event) => structuredClone(event))
}

export async function seedDemoLedger(store: EventStore): Promise<void> {
  for (const event of getDemoSeedEvents()) {
    await store.append(event)
  }
}
