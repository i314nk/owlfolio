import { describe, expect, it, vi } from 'vitest'

import { resolveResearchTicker } from '../tickerValidation'

// TICKER VALIDATION (owner, 2026-07-19): validate a user-typed ticker against SEC's filer list
// (resolveCik / company_tickers.json) BEFORE any spend — the same universe the whole pipeline
// grounds in, so "no CIK" means "this app cannot research it", not merely "possibly mistyped".

describe('resolveResearchTicker', () => {
  it('a known SEC filer resolves ok, uppercased', async () => {
    const resolveCik = vi.fn(async (t: string) => (t === 'KO' ? '0000021344' : undefined))
    const result = await resolveResearchTicker('ko', { resolveCik })
    expect(result).toEqual({ status: 'ok', ticker: 'KO' })
  })

  it('normalizes the human dot form to EDGAR’s hyphen form (BRK.B → BRK-B)', async () => {
    const resolveCik = vi.fn(async (t: string) => (t === 'BRK-B' ? '0001067983' : undefined))
    const result = await resolveResearchTicker('brk.b', { resolveCik })
    expect(result).toEqual({ status: 'ok', ticker: 'BRK-B' })
    // The exact form is tried first, the hyphen variant second.
    expect(resolveCik.mock.calls.map((c) => c[0])).toEqual(['BRK.B', 'BRK-B'])
  })

  it('an unknown ticker is a hard no — the pipeline cannot ground a non-filer', async () => {
    const resolveCik = vi.fn(async () => undefined)
    const result = await resolveResearchTicker('COSTT', { resolveCik })
    expect(result.status).toBe('unknown')
  })

  it('FAIL-OPEN on lookup failure: an SEC outage must not block research (the run itself still fails closed)', async () => {
    const resolveCik = vi.fn(async () => { throw new Error('fetch failed') })
    const result = await resolveResearchTicker('KO', { resolveCik })
    expect(result).toEqual({ status: 'unverified', ticker: 'KO' })
  })
})
