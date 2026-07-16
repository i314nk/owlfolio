import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'

// ---------------------------------------------------------------------------
// Margin-of-safety audit surface: the synthesis decision's key_wrong_assumption (the SINGLE assumption
// that, if wrong, breaks the thesis) and thesis_break_triggers (observable invalidating events) are
// projected on the research case from the `buffett_munger_analysis_drafted` event. Legacy-tolerant: an
// old analysis event WITHOUT these fields still projects (fields undefined, no throw).
// ---------------------------------------------------------------------------

const RC = 'rc_mos_proj'

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

function analysisDrafted(extra: Record<string, unknown>): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_analysis_${RC}`,
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: RC,
    correlation_id: RC,
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      research_case_id: RC,
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'COMPLIANT',
      valuation_status: 'FAIR',
      ...extra,
    },
    source_ids: [],
    created_at: '2026-06-03T00:00:00.000Z',
    schema_version: 1,
  }
}

describe('projectResearchCases — margin-of-safety audit surface', () => {
  it('projects key_wrong_assumption + thesis_break_triggers when present', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({
        key_wrong_assumption: 'The assumed 6% durable growth holds — if pricing power erodes the thesis breaks.',
        thesis_break_triggers: [
          'Gross margin falls below 40% for two consecutive quarters.',
          'Membership renewal rate drops below 88%.',
        ],
      }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.key_wrong_assumption).toContain('6% durable growth')
    expect(rc.thesis_break_triggers).toEqual([
      'Gross margin falls below 40% for two consecutive quarters.',
      'Membership renewal rate drops below 88%.',
    ])
  })

  it('legacy-tolerant: an analysis event WITHOUT the fields still projects (undefined, no throw)', () => {
    const cases = projectResearchCases([created(), analysisDrafted({})])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.key_wrong_assumption).toBeUndefined()
    expect(rc.thesis_break_triggers).toBeUndefined()
    // The rest of the analysis projection is unaffected.
    expect(rc.investment_verdict).toBe('WATCH')
  })

  // D3: the joint MoS judgment is RETIRED — legacy events carrying the payload keys are tolerated by
  // ignore: replay never throws and neither key surfaces on the projection.
  it('D3: legacy margin_of_safety_judgment / moat_ungrounded payload keys are ignored (no throw, not projected)', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({
        margin_of_safety_judgment: {
          sources: ['price', 'moat'],
          price_gap_reasoning: 'Price ~25% below the proposed buy-below.',
          moat_durability_reasoning: 'Grounded wide moat lets time bail out estimate error.',
          adequacy: 'adequate',
          reasoning: 'Price gap and grounded moat jointly supply an adequate margin.',
        },
        margin_of_safety_moat_ungrounded: true,
      }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect('margin_of_safety_judgment' in rc).toBe(false)
    expect('margin_of_safety_moat_ungrounded' in rc).toBe(false)
    expect(rc.investment_verdict).toBe('WATCH')
  })

  // FAIL-CLOSED: the shariah deep re-screen lane grounded no verifiable source (skipped), so the deep
  // compliance re-verification did NOT run. The boolean projects onto the case; the shariah_status verdict
  // (COMPLIANT, from the quick-screen gate) is left untouched — the flag rides ALONGSIDE, never flips it.
  it('projects the shariah_deep_screen_incomplete flag when present, without flipping shariah_status', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({ shariah_deep_screen_incomplete: true }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.shariah_deep_screen_incomplete).toBe(true)
    expect(rc.shariah_status).toBe('COMPLIANT')
  })

  it('legacy-tolerant: an analysis event WITHOUT shariah_deep_screen_incomplete projects it as undefined', () => {
    const cases = projectResearchCases([created(), analysisDrafted({})])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect(rc.shariah_deep_screen_incomplete).toBeUndefined()
  })

  // LEGACY TOLERANCE: an OLD event carrying the retired legacy `margin_of_safety` STRING (from the haircut
  // era, on the owner-earnings valuation block) must still project WITHOUT throwing and WITHOUT being
  // mistaken for the new structured judgment.
  it('legacy-tolerant: an old event with the legacy margin_of_safety STRING still projects (no throw, no collision)', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({
        // Legacy haircut-era shapes — must be ignored gracefully, not crash replay.
        margin_of_safety: '25% applied to the fair value',
        margin_of_safety_applied: true,
        valuation: {
          summary: 'legacy',
          margin_of_safety: '25%',
        },
      }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    // The retired legacy string is NOT projected.
    expect('margin_of_safety_judgment' in rc).toBe(false)
    // Replay did not throw; the rest projects.
    expect(rc.investment_verdict).toBe('WATCH')
  })

  it('legacy-tolerant: a malformed margin_of_safety_judgment projects nothing, no throw', () => {
    const cases = projectResearchCases([
      created(),
      analysisDrafted({ margin_of_safety_judgment: { sources: [], adequacy: 'adequate', reasoning: 'x' } }),
    ])
    const rc = cases.find((c) => c.research_case_id === RC)!
    expect('margin_of_safety_judgment' in rc).toBe(false)
    expect(rc.investment_verdict).toBe('WATCH')
  })
})
