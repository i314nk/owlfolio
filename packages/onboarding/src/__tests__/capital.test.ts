import { describe, expect, it } from 'vitest'

import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectInvestableCapital } from '@owlfolio/ledger/projections/investableCapitalProjection'

import { recordInvestableCapitalEvent } from '../capital'

describe('recordInvestableCapitalEvent', () => {
  it('round-trips amount/currency/as_of through projectInvestableCapital (currency normalized)', async () => {
    const store = new InMemoryEventStore()
    await recordInvestableCapitalEvent(store, { amount: 25_000, currency: 'usd', as_of: '2026-06-27T00:00:00.000Z' })

    const snapshot = projectInvestableCapital(await store.list())
    expect(snapshot).toEqual({ amount: 25_000, currency: 'USD', as_of: '2026-06-27T00:00:00.000Z' })
  })

  it('defaults currency to USD and stamps an ISO as_of when omitted', async () => {
    const store = new InMemoryEventStore()
    await recordInvestableCapitalEvent(store, { amount: 100 })

    const snapshot = projectInvestableCapital(await store.list())
    expect(snapshot?.amount).toBe(100)
    expect(snapshot?.currency).toBe('USD')
    expect(snapshot?.as_of).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('rejects non-positive amounts (no event appended)', async () => {
    const store = new InMemoryEventStore()
    await expect(recordInvestableCapitalEvent(store, { amount: 0 })).rejects.toThrow(/greater than zero/)
    await expect(recordInvestableCapitalEvent(store, { amount: -5 })).rejects.toThrow(/greater than zero/)
    expect(await store.list()).toHaveLength(0)
  })
})
