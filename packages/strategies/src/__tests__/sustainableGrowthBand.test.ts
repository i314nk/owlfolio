import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { sustainableGrowthBand, type SustainableGrowthBandArgs } from '../sustainableGrowthBand'
import { buffettMungerStrategy } from '../buffettMunger'
import { VALUATION_PARAMS } from '../valuationParams'

// Valuation-core revision: the band is GROUNDED on the identity g = reinvestment_rate × incremental_ROIC
// (cited from economics, NOT an agent assertion), clamped to that identity unless a CITED capital-light
// argument lifts band_high (still capped by single_growth_cap). It carries NO conservatism — one-knob
// discipline: conservatism lives in the required-gap engine (a later slice), never here.
describe('sustainableGrowthBand (grounded reinvestment×ROIC identity + capital-light escape valve)', () => {
  const band = (args: SustainableGrowthBandArgs) => sustainableGrowthBand(buffettMungerStrategy, args)

  it('identity→center: reinvestment×incrROIC sets band_center; band_high ≤ cap; band_low is honest dispersion', () => {
    const r = band({
      incremental_roic: 0.20,
      reinvestment_rate: 0.50,
      demonstrated_growth: 0.10,
      runway: 'proven',
      moat_class: 'wide',
      incremental_roic_basis: 'sec_edgar',
    })
    expect(r.band_center).toBeCloseTo(0.10, 10)
    expect(r.band_high).toBeCloseTo(0.10, 10) // ≤ single_growth_cap (0.15)
    // proven (0.80) + wide moat (+0.05) = 0.85 spread on the identity center
    expect(r.band_low).toBeCloseTo(0.10 * 0.85, 10)
    expect(r.grounding_status).toBe('grounded')
    expect(r.basis_citations.length).toBeGreaterThan(0)
    expect(r.band_low).toBeLessThanOrEqual(r.band_center)
    expect(r.band_center).toBeLessThanOrEqual(r.band_high)
  })

  it('unsupported_high clamp (grounding tripwire): demonstrated >> identity, NO cited capital-light → clamp + flag', () => {
    const r = band({
      incremental_roic: 0.20,
      reinvestment_rate: 0.50, // identity = 0.10
      demonstrated_growth: 0.30, // history implies far more than the identity supports
      runway: 'proven',
      moat_class: 'wide',
      incremental_roic_basis: 'sec_edgar',
    })
    expect(r.grounding_status).toBe('unsupported_high')
    expect(r.band_high).toBeCloseTo(0.10, 10) // clamped to the identity (≤ cap)
    expect(r.flags.some((f) => f.startsWith('unsupported_high'))).toBe(true)
  })

  it('capital-light escape valve (the owner key case): cited argument lifts band_high above the identity', () => {
    const r = band({
      incremental_roic: 0.20,
      reinvestment_rate: 0.50, // identity = 0.10
      demonstrated_growth: 0.13,
      runway: 'proven',
      moat_class: 'wide',
      incremental_roic_basis: 'sec_edgar',
      capital_light_argument: {
        claimed_growth: 0.14,
        citation: 'operating-leverage margin expansion per FY25 10-K segment disclosure',
      },
    })
    expect(r.band_high).toBeCloseTo(0.14, 10) // > identity 0.10, ≤ cap 0.15
    expect(r.grounding_status).toBe('grounded')
    expect(r.basis_citations.some((c) => c.includes('operating-leverage margin expansion'))).toBe(true)
    expect(r.flags).toContain('capital_light_escape_used')
  })

  it('escape valve STILL capped by single_growth_cap: claimed 0.20 → band_high = 0.15 + cap flag', () => {
    const r = band({
      incremental_roic: 0.20,
      reinvestment_rate: 0.50,
      demonstrated_growth: 0.18,
      runway: 'proven',
      moat_class: 'wide',
      incremental_roic_basis: 'sec_edgar',
      capital_light_argument: {
        claimed_growth: 0.20,
        citation: 'network-effect operating leverage, cited',
      },
    })
    expect(r.band_high).toBeCloseTo(VALUATION_PARAMS.single_growth_cap, 10) // 0.15 — cap binds
    expect(r.flags).toContain('capital_light_capped_by_growth_cap')
  })

  it("runway 'none' → wider band (band_low strictly lower than the proven case for the same identity)", () => {
    const common = {
      incremental_roic: 0.20,
      reinvestment_rate: 0.50,
      demonstrated_growth: 0.10,
      moat_class: 'narrow' as const,
      incremental_roic_basis: 'sec_edgar' as const,
    }
    const proven = band({ ...common, runway: 'proven' })
    const none = band({ ...common, runway: 'none' })
    expect(none.band_low).toBeLessThan(proven.band_low)
  })

  it('not_computable: NaN incremental_roic → fail-closed (band all zero, not_computable flag/status)', () => {
    const r = band({
      incremental_roic: Number.NaN,
      reinvestment_rate: 0.50,
      demonstrated_growth: 0.10,
      runway: 'proven',
      moat_class: 'wide',
      incremental_roic_basis: 'sec_edgar',
    })
    expect(r.grounding_status).toBe('not_computable')
    expect(r.band_low).toBe(0)
    expect(r.band_center).toBe(0)
    expect(r.band_high).toBe(0)
    expect(r.flags).toContain('not_computable')
  })

  it('not_computable: negative reinvestment_rate (-1) → fail-closed', () => {
    const r = band({
      incremental_roic: 0.20,
      reinvestment_rate: -1,
      demonstrated_growth: 0.10,
      runway: 'proven',
      moat_class: 'wide',
      incremental_roic_basis: 'sec_edgar',
    })
    expect(r.grounding_status).toBe('not_computable')
    expect(r.band_center).toBe(0)
  })

  it('model_proposed uncited flag: surfaces for human audit but status stays grounded', () => {
    const r = band({
      incremental_roic: 0.20,
      reinvestment_rate: 0.50,
      demonstrated_growth: 0.10,
      runway: 'proven',
      moat_class: 'wide',
      incremental_roic_basis: 'model_proposed',
    })
    expect(r.flags).toContain('incremental_roic_model_proposed_uncited')
    expect(r.grounding_status).toBe('grounded')
  })

  // One-knob discipline (type-level + source-level): this engine carries NO conservatism inputs.
  // Conservatism lives in the required-gap engine (a later slice). Assert the source does NOT pull in the
  // widening config and the arg shape omits the conservatism keys.
  it('one-knob: source excludes conservatism inputs (no widening import, no TV-share/dispersion/maint-capex/durability keys)', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../sustainableGrowthBand.ts', import.meta.url)),
      'utf8',
    )
    expect(src).not.toMatch(/margin_of_safety_widening/)
    expect(src).not.toMatch(/widenedMarginOfSafety/)
    expect(src).not.toMatch(/terminal_value_pct_of_iv/)
    expect(src).not.toMatch(/sensitivity_dispersion/)
    expect(src).not.toMatch(/maint_capex_confidence/)
    expect(src).not.toMatch(/weak_moat_durability/)
  })
})
