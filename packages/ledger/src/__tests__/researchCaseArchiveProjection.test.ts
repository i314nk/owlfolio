import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import {
  findLatestResearchCaseForTicker,
  projectResearchCases,
} from '../projections/researchCaseProjection'

// ---------------------------------------------------------------------------
// Append-only ARCHIVE (option-b: hide-without-mutate). A `research_case_archived` event marks a case
// `archived: true`. The case is STILL PROJECTED (never dropped) — only the active views/latest-resolution
// filter it. Legacy-tolerant: no archive event → archived === false. Replay-safe alongside legacy events.
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

function analysisDrafted(researchCaseId: string, ticker: string, createdAt: string): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_analysis_${researchCaseId}`,
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: researchCaseId,
    correlation_id: researchCaseId,
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      research_case_id: researchCaseId,
      ticker,
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'COMPLIANT',
      valuation_status: 'FAIR',
    },
    source_ids: [],
    created_at: createdAt,
    schema_version: 1,
  }
}

function archived(researchCaseId: string, createdAt: string): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_research_case_archived_${researchCaseId}`,
    event_type: 'research_case_archived',
    aggregate_type: 'research_case',
    aggregate_id: researchCaseId,
    correlation_id: researchCaseId,
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { research_case_id: researchCaseId, archived_at: createdAt, reason: 'stale run' },
    source_ids: [],
    created_at: createdAt,
    schema_version: 1,
    idempotency_key: `research-archived:${researchCaseId}:v1`,
  }
}

describe('research case archive projection (option-b append-only archive)', () => {
  it('sets archived: true when a research_case_archived event exists for the case', () => {
    const events = [
      created('rc_arch', 'ARC', '2026-06-01T00:00:00.000Z'),
      analysisDrafted('rc_arch', 'ARC', '2026-06-02T00:00:00.000Z'),
      archived('rc_arch', '2026-06-03T00:00:00.000Z'),
    ]
    const cases = projectResearchCases(events)
    const archivedCase = cases.find((c) => c.research_case_id === 'rc_arch')
    expect(archivedCase?.archived).toBe(true)
  })

  it('defaults archived: false when no archive event is present (legacy-tolerant)', () => {
    const events = [
      created('rc_live', 'LIV', '2026-06-01T00:00:00.000Z'),
      analysisDrafted('rc_live', 'LIV', '2026-06-02T00:00:00.000Z'),
    ]
    const cases = projectResearchCases(events)
    const liveCase = cases.find((c) => c.research_case_id === 'rc_live')
    expect(liveCase?.archived).toBe(false)
  })

  it('STILL returns the archived case from projectResearchCases (hide-without-mutate, never dropped)', () => {
    const events = [
      created('rc_arch', 'ARC', '2026-06-01T00:00:00.000Z'),
      archived('rc_arch', '2026-06-03T00:00:00.000Z'),
    ]
    const cases = projectResearchCases(events)
    expect(cases.map((c) => c.research_case_id)).toContain('rc_arch')
  })

  it('does NOT advance the stage — the archive only marks archived, preserving the prior stage', () => {
    const events = [
      created('rc_arch', 'ARC', '2026-06-01T00:00:00.000Z'),
      analysisDrafted('rc_arch', 'ARC', '2026-06-02T00:00:00.000Z'),
      archived('rc_arch', '2026-06-03T00:00:00.000Z'),
    ]
    const archivedCase = projectResearchCases(events).find((c) => c.research_case_id === 'rc_arch')
    expect(archivedCase?.stage).toBe('analysis_drafted')
    expect(archivedCase?.archived).toBe(true)
  })

  it('findLatestResearchCaseForTicker SKIPS an archived run (a hidden stale run is not surfaced as current)', () => {
    const events = [
      created('rc_arch', 'ARC', '2026-06-01T00:00:00.000Z'),
      analysisDrafted('rc_arch', 'ARC', '2026-06-02T00:00:00.000Z'),
      archived('rc_arch', '2026-06-03T00:00:00.000Z'),
    ]
    expect(findLatestResearchCaseForTicker(events, 'ARC')).toBeUndefined()
  })

  it('findLatestResearchCaseForTicker still returns a non-archived run for the same ticker', () => {
    const events = [
      created('rc_old', 'ARC', '2026-06-01T00:00:00.000Z'),
      archived('rc_old', '2026-06-02T00:00:00.000Z'),
      created('rc_new', 'ARC', '2026-06-03T00:00:00.000Z'),
      analysisDrafted('rc_new', 'ARC', '2026-06-04T00:00:00.000Z'),
    ]
    const latest = findLatestResearchCaseForTicker(events, 'ARC')
    expect(latest?.research_case_id).toBe('rc_new')
    expect(latest?.archived).toBe(false)
  })

  it('replays cleanly with a mix of archived + legacy (no-archive) cases', () => {
    const events = [
      created('rc_legacy', 'LEG', '2026-06-01T00:00:00.000Z'),
      analysisDrafted('rc_legacy', 'LEG', '2026-06-02T00:00:00.000Z'),
      created('rc_arch', 'ARC', '2026-06-01T00:00:00.000Z'),
      archived('rc_arch', '2026-06-03T00:00:00.000Z'),
    ]
    const cases = projectResearchCases(events)
    expect(cases.find((c) => c.research_case_id === 'rc_legacy')?.archived).toBe(false)
    expect(cases.find((c) => c.research_case_id === 'rc_arch')?.archived).toBe(true)
  })
})
