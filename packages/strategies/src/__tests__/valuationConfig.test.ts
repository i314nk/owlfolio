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
    expect(VALUATION_PARAMS.discount_rate).toBe(0.10) // effective default = treasury default + equity premium
    expect(VALUATION_PARAMS.equity_premium).toBe(0.055) // Phase 1.4 — uniform, no quality knob
    expect(VALUATION_PARAMS.ten_year_treasury_default).toBe(0.045) // Phase 1.4 — fail-closed default
    expect(VALUATION_PARAMS.terminal_growth_by_moat).toEqual({ monopoly: 0.025, wide: 0.015 })
    expect(VALUATION_PARAMS.stage1_horizon_by_moat).toEqual({ monopoly: 15, wide: 10 })
    expect(VALUATION_PARAMS.margin_of_safety_by_moat).toEqual({ monopoly: 0.15, wide: 0.25 })
    expect(VALUATION_PARAMS.fv_cap_multiple).toBe(18)
    expect(VALUATION_PARAMS.single_growth_cap).toBe(0.10) // FROZEN at 1.9 (cap)
    expect(VALUATION_PARAMS.gdp_growth_threshold).toBe(0.03)
    expect(VALUATION_PARAMS.oe_normalization_default).toBe('mid_cycle')
  })

  it('the strategy contract sources its valuation constants from VALUATION_PARAMS', () => {
    const v = buffettMungerStrategy.valuation
    expect(v.discount_rate).toBe(VALUATION_PARAMS.discount_rate)
    expect(v.margin_of_safety_by_moat).toEqual(VALUATION_PARAMS.margin_of_safety_by_moat)
    expect(v.terminal_growth_by_moat).toEqual(VALUATION_PARAMS.terminal_growth_by_moat)
    expect(v.stage1_horizon_by_moat).toEqual(VALUATION_PARAMS.stage1_horizon_by_moat)
    expect(v.valuation_multiple_ceiling).toBe(VALUATION_PARAMS.fv_cap_multiple)
    expect(v.single_growth_cap).toBe(VALUATION_PARAMS.single_growth_cap)
    expect(v.gdp_growth_threshold).toBe(VALUATION_PARAMS.gdp_growth_threshold)
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
// Phase 1.8 — version bump to the one-knob config; the config event records the structural diff.
// ---------------------------------------------------------------------------
describe('Phase 1.8 — one-knob version bump records the structural diff', () => {
  it('the live version is the one-knob config (cap frozen at 1.9)', () => {
    expect(VALUATION_PARAMS.version).toBe('valuation-2026-06-one-knob-2')
  })

  it('diff vs the prior recalibration config shows the collapsed/added one-knob fields', () => {
    // Reconstruct the PRIOR (recalibration-1) shape: the stacked growth trio + the old version, WITHOUT
    // the new one-knob fields. Cast through unknown — the prior shape is intentionally no longer the type.
    const previous = {
      version: 'valuation-2026-06-recalibration-1',
      discount_rate: 0.10,
      terminal_growth_by_moat: { monopoly: 0.025, wide: 0.015 },
      stage1_horizon_by_moat: { monopoly: 15, wide: 10 },
      margin_of_safety_by_moat: { monopoly: 0.15, wide: 0.25 },
      fv_cap_multiple: 18,
      growth_band_ceilings: {
        limited_or_none: 0.02, wide_proven: 0.03, wide_proven_exceptional: 0.04,
        monopoly_proven: 0.04, monopoly_proven_exceptional: 0.05,
      },
      growth_eligibility_incremental_roic: 0.10,
      max_growth: 0.05,
      oe_normalization_default: 'mid_cycle',
    } as unknown as ValuationParams

    const changes = diffValuationParams(previous, VALUATION_PARAMS)
    const paths = changes.map((c) => c.path)
    // Collapsed (removed) stacked fields appear with next === undefined.
    expect(paths).toContain('growth_band_ceilings.limited_or_none')
    expect(paths).toContain('growth_eligibility_incremental_roic')
    expect(paths).toContain('max_growth')
    // Added one-knob fields appear with previous === undefined.
    expect(paths).toContain('single_growth_cap')
    expect(paths).toContain('gdp_growth_threshold')
    expect(paths).toContain('equity_premium')
    expect(paths).toContain('ten_year_treasury_default')
    expect(paths).toContain('fv_absurd_multiple')
    expect(paths).toContain('terminal_value_share_flag')
    // The constitutional discount_rate (effective default) is UNCHANGED.
    expect(paths).not.toContain('discount_rate')
  })

  it('buildValuationConfigEvent records the bump + diff (acceptance #5)', () => {
    const previous = { ...VALUATION_PARAMS, version: 'valuation-2026-06-recalibration-1', single_growth_cap: 0.15 }
    const event = buildValuationConfigEvent({
      event_id: 'evt_valuation_config_one_knob',
      strategy_id: buffettMungerStrategy.id,
      previous,
      next: VALUATION_PARAMS,
    })
    expect(event.payload.previous_version).toBe('valuation-2026-06-recalibration-1')
    expect(event.payload.new_version).toBe('valuation-2026-06-one-knob-2')
    expect(event.payload.changes).toContainEqual({ path: 'single_growth_cap', previous: 0.15, next: 0.10 })
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
