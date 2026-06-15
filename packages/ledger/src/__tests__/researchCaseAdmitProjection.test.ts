import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'

// ---------------------------------------------------------------------------
// Task 4.2c — projecting the admit-judgment recommendation OBSERVATION onto the research case.
//
// `admit_judgment_recorded` is an agent OBSERVATION (the recommendation is recomputed fresh on-demand);
// the projection surfaces the NEWEST recorded recommendation as a read-only `admit_recommendation` field
// and must NOT transition the case stage (it does not admit anything).
// ---------------------------------------------------------------------------

const RC = 'rc_admit_proj'

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

function admitJudgment(overrides: Record<string, unknown>, createdAt: string, eventId: string): LedgerEventEnvelope<unknown> {
  return {
    event_id: eventId,
    event_type: 'admit_judgment_recorded',
    aggregate_type: 'research_case',
    aggregate_id: RC,
    correlation_id: RC,
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      admit_judgment_id: eventId,
      research_case_id: RC,
      ticker: 'TST',
      uncertainty: { level: 'high', argument: 'unknowable demand', citations: ['src_a'] },
      permanent_loss_risk: { level: 'low', argument: 'liquidation value floors it', citations: ['src_b'] },
      impairment_bear_case: 'from filings: discount reflects a smaller intrinsic value',
      impairment_call: 'fixable_temporary',
      admittable: true,
      reason: 'low permanent-loss + quality passes',
      buy_below: 42,
      cheapness: { owner_earnings_yield: 0.0825, ev: 10_300, cheap: true },
      is_observation: true,
      is_recommendation: false,
      ...overrides,
    },
    source_ids: ['src_a', 'src_b'],
    created_at: createdAt,
    schema_version: 1,
  }
}

describe('projectResearchCases — admit_judgment_recorded', () => {
  it('projects admit_recommendation onto the research case (grounded fields + bear case survive)', () => {
    const cases = projectResearchCases([
      created(),
      admitJudgment({}, '2026-06-02T00:00:00.000Z', `evt_admit_1_${RC}`),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.admit_recommendation).toBeDefined()
    const rec = rc.admit_recommendation!
    expect(rec.impairment_call).toBe('fixable_temporary')
    expect(rec.admittable).toBe(true)
    expect(rec.buy_below).toBe(42)
    // The two grounded risk fields survive the projection.
    expect(rec.uncertainty?.level).toBe('high')
    expect(rec.uncertainty?.citations).toEqual(['src_a'])
    expect(rec.permanent_loss_risk?.level).toBe('low')
    expect(rec.permanent_loss_risk?.citations).toEqual(['src_b'])
    // The independent bear case survives.
    expect(rec.impairment_bear_case).toContain('from filings')
    // The cheapness summary survives.
    expect(rec.cheapness?.owner_earnings_yield).toBeCloseTo(0.0825, 6)
    expect(rec.cheapness?.ev).toBe(10_300)
  })

  it('does NOT transition the case stage — it is an observation, not an admit', () => {
    const cases = projectResearchCases([
      created(),
      admitJudgment({}, '2026-06-02T00:00:00.000Z', `evt_admit_1_${RC}`),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    // The case stays where it was (discovered here) — recording the recommendation never moves it to watchlist.
    expect(rc.stage).not.toBe('watchlist')
    expect(rc.stage).not.toBe('holding')
  })

  it('newest recorded recommendation wins (recomputed fresh on-demand)', () => {
    const cases = projectResearchCases([
      created(),
      admitJudgment(
        { impairment_call: 'fixable_temporary', admittable: true, permanent_loss_risk: { level: 'low', argument: 'a', citations: ['src_b'] } },
        '2026-06-02T00:00:00.000Z',
        `evt_admit_1_${RC}`,
      ),
      // A later recompute flips to a permanent-impairment call — the newer one must win.
      admitJudgment(
        { impairment_call: 'permanent_impairment', admittable: false, permanent_loss_risk: { level: 'high', argument: 'displaced', citations: ['src_b'] } },
        '2026-06-09T00:00:00.000Z',
        `evt_admit_2_${RC}`,
      ),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.admit_recommendation?.impairment_call).toBe('permanent_impairment')
    expect(rc.admit_recommendation?.admittable).toBe(false)
    expect(rc.admit_recommendation?.permanent_loss_risk?.level).toBe('high')
  })
})
