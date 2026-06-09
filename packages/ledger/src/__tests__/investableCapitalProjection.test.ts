import { describe, expect, it } from 'vitest'
import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectInvestableCapital } from '../projections/investableCapitalProjection'

function makeEvent(overrides: Partial<LedgerEventEnvelope<unknown>> & { payload: unknown }): LedgerEventEnvelope<unknown> {
  return {
    event_id: 'evt_test',
    event_type: 'investable_capital_set',
    aggregate_type: 'portfolio',
    aggregate_id: 'portfolio_default',
    actor_type: 'user',
    source_ids: [],
    created_at: '2026-01-01T00:00:00.000Z',
    schema_version: 1,
    ...overrides,
  }
}

describe('projectInvestableCapital', () => {
  it('returns undefined when there are no events', () => {
    expect(projectInvestableCapital([])).toBeUndefined()
  })

  it('returns undefined when no investable_capital_set events exist', () => {
    const event = makeEvent({
      event_type: 'cash_deposited',
      aggregate_type: 'cash_account',
      payload: { amount: 5000, currency: 'USD', as_of: '2026-01-01' },
    })
    expect(projectInvestableCapital([event])).toBeUndefined()
  })

  it('returns the snapshot from a single investable_capital_set event', () => {
    const event = makeEvent({
      payload: { amount: 100000, currency: 'USD', as_of: '2026-01-15' },
    })
    expect(projectInvestableCapital([event])).toEqual({
      amount: 100000,
      currency: 'USD',
      as_of: '2026-01-15',
    })
  })

  it('returns the latest event when multiple investable_capital_set events exist', () => {
    const older = makeEvent({
      event_id: 'evt_older',
      created_at: '2026-01-01T00:00:00.000Z',
      payload: { amount: 50000, currency: 'USD', as_of: '2026-01-01' },
    })
    const newer = makeEvent({
      event_id: 'evt_newer',
      created_at: '2026-06-01T00:00:00.000Z',
      payload: { amount: 120000, currency: 'USD', as_of: '2026-06-01' },
    })
    // Order should not matter — latest created_at wins
    expect(projectInvestableCapital([older, newer])).toEqual({
      amount: 120000,
      currency: 'USD',
      as_of: '2026-06-01',
    })
    expect(projectInvestableCapital([newer, older])).toEqual({
      amount: 120000,
      currency: 'USD',
      as_of: '2026-06-01',
    })
  })

  it('ignores events with missing or invalid payload fields', () => {
    const badAmount = makeEvent({
      event_id: 'evt_bad_amount',
      created_at: '2026-06-05T00:00:00.000Z',
      payload: { amount: -1000, currency: 'USD', as_of: '2026-06-05' },
    })
    const missingCurrency = makeEvent({
      event_id: 'evt_no_currency',
      created_at: '2026-06-06T00:00:00.000Z',
      payload: { amount: 5000, as_of: '2026-06-06' },
    })
    const good = makeEvent({
      event_id: 'evt_good',
      created_at: '2026-01-01T00:00:00.000Z',
      payload: { amount: 75000, currency: 'GBP', as_of: '2026-01-01' },
    })
    // Only the good event has valid payload — bad ones are skipped
    expect(projectInvestableCapital([badAmount, missingCurrency, good])).toEqual({
      amount: 75000,
      currency: 'GBP',
      as_of: '2026-01-01',
    })
  })
})
