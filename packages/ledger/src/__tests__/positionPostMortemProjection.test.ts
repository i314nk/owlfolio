import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectPositionPostMortems } from '../projections/positionPostMortemProjection'

function recorded(id: string, holdingId: string, createdAt: string, overrides: Record<string, unknown> = {}): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_${id}`,
    event_type: 'position_post_mortem_recorded',
    aggregate_type: 'holding',
    aggregate_id: holdingId,
    actor_type: 'worker',
    actor_id: 'worker_local',
    payload: {
      post_mortem_id: id,
      holding_id: holdingId,
      research_case_id: 'rc_1',
      ticker: 'AAA',
      moat_class: 'wide',
      holding_period_days: 1096,
      total_realized_pl: 3000,
      mos_protection: { entry_discount_to_fv: 0.32, required_mos: 0.3, held: true },
      credited_g_vs_actual: { computable: true, predicted_g: 0.04, actual_g: 0.032 },
      most_wrong_lane: { basis: 'forecast_resolutions', lane: 'MOAT', brier: 0.72 },
      is_observation: true,
      ...overrides,
    },
    source_ids: [],
    created_at: createdAt,
    schema_version: 1,
  }
}

describe('projectPositionPostMortems', () => {
  it('projects a recorded post-mortem with predicted-vs-realized dimensions', () => {
    const result = projectPositionPostMortems([recorded('pm_1', 'h_1', '2026-01-01T00:00:00.000Z')])
    expect(result).toHaveLength(1)
    const pm = result[0]
    if (pm === undefined) throw new Error('no post-mortem')
    expect(pm.holding_id).toBe('h_1')
    expect(pm.research_case_id).toBe('rc_1')
    expect(pm.mos_protection.held).toBe(true)
    expect(pm.credited_g_vs_actual.computable).toBe(true)
    expect(pm.most_wrong_lane.lane).toBe('MOAT')
    expect(pm.holding_period_days).toBe(1096)
    expect(pm.total_realized_pl).toBe(3000)
  })

  it('keeps the latest post-mortem per holding (re-recorded supersedes)', () => {
    const result = projectPositionPostMortems([
      recorded('pm_old', 'h_1', '2026-01-01T00:00:00.000Z', { total_realized_pl: 100 }),
      recorded('pm_new', 'h_1', '2026-02-01T00:00:00.000Z', { total_realized_pl: 200 }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]?.total_realized_pl).toBe(200)
    expect(result[0]?.post_mortem_id).toBe('pm_new')
  })

  it('returns empty when no post-mortems exist', () => {
    expect(projectPositionPostMortems([])).toEqual([])
  })
})
