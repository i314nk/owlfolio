import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'

// ---------------------------------------------------------------------------
// Task #88 (owner, 2026-07-18): the Arabic prose rendering recorded on decision_drafted
// (`prose_ar`) projects through to the case — additive and legacy-tolerant. A partial/malformed
// rendering is DROPPED whole (never a half-Arabic dossier); the English fields always project.
// ---------------------------------------------------------------------------

const RC = 'rc_arabic_prose_proj'

const PROSE_AR = {
  decision_reason: 'سبب القرار',
  thesis_summary: 'الأطروحة',
  evidence_summary: 'الأدلة',
  valuation_rationale: 'التقييم',
  shariah_rationale: 'المسوِّغ الشرعي',
  synthesis_summary: 'الخلاصة',
}

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

function decisionDrafted(payloadExtras: Record<string, unknown>): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_decision_${RC}`,
    event_type: 'decision_drafted',
    aggregate_type: 'decision',
    aggregate_id: `decision_${RC}`,
    correlation_id: RC,
    actor_type: 'system',
    payload: {
      research_case_id: RC,
      decision_id: `decision_${RC}`,
      decision: 'WATCH',
      user_approved: false,
      reason: 'Needs margin of safety.',
      thesis_summary: 'Quality compounder.',
      ...payloadExtras,
    },
    source_ids: [],
    created_at: '2026-06-01T02:00:00.000Z',
    schema_version: 1,
  }
}

describe('prose_ar projection (the Arabic dossier rendering)', () => {
  it('projects a complete prose_ar through to the case; English fields stay untouched', () => {
    const cases = projectResearchCases([created(), decisionDrafted({ prose_ar: PROSE_AR })])
    const c = cases.find((x) => x.research_case_id === RC)
    expect(c?.prose_ar).toEqual(PROSE_AR)
    expect(c?.reason).toBe('Needs margin of safety.')
    expect(c?.thesis_summary).toBe('Quality compounder.')
  })

  it('legacy decision without prose_ar projects with the field absent', () => {
    const cases = projectResearchCases([created(), decisionDrafted({})])
    expect(cases.find((x) => x.research_case_id === RC)?.prose_ar).toBeUndefined()
  })

  it('a PARTIAL rendering is dropped whole — never a half-Arabic dossier', () => {
    const cases = projectResearchCases([
      created(),
      decisionDrafted({ prose_ar: { ...PROSE_AR, synthesis_summary: '' } }),
    ])
    expect(cases.find((x) => x.research_case_id === RC)?.prose_ar).toBeUndefined()
  })
})
