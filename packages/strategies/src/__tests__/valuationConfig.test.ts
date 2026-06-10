import { describe, expect, it } from 'vitest'
import { VALUATION_PARAMS, type ValuationParams } from '../valuationParams'
import {
  buildValuationConfigEvent,
  diffValuationParams,
  VALUATION_CONFIG_EVENT_TYPE,
} from '../valuationConfigEvent'
import { buffettMungerStrategy } from '../buffettMunger'

// ---------------------------------------------------------------------------
// VALUATION_PARAMS — the single source of truth (recalibrated defaults, spec §1).
// ---------------------------------------------------------------------------
describe('VALUATION_PARAMS (versioned config — single source of truth)', () => {
  it('carries a version field', () => {
    expect(typeof VALUATION_PARAMS.version).toBe('string')
    expect(VALUATION_PARAMS.version.length).toBeGreaterThan(0)
  })

  it('recalibrated defaults match spec §1', () => {
    expect(VALUATION_PARAMS.discount_rate).toBe(0.10) // constitutional, untouched
    expect(VALUATION_PARAMS.terminal_growth_by_moat).toEqual({ monopoly: 0.025, wide: 0.015 })
    expect(VALUATION_PARAMS.stage1_horizon_by_moat).toEqual({ monopoly: 15, wide: 10 })
    expect(VALUATION_PARAMS.margin_of_safety_by_moat).toEqual({ monopoly: 0.15, wide: 0.25 })
    expect(VALUATION_PARAMS.fv_cap_multiple).toBe(18)
    expect(VALUATION_PARAMS.growth_eligibility_incremental_roic).toBe(0.10)
    expect(VALUATION_PARAMS.max_growth).toBe(0.05)
    expect(VALUATION_PARAMS.oe_normalization_default).toBe('mid_cycle')
  })

  it('the strategy contract sources its valuation constants from VALUATION_PARAMS', () => {
    const v = buffettMungerStrategy.valuation
    expect(v.discount_rate).toBe(VALUATION_PARAMS.discount_rate)
    expect(v.margin_of_safety_by_moat).toEqual(VALUATION_PARAMS.margin_of_safety_by_moat)
    expect(v.terminal_growth_by_moat).toEqual(VALUATION_PARAMS.terminal_growth_by_moat)
    expect(v.stage1_horizon_by_moat).toEqual(VALUATION_PARAMS.stage1_horizon_by_moat)
    expect(v.valuation_multiple_ceiling).toBe(VALUATION_PARAMS.fv_cap_multiple)
    expect(v.growth_band_ceilings).toEqual(VALUATION_PARAMS.growth_band_ceilings)
    expect(v.growth_eligibility_incremental_roic).toBe(VALUATION_PARAMS.growth_eligibility_incremental_roic)
    expect(v.max_growth).toBe(VALUATION_PARAMS.max_growth)
  })
})

// ---------------------------------------------------------------------------
// diffValuationParams — only the changed parameters appear; version excluded.
// ---------------------------------------------------------------------------
describe('diffValuationParams', () => {
  it('returns empty for identical configs', () => {
    expect(diffValuationParams(VALUATION_PARAMS, VALUATION_PARAMS)).toEqual([])
  })

  it('reports only changed leaf parameters (and excludes version)', () => {
    const next: ValuationParams = {
      ...VALUATION_PARAMS,
      version: 'next-version',
      margin_of_safety_by_moat: { ...VALUATION_PARAMS.margin_of_safety_by_moat, monopoly: 0.20 },
    }
    const changes = diffValuationParams(VALUATION_PARAMS, next)
    expect(changes).toEqual([
      { path: 'margin_of_safety_by_moat.monopoly', previous: 0.15, next: 0.20 },
    ])
  })
})

// ---------------------------------------------------------------------------
// Acceptance test #5 (spec §4): a config change writes a `valuation_config` ledger event.
// ---------------------------------------------------------------------------
describe('Acceptance #5 — config change writes a valuation_config ledger event', () => {
  it('constructs a valuation_config event from a config diff', () => {
    const previous = VALUATION_PARAMS
    const next: ValuationParams = {
      ...previous,
      version: 'valuation-test-tightened-1',
      margin_of_safety_by_moat: { monopoly: 0.20, wide: 0.30 },
    }

    const event = buildValuationConfigEvent({
      event_id: 'evt_valuation_config_test_1',
      strategy_id: buffettMungerStrategy.id,
      previous,
      next,
      actor_id: 'user_admin',
    })

    expect(event.event_type).toBe(VALUATION_CONFIG_EVENT_TYPE)
    expect(event.event_type).toBe('valuation_config')
    expect(event.aggregate_type).toBe('strategy')
    expect(event.aggregate_id).toBe('buffett-munger')
    expect(event.actor_type).toBe('user')
    expect(event.payload.previous_version).toBe(previous.version)
    expect(event.payload.new_version).toBe('valuation-test-tightened-1')
    expect(event.payload.changes).toEqual([
      { path: 'margin_of_safety_by_moat.monopoly', previous: 0.15, next: 0.20 },
      { path: 'margin_of_safety_by_moat.wide', previous: 0.25, next: 0.30 },
    ])
    expect(event.schema_version).toBe(1)
  })
})
