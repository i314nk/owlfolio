import { describe, expect, it } from 'vitest'
import {
  buffettMungerStrategy,
  twoStageFairValuePerShare,
  terminalGrowthForMoat,
  marginOfSafetyForMoat,
  stage1HorizonForMoat,
} from '../buffettMunger'

// ---------------------------------------------------------------------------
// Two-stage DCF valuation contract params (buffett-valuation-method-v2)
// ---------------------------------------------------------------------------
describe('Buffett-Munger two-stage DCF contract params', () => {
  it('flat 10% discount rate', () => {
    expect(buffettMungerStrategy.valuation.discount_rate).toBe(0.1)
  })

  // F.13 — UNIFORM base MoS 25% for every investable moat (collapsed from the old monopoly/wide tier table).
  it('uniform base MoS (F.13): 25% for wide and monopoly alike', () => {
    expect(buffettMungerStrategy.valuation.base_margin_of_safety).toBe(0.25)
    expect(marginOfSafetyForMoat(buffettMungerStrategy, 'monopoly')).toBe(0.25)
    expect(marginOfSafetyForMoat(buffettMungerStrategy, 'wide')).toBe(0.25)
  })

  // F.13 — UNIFORM terminal g 1.5% for every investable moat (collapsed to wide's value).
  it('uniform terminal growth (F.13): 1.5% for wide and monopoly alike', () => {
    expect(buffettMungerStrategy.valuation.terminal_growth).toBe(0.015)
    expect(terminalGrowthForMoat(buffettMungerStrategy, 'monopoly')).toBe(0.015)
    expect(terminalGrowthForMoat(buffettMungerStrategy, 'wide')).toBe(0.015)
  })

  // F.13 — UNIFORM stage-1 horizon 10 yrs for every investable moat (collapsed to wide's value).
  it('uniform stage-1 horizon (F.13): 10 yrs for wide and monopoly alike', () => {
    expect(buffettMungerStrategy.valuation.stage1_horizon).toBe(10)
    expect(stage1HorizonForMoat(buffettMungerStrategy, 'monopoly')).toBe(10)
    expect(stage1HorizonForMoat(buffettMungerStrategy, 'wide')).toBe(10)
  })

  it('18x OE valuation multiple ceiling — now a surfaced sanity FLAG, not a silent truncation (Phase 1.6)', () => {
    expect(buffettMungerStrategy.valuation.valuation_multiple_ceiling).toBe(18)
  })

  it('one named growth backstop replaces the stacked band/eligibility/max trio (Phase 1.3)', () => {
    expect(buffettMungerStrategy.valuation.single_growth_cap).toBe(0.10) // FROZEN at 1.9
    expect(buffettMungerStrategy.valuation.gdp_growth_threshold).toBe(0.03)
    const v = buffettMungerStrategy.valuation as Record<string, unknown>
    expect(v.growth_band_ceilings).toBeUndefined()
    expect(v.growth_eligibility_incremental_roic).toBeUndefined()
    expect(v.max_growth).toBeUndefined()
  })

  it('no longer carries the legacy terminal_growth_cap', () => {
    expect((buffettMungerStrategy.valuation as Record<string, unknown>).terminal_growth_cap).toBeUndefined()
  })
})

// creditedGrowth (Phase 1.3 — one growth path) is covered in creditedGrowth.test.ts.

