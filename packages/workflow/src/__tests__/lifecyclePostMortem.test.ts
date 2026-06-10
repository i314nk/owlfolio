import { describe, expect, it } from 'vitest'

import {
  buildPositionPostMortemEvent,
  buildForecastRecordedEvent,
  buildForecastResolvedEvent,
} from '../lifecyclePostMortem.js'

describe('buildPositionPostMortemEvent', () => {
  it('builds a worker-authored observation event carrying the computed dimensions', () => {
    const event = buildPositionPostMortemEvent({
      research_case_id: 'rc_1',
      holding_id: 'h_1',
      ticker: 'AAA',
      predicted: { fair_value_per_share: 100, buy_price_per_share: 70, margin_of_safety: 0.3, credited_g: 0.04, moat_class: 'wide' },
      realized: {
        entry_cost_basis_per_share: 68,
        exit_price_per_share: 95,
        lowest_price_per_share: 66,
        opened_at: '2023-01-01',
        closed_at: '2026-01-01',
        realized_gain_loss: 2700,
        dividends_received: 300,
      },
      created_at: '2026-01-02T00:00:00.000Z',
    })
    expect(event.event_type).toBe('position_post_mortem_recorded')
    expect(event.aggregate_type).toBe('holding')
    expect(event.aggregate_id).toBe('h_1')
    expect(event.actor_type).toBe('worker')
    const payload = event.payload as Record<string, unknown>
    expect(payload.holding_id).toBe('h_1')
    expect(payload.is_observation).toBe(true)
    expect((payload.mos_protection as Record<string, unknown>).held).toBe(true)
    expect(payload.total_realized_pl).toBe(3000)
  })
})

describe('buildForecastRecordedEvent', () => {
  it('stores a falsifiable forecast against the research case', () => {
    const event = buildForecastRecordedEvent({
      forecast_id: 'fc_1',
      research_case_id: 'rc_1',
      ticker: 'AAA',
      lane: 'MOAT',
      claim: 'ROIC > 15% in FY2027 and FY2028',
      p: 0.8,
      resolves_on: 'FY2028 annual report',
      actor_type: 'provider',
      created_at: '2026-01-01T00:00:00.000Z',
    })
    expect(event.event_type).toBe('forecast_recorded')
    expect(event.aggregate_type).toBe('research_case')
    expect(event.aggregate_id).toBe('rc_1')
    const payload = event.payload as Record<string, unknown>
    expect(payload.p).toBe(0.8)
    expect(payload.lane).toBe('MOAT')
  })
})

describe('buildForecastResolvedEvent', () => {
  it('records the outcome + the Brier score', () => {
    const event = buildForecastResolvedEvent({
      resolution_id: 'res_1',
      forecast_id: 'fc_1',
      research_case_id: 'rc_1',
      ticker: 'AAA',
      lane: 'MOAT',
      p: 0.8,
      outcome: true,
      resolved_on: '2028-02-01',
      actor_type: 'worker',
      created_at: '2028-02-02T00:00:00.000Z',
    })
    expect(event.event_type).toBe('forecast_resolved')
    const payload = event.payload as Record<string, unknown>
    // Brier = (0.8 - 1)^2 = 0.04
    expect(payload.brier_score).toBeCloseTo(0.04, 6)
    expect(payload.outcome).toBe(true)
  })
})
