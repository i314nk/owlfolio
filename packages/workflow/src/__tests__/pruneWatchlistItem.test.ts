import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectNameLifecycle } from '@owlfolio/ledger/projections/nameLifecycleProjection'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { pruneWatchlistItem } from '../watchlistWorkflow'

/**
 * Phase 6 S9 — the watched-name PRUNE. The softer EXIT mirror of the holding close (closeHolding, S7):
 * a HUMAN-authored-only command that removes a falsified watched name from the watchlist.
 */
function watchedChain(): LedgerEventEnvelope<unknown>[] {
  const base = {
    actor_type: 'user' as const,
    source_ids: [] as string[],
    schema_version: 1,
  }
  return [
    {
      ...base,
      event_id: 'evt_rc_created_rc_001',
      event_type: 'research_case_created',
      aggregate_type: 'research_case',
      aggregate_id: 'rc_001',
      payload: { ticker: 'WTCH', company_id: 'company_wtch' },
      created_at: '2026-06-01T00:00:00.000Z',
    },
    {
      ...base,
      event_id: 'evt_watch_created_watch_001',
      event_type: 'watchlist_draft_created',
      aggregate_type: 'watchlist_item',
      aggregate_id: 'watch_001',
      payload: { watchlist_item_id: 'watch_001', research_case_id: 'rc_001', ticker: 'WTCH' },
      created_at: '2026-06-01T01:00:00.000Z',
    },
    {
      ...base,
      event_id: 'evt_watch_confirmed_watch_001',
      event_type: 'watchlist_draft_confirmed',
      aggregate_type: 'watchlist_item',
      aggregate_id: 'watch_001',
      payload: { watchlist_item_id: 'watch_001', research_case_id: 'rc_001' },
      created_at: '2026-06-01T02:00:00.000Z',
    },
  ]
}

async function seedWatched(store: InMemoryEventStore): Promise<void> {
  for (const event of watchedChain()) {
    await store.append(event)
  }
}

const PRUNE = {
  watchlist_item_id: 'watch_001',
  ticker: 'WTCH',
  research_case_id: 'rc_001',
  reason: 'Shariah re-screen returned FAIL.',
  actor_id: 'user_001',
} as const

describe('pruneWatchlistItem (Phase 6 S9 — human-authored watched-name prune)', () => {
  it('emits a watchlist_item_pruned event with execution + user-authoring flags', async () => {
    const store = new InMemoryEventStore()
    await seedWatched(store)

    const pruned = await pruneWatchlistItem(store, {
      ...PRUNE,
      actor_type: 'user',
      pruned_at: '2026-06-06',
      message: 'falsifier tripped — removing from watchlist',
    })

    expect(pruned.event_type).toBe('watchlist_item_pruned')
    expect(pruned.aggregate_type).toBe('watchlist_item')
    expect(pruned.aggregate_id).toBe('watch_001')
    expect(pruned.actor_type).toBe('user')
    expect(pruned.correlation_id).toBe('rc_001')
    expect(pruned.payload.watchlist_item_id).toBe('watch_001')
    expect(pruned.payload.ticker).toBe('WTCH')
    expect(pruned.payload.research_case_id).toBe('rc_001')
    expect(pruned.payload.pruned_at).toBe('2026-06-06')
    expect(pruned.payload.reason).toBe('Shariah re-screen returned FAIL.')
    expect(pruned.payload.is_execution).toBe(true)
    expect(pruned.payload.requires_user_authoring).toBe(true)
    expect(pruned.payload.message).toBe('falsifier tripped — removing from watchlist')

    // Stable, deterministic event id keyed on the watchlist item (mirrors holding_closed).
    expect(pruned.event_id).toBe('evt_watchlist_item_pruned_watch_001')
  })

  it('defaults pruned_at to today when omitted', async () => {
    const store = new InMemoryEventStore()
    await seedWatched(store)
    const pruned = await pruneWatchlistItem(store, { ...PRUNE, actor_type: 'user' })
    expect(pruned.payload.pruned_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('REJECTS a worker-authored prune — the exit cannot be machine-authored', async () => {
    const store = new InMemoryEventStore()
    await seedWatched(store)
    await expect(
      pruneWatchlistItem(store, { ...PRUNE, actor_type: 'worker', actor_id: 'worker_001' }),
    ).rejects.toThrow(/human-authored|user/i)

    const events = await store.list()
    expect(events.filter((e) => e.event_type === 'watchlist_item_pruned')).toHaveLength(0)
  })

  it('REJECTS a provider-authored prune and appends no event', async () => {
    const store = new InMemoryEventStore()
    await seedWatched(store)
    await expect(
      pruneWatchlistItem(store, { ...PRUNE, actor_type: 'provider', actor_id: 'provider_001' }),
    ).rejects.toThrow(/human-authored|user/i)

    const events = await store.list()
    expect(events.filter((e) => e.event_type === 'watchlist_item_pruned')).toHaveLength(0)
  })

  it('folds the name lifecycle to exited/pruned after a watched name is pruned', async () => {
    const store = new InMemoryEventStore()
    await seedWatched(store)
    await pruneWatchlistItem(store, { ...PRUNE, actor_type: 'user', pruned_at: '2026-06-06' })

    const events = (await store.list()) as LedgerEventEnvelope<unknown>[]
    const rows = projectNameLifecycle(events)
    const wtch = rows.find((r) => r.ticker === 'WTCH')
    expect(wtch?.state).toBe('exited')
    expect(wtch?.exit_provenance).toBe('pruned')
  })
})
