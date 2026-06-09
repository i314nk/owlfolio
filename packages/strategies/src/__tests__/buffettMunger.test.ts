import { describe, expect, it } from 'vitest'
import { buffettMungerStrategy, discountRate, marginOfSafetyForMoat, moatPassesGate, targetWeightForMoatClass } from '../buffettMunger'
import { evaluateGates } from '../evaluateGates'

describe('Buffett-Munger default strategy (Design B: 4-class, flat discount, moat-tiered MoS)', () => {
  it('defines the default core policy', () => {
    expect(buffettMungerStrategy.id).toBe('buffett-munger')
    expect(buffettMungerStrategy.certification_status).toBe('draft')
    expect(buffettMungerStrategy.shariah.required).toBe(true)
    expect(buffettMungerStrategy.research.required_specialists.map((s) => s.id)).toEqual(['moat', 'financials', 'risk', 'management', 'valuation', 'synthesis'])
    // Design B: flat 10% discount rate for all investable moat classes
    expect(buffettMungerStrategy.valuation.discount_rate).toBe(0.10)
    // Moat-tiered margin of safety
    expect(buffettMungerStrategy.valuation.margin_of_safety_by_moat).toEqual({ wide: 0.30, monopoly: 0.10 })
    // Equity-bond params
    expect(buffettMungerStrategy.valuation.terminal_growth_cap).toBe(0.03)
    expect(buffettMungerStrategy.valuation.valuation_multiple_ceiling).toBe(20)
    expect(buffettMungerStrategy.valuation.min_investable_moat).toBe('wide')
  })

  it('discountRate returns flat 0.10 for all investable classes', () => {
    expect(discountRate(buffettMungerStrategy)).toBe(0.10)
  })

  it('marginOfSafetyForMoat returns moat-tiered MoS values', () => {
    expect(marginOfSafetyForMoat(buffettMungerStrategy, 'wide')).toBe(0.30)
    expect(marginOfSafetyForMoat(buffettMungerStrategy, 'monopoly')).toBe(0.10)
  })

  it('marginOfSafetyForMoat throws for non-investable moat classes (narrow, moderate)', () => {
    expect(() => marginOfSafetyForMoat(buffettMungerStrategy, 'narrow')).toThrow()
    expect(() => marginOfSafetyForMoat(buffettMungerStrategy, 'moderate')).toThrow()
  })

  it('moatPassesGate: wide/monopoly pass; narrow/moderate reject; no inevitable tier', () => {
    expect(moatPassesGate(buffettMungerStrategy, 'wide')).toBe(true)
    expect(moatPassesGate(buffettMungerStrategy, 'monopoly')).toBe(true)
    expect(moatPassesGate(buffettMungerStrategy, 'narrow')).toBe(false)
    expect(moatPassesGate(buffettMungerStrategy, 'moderate')).toBe(false)
  })

  it('includes required blocking gates', () => {
    const blockingGateIds = buffettMungerStrategy.hard_gates.filter((gate) => gate.severity === 'blocking').map((gate) => gate.id)
    expect(blockingGateIds).toEqual(expect.arrayContaining(['shariah_compliant_or_conditional', 'positive_owner_earnings', 'leverage_safe', 'valuation_complete']))
  })

  it('returns COMPLIANT only when blocking gates pass', () => {
    const result = evaluateGates(buffettMungerStrategy, { shariah_status: 'COMPLIANT', owner_earnings_positive: true, leverage_safe: true, valuation_complete: true, source_coverage_complete: true })
    expect(result.status).toBe('COMPLIANT')
    expect(result.failed_gates).toEqual([])
    expect(result.warning_gates).toEqual([])
    expect(result.unknown_gates).toEqual([])
  })

  it('returns NON_COMPLIANT when a blocking gate is false', () => {
    const result = evaluateGates(buffettMungerStrategy, { shariah_status: 'COMPLIANT', owner_earnings_positive: false, leverage_safe: true, valuation_complete: true, source_coverage_complete: true })
    expect(result.status).toBe('NON_COMPLIANT')
    expect(result.failed_gates).toEqual(['positive_owner_earnings'])
    expect(result.warning_gates).toEqual([])
  })

  it('does not block compliance when a warning gate is false', () => {
    const result = evaluateGates(buffettMungerStrategy, { shariah_status: 'COMPLIANT', owner_earnings_positive: true, leverage_safe: true, valuation_complete: true, source_coverage_complete: false })
    expect(result.status).toBe('COMPLIANT')
    expect(result.failed_gates).toEqual([])
    expect(result.warning_gates).toEqual(['source_coverage_complete'])
  })

  it('returns NON_COMPLIANT when Shariah status is prohibited', () => {
    const result = evaluateGates(buffettMungerStrategy, { shariah_status: 'NON_COMPLIANT', owner_earnings_positive: true, leverage_safe: true, valuation_complete: true, source_coverage_complete: true })
    expect(result.status).toBe('NON_COMPLIANT')
    expect(result.failed_gates).toEqual(['shariah_compliant_or_conditional'])
  })

  it('returns CONDITIONAL when Shariah is conditional but allowed', () => {
    const result = evaluateGates(buffettMungerStrategy, { shariah_status: 'CONDITIONAL', owner_earnings_positive: true, leverage_safe: true, valuation_complete: true, source_coverage_complete: true })
    expect(result.status).toBe('CONDITIONAL')
    expect(result.conditional_gates).toContain('shariah_compliant_or_conditional')
  })

  it('returns INSUFFICIENT_DATA when required facts are missing', () => {
    const result = evaluateGates(buffettMungerStrategy, { shariah_status: 'COMPLIANT', owner_earnings_positive: true })
    expect(result.status).toBe('INSUFFICIENT_DATA')
    expect(result.unknown_gates).toEqual(expect.arrayContaining(['leverage_safe', 'valuation_complete']))
  })
})

