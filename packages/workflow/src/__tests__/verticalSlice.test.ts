import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { MockProvider } from '@owlfolio/providers/mockProvider'
import { createResearchCase, runDemoBuffettMungerAnalysis, draftDecision } from '../researchWorkflow'
import { confirmWatchlistDraft } from '../watchlistWorkflow'

describe('v0.2 vertical research workflow', () => {
  it('creates a Buffett-Munger research case and promotes it to a user-attributed watchlist draft', async () => {
    const store = new InMemoryEventStore()
    const provider = new MockProvider()

    const researchCase = await createResearchCase(store, { research_case_id: 'rc_cost_001', company_id: 'company_cost', ticker: 'COST', strategy_id: 'buffett-munger', actor_id: 'user_local' })
    const analysis = await runDemoBuffettMungerAnalysis(store, provider, { research_case_id: researchCase.research_case_id, company_id: 'company_cost', ticker: 'COST', idempotency_key: 'analysis:rc_cost_001:mock:v1' })
    const decision = await draftDecision(store, { research_case_id: researchCase.research_case_id, decision_id: 'decision_cost_watch_001', decision: analysis.investment_verdict, reason: 'Demo analysis says watch until margin of safety improves.', causation_id: analysis.event_id })
    await confirmWatchlistDraft(store, { watchlist_item_id: 'watch_cost_001', research_case_id: researchCase.research_case_id, decision_id: decision.decision_id, company_id: 'company_cost', ticker: 'COST', strategy_id: 'buffett-munger', thesis_summary: 'Durable quality compounder; wait for better margin of safety.', actor_id: 'user_local' })

    const events = await store.list()
    const projectedCases = projectResearchCases(events)
    const projectedWatchlist = projectWatchlist(events)

    expect(projectedCases[0]).toMatchObject({ research_case_id: 'rc_cost_001', stage: 'watchlist_draft', investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', shariah_status: 'COMPLIANT' })
    expect(projectedWatchlist[0]).toMatchObject({ watchlist_item_id: 'watch_cost_001', user_approved: false, created_by_actor_type: 'user', created_by_actor_id: 'user_local' })
    expect(events.some((event) => event.actor_type === 'provider' && event.event_type === 'watchlist_draft_created')).toBe(false)
  })
})
