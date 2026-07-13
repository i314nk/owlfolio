import { describe, expect, it } from 'vitest'
import {
  computeConvictionFactor,
  type ConvictionInputs,
  type ConvictionResult,
} from '../convictionFactor'
import { SIZING_PARAMS, type SizingParams } from '../sizingParams'
import type { MoatClass } from '../strategyContract'

// Phase 5 S1 — conviction_factor × base_target_weight (no Kelly; discount-depth off by default).
// Island slice: pure, deterministic, no I/O, no probability/odds, NOT wired into computePositionPlan.

const okResult = (r: ConvictionResult): Extract<ConvictionResult, { status: 'ok' }> => {
  if (r.status !== 'ok') throw new Error(`expected ok, got cannot_size: ${r.reason}`)
  return r
}

describe('computeConvictionFactor — conviction_factor × base_target_weight', () => {
  describe('full conviction', () => {
    it('monopoly + low PLR + low uncertainty → factor 1.0 → target_weight 0.10', () => {
      const r = okResult(
        computeConvictionFactor({
          moat_class: 'monopoly',
          permanent_loss_level: 'low',
          uncertainty_level: 'low',
        }),
      )
      expect(r.factor).toBeCloseTo(1.0, 12)
      expect(r.target_weight).toBeCloseTo(0.10, 12)
      expect(r.components.moat_factor).toBeCloseTo(1.0, 12)
      expect(r.components.permanent_loss_subfactor).toBeCloseTo(1.0, 12)
      expect(r.components.uncertainty_subfactor).toBeCloseTo(1.0, 12)
      expect(r.components.loss_uncertainty_factor).toBeCloseTo(1.0, 12)
      // discount_depth_factor is OFF by default — not part of the product.
      expect(r.components.discount_depth_factor).toBeUndefined()
    })
  })

  describe('thinner conviction', () => {
    it('wide + medium PLR + high uncertainty → 0.85×0.7×0.9 = 0.5355 → target ≈ 0.05355', () => {
      const r = okResult(
        computeConvictionFactor({
          moat_class: 'wide',
          permanent_loss_level: 'medium',
          uncertainty_level: 'high',
        }),
      )
      expect(r.factor).toBeCloseTo(0.5355, 12)
      expect(r.target_weight).toBeCloseTo(0.053_55, 12)
      expect(r.target_weight).toBeLessThan(SIZING_PARAMS.base_target_weight)
    })
  })

  describe('no-up-scale property — target_weight ≤ base_target_weight ALWAYS', () => {
    it('holds over random valid inputs', () => {
      const moats: MoatClass[] = ['wide', 'monopoly']
      const levels: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high']
      const rand = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!
      for (let i = 0; i < 500; i += 1) {
        const r = computeConvictionFactor({
          moat_class: rand(moats),
          permanent_loss_level: rand(levels),
          uncertainty_level: rand(levels),
          // pass random prices too — must be ignored by default-off discount depth
          buy_price_per_share: Math.random() * 1000,
          current_price: Math.random() * 1000,
        })
        if (r.status === 'ok') {
          expect(r.factor).toBeGreaterThan(0)
          expect(r.factor).toBeLessThanOrEqual(1)
          expect(r.target_weight).toBeLessThanOrEqual(SIZING_PARAMS.base_target_weight)
        }
      }
    })
  })

  describe('cannot_size — fail-closed paths', () => {
    it('non-investable moat (moderate) → cannot_size', () => {
      const r = computeConvictionFactor({
        moat_class: 'moderate',
        permanent_loss_level: 'low',
        uncertainty_level: 'low',
      })
      expect(r.status).toBe('cannot_size')
      if (r.status === 'cannot_size') expect(r.reason).toMatch(/moat/i)
    })

    it('non-investable moat (narrow) → cannot_size', () => {
      const r = computeConvictionFactor({
        moat_class: 'narrow',
        permanent_loss_level: 'low',
        uncertainty_level: 'low',
      })
      expect(r.status).toBe('cannot_size')
    })

    it('high permanent-loss (should not reach sizing) → cannot_size', () => {
      const r = computeConvictionFactor({
        moat_class: 'monopoly',
        permanent_loss_level: 'high',
        uncertainty_level: 'low',
      })
      expect(r.status).toBe('cannot_size')
      if (r.status === 'cannot_size') expect(r.reason).toMatch(/permanent.loss/i)
    })
  })

  describe('discount-depth is OFF by default', () => {
    it('factor is independent of current_price/buy_price with the default config', () => {
      const base: ConvictionInputs = {
        moat_class: 'wide',
        permanent_loss_level: 'low',
        uncertainty_level: 'medium',
      }
      const cheap = okResult(
        computeConvictionFactor({ ...base, buy_price_per_share: 100, current_price: 40 }),
      )
      const expensive = okResult(
        computeConvictionFactor({ ...base, buy_price_per_share: 100, current_price: 99 }),
      )
      const noPrices = okResult(computeConvictionFactor(base))
      expect(cheap.factor).toBe(expensive.factor)
      expect(cheap.factor).toBe(noPrices.factor)
      expect(cheap.target_weight).toBe(noPrices.target_weight)
    })

    it('missing prices are fine when discount-depth is off (default)', () => {
      const r = computeConvictionFactor({
        moat_class: 'monopoly',
        permanent_loss_level: 'low',
        uncertainty_level: 'low',
      })
      expect(r.status).toBe('ok')
    })

    it('with discount-depth ENABLED + prices missing → cannot_size (fail-closed)', () => {
      const params: SizingParams = { ...SIZING_PARAMS, conviction_use_discount_depth: true }
      const r = computeConvictionFactor(
        { moat_class: 'monopoly', permanent_loss_level: 'low', uncertainty_level: 'low' },
        params,
      )
      expect(r.status).toBe('cannot_size')
      if (r.status === 'cannot_size') expect(r.reason).toMatch(/discount.depth|price/i)
    })

    it('with discount-depth ENABLED + non-finite price → cannot_size (fail-closed)', () => {
      const params: SizingParams = { ...SIZING_PARAMS, conviction_use_discount_depth: true }
      const r = computeConvictionFactor(
        {
          moat_class: 'monopoly',
          permanent_loss_level: 'low',
          uncertainty_level: 'low',
          buy_price_per_share: Number.NaN,
          current_price: 50,
        },
        params,
      )
      expect(r.status).toBe('cannot_size')
    })

    it('with discount-depth ENABLED + valid prices → factor scales DOWN by depth (≤ default)', () => {
      const params: SizingParams = { ...SIZING_PARAMS, conviction_use_discount_depth: true }
      const inputs: ConvictionInputs = {
        moat_class: 'monopoly',
        permanent_loss_level: 'low',
        uncertainty_level: 'low',
        buy_price_per_share: 100,
        current_price: 99, // shallow discount → near the floor, scales down
      }
      const enabled = okResult(computeConvictionFactor(inputs, params))
      const off = okResult(computeConvictionFactor(inputs))
      expect(enabled.factor).toBeLessThanOrEqual(off.factor)
      expect(enabled.components.discount_depth_factor).toBeDefined()
      expect(enabled.target_weight).toBeLessThanOrEqual(SIZING_PARAMS.base_target_weight)
    })
  })

  describe('reason — audit trail enumerates each component + the product', () => {
    it('mentions moat, permanent-loss, uncertainty, and the product', () => {
      const r = okResult(
        computeConvictionFactor({
          moat_class: 'wide',
          permanent_loss_level: 'medium',
          uncertainty_level: 'high',
        }),
      )
      expect(r.reason).toMatch(/moat/i)
      expect(r.reason).toMatch(/permanent.loss/i)
      expect(r.reason).toMatch(/uncertainty/i)
      expect(r.reason).toMatch(/0\.5355|product|factor/i)
    })
  })

  // No-Kelly structural invariant: the input type must carry NO probability/odds/edge field.
  // This is a compile-time + runtime structural assertion (like the no-state-arg detection test):
  // a forbidden key on ConvictionInputs is a TYPE ERROR, so a typed object literal proves absence.
  describe('no-Kelly structural invariant', () => {
    it('ConvictionInputs has no win_prob/odds/edge/probability field', () => {
      // If any forbidden key were added to ConvictionInputs, this typed literal would fail typecheck
      // because excess-property checking forbids unknown keys on a typed object literal.
      const inputs: ConvictionInputs = {
        moat_class: 'monopoly',
        permanent_loss_level: 'low',
        uncertainty_level: 'low',
      }
      const forbidden = ['win_prob', 'odds', 'edge', 'probability'] as const
      for (const key of forbidden) {
        expect(Object.prototype.hasOwnProperty.call(inputs, key)).toBe(false)
      }
      // Also assert the computed result carries no probability-shaped field.
      const r = okResult(computeConvictionFactor(inputs))
      for (const key of forbidden) {
        expect(Object.prototype.hasOwnProperty.call(r, key)).toBe(false)
        expect(Object.prototype.hasOwnProperty.call(r.components, key)).toBe(false)
      }
    })
  })

  describe('config-mutation (acceptance #7 analogue) — behaviour shifts with no code change', () => {
    it('base_target_weight 0.10 → 0.08 shifts every target', () => {
      const inputs: ConvictionInputs = {
        moat_class: 'monopoly',
        permanent_loss_level: 'low',
        uncertainty_level: 'low',
      }
      const atTen = okResult(computeConvictionFactor(inputs))
      const params: SizingParams = { ...SIZING_PARAMS, base_target_weight: 0.08 }
      const atEight = okResult(computeConvictionFactor(inputs, params))
      expect(atTen.target_weight).toBeCloseTo(0.10, 12)
      expect(atEight.target_weight).toBeCloseTo(0.08, 12)
      // factor unchanged — only the base weight moved.
      expect(atEight.factor).toBe(atTen.factor)
    })
  })
})

