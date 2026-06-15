import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'

// ---------------------------------------------------------------------------
// Phase 5 S7 — projecting the sizing recommendation OBSERVATION onto the research case.
//
// `sizing_recommendation_recorded` is an agent OBSERVATION (the S6 assembler, recomputed fresh on-demand);
// the projection surfaces the NEWEST recorded recommendation as a read-only `sizing_recommendation` field
// and must NOT transition the case stage (it does not open a holding).
// ---------------------------------------------------------------------------

const RC = 'rc_sizing_proj'

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

function sizing(payload: Record<string, unknown>, createdAt: string, eventId: string): LedgerEventEnvelope<unknown> {
  return {
    event_id: eventId,
    event_type: 'sizing_recommendation_recorded',
    aggregate_type: 'research_case',
    aggregate_id: RC,
    correlation_id: RC,
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      sizing_recommendation_id: eventId,
      research_case_id: RC,
      ticker: 'TST',
      is_observation: true,
      is_recommendation: false,
      ...payload,
    },
    source_ids: ['src_a'],
    created_at: createdAt,
    schema_version: 1,
  }
}

const sizeablePayload = () => ({
  status: 'sizeable',
  conviction_factor: 0.85,
  target_weight: 0.085,
  sizeable_value: 8500,
  binding_constraint: 'permanent_loss',
  worst_case: {
    downside_floor_per_share: 30,
    downside_floor_basis: 'net_cash',
    realistic_downside_per_share: 12,
    aggregate_cluster_downside_fraction: 0.18,
  },
  ladder: [{ id: 'T1', fraction: 0.4, trigger_label: 'at_buy_price', trigger_price_per_share: 42, buy_price_version: 'v1' }],
  caveats: ['conviction scaled the target DOWN to 85% of base'],
})

describe('projectResearchCases — sizing_recommendation_recorded', () => {
  it('projects a SIZEABLE recommendation (worst_case + binding constraint + ladder survive)', () => {
    const cases = projectResearchCases([
      created(),
      sizing(sizeablePayload(), '2026-06-02T00:00:00.000Z', `evt_sizing_1_${RC}`),
    ])
    const rec = cases.find((c) => c.research_case_id === RC)!.sizing_recommendation!
    expect(rec.status).toBe('sizeable')
    expect(rec.conviction_factor).toBeCloseTo(0.85, 6)
    expect(rec.target_weight).toBeCloseTo(0.085, 6)
    expect(rec.sizeable_value).toBe(8500)
    expect(rec.binding_constraint).toBe('permanent_loss')
    // The worst case (the ALWAYS-attached block) survives, basis included.
    expect(rec.worst_case?.downside_floor_per_share).toBe(30)
    expect(rec.worst_case?.downside_floor_basis).toBe('net_cash')
    expect(rec.worst_case?.aggregate_cluster_downside_fraction).toBeCloseTo(0.18, 6)
    // The ladder + caveats survive.
    expect(rec.ladder?.[0]?.id).toBe('T1')
    expect(rec.ladder?.[0]?.buy_price_version).toBe('v1')
    expect(rec.caveats).toEqual(['conviction scaled the target DOWN to 85% of base'])
  })

  it('projects a hold_in_savings posture (reason + expected_savings_return survive; NOT a warning shape)', () => {
    const cases = projectResearchCases([
      created(),
      sizing(
        { status: 'hold_in_savings', reason: 'OE yield 3% < hurdle', expected_savings_return: 0.02 },
        '2026-06-02T00:00:00.000Z',
        `evt_sizing_1_${RC}`,
      ),
    ])
    const rec = cases.find((c) => c.research_case_id === RC)!.sizing_recommendation!
    expect(rec.status).toBe('hold_in_savings')
    expect(rec.reason).toContain('hurdle')
    expect(rec.expected_savings_return).toBeCloseTo(0.02, 6)
    // No size fields fabricated for a hold posture.
    expect(rec.sizeable_value).toBeUndefined()
  })

  it('projects a cannot_size result (fail-closed — reason only, no fabricated size)', () => {
    const cases = projectResearchCases([
      created(),
      sizing(
        { status: 'cannot_size', reason: 'downside floor unavailable (S2 cannot_floor)' },
        '2026-06-02T00:00:00.000Z',
        `evt_sizing_1_${RC}`,
      ),
    ])
    const rec = cases.find((c) => c.research_case_id === RC)!.sizing_recommendation!
    expect(rec.status).toBe('cannot_size')
    expect(rec.reason).toContain('cannot_floor')
    expect(rec.sizeable_value).toBeUndefined()
    expect(rec.worst_case).toBeUndefined()
  })

  it('does NOT transition the case stage — it is an observation, not a buy', () => {
    const cases = projectResearchCases([
      created(),
      sizing(sizeablePayload(), '2026-06-02T00:00:00.000Z', `evt_sizing_1_${RC}`),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.stage).not.toBe('holding')
    expect(rc.stage).not.toBe('watchlist')
  })

  it('newest recorded recommendation wins (recomputed fresh on-demand)', () => {
    const cases = projectResearchCases([
      created(),
      sizing(sizeablePayload(), '2026-06-02T00:00:00.000Z', `evt_sizing_1_${RC}`),
      // A later recompute against a richer price flips to hold_in_savings — the newer one must win.
      sizing(
        { status: 'hold_in_savings', reason: 'price ran up; OE yield below hurdle', expected_savings_return: 0.02 },
        '2026-06-09T00:00:00.000Z',
        `evt_sizing_2_${RC}`,
      ),
    ])
    const rec = cases.find((c) => c.research_case_id === RC)!.sizing_recommendation!
    expect(rec.status).toBe('hold_in_savings')
    expect(rec.sizeable_value).toBeUndefined()
  })
})
