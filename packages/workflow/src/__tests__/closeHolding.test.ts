import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectNameLifecycle } from '@owlfolio/ledger/projections/nameLifecycleProjection'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { closeHolding, openHoldingFromWatchlist } from '../holdingWorkflow'

const OPEN = {
  holding_id: 'holding_001',
  watchlist_item_id: 'watch_001',
  research_case_id: 'rc_001',
  company_id: 'co_001',
  ticker: 'ACME',
  strategy_id: 'buffett_munger',
  strategy_version: 'v1',
  thesis_summary: 'durable compounder',
  shares: 10,
  cost_basis_per_share: 100,
  currency: 'USD',
  causation_id: 'cause_001',
  actor_id: 'user_001',
} as const

describe('closeHolding (Phase 6 S7 — human-authored holding close)', () => {
  it('emits a holding_closed event with sold provenance, execution + user-authoring flags', async () => {
    const store = new InMemoryEventStore()
    await openHoldingFromWatchlist(store, OPEN)

    const closed = await closeHolding(store, {
      holding_id: 'holding_001',
      closed_at: '2026-06-02',
      exit_price_per_share: 150,
      reason_code: 'valuation_inverted',
      actor_type: 'user',
      actor_id: 'user_001',
      message: 'price reached frozen IV',
    })

    expect(closed.event_type).toBe('holding_closed')
    expect(closed.aggregate_type).toBe('holding')
    expect(closed.aggregate_id).toBe('holding_001')
    expect(closed.actor_type).toBe('user')
    expect(closed.payload.holding_id).toBe('holding_001')
    expect(closed.payload.closed_at).toBe('2026-06-02')
    expect(closed.payload.exit_price_per_share).toBe(150)
    expect(closed.payload.reason_code).toBe('valuation_inverted')
    expect(closed.payload.exit_provenance).toBe('sold')
    expect(closed.payload.is_execution).toBe(true)
    expect(closed.payload.requires_user_authoring).toBe(true)
    expect(closed.payload.message).toBe('price reached frozen IV')

    // Stable, deterministic event id keyed on the holding (mirrors holding_opened).
    expect(closed.event_id).toBe('evt_holding_closed_holding_001')
  })

  it('defaults closed_at to today when omitted', async () => {
    const store = new InMemoryEventStore()
    await openHoldingFromWatchlist(store, OPEN)
    const closed = await closeHolding(store, {
      holding_id: 'holding_001',
      exit_price_per_share: 120,
      reason_code: 'thesis_broken',
      actor_type: 'user',
      actor_id: 'user_001',
    })
    expect(closed.payload.closed_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('REJECTS a worker-authored close — the irreversible exit cannot be machine-authored', async () => {
    const store = new InMemoryEventStore()
    await openHoldingFromWatchlist(store, OPEN)
    await expect(
      closeHolding(store, {
        holding_id: 'holding_001',
        exit_price_per_share: 150,
        reason_code: 'valuation_inverted',
        actor_type: 'worker',
        actor_id: 'worker_001',
      }),
    ).rejects.toThrow(/human-authored|user/i)
  })

  it('REJECTS a provider-authored close', async () => {
    const store = new InMemoryEventStore()
    await openHoldingFromWatchlist(store, OPEN)
    await expect(
      closeHolding(store, {
        holding_id: 'holding_001',
        exit_price_per_share: 150,
        reason_code: 'valuation_inverted',
        actor_type: 'provider',
        actor_id: 'provider_001',
      }),
    ).rejects.toThrow(/human-authored|user/i)

    // The rejected close must NOT have appended any event.
    const events = await store.list()
    expect(events.filter((e) => e.event_type === 'holding_closed')).toHaveLength(0)
  })

  it('folds the name lifecycle to exited/sold after holding_opened then holding_closed', async () => {
    const store = new InMemoryEventStore()
    await openHoldingFromWatchlist(store, OPEN)
    await closeHolding(store, {
      holding_id: 'holding_001',
      closed_at: '2026-06-02',
      exit_price_per_share: 150,
      reason_code: 'valuation_inverted',
      actor_type: 'user',
      actor_id: 'user_001',
    })

    const events = (await store.list()) as LedgerEventEnvelope<unknown>[]
    const rows = projectNameLifecycle(events)
    const acme = rows.find((r) => r.ticker === 'ACME')
    expect(acme?.state).toBe('exited')
    expect(acme?.exit_provenance).toBe('sold')
  })
})