describe('SIZING_PARAMS — conviction additions + version pin', () => {
  it('is pinned to the conviction config version', () => {
    expect(SIZING_PARAMS.version).toBe('sizing-2026-07-rule8-truck-1')
    expect(SIZING_PARAMS.load_up_target_weight).toBe(0.15)
  })

  it('carries base_target_weight 0.10 and per_name_cap 0.15', () => {
    expect(SIZING_PARAMS.base_target_weight).toBe(0.10)
    expect(SIZING_PARAMS.per_name_cap).toBe(0.15)
  })

  it('carries the conviction sub-factor tables', () => {
    expect(SIZING_PARAMS.conviction_moat_factor).toEqual({ monopoly: 1.0, wide: 0.85 })
    expect(SIZING_PARAMS.conviction_permanent_loss_subfactor).toEqual({ low: 1.0, medium: 0.7 })
    expect(SIZING_PARAMS.conviction_uncertainty_subfactor).toEqual({ high: 0.9, default: 1.0 })
  })

  it('discount-depth is OFF by default', () => {
    expect(SIZING_PARAMS.conviction_use_discount_depth).toBe(false)
  })

  it('no longer carries the deprecated moat-tiered target_weight_by_moat (retired in Phase 5 S6 O-9)', () => {
    expect('target_weight_by_moat' in SIZING_PARAMS).toBe(false)
  })
})

