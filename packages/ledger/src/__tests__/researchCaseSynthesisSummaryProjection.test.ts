import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'

// ---------------------------------------------------------------------------
// H (owner feedback, 2026-07-12): the synthesis agent's own reconciliation narrative
// (`synthesis_summary` on `deep_dive_synthesis_drafted`) was projected NOWHERE — the dossier's
// "Synthesis & decision" section had no actual synthesis card. Project it (additive, optional);
// legacy events without the key still project (field absent, no default).
// ---------------------------------------------------------------------------

const RC = 'rc_synth_summary_proj'

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

function synthesisDrafted(payloadExtras: Record<string, unknown>): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_synth_${RC}`,
    event_type: 'deep_dive_synthesis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: RC,
    correlation_id: RC,
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      research_case_id: RC,
      synthesis_id: 'synth_1',
      confidence: 'medium',
      caveats: ['Renewal-rate durability is the open question.'],
      ...payloadExtras,
    },
    source_ids: [],
    created_at: '2026-06-01T01:00:00.000Z',
    schema_version: 1,
  }
}

describe('synthesis_summary projection (the reconciliation narrative)', () => {
  it('projects synthesis_summary from deep_dive_synthesis_drafted alongside confidence + caveats', () => {
    const cases = projectResearchCases([
      created(),
      synthesisDrafted({ synthesis_summary: 'The four pillars agree on quality; price is the only dissent.' }),
    ])
    const c = cases.find((x) => x.research_case_id === RC)
    expect(c?.synthesis_summary).toBe('The four pillars agree on quality; price is the only dissent.')
    expect(c?.confidence).toBe('medium')
    expect(c?.caveats).toEqual(['Renewal-rate durability is the open question.'])
  })

  it('legacy event without the key projects with the field absent (no default)', () => {
    const cases = projectResearchCases([created(), synthesisDrafted({})])
    const c = cases.find((x) => x.research_case_id === RC)
    expect(c?.synthesis_summary).toBeUndefined()
    expect(c?.confidence).toBe('medium')
  })
})
