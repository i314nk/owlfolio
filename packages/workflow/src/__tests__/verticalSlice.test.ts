import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { MockProvider } from '@owlfolio/providers/mockProvider'
import { openHoldingFromWatchlist, recordHoldingValuationSnapshot } from '../holdingWorkflow'
import {
  confirmHoldingReviewDraft,
  draftHoldingReview,
  overrideHoldingReviewDraft,
  rejectHoldingReviewDraft,
} from '../holdingReviewWorkflow'
import { createResearchCase, runDemoBuffettMungerAnalysis, draftDecision } from '../researchWorkflow'
import { approveWatchlistDraft, confirmWatchlistDraft } from '../watchlistWorkflow'

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
    await confirmWatchlistDraft(store, { watchlist_item_id: 'watch_cost_001', research_case_id: researchCase.research_case_id, decision_id: decision.decision_id, company_id: 'company_cost', ticker: 'COST', strategy_id: 'buffett-munger', thesis_summary: 'Durable quality compounder; wait for better margin of safety.', actor_id: 'user_local' })
    const confirmed = await approveWatchlistDraft(store, { watchlist_item_id: 'watch_cost_001', research_case_id: researchCase.research_case_id, causation_id: 'watch_cost_001', actor_id: 'user_local', idempotency_key: 'watchlist:watch_cost_001:confirm:v1' })
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
    const reviewDraft = await draftHoldingReview(store, provider, {
      review_id: 'review_holding_cost_001_2026_06_30',
      holding_id: holding.holding_id,
      model_id: 'mock-buffett-munger-demo',
      causation_id: valuation.event_id,
      idempotency_key: 'holding:holding_cost_001:review:2026-06-30:v1',
    })
    const reviewConfirmation = await confirmHoldingReviewDraft(store, {
      review_id: reviewDraft.review_id,
      holding_id: holding.holding_id,
      causation_id: reviewDraft.event_id,
      actor_id: 'user_local',
      idempotency_key: 'holding:holding_cost_001:review:2026-06-30:confirm:v1',
    })
    const secondReviewDraft = await draftHoldingReview(store, provider, {
      review_id: 'review_holding_cost_001_2026_12_31',
      holding_id: holding.holding_id,
      model_id: 'mock-buffett-munger-demo',
      causation_id: reviewConfirmation.event_id,
      idempotency_key: 'holding:holding_cost_001:review:2026-12-31:v1',
    })
    const reviewOverride = await overrideHoldingReviewDraft(store, {
      review_id: secondReviewDraft.review_id,
      holding_id: holding.holding_id,
      causation_id: secondReviewDraft.event_id,
      actor_id: 'user_local',
      thesis_health: 'WATCH',
      action_stance: 'RESEARCH_MORE',
      rationale: 'User override: moat remains attractive but valuation/concentration require more evidence.',
      evidence_summary: 'Reviewed latest valuation snapshot and original watchlist thesis.',
      uncertainty: 'Need updated debt and Shariah ratio review before increasing exposure.',
      next_review_at: '2026-10-31',
      idempotency_key: 'holding:holding_cost_001:review:2026-12-31:override:v1',
    })
    const rejectedReviewDraft = await draftHoldingReview(store, provider, {
      review_id: 'review_holding_cost_001_2027_01_31',
      holding_id: holding.holding_id,
      model_id: 'mock-buffett-munger-demo',
      causation_id: reviewOverride.event_id,
      idempotency_key: 'holding:holding_cost_001:review:2027-01-31:v1',
    })
    const reviewRejection = await rejectHoldingReviewDraft(store, {
      review_id: rejectedReviewDraft.review_id,
      holding_id: holding.holding_id,
      causation_id: rejectedReviewDraft.event_id,
      actor_id: 'user_local',
      rejection_reason: 'Rejecting stale draft after manual override; wait for fresh evidence.',
      idempotency_key: 'holding:holding_cost_001:review:2027-01-31:reject:v1',
    })

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
    expect(reviewDraft).toMatchObject({
      review_id: 'review_holding_cost_001_2026_06_30',
      holding_id: 'holding_cost_001',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      thesis_health: 'HEALTHY',
      action_stance: 'HOLD',
      user_approved: false,
      reviewed_by_actor_type: 'provider',
      reviewed_by_actor_id: 'mock-provider',
      next_review_at: '2026-09-30',
    })
    expect(reviewConfirmation).toMatchObject({
      review_id: 'review_holding_cost_001_2026_06_30',
      holding_id: 'holding_cost_001',
      thesis_health: 'HEALTHY',
      action_stance: 'HOLD',
      user_approved: true,
      confirmed_by_actor_type: 'user',
      confirmed_by_actor_id: 'user_local',
      next_review_at: '2026-09-30',
    })
    expect(reviewOverride).toMatchObject({
      review_id: 'review_holding_cost_001_2026_12_31',
      holding_id: 'holding_cost_001',
      event_type: 'holding_review_overridden',
      actor_type: 'user',
      thesis_health: 'WATCH',
      action_stance: 'RESEARCH_MORE',
      rationale: 'User override: moat remains attractive but valuation/concentration require more evidence.',
      evidence_summary: 'Reviewed latest valuation snapshot and original watchlist thesis.',
      uncertainty: 'Need updated debt and Shariah ratio review before increasing exposure.',
      user_approved: true,
      user_overrode_provider: true,
      overridden_by_actor_type: 'user',
      overridden_by_actor_id: 'user_local',
      next_review_at: '2026-10-31',
    })
    expect(reviewRejection).toMatchObject({
      review_id: 'review_holding_cost_001_2027_01_31',
      holding_id: 'holding_cost_001',
      event_type: 'holding_review_rejected',
      actor_type: 'user',
      user_approved: false,
      rejected_by_actor_type: 'user',
      rejected_by_actor_id: 'user_local',
      rejection_reason: 'Rejecting stale draft after manual override; wait for fresh evidence.',
    })
    expect(projectedCases[0]).toMatchObject({ research_case_id: 'rc_cost_001', stage: 'holding_opened', investment_verdict: 'WATCH', strategy_compliance: 'CONDITIONAL', shariah_status: 'COMPLIANT', user_approved: true })
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
      latest_review_id: 'review_holding_cost_001_2026_12_31',
      thesis_health: 'WATCH',
      action_stance: 'RESEARCH_MORE',
      latest_review_rationale: 'User override: moat remains attractive but valuation/concentration require more evidence.',
      latest_review_evidence_summary: 'Reviewed latest valuation snapshot and original watchlist thesis.',
      latest_review_uncertainty: 'Need updated debt and Shariah ratio review before increasing exposure.',
      next_review_at: '2026-10-31',
    })
    expect(projectedHoldings[0]?.pending_review_id).toBeUndefined()
    expect(events.some((event) => event.actor_type === 'provider' && event.event_type.startsWith('watchlist_'))).toBe(false)
    expect(events.some((event) => event.actor_type === 'provider' && ['holding_opened', 'holding_valuation_recorded'].includes(event.event_type))).toBe(false)
    expect(events.some((event) => event.actor_type === 'provider' && event.event_type === 'holding_review_drafted')).toBe(true)
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

  it('rejects decisions for stale holding review drafts when a newer draft is pending', async () => {
    const store = new InMemoryEventStore()
    const provider = new MockProvider()
    const holding = await openCostHolding(store)
    const firstDraft = await draftHoldingReview(store, provider, {
      review_id: 'review_holding_cost_001_first',
      holding_id: holding.holding_id,
      model_id: 'mock-buffett-munger-demo',
      causation_id: holding.event_id,
    })
    await draftHoldingReview(store, provider, {
      review_id: 'review_holding_cost_001_second',
      holding_id: holding.holding_id,
      model_id: 'mock-buffett-munger-demo',
      causation_id: firstDraft.event_id,
    })

    await expect(confirmHoldingReviewDraft(store, {
      review_id: firstDraft.review_id,
      holding_id: holding.holding_id,
      causation_id: firstDraft.event_id,
      actor_id: 'user_local',
    })).rejects.toThrow('Holding review draft is not the latest pending draft')
  })
})
