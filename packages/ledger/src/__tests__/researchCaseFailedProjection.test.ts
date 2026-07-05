import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'

// ---------------------------------------------------------------------------
// Mid-run failure honesty (the ADBE "in progress forever" bug): `research_run_failed` is a research-case
// lifecycle event, but the projection ignored it entirely — a case whose run died between
// `research_case_created` and the dossier kept its last in-flight stage, so every consumer (research
// library, case page) showed "in progress" forever. The projection now moves a NON-terminal case to
// stage 'failed'; a case that already reached a terminal stage is untouched (never hide a completed
// dossier behind a failed marker — e.g. a watchdog reaping a stale run record late).
// ---------------------------------------------------------------------------

function created(researchCaseId: string, ticker: string, createdAt: string): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_created_${researchCaseId}`,
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: researchCaseId,
    correlation_id: researchCaseId,
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { research_case_id: researchCaseId, ticker, company_id: `company_${ticker.toLowerCase()}` },
    source_ids: [],
    created_at: createdAt,
    schema_version: 1,
  }
}

function deepDiveStarted(researchCaseId: string, createdAt: string): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_dd_started_${researchCaseId}`,
    event_type: 'deep_dive_started',
    aggregate_type: 'research_case',
    aggregate_id: researchCaseId,
    correlation_id: researchCaseId,
    actor_type: 'worker',
    actor_id: 'owlfolio-worker',
    payload: { research_case_id: researchCaseId, deep_dive_id: `deep_${researchCaseId}` },
    source_ids: [],
    created_at: createdAt,
    schema_version: 1,
  }
}

function decisionDrafted(researchCaseId: string, createdAt: string): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_decision_${researchCaseId}`,
    event_type: 'decision_drafted',
    aggregate_type: 'research_case',
    aggregate_id: researchCaseId,
    correlation_id: researchCaseId,
    actor_type: 'worker',
    actor_id: 'owlfolio-worker',
    payload: { research_case_id: researchCaseId, decision_id: `dec_${researchCaseId}`, decision: 'watch', user_approved: false, reason: 'r' },
    source_ids: [],
    created_at: createdAt,
    schema_version: 1,
  }
}

function runFailed(researchCaseId: string, createdAt: string, errorSummary: string): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_run_failed_${researchCaseId}`,
    event_type: 'research_run_failed',
    aggregate_type: 'research_case',
    aggregate_id: researchCaseId,
    correlation_id: researchCaseId,
    actor_type: 'worker',
    actor_id: 'owlfolio-worker',
    payload: { research_case_id: researchCaseId, run_id: `run_${researchCaseId}`, failed_at: createdAt, error_summary: errorSummary },
    source_ids: [],
    created_at: createdAt,
    schema_version: 1,
  }
}

describe('research_run_failed projection (mid-run failure honesty)', () => {
  it('moves a non-terminal case to stage failed and carries the error summary', () => {
    const cases = projectResearchCases([
      created('rc_fail_101', 'ADBE', '2026-07-03T18:19:43.153Z'),
      deepDiveStarted('rc_fail_101', '2026-07-03T18:25:21.646Z'),
      runFailed('rc_fail_101', '2026-07-03T18:28:38.525Z', 'synthesis stage failed after retry'),
    ])
    const projected = cases.find((c) => c.research_case_id === 'rc_fail_101')
    expect(projected?.stage).toBe('failed')
    expect(projected?.run_failed_error_summary).toBe('synthesis stage failed after retry')
  })

  it('leaves a terminal case untouched by a late failure event (never hide a completed dossier)', () => {
    const cases = projectResearchCases([
      created('rc_fail_102', 'ADBE', '2026-07-03T18:19:43.153Z'),
      decisionDrafted('rc_fail_102', '2026-07-03T18:28:00.000Z'),
      runFailed('rc_fail_102', '2026-07-03T18:29:00.000Z', 'stale run reaped'),
    ])
    const projected = cases.find((c) => c.research_case_id === 'rc_fail_102')
    expect(projected?.stage).toBe('decision_drafted')
    expect(projected?.run_failed_error_summary).toBeUndefined()
  })

  it('ignores a failure event with no matching case (worker-never-started path stays view-resolved)', () => {
    const cases = projectResearchCases([
      runFailed('rc_fail_103', '2026-07-03T18:29:00.000Z', 'spawn failed'),
    ])
    expect(cases.find((c) => c.research_case_id === 'rc_fail_103')).toBeUndefined()
  })
})
