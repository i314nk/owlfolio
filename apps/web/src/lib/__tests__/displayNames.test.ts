import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetDisplayNameCacheForTests, resolveDisplayNamesForTickers } from '../displayNames'
import { titleCaseEntityName } from '../entityName'

// The resolver is offline-test-gated on VITEST — clear the gate per test via the injected fetch by
// removing the env marker around each call.
function withoutVitestGate<T>(run: () => Promise<T>): Promise<T> {
  const prior = process.env['VITEST']
  delete process.env['VITEST']
  return run().finally(() => {
    if (prior !== undefined) process.env['VITEST'] = prior
  })
}

const SEC_BODY = {
  '0': { cik_str: 1403161, ticker: 'V', title: 'VISA INC.' },
  '1': { cik_str: 909832, ticker: 'COST', title: 'COSTCO WHOLESALE CORP /NEW' },
}

afterEach(() => {
  resetDisplayNameCacheForTests()
})

describe('resolveDisplayNamesForTickers (the legacy-case display backfill)', () => {
  it('maps tickers to registrant titles via the SEC map (one fetch, then cached)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(SEC_BODY), { status: 200 }))
    await withoutVitestGate(async () => {
      const names = await resolveDisplayNamesForTickers(['v', 'COST', 'UNKNOWN'], { fetchImpl: fetchImpl as never })
      expect(names.get('V')).toBe('VISA INC.')
      expect(names.get('COST')).toBe('COSTCO WHOLESALE CORP /NEW')
      expect(names.has('UNKNOWN')).toBe(false)
      // Second call rides the module cache — no second fetch.
      await resolveDisplayNamesForTickers(['V'], { fetchImpl: fetchImpl as never })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })
  })

  it('fails open: a dead SEC yields an empty map (and never throws)', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline') })
    await withoutVitestGate(async () => {
      const names = await resolveDisplayNamesForTickers(['V'], { fetchImpl: fetchImpl as never })
      expect(names.size).toBe(0)
    })
  })

  it('never touches the network under the offline test gate', async () => {
    const fetchImpl = vi.fn()
    // VITEST is set in this process — the gate must short-circuit before any fetch.
    const names = await resolveDisplayNamesForTickers(['V'], { fetchImpl: fetchImpl as never })
    expect(names.size).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('titleCaseEntityName', () => {
  it('treats & as a word boundary (S&P, not S&p)', () => {
    expect(titleCaseEntityName('S&P GLOBAL INC.')).toBe('S&P Global Inc.')
    expect(titleCaseEntityName('VISA INC.')).toBe('Visa Inc.')
  })
})