// RULE 8 TEETH (owner-locked 2026-07-13, from the book verbatim: "Once you find a margin of safety,
// load up the truck" / "act boldly"): in the LOAD-UP zone the sizing BASE rises to the truck weight
// (the position cap) — the only place anything sizes UP. Conviction still scales DOWN from it.
describe('rule 8 — the load-up zone raises the sizing base to the truck weight', () => {
  it('in the load-up zone the base is load_up_target_weight; outside it the S1 base', () => {
    const inZone = computeConvictionFactor({ moat_class: 'wide', permanent_loss_level: 'low', uncertainty_level: 'low', in_load_up_zone: true })
    const outZone = computeConvictionFactor({ moat_class: 'wide', permanent_loss_level: 'low', uncertainty_level: 'low' })
    expect(inZone.status).toBe('ok')
    expect(outZone.status).toBe('ok')
    if (inZone.status === 'ok' && outZone.status === 'ok') {
      expect(inZone.target_weight).toBeGreaterThan(outZone.target_weight)
      expect(inZone.target_weight).toBeCloseTo(SIZING_PARAMS.load_up_target_weight * (outZone.target_weight / SIZING_PARAMS.base_target_weight), 6)
    }
  })
  it('conviction still scales DOWN from the truck base (anti-Kelly preserved)', () => {
    const risky = computeConvictionFactor({ moat_class: 'wide', permanent_loss_level: 'medium', uncertainty_level: 'high', in_load_up_zone: true })
    expect(risky.status).toBe('ok')
    if (risky.status === 'ok') expect(risky.target_weight).toBeLessThan(SIZING_PARAMS.load_up_target_weight)
  })
})
