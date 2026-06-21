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
    expect(VALUATION_PARAMS.discount_rate).toBe(0.075) // F.2 effective default = savings_rate_default + equity premium
    expect(VALUATION_PARAMS.equity_premium).toBe(0.055) // Phase 1.4 — uniform, no quality knob
    expect(VALUATION_PARAMS.savings_rate_default).toBe(0.02) // F.2 — compliant savings rate fail-closed default
    // F.13 — UNIFORM scalars (collapsed from the old _by_moat tier tables to the conservative wide values).
    expect(VALUATION_PARAMS.terminal_growth).toBe(0.015)
    expect(VALUATION_PARAMS.stage1_horizon).toBe(10)
    expect(VALUATION_PARAMS.growth_fade_years).toBe(5) // Part D Step 2 — linear fade over years 6–10
    expect(VALUATION_PARAMS.fv_cap_multiple).toBe(18)
    expect(VALUATION_PARAMS.single_growth_cap).toBe(0.15) // re-derived 2026-06-15 (forward-humility ceiling)
    expect(VALUATION_PARAMS.gdp_growth_threshold).toBe(0.03)
    expect(VALUATION_PARAMS.oe_normalization_default).toBe('mid_cycle')
  })

  it('the strategy contract sources its valuation constants from VALUATION_PARAMS', () => {
    const v = buffettMungerStrategy.valuation
    expect(v.discount_rate).toBe(VALUATION_PARAMS.discount_rate)
    expect(v.terminal_growth).toBe(VALUATION_PARAMS.terminal_growth)
    expect(v.stage1_horizon).toBe(VALUATION_PARAMS.stage1_horizon)
    expect(v.growth_fade_years).toBe(VALUATION_PARAMS.growth_fade_years)
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
      single_growth_cap: 0.12,
    }
    const changes = diffValuationParams(VALUATION_PARAMS, next)
    expect(changes).toEqual([
      { path: 'single_growth_cap', previous: 0.15, next: 0.12 },
    ])
  })
})

