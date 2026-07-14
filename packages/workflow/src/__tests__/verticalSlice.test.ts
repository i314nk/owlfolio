import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { MockProvider } from '@owlfolio/providers/mockProvider'
import { openHoldingFromWatchlist, recordHoldingValuationSnapshot } from '../holdingWorkflow'
import { CHECKLIST_PARAMS, listBusinessItems } from '@owlfolio/strategies/checklistParams'
import { createResearchCase, runDemoBuffettMungerAnalysis, draftDecision } from '../researchWorkflow'
import { confirmWatchlistDraft } from '../watchlistWorkflow'

// Phase 7 S2: admit requires every hygiene/bias checklist item to be addressed (affirmed + note).
const COMPLETE_AUDIT: import('@owlfolio/strategies/checklistParams').ChecklistAudit = {
  version: CHECKLIST_PARAMS.version,
  business_findings: Object.fromEntries(
    listBusinessItems().map((item) => [item.id, `Marshaled finding for ${item.id}.`]),
  ),
  cognitive_acknowledged: true,
}

async function openCostHolding(store: InMemoryEventStore) {
  return await openHoldingFromWatchlist(store, {
    holding_id: 'holding_cost_001',
    watchlist_item_id: 'watch_cost_001',
    research_case_id: 'rc_cost_001',
    company_id: 'company_cost',
    ticker: 'COST',
    strategy_id: 'buffett-munger',
    thesis_summary: 'Durable quality compounder.',
    shares: 3,
    cost_basis_per_share: 800,
    opened_at: '2026-05-31',
    currency: 'USD',
    causation_id: 'evt_watchlist_confirmed',
    actor_id: 'user_local',
  })
}

