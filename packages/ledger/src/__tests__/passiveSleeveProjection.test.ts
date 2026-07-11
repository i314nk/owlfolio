import { describe, expect, it } from 'vitest'
import { projectPassiveSleeve } from '../projections/passiveSleeveProjection'
import type { LedgerEventEnvelope } from '../eventEnvelope'

// B7 (book alignment): the passive-sleeve fold — user-authored contributions only, chronological,
// consistency months counted, malformed rows skipped (never guessed). No withdrawal event exists.

function contribution(id: string, amount: number, at: string, extra: Record<string, unknown> = {}): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_${id}`,
    event_type: 'passive_contribution_recorded',
    aggregate_type: 'passive_sleeve',
    aggregate_id: 'passive_sleeve',
    correlation_id: 'passive_sleeve',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { contribution_id: id, amount, contributed_at: at, ...extra },
    source_ids: [],
    created_at: `${at}T12:00:00.000Z`,
    schema_version: 1,
    idempotency_key: `passive-contribution:${id}`,
  } as LedgerEventEnvelope<unknown>
}

describe('projectPassiveSleeve', () => {
  it('folds contributions chronologically with totals + distinct consistency months', () => {
    const p = projectPassiveSleeve([
      contribution('c2', 500, '2026-06-01', { instrument: 'S&P 500 index fund' }),
      contribution('c1', 500, '2026-05-01'),
      contribution('c3', 250, '2026-06-15', { note: 'topped up' }),
      { event_type: 'research_run_requested', payload: {} } as never, // unrelated events ignored
    ])
    expect(p.contributions.map((c) => c.contribution_id)).toEqual(['c1', 'c2', 'c3'])
    expect(p.total_contributed).toBe(1250)
    expect(p.months_contributed).toBe(2)
    expect(p.last_contribution_at).toBe('2026-06-15')
    expect(p.contributions[1]?.instrument).toBe('S&P 500 index fund')
  })

  it('skips malformed rows (no amount / bad date) rather than guessing', () => {
    const p = projectPassiveSleeve([
      contribution('good', 100, '2026-06-01'),
      contribution('bad-amount', -5, '2026-06-02'),
      contribution('bad-date', 100, 'not-a-date'),
    ])
    expect(p.contributions).toHaveLength(1)
    expect(p.total_contributed).toBe(100)
  })

  it('is empty-safe', () => {
    const p = projectPassiveSleeve([])
    expect(p.contributions).toEqual([])
    expect(p.total_contributed).toBe(0)
    expect(p.last_contribution_at).toBeUndefined()
  })
})
