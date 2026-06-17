import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'

// ---------------------------------------------------------------------------
// Phase 6 S8b — projecting the SELL DECISION OBSERVATION onto the research case.
//
// `holding_sell_review_drafted` is an agent OBSERVATION (recomputed fresh on-demand by S8a). It rides on
// the HELD holding (aggregate_id = holding_id) and is correlated to the research case (correlation_id =
// research_case_id; the payload also carries research_case_id). The projection surfaces the NEWEST such
// observation as a read-only `sell_recommendation` field and must NOT transition the case stage (it never
// closes the holding).
// ---------------------------------------------------------------------------

const RC = 'rc_sell_proj'
const HOLDING = 'holding_sell_proj'

function created(): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_created_${RC}`,
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: RC,
    correlation_id: RC,
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { research_case_id: RC, ticker: 'TST', company_id: 'company_tst' },
    source_ids: [],
    created_at: '2026-06-01T00:00:00.000Z',
    schema_version: 1,
  }
}

function holdingOpened(): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_holding_opened_${RC}`,
    event_type: 'holding_opened',
    aggregate_type: 'holding',
    aggregate_id: HOLDING,
    correlation_id: RC,
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { research_case_id: RC, ticker: 'TST', company_id: 'company_tst', holding_id: HOLDING },
    source_ids: [],
    created_at: '2026-06-01T01:00:00.000Z',
    schema_version: 1,
  }
}

function sell(payload: Record<string, unknown>, createdAt: string, eventId: string): LedgerEventEnvelope<unknown> {
  return {
    event_id: eventId,
    event_type: 'holding_sell_review_drafted',
    aggregate_type: 'holding',
    aggregate_id: HOLDING,
    correlation_id: RC,
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      sell_review_id: eventId,
      holding_id: HOLDING,
      research_case_id: RC,
      ticker: 'TST',
      is_observation: true,
      is_recommendation: false,
      is_execution: false,
      requires_user_authoring: true,
      ...payload,
    },
    source_ids: ['src_a'],
    created_at: createdAt,
    schema_version: 1,
  }
}

const sellReviewPayload = () => ({
  decision_status: 'sell_review',
  reason_code: 'thesis_broken',
  trigger: 'thesis_broke',
  impairment_call: 'permanent_impairment',
  minimum_hold_decision: 'allow_sell_review',
  frozen_iv: 120,
  worst_case: {
    downside_floor_per_share: 30,
    downside_floor_basis: 'net_cash',
    downside_floor_reliability: 'high',
    realistic_downside: 12,
  },
  bias_caveats: [{ kind: 'disposition', message: 'do not hold to avoid realizing a loss' }],
  requires_human_signoff: true,
})

