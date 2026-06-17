import { describe, it, expect } from 'vitest'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import {
  findAbandonedResearchRuns,
  resolveRunWatchdogStalenessMs,
  RUN_WATCHDOG_STALENESS_MS,
} from '../researchRunWatchdog'

function event(
  partial: Partial<LedgerEventEnvelope<Record<string, unknown>>> &
    Pick<LedgerEventEnvelope<Record<string, unknown>>, 'event_type' | 'aggregate_id' | 'created_at'>,
): LedgerEventEnvelope<Record<string, unknown>> {
  return {
    event_id: `evt_${partial.event_type}_${partial.aggregate_id}_${partial.created_at}`,
    aggregate_type: 'research_case',
    actor_type: 'worker',
    actor_id: 'owlfolio-worker',
    payload: {},
    source_ids: [],
    schema_version: 1,
    ...partial,
  }
}

/** A case at deep_dive_started (an in-flight, non-terminal stage) whose latest event is at `lastAt`. */
function inFlightCase(id: string, ticker: string, lastAt: string): LedgerEventEnvelope<Record<string, unknown>>[] {
  return [
    event({
      event_type: 'research_case_created',
      aggregate_id: id,
      created_at: '2026-06-08T00:00:00.000Z',
      payload: { research_case_id: id, ticker, company_id: `company_${ticker.toLowerCase()}`, strategy_id: 'buffett-munger' },
    }),
    event({
      event_type: 'deep_dive_started',
      aggregate_id: id,
      created_at: lastAt,
      payload: { research_case_id: id, deep_dive_id: `dd_${id}` },
    }),
  ]
}

const STALENESS_MS = 25 * 60_000
const NOW = new Date('2026-06-08T02:00:00.000Z')

describe('findAbandonedResearchRuns', () => {
  it('flags a non-terminal case whose latest event is stale (worker died mid-run)', () => {
    // deep_dive_started at 01:00, now 02:00 → 60 min stale >> 25 min threshold.
    const events = inFlightCase('rc_stale', 'STALE', '2026-06-08T01:00:00.000Z')
    const result = findAbandonedResearchRuns({ events, now: NOW, stalenessMs: STALENESS_MS })
    expect(result.map((r) => r.research_case_id)).toEqual(['rc_stale'])
    expect(result[0]?.ticker).toBe('STALE')
    expect(result[0]?.last_event_at).toBe('2026-06-08T01:00:00.000Z')
    expect(result[0]?.stalled_for_ms).toBe(60 * 60_000)
  })

  it('does NOT flag the same non-terminal case when its latest event is recent (slow-but-progressing is safe)', () => {
    // deep_dive_started at 01:50, now 02:00 → only 10 min, inside the 25 min window.
    const events = inFlightCase('rc_fresh', 'FRESH', '2026-06-08T01:50:00.000Z')
    const result = findAbandonedResearchRuns({ events, now: NOW, stalenessMs: STALENESS_MS })
    expect(result).toEqual([])
  })

  it('does NOT flag a terminal (decision_drafted) case even when stale', () => {
    const events = [
      ...inFlightCase('rc_done', 'DONE', '2026-06-08T00:30:00.000Z'),
      event({
        event_type: 'decision_drafted',
        aggregate_id: 'rc_done',
        created_at: '2026-06-08T00:40:00.000Z',
        payload: { research_case_id: 'rc_done', decision_id: 'd_done', decision: 'WATCH' },
      }),
    ]
    const result = findAbandonedResearchRuns({ events, now: NOW, stalenessMs: STALENESS_MS })
    expect(result).toEqual([])
  })

  it('does NOT flag a superseded stale case', () => {
    const events = [
      ...inFlightCase('rc_old', 'OLD', '2026-06-08T00:10:00.000Z'),
      // A newer version supersedes rc_old.
      event({
        event_type: 'research_case_created',
        aggregate_id: 'rc_new',
        created_at: '2026-06-08T01:55:00.000Z',
        payload: { research_case_id: 'rc_new', ticker: 'OLD', supersedes_research_case_id: 'rc_old' },
      }),
    ]
    const result = findAbandonedResearchRuns({ events, now: NOW, stalenessMs: STALENESS_MS })
    expect(result.map((r) => r.research_case_id)).not.toContain('rc_old')
  })

  it('does NOT flag a case that already carries a research_run_failed event (no double-report)', () => {
    const events = [
      ...inFlightCase('rc_failed', 'FAILED', '2026-06-08T00:30:00.000Z'),
      event({
        event_type: 'research_run_failed',
        aggregate_id: 'rc_failed',
        created_at: '2026-06-08T00:35:00.000Z',
        payload: { research_case_id: 'rc_failed', run_id: 'run_rc_failed', error_summary: 'already failed' },
      }),
    ]
    const result = findAbandonedResearchRuns({ events, now: NOW, stalenessMs: STALENESS_MS })
    expect(result).toEqual([])
  })
})

describe('resolveRunWatchdogStalenessMs', () => {
  it('defaults to 25 min (1_500_000 ms) when unset/empty', () => {
    expect(RUN_WATCHDOG_STALENESS_MS).toBe(1_500_000)
    expect(resolveRunWatchdogStalenessMs(undefined)).toBe(1_500_000)
    expect(resolveRunWatchdogStalenessMs('')).toBe(1_500_000)
  })

  it('honors a valid positive override', () => {
    expect(resolveRunWatchdogStalenessMs('600000')).toBe(600_000)
    expect(resolveRunWatchdogStalenessMs('3600000')).toBe(3_600_000)
  })

  it('falls back to the default on invalid/zero/negative override', () => {
    expect(resolveRunWatchdogStalenessMs('0')).toBe(1_500_000)
    expect(resolveRunWatchdogStalenessMs('-5')).toBe(1_500_000)
    expect(resolveRunWatchdogStalenessMs('not-a-number')).toBe(1_500_000)
  })
})
