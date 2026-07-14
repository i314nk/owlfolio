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

  it('projects frozen_reference_fair_value + frozen_iv_valuation_version from the draft event', () => {
    const watchlist = projectWatchlist([
      watchlistDraftCreated({
        // The frozen REFERENCE fair value (216) is DISTINCT from the MoS-discounted buy-below (150).
        locked_buy_below: 150,
        buy_below_valuation_version: 'valuation-2026-06-1',
        frozen_reference_fair_value: 216,
        frozen_iv_valuation_version: 'valuation-2026-06-1',
      }),
    ])

    expect(watchlist[0]).toMatchObject({
      locked_buy_below: 150,
      frozen_reference_fair_value: 216,
      frozen_iv_valuation_version: 'valuation-2026-06-1',
    })
  })

  it('LEGACY TOLERANCE: maps a legacy frozen_iv event onto frozen_reference_fair_value', () => {
    const watchlist = projectWatchlist([
      watchlistDraftCreated({
        locked_buy_below: 150,
        buy_below_valuation_version: 'valuation-2026-06-1',
        // A legacy event written before the scope-reframe carried frozen_band_* + frozen_iv.
        frozen_band_low: 0.06,
        frozen_band_high: 0.10,
        frozen_iv: 216,
        frozen_iv_valuation_version: 'valuation-2026-06-1',
      }),
    ])

    expect(watchlist[0]?.frozen_reference_fair_value).toBe(216)
    expect(watchlist[0]?.locked_buy_below).toBe(150)
  })

  it('leaves frozen_reference_fair_value absent when the draft event carries none (never falls back to buy-below)', () => {
    const watchlist = projectWatchlist([
      watchlistDraftCreated({ locked_buy_below: 150, buy_below_valuation_version: 'valuation-2026-06-1' }),
    ])

    expect(watchlist[0]?.frozen_reference_fair_value).toBeUndefined()
    expect(watchlist[0]?.frozen_iv_valuation_version).toBeUndefined()
    // The discounted buy-below still projects — the reference must NOT have been backfilled from it.
    expect(watchlist[0]?.locked_buy_below).toBe(150)
  })
})

describe('projectWatchlist audit-and-decide sign-off (checklist_audit + thesis provenance)', () => {
  function draftCreated(payload: Record<string, unknown>): LedgerEventEnvelope<unknown> {
    return {
      event_id: 'evt_watchlist_draft_created_watch_cost_001',
      event_type: 'watchlist_draft_created',
      aggregate_type: 'watchlist_item',
      aggregate_id: 'watch_cost_001',
      actor_type: 'user',
      actor_id: 'user_local',
      payload: {
        watchlist_item_id: 'watch_cost_001',
        research_case_id: 'rc_cost_001',
        decision_id: 'decision_cost_001',
        company_id: 'company_cost',
        ticker: 'COST',
        strategy_id: 'buffett-munger',
        thesis_summary: 'Watch COST.',
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

  const completeAudit = {
    version: 'checklist-2026-06-phase7-2',
    business_findings: {
      moat_erosion: 'Marshaled finding: no erosion evidence.',
      shariah_drift: 'Marshaled finding: compliant.',
    },
    cognitive_acknowledged: true,
  }

  it('projects checklist_audit + signed_thesis_draft + thesis_amended:false when the human affirms', () => {
    const watchlist = projectWatchlist([
      draftCreated({
        signed_thesis: 'Final thesis verbatim from the agent draft.',
        signed_thesis_draft: 'Final thesis verbatim from the agent draft.',
        thesis_amended: false,
        checklist_audit: completeAudit,
      }),
    ])

    expect(watchlist[0]?.checklist_audit).toEqual(completeAudit)
    expect(watchlist[0]?.signed_thesis).toBe('Final thesis verbatim from the agent draft.')
    expect(watchlist[0]?.signed_thesis_draft).toBe('Final thesis verbatim from the agent draft.')
    expect(watchlist[0]?.thesis_amended).toBe(false)
    // No legacy answers field on a new event.
    expect(watchlist[0]?.checklist_answers).toBeUndefined()
  })

  it('projects thesis_amended:true when the human amended the agent draft', () => {
    const watchlist = projectWatchlist([
      draftCreated({
        signed_thesis: 'Human-amended final thesis with a wider margin of safety.',
        signed_thesis_draft: 'Agent draft thesis.',
        thesis_amended: true,
        checklist_audit: completeAudit,
      }),
    ])

    expect(watchlist[0]?.thesis_amended).toBe(true)
    expect(watchlist[0]?.signed_thesis).toBe('Human-amended final thesis with a wider margin of safety.')
    expect(watchlist[0]?.signed_thesis_draft).toBe('Agent draft thesis.')
  })

  it('LEGACY TOLERANCE: an OLD event carrying checklist_answers (no checklist_audit) still projects', () => {
    const legacyAnswers = {
      moat_erosion: { addressed: true, note: 'Legacy answer.' },
      shariah_drift: { addressed: true, note: 'Legacy answer.' },
    }
    const watchlist = projectWatchlist([
      draftCreated({
        signed_thesis: 'Legacy signed thesis.',
        checklist_answers: legacyAnswers,
      }),
    ])

    // The legacy answers project without throwing; the new audit field stays undefined.
    expect(watchlist[0]?.checklist_answers).toEqual(legacyAnswers)
    expect(watchlist[0]?.checklist_audit).toBeUndefined()
    expect(watchlist[0]?.signed_thesis).toBe('Legacy signed thesis.')
    expect(watchlist[0]?.signed_thesis_draft).toBeUndefined()
    expect(watchlist[0]?.thesis_amended).toBeUndefined()
  })
})

describe('projectWatchlist — the human-authored prune removes the item from active views', () => {
  const draft = (id: string): LedgerEventEnvelope<unknown> => ({
    event_id: `evt_created_${id}`,
    event_type: 'watchlist_draft_created',
    aggregate_type: 'watchlist_item',
    aggregate_id: id,
    correlation_id: 'rc_v_001',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { watchlist_item_id: id, research_case_id: 'rc_v_001', ticker: 'V', user_approved: true },
    source_ids: [],
    created_at: '2026-07-01T00:00:00.000Z',
    schema_version: 1,
  } as LedgerEventEnvelope<unknown>)

  it('drops a pruned item (the raw events remain the audit record)', () => {
    const prune: LedgerEventEnvelope<unknown> = {
      event_id: 'evt_watchlist_item_pruned_w_v_001',
      event_type: 'watchlist_item_pruned',
      aggregate_type: 'watchlist_item',
      aggregate_id: 'w_v_001',
      actor_type: 'user',
      actor_id: 'user_local',
      payload: { watchlist_item_id: 'w_v_001', ticker: 'V', pruned_at: '2026-07-14', reason: 'No longer tracking', is_execution: true, requires_user_authoring: true },
      source_ids: [],
      created_at: '2026-07-14T00:00:00.000Z',
      schema_version: 1,
    } as LedgerEventEnvelope<unknown>
    expect(projectWatchlist([draft('w_v_001'), prune])).toEqual([])
    // The other item is untouched.
    expect(projectWatchlist([draft('w_v_001'), draft('w_ko_001'), prune]).map((i) => i.watchlist_item_id)).toEqual(['w_ko_001'])
  })
})