describe('projectResearchCases — holding_sell_review_drafted', () => {
  it('projects a sell_review recommendation (worst_case + bias_caveats + signoff survive)', () => {
    const cases = projectResearchCases([
      created(),
      holdingOpened(),
      sell(sellReviewPayload(), '2026-06-02T00:00:00.000Z', `evt_sell_1_${RC}`),
    ])
    const rec = cases.find((c) => c.research_case_id === RC)!.sell_recommendation!
    expect(rec.decision_status).toBe('sell_review')
    expect(rec.reason_code).toBe('thesis_broken')
    expect(rec.trigger).toBe('thesis_broke')
    expect(rec.impairment_call).toBe('permanent_impairment')
    expect(rec.minimum_hold_decision).toBe('allow_sell_review')
    // LEGACY TOLERANCE: the payload's legacy frozen_iv (120) maps onto the new frozen_reference_fair_value.
    expect(rec.frozen_reference_fair_value).toBe(120)
    expect(rec.requires_human_signoff).toBe(true)
    // The ALWAYS-attached worst case survives, basis + reliability included.
    expect(rec.worst_case?.downside_floor_per_share).toBe(30)
    expect(rec.worst_case?.downside_floor_basis).toBe('net_cash')
    expect(rec.worst_case?.downside_floor_reliability).toBe('high')
    expect(rec.worst_case?.realistic_downside).toBe(12)
    // The bias caveats survive (advisory).
    expect(rec.bias_caveats?.[0]?.kind).toBe('disposition')
    expect(rec.bias_caveats?.[0]?.message).toContain('loss')
    expect(rec.recorded_at).toBe('2026-06-02T00:00:00.000Z')
  })

  it('projects a hold decision (the guard held — fixable problem inside the window)', () => {
    const cases = projectResearchCases([
      created(),
      holdingOpened(),
      sell(
        {
          decision_status: 'hold',
          reason_code: 'minimum_hold_active',
          trigger: 'thesis_broke',
          impairment_call: 'fixable_temporary',
          minimum_hold_decision: 'hold_blocks_sell',
          worst_case: { downside_floor_per_share: 30, downside_floor_basis: 'net_cash' },
          bias_caveats: [],
          requires_human_signoff: false,
        },
        '2026-06-02T00:00:00.000Z',
        `evt_sell_1_${RC}`,
      ),
    ])
    const rec = cases.find((c) => c.research_case_id === RC)!.sell_recommendation!
    expect(rec.decision_status).toBe('hold')
    expect(rec.minimum_hold_decision).toBe('hold_blocks_sell')
    expect(rec.impairment_call).toBe('fixable_temporary')
  })

  it('projects an escalate_review decision (the unresolved / incoherent path)', () => {
    const cases = projectResearchCases([
      created(),
      holdingOpened(),
      sell(
        {
          decision_status: 'escalate_review',
          reason_code: 'escalate_human_review',
          trigger: 'thesis_broke',
          impairment_call: 'unresolved',
          minimum_hold_decision: 'escalate_human_review',
          worst_case: {},
          bias_caveats: [],
          requires_human_signoff: true,
        },
        '2026-06-02T00:00:00.000Z',
        `evt_sell_1_${RC}`,
      ),
    ])
    const rec = cases.find((c) => c.research_case_id === RC)!.sell_recommendation!
    expect(rec.decision_status).toBe('escalate_review')
    expect(rec.impairment_call).toBe('unresolved')
    expect(rec.requires_human_signoff).toBe(true)
  })

  it('does NOT transition the case stage — it is an observation, never closes the holding', () => {
    const cases = projectResearchCases([
      created(),
      holdingOpened(),
      sell(sellReviewPayload(), '2026-06-02T00:00:00.000Z', `evt_sell_1_${RC}`),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    // It stays HELD — the close is a separate human-authored transition.
    expect(rc.stage).toBe('holding')
  })

  it('newest recorded recommendation wins (recomputed fresh on-demand)', () => {
    const cases = projectResearchCases([
      created(),
      holdingOpened(),
      sell(sellReviewPayload(), '2026-06-02T00:00:00.000Z', `evt_sell_1_${RC}`),
      // A later recompute flips to hold (the guard now holds) — the newer one must win.
      sell(
        {
          decision_status: 'hold',
          reason_code: 'minimum_hold_active',
          trigger: 'thesis_broke',
          impairment_call: 'fixable_temporary',
          minimum_hold_decision: 'hold_blocks_sell',
          worst_case: { downside_floor_per_share: 30 },
          bias_caveats: [],
          requires_human_signoff: false,
        },
        '2026-06-09T00:00:00.000Z',
        `evt_sell_2_${RC}`,
      ),
    ])
    const rec = cases.find((c) => c.research_case_id === RC)!.sell_recommendation!
    expect(rec.decision_status).toBe('hold')
    expect(rec.recorded_at).toBe('2026-06-09T00:00:00.000Z')
  })

  it('resolves the case via correlation_id even when research_case_id is absent from the payload', () => {
    const event = sell(sellReviewPayload(), '2026-06-02T00:00:00.000Z', `evt_sell_1_${RC}`)
    delete (event.payload as Record<string, unknown>).research_case_id
    const cases = projectResearchCases([created(), holdingOpened(), event])
    const rec = cases.find((c) => c.research_case_id === RC)?.sell_recommendation
    expect(rec?.decision_status).toBe('sell_review')
  })
})