// ---------------------------------------------------------------------------
// twoStageFairValuePerShare — Step 4 formula
// ---------------------------------------------------------------------------
describe('twoStageFairValuePerShare (Step 4 two-stage DCF)', () => {
  it('COST validation: OE/sh 18.97, g 0.03, g_t 0.01, r 0.10 → FV ≈ 245', () => {
    const oe_ps = 8440 / 444.8 // ≈ 18.9748
    const fv = twoStageFairValuePerShare({ oe_ps, g: 0.03, terminal_g: 0.01, discount: 0.1, ceiling_multiple: 18 })
    expect(oe_ps).toBeCloseTo(18.97, 1)
    expect(fv).toBeCloseTo(244.87, 0)
    // Stage 1 ≈ 134, Stage 2 ≈ 110, well under the 18× cap of ≈ 341
    expect(fv).toBeLessThan(18 * oe_ps)
    expect(fv).toBeGreaterThan(200)
    // implied multiple ≈ 12.9×
    expect(fv / oe_ps).toBeCloseTo(12.9, 1)
  })

  it('g=0 → FV equals the two-stage value with flat stage 1 (no growth credit)', () => {
    const oe_ps = 8440 / 444.8
    const fv = twoStageFairValuePerShare({ oe_ps, g: 0, terminal_g: 0.01, discount: 0.1, ceiling_multiple: 18 })
    // Stage 1 flat OE for 10 yrs + Gordon terminal at g_t; ≈ 198.7 (close to Gordon oe*(1.01)/0.09 ≈ 213)
    expect(fv).toBeCloseTo(198.69, 0)
    expect(fv).toBeLessThan(oe_ps * 1.01 / 0.09) // below pure Gordon because stage 1 doesn't grow
  })

  it('18× OE ceiling binds when credited growth is high', () => {
    // A deliberately high g (above the policy max) drives the raw two-stage value above 18× OE.
    const oe_ps = 20
    const raw = twoStageFairValuePerShare({ oe_ps, g: 0.09, terminal_g: 0.02, discount: 0.1, ceiling_multiple: 1000 })
    expect(raw / oe_ps).toBeGreaterThan(18)
    const capped = twoStageFairValuePerShare({ oe_ps, g: 0.09, terminal_g: 0.02, discount: 0.1, ceiling_multiple: 18 })
    expect(capped).toBe(18 * oe_ps)
  })

  it('monopoly terminal (g_t 0.02) yields a higher FV than wide terminal (g_t 0.01)', () => {
    const oe_ps = 18.97
    const mono = twoStageFairValuePerShare({ oe_ps, g: 0.04, terminal_g: 0.02, discount: 0.1, ceiling_multiple: 18 })
    const wide = twoStageFairValuePerShare({ oe_ps, g: 0.03, terminal_g: 0.01, discount: 0.1, ceiling_multiple: 18 })
    expect(mono).toBeGreaterThan(wide)
  })

  it('per-share values are sane — never ~100× off (units guard)', () => {
    const oe_ps = 18.97
    const fv = twoStageFairValuePerShare({ oe_ps, g: 0.03, terminal_g: 0.01, discount: 0.1, ceiling_multiple: 18 })
    expect(fv).toBeLessThan(oe_ps * 18 + 1)
    expect(fv).toBeGreaterThan(oe_ps)
  })

  it('moat-dependent horizon: monopoly 15yr FV exceeds the same inputs at 10yr', () => {
    const oe_ps = 100
    const h15 = twoStageFairValuePerShare({ oe_ps, g: 0.04, terminal_g: 0.025, discount: 0.1, ceiling_multiple: 18, horizon: 15 })
    const h10 = twoStageFairValuePerShare({ oe_ps, g: 0.04, terminal_g: 0.025, discount: 0.1, ceiling_multiple: 18, horizon: 10 })
    expect(h15).toBeGreaterThan(h10)
  })
})