describe('v0.2 vertical research workflow', () => {
  it('creates a Buffett-Munger research case and confirms a user-attributed watchlist draft', async () => {
    const store = new InMemoryEventStore()
    const provider = new MockProvider()

    const researchCase = await createResearchCase(store, { research_case_id: 'rc_cost_001', company_id: 'company_cost', ticker: 'COST', strategy_id: 'buffett-munger', actor_id: 'user_local' })
    const analysis = await runDemoBuffettMungerAnalysis(store, provider, { research_case_id: researchCase.research_case_id, company_id: 'company_cost', ticker: 'COST', idempotency_key: 'analysis:rc_cost_001:mock:v1' })
    const decision = await draftDecision(store, { research_case_id: researchCase.research_case_id, decision_id: 'decision_cost_watch_001', decision: analysis.investment_verdict, reason: 'Demo analysis says watch until margin of safety improves.', causation_id: analysis.event_id })
    // Phase 8 S4: one gated admit emits BOTH the created draft AND the confirmation atomically.
    await confirmWatchlistDraft(store, { watchlist_item_id: 'watch_cost_001', research_case_id: researchCase.research_case_id, decision_id: decision.decision_id, company_id: 'company_cost', ticker: 'COST', strategy_id: 'buffett-munger', thesis_summary: 'Durable quality compounder; wait for better margin of safety.', locked_buy_below: 742.5, buy_below_valuation_version: 'valuation-2026-06-cap-1', signed_thesis: 'I am admitting COST as a durable low-cost-moat compounder; buy only at a deep dislocation.', signed_thesis_draft: 'I am admitting COST as a durable low-cost-moat compounder; buy only at a deep dislocation.', checklist_audit: COMPLETE_AUDIT, actor_id: 'user_local' })
    const confirmedEvent = (await store.list()).find((event) => event.event_type === 'watchlist_draft_confirmed')
    if (confirmedEvent === undefined) {
      throw new Error('expected the consolidated admit to emit a watchlist_draft_confirmed event')
    }
    const confirmed = { ...confirmedEvent, ...(confirmedEvent.payload as Record<string, unknown>) }
    const holding = await openHoldingFromWatchlist(store, {
      holding_id: 'holding_cost_001',
      watchlist_item_id: 'watch_cost_001',
      research_case_id: researchCase.research_case_id,
      company_id: 'company_cost',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      thesis_summary: 'Durable quality compounder; wait for better margin of safety.',
      shares: 3.25,
      cost_basis_per_share: 812.4,
      opened_at: '2026-05-31',
      currency: 'USD',
      causation_id: confirmed.event_id,
      actor_id: 'user_local',
      idempotency_key: 'holding:watch_cost_001:open:v1',
    })

    const valuation = await recordHoldingValuationSnapshot(store, {
      snapshot_id: 'valuation_holding_cost_001_2026_06_01',
      holding_id: holding.holding_id,
      price_per_share: 900,
      currency: 'USD',
      valued_at: '2026-06-01',
      causation_id: holding.event_id,
      actor_id: 'user_local',
      idempotency_key: 'holding:holding_cost_001:valuation:2026-06-01:v1',
    })
    // REVIEW RETIRED (owner, 2026-07-14): the drafted holding review + attestation are gone —
    // the vertical slice ends at the held thesis; check-ins/10-K re-runs are covered elsewhere.
    const events = await store.list()
    const projectedCases = projectResearchCases(events)
    const projectedWatchlist = projectWatchlist(events)
    const projectedHoldings = projectHoldings(events)

    expect(confirmed).toMatchObject({
      watchlist_item_id: 'watch_cost_001',
      research_case_id: 'rc_cost_001',
      user_approved: true,
      confirmed_by_actor_type: 'user',
      confirmed_by_actor_id: 'user_local',
    })
    expect(holding).toMatchObject({
      holding_id: 'holding_cost_001',
      watchlist_item_id: 'watch_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      shares: 3.25,
      cost_basis_per_share: 812.4,
      opened_at: '2026-05-31',
      total_cost_basis: 2640.3,
      currency: 'USD',
      opened_by_actor_type: 'user',
      opened_by_actor_id: 'user_local',
    })
    expect(valuation).toMatchObject({
      snapshot_id: 'valuation_holding_cost_001_2026_06_01',
      holding_id: 'holding_cost_001',
      price_per_share: 900,
      shares: 3.25,
      market_value: 2925,
      currency: 'USD',
      valued_at: '2026-06-01',
      valued_by_actor_type: 'user',
      valued_by_actor_id: 'user_local',
    })
    expect(projectedCases[0]).toMatchObject({ research_case_id: 'rc_cost_001', stage: 'holding', investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', shariah_status: 'COMPLIANT', user_approved: true })
    expect(projectedWatchlist[0]).toMatchObject({ watchlist_item_id: 'watch_cost_001', user_approved: true, created_by_actor_type: 'user', created_by_actor_id: 'user_local', confirmed_by_actor_type: 'user', confirmed_by_actor_id: 'user_local' })
    expect(projectedHoldings[0]).toMatchObject({
      holding_id: 'holding_cost_001',
      watchlist_item_id: 'watch_cost_001',
      ticker: 'COST',
      shares: 3.25,
      cost_basis_per_share: 812.4,
      total_cost_basis: 2640.3,
      opened_at: '2026-05-31',
      latest_price_per_share: 900,
      latest_market_value: 2925,
      latest_valuation_at: '2026-06-01',
      unrealized_gain_loss: 284.7,
      unrealized_gain_loss_percent: 10.78,
      portfolio_weight: 100,
    })
    expect(projectedHoldings[0]?.pending_review_id).toBeUndefined()
    expect(events.some((event) => event.actor_type === 'provider' && event.event_type.startsWith('watchlist_'))).toBe(false)
    expect(events.some((event) => event.actor_type === 'provider' && ['holding_opened', 'holding_valuation_recorded'].includes(event.event_type))).toBe(false)
  })

  it('rejects invalid user-entered holding lot economics', async () => {
    const store = new InMemoryEventStore()

    await expect(openHoldingFromWatchlist(store, {
      holding_id: 'holding_cost_001',
      watchlist_item_id: 'watch_cost_001',
      research_case_id: 'rc_cost_001',
      company_id: 'company_cost',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      thesis_summary: 'Durable quality compounder.',
      shares: 0,
      cost_basis_per_share: 812.4,
      currency: 'USD',
      opened_at: '2026-05-31',
      causation_id: 'evt_watchlist_confirmed',
      actor_id: 'user_local',
    })).rejects.toThrow('Holding shares must be greater than zero')

    await expect(openHoldingFromWatchlist(store, {
      holding_id: 'holding_cost_002',
      watchlist_item_id: 'watch_cost_001',
      research_case_id: 'rc_cost_001',
      company_id: 'company_cost',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      thesis_summary: 'Durable quality compounder.',
      shares: 1,
      cost_basis_per_share: -1,
      currency: 'USD',
      opened_at: '2026-05-31',
      causation_id: 'evt_watchlist_confirmed',
      actor_id: 'user_local',
    })).rejects.toThrow('Cost basis per share cannot be negative')
    await expect(recordHoldingValuationSnapshot(store, {
      snapshot_id: 'valuation_holding_cost_001_invalid',
      holding_id: 'holding_cost_001',
      price_per_share: -1,
      currency: 'USD',
      valued_at: '2026-06-01',
      causation_id: 'evt_holding_opened',
      actor_id: 'user_local',
    })).rejects.toThrow('Valuation price per share cannot be negative')

    await expect(recordHoldingValuationSnapshot(store, {
      snapshot_id: 'valuation_holding_cost_001_bad_date',
      holding_id: 'holding_cost_001',
      price_per_share: 900,
      currency: 'USD',
      valued_at: '06/01/2026',
      causation_id: 'evt_holding_opened',
      actor_id: 'user_local',
    })).rejects.toThrow('Valuation date must use YYYY-MM-DD format')
  })

  it('rejects valuation snapshots in a currency that differs from the opened holding', async () => {
    const store = new InMemoryEventStore()
    const holding = await openCostHolding(store)

    await expect(recordHoldingValuationSnapshot(store, {
      snapshot_id: 'valuation_holding_cost_001_eur',
      holding_id: holding.holding_id,
      price_per_share: 900,
      currency: 'EUR',
      valued_at: '2026-06-01',
      causation_id: holding.event_id,
      actor_id: 'user_local',
    })).rejects.toThrow('Valuation currency must match holding currency')
  })

})
