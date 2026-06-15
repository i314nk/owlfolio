import { describe, expect, it } from 'vitest'

import { SELL_PARAMS } from '../sellParams'
import { computeHoldingAgeMonths, holdingMinimumHoldStatus } from '../minimumHold'

// ---------------------------------------------------------------------------
// Phase 6 S1 — the minimum-hold "clock". computeHoldingAgeMonths is the pure age arithmetic;
// holdingMinimumHoldStatus answers "is this name still inside the minimum-hold window?". FAIL-CLOSED:
// a name with no known open date is treated as still INSIDE the window so the guard stays active — it
// must NEVER default to "window passed".
// ---------------------------------------------------------------------------

describe('computeHoldingAgeMonths', () => {
  it('computes a whole-month span between two ISO timestamps', () => {
    // 2024-01-15 → 2026-01-15 is exactly 24 months.
    expect(computeHoldingAgeMonths('2024-01-15', '2026-01-15')).toBe(24)
  })

  it('computes a fractional month for a partial trailing month', () => {
    // 2024-01-01 → 2024-02-16 is 1 whole month + ~15 days into a ~29-day month ≈ 1.5 months.
    const age = computeHoldingAgeMonths('2024-01-01T00:00:00.000Z', '2024-02-16T00:00:00.000Z')
    expect(age).toBeGreaterThan(1.4)
    expect(age).toBeLessThan(1.6)
  })
})

describe('holdingMinimumHoldStatus', () => {
  it('reports within_window true just UNDER minimum_hold_months (30)', () => {
    // 29 months in → still inside the 30-month window.
    const status = holdingMinimumHoldStatus({ opened_at: '2024-01-15', now: '2026-06-15' })
    expect(status.age_months).not.toBeNull()
    expect(status.age_months as number).toBeLessThan(SELL_PARAMS.minimum_hold_months)
    expect(status.within_window).toBe(true)
  })

  it('reports within_window false just OVER minimum_hold_months (30)', () => {
    // 31 months in → past the 30-month window.
    const status = holdingMinimumHoldStatus({ opened_at: '2024-01-15', now: '2026-08-20' })
    expect(status.age_months as number).toBeGreaterThan(SELL_PARAMS.minimum_hold_months)
    expect(status.within_window).toBe(false)
  })

  it('FAIL-CLOSED: a missing opened_at → { age_months: null, within_window: true }', () => {
    expect(holdingMinimumHoldStatus({ opened_at: undefined, now: '2026-06-15' })).toEqual({
      age_months: null,
      within_window: true,
    })
  })

  it('honors a minimum_hold_months config override (boundary moves with params)', () => {
    // ~17 months in. With the default 30-month window it is inside; with a 12-month override it is past.
    const args = { opened_at: '2024-01-15', now: '2025-06-15' } as const
    expect(holdingMinimumHoldStatus({ ...args }).within_window).toBe(true)
    const override = { ...SELL_PARAMS, minimum_hold_months: 12 }
    expect(holdingMinimumHoldStatus({ ...args, params: override }).within_window).toBe(false)
  })
})