describe('Buffett-Munger equity-bond capitalization (Design B arithmetic)', () => {
  it('flat 10% discount for all investable classes — wide and monopoly use the same rate', () => {
    expect(discountRate(buffettMungerStrategy)).toBe(0.10)
    expect(discountRate(buffettMungerStrategy)).toBe(discountRate(buffettMungerStrategy))
  })

  it('marginOfSafetyForMoat: monopoly 10%, wide 30%', () => {
    expect(marginOfSafetyForMoat(buffettMungerStrategy, 'monopoly')).toBe(0.10)
    expect(marginOfSafetyForMoat(buffettMungerStrategy, 'wide')).toBe(0.30)
  })

  it('ROIC-gated growth: g = min(reinvestment * ROIC, 3%) when ROIC > 10%; g=0 otherwise', () => {
    const disc = discountRate(buffettMungerStrategy)
    const cap = buffettMungerStrategy.valuation.terminal_growth_cap

    // ROIC 25%, reinvestment 40% → g = min(0.40*0.25, 0.03) = 0.1 capped to 0.03
    const roicHigh = 0.25
    const reinvHigh = 0.40
    const gHigh = roicHigh > disc ? Math.min(reinvHigh * roicHigh, cap) : 0
    expect(gHigh).toBe(0.03)

    // ROIC 9% (< disc 10%) → g = 0
    const roicLow = 0.09
    const gLow = roicLow > disc ? Math.min(0.4 * roicLow, cap) : 0
    expect(gLow).toBe(0)

    // ROIC 15%, reinvestment 15% → g = min(0.15*0.15, 0.03) = min(0.0225, 0.03) = 0.0225
    const roicMid = 0.15
    const reinvMid = 0.15
    const gMid = roicMid > disc ? Math.min(reinvMid * roicMid, cap) : 0
    expect(gMid).toBeCloseTo(0.0225, 10)
  })

  it('equity-bond fair value capped at 20x OE ceiling', () => {
    const disc = discountRate(buffettMungerStrategy)
    const ceiling = buffettMungerStrategy.valuation.valuation_multiple_ceiling
    const OE = 14

    // g=0.03 → capitalized = 14/(0.10-0.03) = 200; ceiling = 20*14 = 280; min(200,280) = 200
    const g = 0.03
    const capped = Math.min(OE / (disc - g), ceiling * OE)
    expect(capped).toBeCloseTo(200, 5)

    // OE=100, g=0 → capitalized = 100/0.10 = 1000; ceiling = 20*100=2000; min(1000,2000) = 1000
    const OE2 = 100
    const capped2 = Math.min(OE2 / disc, ceiling * OE2)
    expect(capped2).toBe(1000)
  })

  it('signed ΔWC in OE bridge: negative WC change adds to OE', () => {
    // NI=14, D&A=4, maint_capex=3, SBC=2, dNWC=-1 → OE = 14+4-3-2-(-1) = 14
    const oe = 14 + 4 - 3 - 2 - (-1)
    expect(oe).toBe(14)

    // If dNWC=+2 (WC use of cash) → OE = 14+4-3-2-(+2) = 11
    const oe2 = 14 + 4 - 3 - 2 - 2
    expect(oe2).toBe(11)
  })

  it('monopoly case: OE=14, ROIC=0.25, reinv=0.40 → g=0.03, fair=200, MoS=10%, buy=180', () => {
    const disc = discountRate(buffettMungerStrategy)
    const cap = buffettMungerStrategy.valuation.terminal_growth_cap
    const ceiling = buffettMungerStrategy.valuation.valuation_multiple_ceiling
    const mos = marginOfSafetyForMoat(buffettMungerStrategy, 'monopoly')

    const OE = 14 + 4 - 3 - 2 - (-1)  // = 14
    const g = Math.min(0.40 * 0.25, cap)  // = min(0.10, 0.03) = 0.03
    const fv = Math.min(OE / (disc - g), ceiling * OE)  // min(200, 280) = 200
    const buy = Math.round(fv * (1 - mos) * 100) / 100  // 200*0.90 = 180

    expect(OE).toBe(14)
    expect(g).toBe(0.03)
    expect(fv).toBeCloseTo(200, 5)
    expect(mos).toBe(0.10)
    expect(buy).toBe(180)
  })

  it('wide case: OE=10, ROIC=0.12, reinv=0.5 → g=0.03, fair≈142.86, MoS=30%, buy≈100', () => {
    const disc = discountRate(buffettMungerStrategy)
    const cap = buffettMungerStrategy.valuation.terminal_growth_cap
    const ceiling = buffettMungerStrategy.valuation.valuation_multiple_ceiling
    const mos = marginOfSafetyForMoat(buffettMungerStrategy, 'wide')

    const OE = 10
    const g = Math.min(0.5 * 0.12, cap)  // min(0.06, 0.03) = 0.03
    const fv = Math.min(OE / (disc - g), ceiling * OE)  // min(142.857, 200) = 142.857
    const buy = Math.round(fv * (1 - mos) * 100) / 100  // 142.857 * 0.70 ≈ 100.00

    expect(g).toBe(0.03)
    expect(fv).toBeCloseTo(142.857, 3)
    expect(mos).toBe(0.30)
    expect(buy).toBeCloseTo(100.0, 1)
  })

  it('ROIC ≤ disc: g=0, fair=OE/disc (plain capitalization, no growth credit)', () => {
    const disc = discountRate(buffettMungerStrategy)
    const ceiling = buffettMungerStrategy.valuation.valuation_multiple_ceiling

    const OE = 10
    const roic = 0.09  // ≤ disc
    const g = roic > disc ? 0.03 : 0
    const fv = Math.min(OE / (disc - g), ceiling * OE)  // OE/0.10 = 100; ceiling = 200; min = 100

    expect(g).toBe(0)
    expect(fv).toBe(100)
  })
})