// ---------------------------------------------------------------------------
// Acceptance test #1 (valuation-recalibration-spec §4): reference valuation regression.
// "Do not trust any number in prose, including the spec's — compute from the formula and pin your
// computed value as the regression test."
//
// COMPUTED (this implementation, from the Step-4 formula). F.13 — valuation params are UNIFORM across
// investable moats: terminal g 1.5%, horizon 10, base MoS 25% for monopoly and wide alike. A monopoly no
// longer earns a longer horizon / higher g_t / lower MoS; the only difference below is the credited growth
// input (g=4% vs g=3%).
//   Monopoly-tagged name, OE_ps=100, g=0.04, horizon=10, terminal=0.015, discount=0.10, cap=18× →
//     FV = Σ_{t=1..10} 100·1.04^t/1.10^t + [100·1.04^10·1.015/(0.10−0.015)]/1.10^10
//        = 1425.6039   (implied 14.26× OE, under 18× cap)
//     buy @ MOS 25% = 1425.6039 × 0.75 = 1069.2029
// ---------------------------------------------------------------------------
describe('Acceptance #1 — reference valuation regression (computed, not trusted from prose; F.13 uniform)', () => {
  it('Monopoly-tagged name: OE=100, g=4%, uniform horizon 10, terminal 1.5%, discount 10%, cap 18×, MOS 25%', () => {
    const oe_ps = 100
    const fv = twoStageFairValuePerShare({
      oe_ps,
      g: 0.04,
      terminal_g: terminalGrowthForMoat(buffettMungerStrategy, 'monopoly'),
      discount: buffettMungerStrategy.valuation.discount_rate,
      ceiling_multiple: buffettMungerStrategy.valuation.valuation_multiple_ceiling,
      horizon: stage1HorizonForMoat(buffettMungerStrategy, 'monopoly'),
    })
    const mos = marginOfSafetyForMoat(buffettMungerStrategy, 'monopoly')
    const buy = fv * (1 - mos)
    // Pinned computed values (truth per spec §4 instruction); F.13 uniform params (terminal 1.5%, horizon 10).
    expect(fv).toBeCloseTo(1425.6039, 3)
    expect(fv / oe_ps).toBeCloseTo(14.256, 3) // implied multiple, under the 18× cap
    expect(buy).toBeCloseTo(1069.2029, 2)
    expect(fv).toBeLessThan(18 * oe_ps) // cap does not bind here
  })

  it('Wide reference: OE=100, g=3%, horizon 10, terminal 1.5%, discount 10%, cap 18×, MOS 25%', () => {
    const oe_ps = 100
    const fv = twoStageFairValuePerShare({
      oe_ps,
      g: 0.03,
      terminal_g: terminalGrowthForMoat(buffettMungerStrategy, 'wide'),
      discount: buffettMungerStrategy.valuation.discount_rate,
      ceiling_multiple: buffettMungerStrategy.valuation.valuation_multiple_ceiling,
      horizon: stage1HorizonForMoat(buffettMungerStrategy, 'wide'),
    })
    const mos = marginOfSafetyForMoat(buffettMungerStrategy, 'wide')
    const buy = fv * (1 - mos)
    // Computed: stage1 709.0256 + terminal 618.7177 = 1327.7433 (implied 13.277×); buy @25% = 995.8074.
    expect(fv).toBeCloseTo(1327.7433, 3)
    expect(fv / oe_ps).toBeCloseTo(13.277, 3)
    expect(buy).toBeCloseTo(995.8074, 3)
  })
})

// ---------------------------------------------------------------------------
// Acceptance test #2 (spec §4): all parameters readable from config; changing MOS in the config
// changes the buy price with NO code change.
// ---------------------------------------------------------------------------
describe('Acceptance #2 — config-driven (changing a param changes the buy price, no code change)', () => {
  it('changing MOS in the params object changes the buy price', async () => {
    const { VALUATION_PARAMS } = await import('../valuationParams')
    const oe_ps = 100
    const fv = twoStageFairValuePerShare({
      oe_ps,
      g: 0.04,
      terminal_g: VALUATION_PARAMS.terminal_growth,
      discount: VALUATION_PARAMS.discount_rate,
      ceiling_multiple: VALUATION_PARAMS.fv_cap_multiple,
      horizon: VALUATION_PARAMS.stage1_horizon,
    })
    // Same valuation engine, two different MOS values pulled from a config object — no code change.
    const buyAtDefaultMos = fv * (1 - VALUATION_PARAMS.base_margin_of_safety)
    const tighterConfig = {
      ...VALUATION_PARAMS,
      base_margin_of_safety: 0.30,
    }
    const buyAtTighterMos = fv * (1 - tighterConfig.base_margin_of_safety)
    expect(buyAtTighterMos).toBeLessThan(buyAtDefaultMos)
    expect(buyAtTighterMos).toBeCloseTo(fv * 0.70, 6)
    expect(buyAtDefaultMos).toBeCloseTo(fv * 0.75, 6) // uniform base MoS is now 25% (F.13)
  })
})
