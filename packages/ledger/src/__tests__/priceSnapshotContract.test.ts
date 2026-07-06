import { describe, expect, it } from 'vitest'
import { domainEventTypes, domainEventContracts } from '../domainEventContracts'

describe('price_snapshot_recorded contract', () => {
  it('is a registered domain event type', () => {
    expect(domainEventTypes).toContain('price_snapshot_recorded')
  })
  it('has a contract with the price-snapshot payload fields', () => {
    const c = domainEventContracts.find((e) => e.event_type === 'price_snapshot_recorded')
    expect(c).toBeDefined()
    expect(c?.aggregate_type).toBe('portfolio')
    expect(c?.payload_fields).toEqual(
      expect.arrayContaining(['snapshot_id', 'ticker', 'price_per_share', 'currency', 'as_of', 'source', 'checked_at']),
    )
  })
})