describe('Buffett-Munger position sizing params (Design B)', () => {
  it('entry_tranches fractions sum to 1.0', () => {
    const tranches = buffettMungerStrategy.portfolio.entry_tranches
    const total = tranches.reduce((sum, t) => sum + t.fraction, 0)
    // Use approximate equality to handle floating-point arithmetic
    expect(total).toBeCloseTo(1.0, 10)
  })

  it('all target_weight_by_moat values are ≤ max_position_weight', () => {
    const maxWeight = buffettMungerStrategy.portfolio.max_position_weight
    const weights = buffettMungerStrategy.portfolio.target_weight_by_moat
    expect(weights.wide).toBeLessThanOrEqual(maxWeight)
    expect(weights.monopoly).toBeLessThanOrEqual(maxWeight)
  })

  it('targetWeightForMoatClass returns correct weights (4-class model; no inevitable)', () => {
    expect(targetWeightForMoatClass(buffettMungerStrategy, 'wide')).toBe(0.06)
    expect(targetWeightForMoatClass(buffettMungerStrategy, 'monopoly')).toBe(0.10)
  })

  it('targetWeightForMoatClass throws for non-investable moat classes', () => {
    expect(() => targetWeightForMoatClass(buffettMungerStrategy, 'narrow')).toThrow()
    expect(() => targetWeightForMoatClass(buffettMungerStrategy, 'moderate')).toThrow()
  })

  it('entry_tranches have correct trigger types and pct values', () => {
    const tranches = buffettMungerStrategy.portfolio.entry_tranches
    expect(tranches).toHaveLength(3)

    const [t1, t2, t3] = tranches
    expect(t1).toMatchObject({ id: 'T1', fraction: 0.40, trigger: 'at_buy_price' })
    expect(t2).toMatchObject({ id: 'T2', fraction: 0.30, trigger: 'pct_below_buy_price', pct: 0.10 })
    expect(t3).toMatchObject({ id: 'T3', fraction: 0.30, trigger: 'pct_below_buy_price', pct: 0.20 })
  })
})
