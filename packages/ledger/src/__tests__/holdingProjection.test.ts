import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectHoldings } from '../projections/holdingProjection'

const openedHolding: LedgerEventEnvelope<unknown> = {
  event_id: 'evt_holding_opened',
  event_type: 'holding_opened',
  aggregate_type: 'holding',
  aggregate_id: 'holding_cost_001',
  actor_type: 'user',
  actor_id: 'user_local',
  payload: {
    holding_id: 'holding_cost_001',
    watchlist_item_id: 'watch_cost_001',
    research_case_id: 'rc_cost_001',
    ticker: 'COST',
    strategy_id: 'buffett-munger',
    shares: 3,
    cost_basis_per_share: 800,
    total_cost_basis: 2400,
    currency: 'USD',
    opened_at: '2026-05-31',
  },
  source_ids: [],
  created_at: '2026-05-31T00:00:00.000Z',
  schema_version: 1,
}

function draftedReview(reviewId: string, createdAt: string): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_holding_review_drafted_${reviewId}`,
    event_type: 'holding_review_drafted',
    aggregate_type: 'holding',
    aggregate_id: 'holding_cost_001',
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      review_id: reviewId,
      holding_id: 'holding_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      thesis_health: 'HEALTHY',
      action_stance: 'HOLD',
      rationale: `Draft ${reviewId}`,
      evidence_summary: 'Reviewed source ledger references.',
      uncertainty: 'Refresh after the next filing.',
      next_review_at: '2026-09-30',
      user_approved: false,
    },
    source_ids: [],
    created_at: createdAt,
    schema_version: 1,
  }
}

describe('projectHoldings', () => {
  it('projects latest Shariah gate decision details onto holdings', () => {
    const holdings = projectHoldings([
      {
        event_id: 'evt_shariah_gate_holding_cost_001',
        event_type: 'shariah_gate_decision_recorded',
        aggregate_type: 'decision',
        aggregate_id: 'gate_holding_cost_001',
        actor_type: 'system',
        payload: {
          gate_decision_id: 'gate_holding_cost_001',
          target_transition: 'holding_open',
          target_id: 'holding_cost_001',
          research_case_id: 'rc_cost_001',
          status: 'COMPLIANT',
          allowed: true,
          requires_user_confirmation: false,
          reasons: [],
          required_source_ids: ['src_cost_10k_2025'],
          missing_evidence: [],
          conditional_allowed: true,
        },
        source_ids: ['src_cost_10k_2025'],
        created_at: '2026-05-30T00:00:00.000Z',
        schema_version: 1,
      },
      openedHolding,
    ])

    expect(holdings[0]).toMatchObject({
      holding_id: 'holding_cost_001',
      shariah_gate_decision_id: 'gate_holding_cost_001',
      shariah_gate_status: 'COMPLIANT',
      shariah_gate_allowed: true,
      shariah_gate_reasons: [],
      shariah_required_source_ids: ['src_cost_10k_2025'],
      shariah_missing_evidence: [],
    })
  })

  it('keeps the newest pending review visible when an older draft is decided later', () => {
    const holdings = projectHoldings([
      openedHolding,
      draftedReview('review_old', '2026-06-01T00:00:00.000Z'),
      draftedReview('review_new', '2026-06-02T00:00:00.000Z'),
      {
        event_id: 'evt_holding_review_confirmed_review_old',
        event_type: 'holding_review_confirmed',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost_001',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          review_id: 'review_old',
          holding_id: 'holding_cost_001',
          research_case_id: 'rc_cost_001',
          ticker: 'COST',
          strategy_id: 'buffett-munger',
          thesis_health: 'HEALTHY',
          action_stance: 'HOLD',
          rationale: 'Confirmed the older draft.',
          evidence_summary: 'Manual confirmation.',
          uncertainty: 'No new uncertainty.',
          next_review_at: '2026-09-30',
          user_approved: true,
        },
        source_ids: [],
        created_at: '2026-06-03T00:00:00.000Z',
        schema_version: 1,
      },
    ])

    expect(holdings[0]).toMatchObject({
      latest_review_id: 'review_old',
      pending_review_id: 'review_new',
      pending_review_rationale: 'Draft review_new',
    })
  })

  it('projects the re-underwrite checklist answers from holding_review_confirmed (auditable)', () => {
    const checklistAnswers = {
      moat_erosion: { addressed: true, note: 'No erosion evidence at re-underwrite.' },
      shariah_drift: { addressed: true, note: 'Ratios unchanged since admission.' },
    }
    const holdings = projectHoldings([
      openedHolding,
      draftedReview('review_ru', '2026-06-01T00:00:00.000Z'),
      {
        event_id: 'evt_holding_review_confirmed_review_ru',
        event_type: 'holding_review_confirmed',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost_001',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          review_id: 'review_ru',
          holding_id: 'holding_cost_001',
          research_case_id: 'rc_cost_001',
          ticker: 'COST',
          strategy_id: 'buffett-munger',
          thesis_health: 'HEALTHY',
          action_stance: 'HOLD',
          rationale: 'Confirmed at re-underwrite.',
          evidence_summary: 'Manual confirmation.',
          uncertainty: 'None.',
          next_review_at: '2026-09-30',
          user_approved: true,
          checklist_answers: checklistAnswers,
        },
        source_ids: [],
        created_at: '2026-06-03T00:00:00.000Z',
        schema_version: 1,
      },
    ])

    expect(holdings[0]?.checklist_answers).toEqual(checklistAnswers)
  })

  it('omits checklist_answers when an older confirmation event has none', () => {
    const holdings = projectHoldings([
      openedHolding,
      draftedReview('review_legacy', '2026-06-01T00:00:00.000Z'),
      {
        event_id: 'evt_holding_review_confirmed_review_legacy',
        event_type: 'holding_review_confirmed',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost_001',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          review_id: 'review_legacy',
          holding_id: 'holding_cost_001',
          research_case_id: 'rc_cost_001',
          ticker: 'COST',
          strategy_id: 'buffett-munger',
          thesis_health: 'HEALTHY',
          action_stance: 'HOLD',
          rationale: 'Legacy confirmation, no checklist.',
          evidence_summary: 'Manual confirmation.',
          uncertainty: 'None.',
          next_review_at: '2026-09-30',
          user_approved: true,
        },
        source_ids: [],
        created_at: '2026-06-03T00:00:00.000Z',
        schema_version: 1,
      },
    ])

    expect(holdings[0]?.checklist_answers).toBeUndefined()
  })

  it('projects scheduled price-check metadata from valuation snapshots', () => {
    const holdings = projectHoldings([
      openedHolding,
      {
        event_id: 'evt_holding_valuation_recorded_scheduled_cost_20260601',
        event_type: 'holding_valuation_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost_001',
        actor_type: 'worker',
        actor_id: 'owlfolio-worker',
        payload: {
          snapshot_id: 'scheduled_cost_20260601',
          holding_id: 'holding_cost_001',
          price_per_share: 912.34,
          shares: 3,
          market_value: 2737.02,
          currency: 'USD',
          valued_at: '2026-06-01',
          valuation_source: 'mock-local-price-feed',
          price_checked_at: '2026-06-01T07:00:00.000Z',
          confidence: 'mock',
          caveat: 'Deterministic mock price for local workflow verification.',
          missing_data: [],
          valued_by_actor_type: 'worker',
          valued_by_actor_id: 'owlfolio-worker',
        },
        source_ids: ['mock-price:COST:2026-06-01'],
        created_at: '2026-06-01T07:00:00.000Z',
        schema_version: 1,
      },
    ])

    expect(holdings[0]).toMatchObject({
      latest_market_value: 2737.02,
      latest_price_per_share: 912.34,
      latest_valuation_source: 'mock-local-price-feed',
      latest_price_checked_at: '2026-06-01T07:00:00.000Z',
      latest_valuation_confidence: 'mock',
      latest_valuation_caveat: 'Deterministic mock price for local workflow verification.',
      latest_valuation_source_ids: ['mock-price:COST:2026-06-01'],
      latest_valuation_missing_data: [],
    })
  })

  it('clears scheduled price-check metadata when a later manual valuation becomes latest', () => {
    const holdings = projectHoldings([
      openedHolding,
      {
        event_id: 'evt_holding_valuation_recorded_scheduled_cost_20260601',
        event_type: 'holding_valuation_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost_001',
        actor_type: 'worker',
        actor_id: 'owlfolio-worker',
        payload: {
          snapshot_id: 'scheduled_cost_20260601',
          holding_id: 'holding_cost_001',
          price_per_share: 912.34,
          shares: 3,
          market_value: 2737.02,
          currency: 'USD',
          valued_at: '2026-06-01',
          valuation_source: 'mock-local-price-feed',
          price_checked_at: '2026-06-01T07:00:00.000Z',
          confidence: 'mock',
          caveat: 'Deterministic mock price for local workflow verification.',
          missing_data: [],
          valued_by_actor_type: 'worker',
          valued_by_actor_id: 'owlfolio-worker',
        },
        source_ids: ['mock-price:COST:2026-06-01'],
        created_at: '2026-06-01T07:00:00.000Z',
        schema_version: 1,
      },
      {
        event_id: 'evt_holding_valuation_recorded_manual_cost_20260602',
        event_type: 'holding_valuation_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'holding_cost_001',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          snapshot_id: 'manual_cost_20260602',
          holding_id: 'holding_cost_001',
          price_per_share: 920,
          shares: 3,
          market_value: 2760,
          currency: 'USD',
          valued_at: '2026-06-02',
          valuation_source: 'manual',
          valued_by_actor_type: 'user',
          valued_by_actor_id: 'user_local',
        },
        source_ids: [],
        created_at: '2026-06-02T07:00:00.000Z',
        schema_version: 1,
      },
    ])

    expect(holdings[0]).toMatchObject({
      latest_market_value: 2760,
      latest_price_per_share: 920,
      latest_valuation_source: 'manual',
      latest_valuation_source_ids: [],
      latest_valuation_missing_data: [],
    })
    expect(holdings[0]).not.toHaveProperty('latest_price_checked_at')
    expect(holdings[0]).not.toHaveProperty('latest_valuation_confidence')
    expect(holdings[0]).not.toHaveProperty('latest_valuation_caveat')
  })
})
