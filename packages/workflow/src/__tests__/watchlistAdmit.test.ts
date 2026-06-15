import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectNameLifecycle } from '@owlfolio/ledger/projections/nameLifecycleProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import { createResearchCase, draftDecision } from '../researchWorkflow'
import { approveWatchlistDraft, confirmWatchlistDraft, type ConfirmWatchlistDraftCommand } from '../watchlistWorkflow'

const SIGNED_THESIS =
  'I am admitting COST: a durable, low-cost-moat retailer compounding membership economics; I will buy only at a deep dislocation.'

function admitCommand(overrides: Partial<ConfirmWatchlistDraftCommand> = {}): ConfirmWatchlistDraftCommand {
  return {
    watchlist_item_id: 'watch_cost_admit_001',
    research_case_id: 'rc_cost_admit_001',
    decision_id: 'decision_cost_admit_001',
    company_id: 'company_cost',
    ticker: 'COST',
    strategy_id: 'buffett-munger',
    thesis_summary: 'Agent-drafted: durable quality compounder; wait for margin of safety.',
    locked_buy_below: 742.5,
    buy_below_valuation_version: VALUATION_PARAMS.version,
    buy_below_mos_provisional: true,
    // Sign-off-frozen UNDISCOUNTED IV — distinct from the MoS-discounted locked_buy_below (742.5).
    frozen_iv: 990,
    frozen_iv_valuation_version: VALUATION_PARAMS.version,
    signed_thesis: SIGNED_THESIS,
    actor_id: 'user_local',
    ...overrides,
  }
}

async function seedCase(store: InMemoryEventStore): Promise<void> {
  await createResearchCase(store, {
    research_case_id: 'rc_cost_admit_001',
    company_id: 'company_cost',
    ticker: 'COST',
    strategy_id: 'buffett-munger',
    actor_id: 'user_local',
  })
  await draftDecision(store, {
    research_case_id: 'rc_cost_admit_001',
    decision_id: 'decision_cost_admit_001',
    decision: 'WATCH',
    reason: 'Watch until margin of safety improves.',
    causation_id: 'rc_cost_admit_001',
  })
}

describe('admit candidate → watched (Task 4.2b)', () => {
  it('freezes the locked buy-below, MoS/valuation provenance, and a signed human thesis on admit', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    const created = await confirmWatchlistDraft(store, admitCommand())

    // The buy-below is FROZEN as a snapshot, with the valuation/MoS provenance it was frozen under.
    expect(created.locked_buy_below).toBe(742.5)
    expect(created.buy_below_valuation_version).toBe(VALUATION_PARAMS.version)
    expect(created.buy_below_mos_provisional).toBe(true)
    // The signed human thesis is distinct from the agent-drafted summary.
    expect(created.signed_thesis).toBe(SIGNED_THESIS)
    expect(created.thesis_summary).not.toBe(created.signed_thesis)
    // Human-authored, append-only, no auto-admit.
    expect(created.actor_type).toBe('user')
    expect(created.created_by_actor_type).toBe('user')

    const [item] = projectWatchlist(await store.list())
    expect(item?.locked_buy_below).toBe(742.5)
    expect(item?.buy_below_valuation_version).toBe(VALUATION_PARAMS.version)
    expect(item?.buy_below_mos_provisional).toBe(true)
    expect(item?.signed_thesis).toBe(SIGNED_THESIS)
  })

  it('freezes the UNDISCOUNTED IV at sign-off, distinct from the discounted buy-below (Phase 6 S3)', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    const created = await confirmWatchlistDraft(store, admitCommand())

    // The frozen IV is the undiscounted intrinsic value (990), NOT the MoS-discounted buy-below (742.5).
    expect(created.frozen_iv).toBe(990)
    expect(created.frozen_iv_valuation_version).toBe(VALUATION_PARAMS.version)
    expect(created.frozen_iv).not.toBe(created.locked_buy_below)

    const [item] = projectWatchlist(await store.list())
    expect(item?.frozen_iv).toBe(990)
    expect(item?.frozen_iv_valuation_version).toBe(VALUATION_PARAMS.version)
  })

  it('omits frozen_iv when no undiscounted IV is available at sign-off (fail-closed, never the buy-below)', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    const created = await confirmWatchlistDraft(
      store,
      admitCommand({ frozen_iv: undefined, frozen_iv_valuation_version: undefined }),
    )

    // No undiscounted IV → frozen_iv absent; it must NEVER be backfilled from the discounted buy-below.
    expect(created.frozen_iv).toBeUndefined()
    const [item] = projectWatchlist(await store.list())
    expect(item?.frozen_iv).toBeUndefined()
    expect(item?.frozen_iv_valuation_version).toBeUndefined()
    // The discounted buy-below still freezes normally.
    expect(item?.locked_buy_below).toBe(742.5)
  })

  it('rejects an admit with an empty or whitespace-only signed thesis (human commitment is mandatory)', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    await expect(confirmWatchlistDraft(store, admitCommand({ signed_thesis: '' }))).rejects.toThrow(/signed[_ ]thesis/i)
    await expect(confirmWatchlistDraft(store, admitCommand({ signed_thesis: '   ' }))).rejects.toThrow(/signed[_ ]thesis/i)
  })

  it('rejects an admit authored by a non-user actor (no auto-admit by worker/provider)', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    await expect(
      confirmWatchlistDraft(store, admitCommand({ actor_type: 'worker' })),
    ).rejects.toThrow(/auto-admit|user/i)
    await expect(
      confirmWatchlistDraft(store, admitCommand({ actor_type: 'provider' })),
    ).rejects.toThrow(/auto-admit|user/i)
  })

  it('surfaces the locked buy-below (frozen at admit) as buy_price_per_share on the watched name', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    await confirmWatchlistDraft(store, admitCommand())
    await approveWatchlistDraft(store, {
      watchlist_item_id: 'watch_cost_admit_001',
      research_case_id: 'rc_cost_admit_001',
      causation_id: 'evt_watchlist_draft_created_watch_cost_admit_001',
      actor_id: 'user_local',
    })

    const lifecycle = projectNameLifecycle(await store.list())
    const watched = lifecycle.find((row) => row.ticker === 'COST')
    expect(watched?.state).toBe('watched')
    // The buy-below is FROZEN at admit, so the watched row carries the locked value as its buy-below.
    expect(watched?.buy_price_per_share).toBe(742.5)
    expect(watched?.locked_buy_below).toBe(742.5)
    expect(watched?.buy_below_valuation_version).toBe(VALUATION_PARAMS.version)
    expect(watched?.buy_below_mos_provisional).toBe(true)
  })
})
