import { describe, expect, it } from 'vitest'
import {
  buffettMungerStrategy,
  twoStageFairValuePerShare,
  twoStageValuation,
  terminalGrowthForMoat,
  stage1HorizonForMoat,
} from '../buffettMunger'

// ---------------------------------------------------------------------------
// Two-stage DCF valuation contract params (buffett-valuation-method-v2)
// ---------------------------------------------------------------------------
describe('Buffett-Munger two-stage DCF contract params', () => {
  it('flat 7.5% effective default discount rate (F.2 — compliant savings anchor 2% + uniform premium 5.5%)', () => {
    expect(buffettMungerStrategy.valuation.discount_rate).toBe(0.075)
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
    expect(buffettMungerStrategy.valuation.single_growth_cap).toBe(0.15) // re-derived 2026-06-15
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
  it('COST validation (Part D Step 2 fade): OE/sh 18.97, g 0.03, g_t 0.01, r 0.10 → FV ≈ 237', () => {
    const oe_ps = 8440 / 444.8 // ≈ 18.9748
    const fv = twoStageFairValuePerShare({ oe_ps, g: 0.03, terminal_g: 0.01, discount: 0.1, ceiling_multiple: 18 })
    expect(oe_ps).toBeCloseTo(18.97, 1)
    // Faded stage-1 path (g 3% glides to 1% over the trailing 5 yrs): FV ≈ 237.17, implied 12.50× OE.
    expect(fv).toBeCloseTo(237.1706, 2)
    expect(fv).toBeLessThan(18 * oe_ps)
    expect(fv).toBeGreaterThan(200)
    // implied multiple ≈ 12.5×
    expect(fv / oe_ps).toBeCloseTo(12.5, 1)
  })

  it('g=0 → FV equals the two-stage value with flat stage 1 (no growth credit; fade never bites, g < g_t)', () => {
    const oe_ps = 8440 / 444.8
    const fv = twoStageFairValuePerShare({ oe_ps, g: 0, terminal_g: 0.01, discount: 0.1, ceiling_multiple: 18 })
    // g=0 ≤ terminal → fade is skipped (flat stage 1); unchanged at ≈ 198.69.
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
//
// F.2 — the live discount is now the COMPLIANT savings-rate anchor (0.075 = 0.02 savings + 0.055 premium),
// down from the retired Treasury-anchored 0.10. The lower discount raises every present value, so these
// reference cases now exceed the 18× OE cap: we pin the UNCAPPED two-stage DCF fair value (twoStageValuation,
// the real Step-4 reference) AND assert the legacy capped scalar truncates at 18× (cap now binds at 7.5%).
//   Monopoly-tagged name, OE_ps=100, g=0.04, horizon=10, terminal=0.015, discount=0.075, fade 5 →
//     OE_t = 100·Π_{i=1..t}(1+g_i); FV = Σ OE_t/1.075^t + [OE_10·1.015/(0.075−0.015)]/1.075^10
//        = 1954.7576   (implied 19.55× OE — over the 18× cap; the cap now binds at the F.2 discount)
// ---------------------------------------------------------------------------
describe('Acceptance #1 — reference valuation regression (computed, not trusted from prose; F.13 uniform)', () => {
  it('Monopoly-tagged name: OE=100, g=4%, uniform horizon 10, terminal 1.5%, F.2 discount 7.5%, cap 18×', () => {
    const oe_ps = 100
    const uncapped = twoStageValuation({
      oe_ps,
      g: 0.04,
      terminal_g: terminalGrowthForMoat(buffettMungerStrategy, 'monopoly'),
      discount: buffettMungerStrategy.valuation.discount_rate,
      ceiling_multiple: buffettMungerStrategy.valuation.valuation_multiple_ceiling,
      horizon: stage1HorizonForMoat(buffettMungerStrategy, 'monopoly'),
    })
    // Pinned UNCAPPED computed value (truth per spec §4 instruction); F.13 uniform params + Part D Step 2 fade.
    expect(uncapped.fair_value).toBeCloseTo(1954.7576, 3)
    expect(uncapped.fair_value! / oe_ps).toBeCloseTo(19.548, 3) // implied multiple, OVER the 18× cap at 7.5%
    expect(uncapped.cap_exceeded).toBe(true) // the F.2 lower discount pushes it over the cap (surfaced flag)
    // The legacy capped scalar truncates at 18× OE (the cap now binds at the F.2 discount).
    const capped = twoStageFairValuePerShare({
      oe_ps,
      g: 0.04,
      terminal_g: terminalGrowthForMoat(buffettMungerStrategy, 'monopoly'),
      discount: buffettMungerStrategy.valuation.discount_rate,
      ceiling_multiple: buffettMungerStrategy.valuation.valuation_multiple_ceiling,
      horizon: stage1HorizonForMoat(buffettMungerStrategy, 'monopoly'),
    })
    expect(capped).toBeCloseTo(1800, 6) // 18 × OE
  })

  it('Wide reference: OE=100, g=3%, horizon 10, terminal 1.5%, F.2 discount 7.5%, cap 18×', () => {
    const oe_ps = 100
    const uncapped = twoStageValuation({
      oe_ps,
      g: 0.03,
      terminal_g: terminalGrowthForMoat(buffettMungerStrategy, 'wide'),
      discount: buffettMungerStrategy.valuation.discount_rate,
      ceiling_multiple: buffettMungerStrategy.valuation.valuation_multiple_ceiling,
      horizon: stage1HorizonForMoat(buffettMungerStrategy, 'wide'),
    })
    // Computed UNCAPPED (Part D Step 2 fade, g 3% → 1.5%, F.2 discount 7.5%): 1845.1904 (implied 18.452×).
    expect(uncapped.fair_value).toBeCloseTo(1845.1904, 3)
    expect(uncapped.fair_value! / oe_ps).toBeCloseTo(18.452, 3)
    expect(uncapped.cap_exceeded).toBe(true)
    const capped = twoStageFairValuePerShare({
      oe_ps,
      g: 0.03,
      terminal_g: terminalGrowthForMoat(buffettMungerStrategy, 'wide'),
      discount: buffettMungerStrategy.valuation.discount_rate,
      ceiling_multiple: buffettMungerStrategy.valuation.valuation_multiple_ceiling,
      horizon: stage1HorizonForMoat(buffettMungerStrategy, 'wide'),
    })
    expect(capped).toBeCloseTo(1800, 6) // 18 × OE
  })
})

// ---------------------------------------------------------------------------
// Part D Step 2 — linear stage-1 growth fade to the terminal rate over the trailing years.
// The near-term g compounds flat over the plateau years then glides DOWN to the terminal rate over the
// last `growth_fade_years`. Flat compounding over a long horizon over-values quality compounders; the fade
// is the forecasting-humility mechanism inside the explicit window. Fade bites ONLY downward (g > terminal).
// ---------------------------------------------------------------------------
describe('Part D Step 2 — linear stage-1 growth fade', () => {
  const base = { oe_ps: 1, terminal_g: 0.015, discount: 0.10, ceiling_multiple: 1e9, horizon: 10 } as const

  it('high-g name is valued FAR below the old flat-compounding model (g=0.20)', () => {
    // Old flat model: Σ 1.20^t/1.10^t + Gordon ≈ 45.15× OE. Faded path collapses it to ≈ 31.99× OE.
    const faded = twoStageValuation({ ...base, g: 0.20 })
    expect(faded.fair_value!).toBeCloseTo(31.9901, 2)
    // Strictly, and substantially, below the ~45× the flat model produced.
    expect(faded.fair_value!).toBeLessThan(45)
    expect(faded.fair_value!).toBeLessThan(33)
  })

  it('faded FV is monotonically below the equivalent flat-compounding FV for every above-terminal g', () => {
    for (const g of [0.10, 0.15, 0.20]) {
      const faded = twoStageValuation({ ...base, g }).fair_value!
      // Flat reference (the OLD model: full g for all H years, no glide) computed inline.
      let stage1 = 0
      for (let t = 1; t <= base.horizon; t += 1) stage1 += Math.pow(1 + g, t) / Math.pow(1 + base.discount, t)
      const terminal = (Math.pow(1 + g, base.horizon) * (1 + base.terminal_g) / (base.discount - base.terminal_g)) / Math.pow(1 + base.discount, base.horizon)
      const flat = stage1 + terminal
      expect(faded).toBeLessThan(flat)
    }
  })

  it('pins the faded FV/OE multiple at the calibration inputs (oe=1, r=0.10, g_t=0.015, H=10, F=5)', () => {
    expect(twoStageValuation({ ...base, g: 0.10 }).fair_value!).toBeCloseTo(18.8955, 3)
    expect(twoStageValuation({ ...base, g: 0.15 }).fair_value!).toBeCloseTo(24.6389, 3)
    expect(twoStageValuation({ ...base, g: 0.20 }).fair_value!).toBeCloseTo(31.9901, 3)
  })

  it('a low/no-growth name (g ≤ terminal) is UNAFFECTED by the fade — flat path, glide skipped', () => {
    // g = 0.01 < terminal 0.015: the glide would inflate it UPWARD toward 1.5%, which is forbidden.
    const withFade = twoStageValuation({ ...base, g: 0.01 }).fair_value!
    const noFade = twoStageValuation({ ...base, g: 0.01, fade_years: 0 }).fair_value!
    expect(withFade).toBeCloseTo(noFade, 10) // identical — fade does not bite when g ≤ terminal
  })

  it('fade_years=0 disables the fade (flat compounding); the trailing fade lowers the value', () => {
    const flat = twoStageValuation({ ...base, g: 0.20, fade_years: 0 }).fair_value!
    const faded = twoStageValuation({ ...base, g: 0.20 }).fair_value! // default fade_years = 5
    expect(flat).toBeCloseTo(45.1520, 3) // old flat model
    expect(faded).toBeLessThan(flat)
  })

  it('a longer fade window (more humility) yields a strictly lower FV', () => {
    const f3 = twoStageValuation({ ...base, g: 0.20, fade_years: 3 }).fair_value!
    const f5 = twoStageValuation({ ...base, g: 0.20, fade_years: 5 }).fair_value!
    const f8 = twoStageValuation({ ...base, g: 0.20, fade_years: 8 }).fair_value!
    expect(f5).toBeLessThan(f3)
    expect(f8).toBeLessThan(f5)
  })

  it('config default growth_fade_years is 5 (Part D — years 6–10 of a 10-yr horizon)', () => {
    expect(buffettMungerStrategy.valuation.growth_fade_years).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// Acceptance test #2 (spec §4): all parameters readable from config; changing a param in the config
// changes the fair value with NO code change. (Margin of safety is no longer a deterministic config
// haircut — it comes from the synthesis joint price/moat judgment — so the live config-driven property
// is exercised here via the growth-cap, which still feeds twoStageValuation directly.)
// ---------------------------------------------------------------------------
describe('Acceptance #2 — config-driven (changing a param changes the fair value, no code change)', () => {
  it('changing the growth cap in the params object changes the fair value', async () => {
    const { VALUATION_PARAMS } = await import('../valuationParams')
    const oe_ps = 100
    // High ceiling_multiple so the 18× sanity clamp does not bind for either cap — this isolates the
    // growth-cap effect on the underlying faded fair value (both caps would otherwise clamp to 18× and tie).
    const ceiling_multiple = 1000
    // Same valuation engine, two different growth caps pulled from a config object — no code change.
    const fvAtDefaultCap = twoStageFairValuePerShare({
      oe_ps,
      g: VALUATION_PARAMS.single_growth_cap,
      terminal_g: VALUATION_PARAMS.terminal_growth,
      discount: VALUATION_PARAMS.discount_rate,
      ceiling_multiple,
      horizon: VALUATION_PARAMS.stage1_horizon,
    })
    const tighterConfig = {
      ...VALUATION_PARAMS,
      single_growth_cap: 0.10,
    }
    const fvAtTighterCap = twoStageFairValuePerShare({
      oe_ps,
      g: tighterConfig.single_growth_cap,
      terminal_g: tighterConfig.terminal_growth,
      discount: tighterConfig.discount_rate,
      ceiling_multiple,
      horizon: tighterConfig.stage1_horizon,
    })
    expect(fvAtTighterCap).toBeLessThan(fvAtDefaultCap) // a tighter growth cap lowers fair value
  })
})
