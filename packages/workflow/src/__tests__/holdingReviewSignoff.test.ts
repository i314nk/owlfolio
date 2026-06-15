import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import { MockProvider } from '@owlfolio/providers/mockProvider'
import { CHECKLIST_PARAMS } from '@owlfolio/strategies/checklistParams'
import { openHoldingFromWatchlist, recordHoldingValuationSnapshot } from '../holdingWorkflow'
import { confirmHoldingReviewDraft, draftHoldingReview } from '../holdingReviewWorkflow'

// Phase 7 S3: the re-underwrite sign-off (confirmHoldingReviewDraft → holding_review_confirmed) is
// completion-blocked on the SAME 17-item hygiene/bias checklist. These tests prove the integrity fix:
// a confirmation that previously validated NOTHING now validates that the checklist is addressed.
const COMPLETE_CHECKLIST: Record<string, { addressed: boolean; note: string }> = Object.fromEntries(
  CHECKLIST_PARAMS.items.map((item) => [item.id, { addressed: true, note: `Addressed ${item.id} at re-underwrite.` }]),
)

function withUnaddressed(itemId: string): Record<string, { addressed: boolean; note: string }> {
  return { ...COMPLETE_CHECKLIST, [itemId]: { addressed: false, note: '' } }
}

async function openCostHolding(store: InMemoryEventStore) {
  return await openHoldingFromWatchlist(store, {
    holding_id: 'holding_cost_001',
    watchlist_item_id: 'watch_cost_001',
    research_case_id: 'rc_cost_001',
    company_id: 'company_cost',
    ticker: 'COST',
    strategy_id: 'buffett-munger',
    thesis_summary: 'Durable quality compounder.',
    shares: 3,
    cost_basis_per_share: 800,
    opened_at: '2026-05-31',
    currency: 'USD',
    causation_id: 'evt_watchlist_confirmed',
    actor_id: 'user_local',
  })
}

async function draftReview(store: InMemoryEventStore) {
  const provider = new MockProvider()
  const holding = await openCostHolding(store)
  await recordHoldingValuationSnapshot(store, {
    snapshot_id: 'valuation_holding_cost_001_2026_06_01',
    holding_id: holding.holding_id,
    price_per_share: 900,
    currency: 'USD',
    valued_at: '2026-06-01',
    causation_id: holding.event_id,
    actor_id: 'user_local',
  })
  return await draftHoldingReview(store, provider, {
    review_id: 'review_holding_cost_001_2026_06_30',
    holding_id: holding.holding_id,
    model_id: 'mock-buffett-munger-demo',
    causation_id: holding.event_id,
  })
}

describe('re-underwrite sign-off checklist completion-block (Phase 7 S3)', () => {
  it('confirms when every checklist item is addressed and persists the answers', async () => {
    const store = new InMemoryEventStore()
    const draft = await draftReview(store)

    const confirmation = await confirmHoldingReviewDraft(store, {
      review_id: draft.review_id,
      holding_id: draft.holding_id,
      causation_id: draft.event_id,
      actor_id: 'user_local',
      checklist_answers: COMPLETE_CHECKLIST,
    })

    expect(confirmation.event_type).toBe('holding_review_confirmed')
    expect(confirmation.user_approved).toBe(true)
    // Persisted append-only on the re-underwrite artifact (auditable).
    expect(confirmation.payload.checklist_answers).toEqual(COMPLETE_CHECKLIST)
  })

  it('throws and appends NOTHING when an item is unaddressed (the integrity test)', async () => {
    const store = new InMemoryEventStore()
    const draft = await draftReview(store)
    const before = (await store.list()).length

    await expect(confirmHoldingReviewDraft(store, {
      review_id: draft.review_id,
      holding_id: draft.holding_id,
      causation_id: draft.event_id,
      actor_id: 'user_local',
      checklist_answers: withUnaddressed('moat_erosion'),
    })).rejects.toThrow(/Re-underwrite sign-off requires every quality\/bias checklist item to be addressed; unaddressed: moat_erosion/)

    // No append on the failed sign-off — throw-before-append.
    expect((await store.list()).length).toBe(before)
    const holding = projectHoldings(await store.list()).find((h) => h.holding_id === draft.holding_id)
    expect(holding?.latest_review_id).toBeUndefined()
    // The draft remains pending — nothing was confirmed.
    expect(holding?.pending_review_id).toBe(draft.review_id)
  })

  it('rejects an EMPTY checklist (the re-underwrite twin of confirming nothing)', async () => {
    const store = new InMemoryEventStore()
    const draft = await draftReview(store)

    await expect(confirmHoldingReviewDraft(store, {
      review_id: draft.review_id,
      holding_id: draft.holding_id,
      causation_id: draft.event_id,
      actor_id: 'user_local',
      checklist_answers: {},
    })).rejects.toThrow(/Re-underwrite sign-off requires every quality\/bias checklist item to be addressed/)
  })

  it('is completion-blocked when shariah_drift (item 10) is unaddressed — catches post-admission drift', async () => {
    const store = new InMemoryEventStore()
    const draft = await draftReview(store)

    await expect(confirmHoldingReviewDraft(store, {
      review_id: draft.review_id,
      holding_id: draft.holding_id,
      causation_id: draft.event_id,
      actor_id: 'user_local',
      checklist_answers: withUnaddressed('shariah_drift'),
    })).rejects.toThrow(/unaddressed: shariah_drift/)
  })

  it('is completion-blocked when data_completeness (item 11) is unaddressed', async () => {
    const store = new InMemoryEventStore()
    const draft = await draftReview(store)

    await expect(confirmHoldingReviewDraft(store, {
      review_id: draft.review_id,
      holding_id: draft.holding_id,
      causation_id: draft.event_id,
      actor_id: 'user_local',
      checklist_answers: withUnaddressed('data_completeness'),
    })).rejects.toThrow(/unaddressed: data_completeness/)
  })

  it('records the re-underwrite answers human-authored (actor user); nothing is defaulted server-side', async () => {
    const store = new InMemoryEventStore()
    const draft = await draftReview(store)

    const confirmation = await confirmHoldingReviewDraft(store, {
      review_id: draft.review_id,
      holding_id: draft.holding_id,
      causation_id: draft.event_id,
      actor_id: 'user_local',
      checklist_answers: COMPLETE_CHECKLIST,
    })

    expect(confirmation.actor_type).toBe('user')
    expect(confirmation.confirmed_by_actor_type).toBe('user')
  })
})
