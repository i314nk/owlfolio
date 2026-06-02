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
})