// ---------------------------------------------------------------------------
// Part D Step 2 — version bump to the growth-fade config; the config event records the structural diff
// (the F.13 uniform scalars are unchanged; a new growth_fade_years field appears).
// ---------------------------------------------------------------------------
describe('Part D Step 2 — growth-fade version bump records the structural diff', () => {
  it('the live version is the savings-anchor config (F.2 — discount anchor swapped to the compliant savings rate)', () => {
    expect(VALUATION_PARAMS.version).toBe('valuation-2026-06-savings-anchor-1')
  })

  it('F.2 — diff vs the prior no-mos-knob config shows the retired ten_year_treasury_default + the added savings_rate_default', () => {
    // Reconstruct the PRIOR (no-mos-knob-1) shape: identical EXCEPT the discount anchored on the now-retired
    // ten_year_treasury_default (0.045) and the effective default discount was 0.10. The F.2 bump records the
    // Treasury anchor's removal + the compliant savings-rate anchor's addition; equity_premium is unchanged.
    const previous = {
      ...VALUATION_PARAMS,
      version: 'valuation-2026-06-no-mos-knob-1',
      discount_rate: 0.10,
      savings_rate_default: undefined,
      ten_year_treasury_default: 0.045,
    } as unknown as ValuationParams
    const changes = diffValuationParams(previous, VALUATION_PARAMS)
    const byPath = new Map(changes.map((c) => [c.path, c]))
    // The retired Treasury anchor appears with next === undefined.
    expect(byPath.get('ten_year_treasury_default')).toEqual({ path: 'ten_year_treasury_default', previous: 0.045, next: undefined })
    // The added compliant savings-rate anchor appears with previous === undefined.
    expect(byPath.get('savings_rate_default')).toEqual({ path: 'savings_rate_default', previous: undefined, next: 0.02 })
    // The effective default discount drops 0.10 -> 0.075 (0.02 savings + 0.055 premium).
    expect(byPath.get('discount_rate')).toEqual({ path: 'discount_rate', previous: 0.10, next: 0.075 })
    // The equity premium is UNCHANGED by this bump.
    expect(byPath.has('equity_premium')).toBe(false)
  })

  it('diff vs the prior no-band-gap config shows the removed base_margin_of_safety + margin_of_safety_widening (MoS knob deleted)', () => {
    // Reconstruct the PRIOR (no-band-gap-1) shape: identical EXCEPT it still carried the now-removed
    // deterministic margin-of-safety knob (base_margin_of_safety + margin_of_safety_widening). The
    // no-mos-knob bump records their removal — margin of safety now comes from the synthesis joint
    // price/moat judgment, not a deterministic config haircut.
    const previous = {
      ...VALUATION_PARAMS,
      version: 'valuation-2026-06-no-band-gap-1',
      base_margin_of_safety: 0.25,
      margin_of_safety_widening: {
        high_terminal_value_share: 0.10,
        low_maint_capex_confidence: 0.05,
        weak_moat_durability: 0.10,
        sensitivity_dispersion_max: 0.10,
        cap: 0.50,
      },
    } as unknown as ValuationParams
    const changes = diffValuationParams(previous, VALUATION_PARAMS)
    const byPath = new Map(changes.map((c) => [c.path, c]))
    // The removed leaves appear with next === undefined (the deterministic MoS conservatism knob is gone).
    expect(byPath.get('base_margin_of_safety')).toEqual({ path: 'base_margin_of_safety', previous: 0.25, next: undefined })
    expect(byPath.get('margin_of_safety_widening.cap')).toEqual({ path: 'margin_of_safety_widening.cap', previous: 0.50, next: undefined })
    // The surviving sanity-check params are UNCHANGED by this bump.
    expect(byPath.has('single_growth_cap')).toBe(false)
    expect(byPath.has('terminal_value_share_flag')).toBe(false)
    expect(byPath.has('fv_cap_multiple')).toBe(false)
  })

  it('diff vs the prior F.13 uniform-moat config shows the added growth_fade_years field', () => {
    // Reconstruct the PRIOR (f13-uniform-moat-1) shape: identical EXCEPT it had no growth_fade_years field.
    const previous = {
      ...VALUATION_PARAMS,
      version: 'valuation-2026-06-f13-uniform-moat-1',
      growth_fade_years: undefined,
    } as unknown as ValuationParams
    const changes = diffValuationParams(previous, VALUATION_PARAMS)
    const byPath = new Map(changes.map((c) => [c.path, c]))
    // The added field appears with previous === undefined (Part D Step 2 — trailing linear fade).
    expect(byPath.get('growth_fade_years')).toEqual({ path: 'growth_fade_years', previous: undefined, next: 5 })
    // The F.13 uniform scalars are UNCHANGED by this bump.
    expect(byPath.has('terminal_growth')).toBe(false)
    expect(byPath.has('stage1_horizon')).toBe(false)
    expect(byPath.has('single_growth_cap')).toBe(false)
    expect(byPath.has('discount_rate')).toBe(false)
  })

  it('diff vs the prior one-knob config shows the collapsed tier tables and the added uniform scalars', () => {
    // Reconstruct the PRIOR (one-knob-2) shape: the moat-tiered _by_moat tables + the old version, WITHOUT
    // the new uniform scalar fields. Cast through unknown — the prior shape is intentionally no longer the type.
    const previous = {
      ...VALUATION_PARAMS,
      version: 'valuation-2026-06-one-knob-2',
      terminal_growth: undefined,
      stage1_horizon: undefined,
      single_growth_cap: undefined,
      terminal_growth_by_moat: { monopoly: 0.025, wide: 0.015 },
      stage1_horizon_by_moat: { monopoly: 15, wide: 10 },
      margin_of_safety_by_moat: { monopoly: 0.15, wide: 0.25 },
    } as unknown as ValuationParams

    const changes = diffValuationParams(previous, VALUATION_PARAMS)
    const byPath = new Map(changes.map((c) => [c.path, c]))
    // Collapsed (removed) tier-table leaves appear with next === undefined.
    expect(byPath.get('terminal_growth_by_moat.monopoly')).toEqual({ path: 'terminal_growth_by_moat.monopoly', previous: 0.025, next: undefined })
    expect(byPath.get('terminal_growth_by_moat.wide')).toEqual({ path: 'terminal_growth_by_moat.wide', previous: 0.015, next: undefined })
    expect(byPath.get('stage1_horizon_by_moat.monopoly')).toEqual({ path: 'stage1_horizon_by_moat.monopoly', previous: 15, next: undefined })
    expect(byPath.get('stage1_horizon_by_moat.wide')).toEqual({ path: 'stage1_horizon_by_moat.wide', previous: 10, next: undefined })
    expect(byPath.get('margin_of_safety_by_moat.monopoly')).toEqual({ path: 'margin_of_safety_by_moat.monopoly', previous: 0.15, next: undefined })
    expect(byPath.get('margin_of_safety_by_moat.wide')).toEqual({ path: 'margin_of_safety_by_moat.wide', previous: 0.25, next: undefined })
    // Added uniform scalar fields appear with previous === undefined (collapsed to the conservative wide values).
    expect(byPath.get('terminal_growth')).toEqual({ path: 'terminal_growth', previous: undefined, next: 0.015 })
    expect(byPath.get('stage1_horizon')).toEqual({ path: 'stage1_horizon', previous: undefined, next: 10 })
    expect(byPath.get('single_growth_cap')).toEqual({ path: 'single_growth_cap', previous: undefined, next: 0.15 })
    // The constitutional discount_rate (effective default) is UNCHANGED.
    expect(byPath.has('discount_rate')).toBe(false)
  })

  it('buildValuationConfigEvent records the bump + diff (acceptance #5)', () => {
    const previous = { ...VALUATION_PARAMS, version: 'valuation-2026-06-one-knob-2', single_growth_cap: 0.10 }
    const event = buildValuationConfigEvent({
      event_id: 'evt_valuation_config_cap',
      strategy_id: buffettMungerStrategy.id,
      previous,
      next: VALUATION_PARAMS,
    })
    expect(event.payload.previous_version).toBe('valuation-2026-06-one-knob-2')
    expect(event.payload.new_version).toBe('valuation-2026-06-savings-anchor-1')
    expect(event.payload.changes).toContainEqual({ path: 'single_growth_cap', previous: 0.10, next: 0.15 })
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
      single_growth_cap: 0.12,
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
      { path: 'single_growth_cap', previous: 0.15, next: 0.12 },
    ])
    expect(event.schema_version).toBe(1)
  })
})
