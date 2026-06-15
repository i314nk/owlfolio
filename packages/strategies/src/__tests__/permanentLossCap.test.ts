import { describe, expect, it } from 'vitest'
import { evaluatePermanentLossCap } from '../permanentLossCap'
import { SIZING_PARAMS } from '../sizingParams'

// Phase 5 S3 — permanent-loss CAP, on the CONCRETE floor (a number), not a quality re-judgment.

describe('evaluatePermanentLossCap', () => {
  it('floor well below entry → small downside → not binding (full proposed size allowed)', () => {
    // entry 100, floor 90 → realistic downside 10/share. proposed $1,000 → 10 shares → $100 loss at floor.
    // book_nav 100_000 → impairment 0.001 ≪ 0.05 → not binding.
    const result = evaluatePermanentLossCap({
      entry_price_per_share: 100,
      downside_floor: { floor_per_share: 90 },
      book_nav: 100_000,
      proposed_value: 1_000,
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.binding).toBe(false)
    expect(result.book_impairment_fraction).toBeCloseTo(0.001, 6)
    expect(result.max_sizeable_value).toBe(1_000)
  })

  it('thin floor (large gap entry→floor) → binds; max_sizeable < proposed; reason names the floor', () => {
    // entry 100, floor 10 → realistic downside 90/share. proposed $10,000 → 100 shares → $9,000 loss.
    // book_nav 100_000 → impairment 0.09 > 0.05 → binds.
    // max sizeable: loss ≤ 0.05 × 100_000 = 5_000; downside-per-$invested = 90/100 = 0.9;
    //   max_value = 5_000 / 0.9 = 5_555.56 < 10_000.
    const result = evaluatePermanentLossCap({
      entry_price_per_share: 100,
      downside_floor: { floor_per_share: 10 },
      book_nav: 100_000,
      proposed_value: 10_000,
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.binding).toBe(true)
    expect(result.book_impairment_fraction).toBeCloseTo(0.09, 6)
    expect(result.max_sizeable_value).toBeLessThan(10_000)
    expect(result.max_sizeable_value).toBeCloseTo(5_555.5556, 3)
    // the reason NAMES the floor (a number) and the impairment.
    expect(result.reason).toContain('10') // floor per share
    expect(result.reason.toLowerCase()).toContain('floor')
  })

  it('cannot_floor input → cannot_size (fail-closed; never sized on a quality-only guess)', () => {
    const result = evaluatePermanentLossCap({
      entry_price_per_share: 100,
      downside_floor: { cannot_floor: true },
      book_nav: 100_000,
      proposed_value: 1_000,
    })
    expect(result.status).toBe('cannot_size')
  })

  it('Horsehead-style: an S2 level-gated cannot_floor → cannot_size (ties to S2)', () => {
    // S2 returns cannot_floor when permanent_loss_level is HIGH (encumbered balance sheet). The cap
    // must NOT substitute a quality guess; it fails closed.
    const result = evaluatePermanentLossCap({
      entry_price_per_share: 50,
      downside_floor: { cannot_floor: true },
      book_nav: 200_000,
      proposed_value: 5_000,
    })
    expect(result.status).toBe('cannot_size')
    if (result.status !== 'cannot_size') return
    expect(result.reason.toLowerCase()).toContain('floor')
  })

  it('reads NO quality/moat field — the cap binds on the floor number only (structural)', () => {
    // STRUCTURAL GUARD: the cap binds on the floor (a number), never on a quality re-judgment. Injecting
    // extra "quality"/moat/uncertainty fields at the call site must NOT change the result — the function
    // reads only entry/floor/book_nav/proposed_value. (A re-judgment field would smuggle quality back in.)
    const base = {
      entry_price_per_share: 100,
      downside_floor: { floor_per_share: 10 } as const,
      book_nav: 100_000,
      proposed_value: 10_000,
    }
    const withJunk = { ...base, moat_class: 'monopoly', uncertainty_level: 'low', conviction: 0.9 }
    expect(evaluatePermanentLossCap(base)).toEqual(evaluatePermanentLossCap(withJunk))
  })

  it('realistic downside is deterministic max(entry − floor, 0): floor above entry → zero downside, never binds', () => {
    const result = evaluatePermanentLossCap({
      entry_price_per_share: 100,
      downside_floor: { floor_per_share: 120 }, // floor above entry
      book_nav: 10_000,
      proposed_value: 5_000,
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.binding).toBe(false)
    expect(result.book_impairment_fraction).toBe(0)
    expect(result.max_sizeable_value).toBe(5_000)
  })

  it('book_recovery_threshold mutation changes the binding point (config-driven, no code change)', () => {
    const args = {
      entry_price_per_share: 100,
      downside_floor: { floor_per_share: 90 } as const,
      book_nav: 100_000,
      proposed_value: 10_000, // 100 shares × $10 downside = $1,000 loss → impairment 0.01.
    }
    // Default threshold 0.05 → 0.01 ≤ 0.05 → not binding.
    const loose = evaluatePermanentLossCap(args)
    expect(loose.status).toBe('ok')
    if (loose.status === 'ok') expect(loose.binding).toBe(false)

    // Tighten to 0.005 → 0.01 > 0.005 → binds.
    const tight = evaluatePermanentLossCap({
      ...args,
      params: { ...SIZING_PARAMS, book_recovery_threshold: 0.005 },
    })
    expect(tight.status).toBe('ok')
    if (tight.status === 'ok') {
      expect(tight.binding).toBe(true)
      expect(tight.max_sizeable_value).toBeLessThan(10_000)
    }
  })

  it('fail-closed on non-finite / non-positive entry price → cannot_size', () => {
    const result = evaluatePermanentLossCap({
      entry_price_per_share: 0,
      downside_floor: { floor_per_share: 10 },
      book_nav: 100_000,
      proposed_value: 1_000,
    })
    expect(result.status).toBe('cannot_size')
  })

  it('fail-closed on non-positive book_nav → cannot_size', () => {
    const result = evaluatePermanentLossCap({
      entry_price_per_share: 100,
      downside_floor: { floor_per_share: 10 },
      book_nav: 0,
      proposed_value: 1_000,
    })
    expect(result.status).toBe('cannot_size')
  })
})
