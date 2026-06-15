import { describe, expect, it } from 'vitest'

import { computeDownsideFloor } from '../downsideFloor'
import type { AnnualFacts, Fundamentals } from '../secEdgar'
import { SIZING_PARAMS } from '@owlfolio/strategies/sizingParams'

/**
 * Fixture builder: a single-year fundamentals payload. Defaults carry POSITIVE net cash
 * (cash 600 − debt 100 = 500 net cash / 100 shares = 5.0/share) and positive equity.
 */
function makeFundamentals(overrides?: Partial<AnnualFacts>, omit?: (keyof AnnualFacts)[]): Fundamentals {
  const latest: AnnualFacts = {
    fiscal_year: 2024,
    currency: 'USD',
    diluted_shares_m: 100,
    total_debt_musd: 100,
    cash_and_securities_musd: 600,
    stockholders_equity_musd: 800,
    ...overrides,
  }
  for (const key of omit ?? []) delete latest[key]
  return {
    cik: '0000000001',
    entity_name: 'Test Co',
    currency: 'USD',
    latest_annual: latest,
    annual_series: [latest],
    filings: [],
  }
}

describe('computeDownsideFloor — net-cash basis', () => {
  it('positive net cash → floor = net_cash_per_share, basis net_cash, reliability sound at low level', () => {
    const result = computeDownsideFloor({ fundamentals: makeFundamentals(), permanent_loss_level: 'low' })
    expect(result.status).toBe('floor')
    if (result.status !== 'floor') return
    // (600 − 100) / 100 = 5.0
    expect(result.floor_per_share).toBeCloseTo(5.0, 6)
    expect(result.basis).toBe('net_cash')
    expect(result.reliability).toBe('sound')
  })

  it('medium permanent-loss level → reliability qualified (floor still net cash)', () => {
    const result = computeDownsideFloor({ fundamentals: makeFundamentals(), permanent_loss_level: 'medium' })
    expect(result.status).toBe('floor')
    if (result.status !== 'floor') return
    expect(result.basis).toBe('net_cash')
    expect(result.reliability).toBe('qualified')
  })
})

describe('computeDownsideFloor — stressed-book fallback', () => {
  it('net debt + positive equity → stressed_book basis with the config haircut', () => {
    // net debt: cash 100 − debt 400 = −300 (non-positive) ⇒ fall to stressed book.
    // stressed book = equity 800 × 0.5 / 100 shares = 4.0
    const fundamentals = makeFundamentals({ cash_and_securities_musd: 100, total_debt_musd: 400 })
    const result = computeDownsideFloor({ fundamentals, permanent_loss_level: 'low' })
    expect(result.status).toBe('floor')
    if (result.status !== 'floor') return
    expect(result.basis).toBe('stressed_book')
    expect(result.floor_per_share).toBeCloseTo(800 * SIZING_PARAMS.book_value_haircut / 100, 6)
    expect(result.reliability).toBe('sound')
  })

  it('haircut-config mutation (0.5 → 0.3) changes the stressed floor (acceptance #7 analogue)', () => {
    const fundamentals = makeFundamentals({ cash_and_securities_musd: 100, total_debt_musd: 400 })
    const mutated = { ...SIZING_PARAMS, book_value_haircut: 0.3 }
    const baseline = computeDownsideFloor({ fundamentals, permanent_loss_level: 'low' })
    const altered = computeDownsideFloor({ fundamentals, permanent_loss_level: 'low', params: mutated })
    expect(baseline.status).toBe('floor')
    expect(altered.status).toBe('floor')
    if (baseline.status !== 'floor' || altered.status !== 'floor') return
    expect(baseline.floor_per_share).toBeCloseTo(800 * 0.5 / 100, 6)
    expect(altered.floor_per_share).toBeCloseTo(800 * 0.3 / 100, 6)
    expect(altered.floor_per_share).not.toBeCloseTo(baseline.floor_per_share, 6)
  })
})

describe('computeDownsideFloor — fail-closed (the grounding test)', () => {
  it('missing cash_and_securities_musd (and no positive book to fall back on) → cannot_floor', () => {
    // Net cash is not computable without cash, and there is no positive equity to value a stressed book
    // against — so the floor truly is not computable (the grounding case: never substitute a guess).
    const fundamentals = makeFundamentals(undefined, ['cash_and_securities_musd', 'stockholders_equity_musd'])
    const result = computeDownsideFloor({ fundamentals, permanent_loss_level: 'low' })
    expect(result.status).toBe('cannot_floor')
  })

  it('missing diluted_shares_m → cannot_floor', () => {
    const fundamentals = makeFundamentals(undefined, ['diluted_shares_m'])
    const result = computeDownsideFloor({ fundamentals, permanent_loss_level: 'low' })
    expect(result.status).toBe('cannot_floor')
  })

  it('net debt + non-positive equity → cannot_floor (never substitutes a guess)', () => {
    const fundamentals = makeFundamentals({
      cash_and_securities_musd: 100,
      total_debt_musd: 400,
      stockholders_equity_musd: -50,
    })
    const result = computeDownsideFloor({ fundamentals, permanent_loss_level: 'low' })
    expect(result.status).toBe('cannot_floor')
  })
})

describe('computeDownsideFloor — the Horsehead paired real-trap fixture', () => {
  // A SUPERFICIALLY CLEAN balance sheet: positive net cash AND positive book. Arithmetic ALONE would
  // compute a healthy net-cash floor. But Horsehead-style real encumbrance (secured creditors ahead of
  // the apparent assets) is captured only by the grounded 4.2a permanent-loss LEVEL.
  const cleanSheet = makeFundamentals() // net cash 5.0/share, positive book

  it('clean balance sheet + permanent_loss_level high → cannot_floor (the level gate catches the trap)', () => {
    const result = computeDownsideFloor({ fundamentals: cleanSheet, permanent_loss_level: 'high' })
    expect(result.status).toBe('cannot_floor')
  })

  it('SAME clean balance sheet + permanent_loss_level low → sound net-cash floor', () => {
    const result = computeDownsideFloor({ fundamentals: cleanSheet, permanent_loss_level: 'low' })
    expect(result.status).toBe('floor')
    if (result.status !== 'floor') return
    expect(result.basis).toBe('net_cash')
    expect(result.floor_per_share).toBeCloseTo(5.0, 6)
    expect(result.reliability).toBe('sound')
  })
})
