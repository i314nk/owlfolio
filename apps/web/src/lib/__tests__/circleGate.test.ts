import { describe, expect, it, vi } from 'vitest'

import { defaultCircleOfCompetenceConfig } from '@owlfolio/shared'
import type { Fundamentals } from '@owlfolio/workflow/secEdgar'
import type { PriceQuote } from '@owlfolio/workflow/marketData'

import { evaluateCircleGate } from '../circleGate'

function fundamentals(overrides: Partial<Fundamentals> = {}): Fundamentals {
  return {
    cik: '0000789019',
    entity_name: 'MICROSOFT CORP',
    currency: 'USD',
    latest_annual: { fiscal_year: 2024, currency: 'USD', diluted_shares_m: 7_500 },
    annual_series: [{ fiscal_year: 2024, currency: 'USD', diluted_shares_m: 7_500 }],
    filings: [],
    ...overrides,
  }
}

describe('evaluateCircleGate', () => {
  it('skips entirely (allowed, no fetch) when the circle config is the permissive default (disabled)', async () => {
    const fetchFundamentals = vi.fn()
    const resolvePrice = vi.fn()

    const result = await evaluateCircleGate(defaultCircleOfCompetenceConfig(), 'MSFT', {
      fetchFundamentals,
      resolvePrice,
    })

    expect(result).toEqual({ allowed: true })
    expect(fetchFundamentals).not.toHaveBeenCalled()
    expect(resolvePrice).not.toHaveBeenCalled()
  })

  it('admits an in-circle candidate (enabled allowed-prefix matched)', async () => {
    const fetchFundamentals = vi.fn().mockResolvedValue(fundamentals({ sic: '7372', latest_annual: { fiscal_year: 2024, currency: 'USD', diluted_shares_m: 7_500 } }))
    const resolvePrice = vi.fn().mockResolvedValue({ available: true, price_per_share: 400, currency: 'USD', as_of: '2026-06-01', source: 'yahoo' } satisfies PriceQuote)

    const result = await evaluateCircleGate(
      { enabled: true, allowed_sic_prefixes: ['73'] },
      'MSFT',
      { fetchFundamentals, resolvePrice },
    )

    expect(result).toEqual({ allowed: true })
    expect(fetchFundamentals).toHaveBeenCalledWith('MSFT')
  })

  it('rejects an out-of-circle candidate, returning the rule reason', async () => {
    const fetchFundamentals = vi.fn().mockResolvedValue(fundamentals({ sic: '6022' }))
    const resolvePrice = vi.fn().mockResolvedValue({ available: true, price_per_share: 50, currency: 'USD', as_of: '2026-06-01', source: 'yahoo' } satisfies PriceQuote)

    const result = await evaluateCircleGate(
      { enabled: true, allowed_sic_prefixes: ['73'] },
      'BANK',
      { fetchFundamentals, resolvePrice },
    )

    expect(result.allowed).toBe(false)
    if (result.allowed === false) {
      expect(result.reason).toMatch(/allow/i)
      expect(result.reason).toContain('6022')
    }
  })

  it('rejects (fail-closed) when SIC cannot be fetched under an enabled allowed-prefix restriction', async () => {
    const fetchFundamentals = vi.fn().mockResolvedValue(undefined)
    const resolvePrice = vi.fn().mockResolvedValue({ available: false, reason: 'no price', source: 'yahoo' } satisfies PriceQuote)

    const result = await evaluateCircleGate(
      { enabled: true, allowed_sic_prefixes: ['73'] },
      'MSFT',
      { fetchFundamentals, resolvePrice },
    )

    expect(result.allowed).toBe(false)
    if (result.allowed === false) {
      expect(result.reason).toMatch(/sic/i)
    }
  })

  it('computes market cap from price x diluted shares for a cap-bound rejection', async () => {
    // 400 x 7500m shares = 3,000,000 musd, above a 50,000 musd ceiling.
    const fetchFundamentals = vi.fn().mockResolvedValue(fundamentals({ sic: '7372' }))
    const resolvePrice = vi.fn().mockResolvedValue({ available: true, price_per_share: 400, currency: 'USD', as_of: '2026-06-01', source: 'yahoo' } satisfies PriceQuote)

    const result = await evaluateCircleGate(
      { enabled: true, max_market_cap_musd: 50_000 },
      'MSFT',
      { fetchFundamentals, resolvePrice },
    )

    expect(result.allowed).toBe(false)
    if (result.allowed === false) {
      expect(result.reason).toMatch(/max/i)
    }
  })

  it('rejects (fail-closed) when market cap cannot be computed under a set bound (price unavailable)', async () => {
    const fetchFundamentals = vi.fn().mockResolvedValue(fundamentals({ sic: '7372' }))
    const resolvePrice = vi.fn().mockResolvedValue({ available: false, reason: 'no price', source: 'yahoo' } satisfies PriceQuote)

    const result = await evaluateCircleGate(
      { enabled: true, min_market_cap_musd: 500 },
      'MSFT',
      { fetchFundamentals, resolvePrice },
    )

    expect(result.allowed).toBe(false)
    if (result.allowed === false) {
      expect(result.reason).toMatch(/market.?cap/i)
    }
  })
})
