import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectWatchlist } from '../projections/watchlistProjection'

function gateDecision(overrides: Partial<LedgerEventEnvelope<unknown>> = {}): LedgerEventEnvelope<unknown> {
  return {
    event_id: 'evt_shariah_gate_watch_msft_001',
    event_type: 'shariah_gate_decision_recorded',
    aggregate_type: 'decision',
    aggregate_id: 'gate_watch_msft_001',
    actor_type: 'system',
    payload: {
      gate_decision_id: 'gate_watch_msft_001',
      target_transition: 'watchlist_promotion',
      target_id: 'watch_msft_001',
      research_case_id: 'rc_msft_001',
      status: 'CONDITIONAL',
      allowed: true,
      requires_user_confirmation: true,
      reasons: ['Business activity requires conditional Shariah review with sourced evidence.'],
      required_source_ids: ['src_msft_10k_2025'],
      missing_evidence: [],
      conditional_allowed: true,
    },
    source_ids: ['src_msft_10k_2025'],
    created_at: '2026-06-01T00:00:00.000Z',
    schema_version: 1,
    ...overrides,
  }
}

describe('projectWatchlist Shariah gates', () => {
  it('projects latest Shariah gate decision details onto watchlist items', () => {
    const watchlist = projectWatchlist([
      gateDecision(),
      {
        event_id: 'evt_watchlist_draft_created_watch_msft_001',
        event_type: 'watchlist_draft_created',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_msft_001',
        actor_type: 'user',
        actor_id: 'user_local',
        payload: {
          watchlist_item_id: 'watch_msft_001',
          research_case_id: 'rc_msft_001',
          decision_id: 'decision_msft_001',
          company_id: 'company_msft',
          ticker: 'MSFT',
          strategy_id: 'buffett-munger',
          thesis_summary: 'Watch MSFT.',
          user_approved: false,
          created_by_actor_type: 'user',
          created_by_actor_id: 'user_local',
        },
        source_ids: [],
        created_at: '2026-06-01T00:01:00.000Z',
        schema_version: 1,
      },
    ])

    expect(watchlist[0]).toMatchObject({
      watchlist_item_id: 'watch_msft_001',
      shariah_gate_decision_id: 'gate_watch_msft_001',
      shariah_gate_status: 'CONDITIONAL',
      shariah_gate_allowed: true,
      shariah_gate_reasons: ['Business activity requires conditional Shariah review with sourced evidence.'],
      shariah_required_source_ids: ['src_msft_10k_2025'],
      shariah_missing_evidence: [],
    })
  })
})

describe('projectWatchlist frozen undiscounted IV (Phase 6 S3)', () => {
  function watchlistDraftCreated(payload: Record<string, unknown>): LedgerEventEnvelope<unknown> {
    return {
      event_id: 'evt_watchlist_draft_created_watch_msft_001',
      event_type: 'watchlist_draft_created',
      aggregate_type: 'watchlist_item',
      aggregate_id: 'watch_msft_001',
      actor_type: 'user',
      actor_id: 'user_local',
      payload: {
        watchlist_item_id: 'watch_msft_001',
        research_case_id: 'rc_msft_001',
        decision_id: 'decision_msft_001',
        company_id: 'company_msft',
        ticker: 'MSFT',
        strategy_id: 'buffett-munger',
        thesis_summary: 'Watch MSFT.',
        user_approved: false,
        created_by_actor_type: 'user',
        created_by_actor_id: 'user_local',
        ...payload,
      },
      source_ids: [],
      created_at: '2026-06-01T00:01:00.000Z',
      schema_version: 1,
    }
  }

  it('projects frozen_iv + frozen_iv_valuation_version from the draft event', () => {
    const watchlist = projectWatchlist([
      watchlistDraftCreated({
        // The frozen undiscounted IV (216) is DISTINCT from the MoS-discounted buy-below (150).
        locked_buy_below: 150,
        buy_below_valuation_version: 'valuation-2026-06-1',
        frozen_iv: 216,
        frozen_iv_valuation_version: 'valuation-2026-06-1',
      }),
    ])

    expect(watchlist[0]).toMatchObject({
      locked_buy_below: 150,
      frozen_iv: 216,
      frozen_iv_valuation_version: 'valuation-2026-06-1',
    })
  })

  it('leaves frozen_iv absent when the draft event carries none (never falls back to buy-below)', () => {
    const watchlist = projectWatchlist([
      watchlistDraftCreated({ locked_buy_below: 150, buy_below_valuation_version: 'valuation-2026-06-1' }),
    ])

    expect(watchlist[0]?.frozen_iv).toBeUndefined()
    expect(watchlist[0]?.frozen_iv_valuation_version).toBeUndefined()
    // The discounted buy-below still projects — frozen_iv must NOT have been backfilled from it.
    expect(watchlist[0]?.locked_buy_below).toBe(150)
  })
})
