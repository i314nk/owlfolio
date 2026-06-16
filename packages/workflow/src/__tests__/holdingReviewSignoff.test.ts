import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import { MockProvider } from '@owlfolio/providers/mockProvider'
import { CHECKLIST_PARAMS, listBusinessItems, type ChecklistAudit } from '@owlfolio/strategies/checklistParams'
import { openHoldingFromWatchlist, recordHoldingValuationSnapshot } from '../holdingWorkflow'
import { confirmHoldingReviewDraft, draftHoldingReview, overrideHoldingReviewDraft } from '../holdingReviewWorkflow'

const OVERRIDE_THESIS = {
  thesis_health: 'WATCH',
  action_stance: 'RESEARCH_MORE',
  rationale: 'User override: moat intact, valuation needs another evidence pass.',
  evidence_summary: 'Compared the provider draft to the manual valuation snapshot.',
  uncertainty: 'Need an updated Shariah ratio + concentration check.',
  next_review_at: '2026-10-31',
} as const

// Audit-and-decide: the re-underwrite sign-off (confirmHoldingReviewDraft → holding_review_confirmed) is
// completion-blocked on the harness-marshaled audit. These tests prove the integrity fix: a confirmation
// that previously validated NOTHING now validates that the audit is complete.
function completeChecklistAudit(): ChecklistAudit {
  const business_findings: Record<string, string> = {}
  for (const item of listBusinessItems()) {
    business_findings[item.id] = `Marshaled finding for ${item.id} at re-underwrite.`
  }
  return { version: CHECKLIST_PARAMS.version, business_findings, cognitive_acknowledged: true }
}

const COMPLETE_AUDIT: ChecklistAudit = completeChecklistAudit()

/** A complete audit missing one business finding (the named business item is unmarshaled). */
function withMissingFinding(itemId: string): ChecklistAudit {
  const audit = completeChecklistAudit()
  delete audit.business_findings[itemId]
  return audit
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
      checklist_audit: COMPLETE_AUDIT,
    })

    expect(confirmation.event_type).toBe('holding_review_confirmed')
    expect(confirmation.user_approved).toBe(true)
    // Persisted append-only on the re-underwrite artifact (auditable).
    expect(confirmation.payload.checklist_audit).toEqual(COMPLETE_AUDIT)
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
      checklist_audit: withMissingFinding('moat_erosion'),
    })).rejects.toThrow(/Re-underwrite sign-off requires a complete audit; missing: moat_erosion/)

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
      checklist_audit: { version: CHECKLIST_PARAMS.version, business_findings: {}, cognitive_acknowledged: false },
    })).rejects.toThrow(/Re-underwrite sign-off requires a complete audit/)
  })

  it('is completion-blocked when shariah_drift (item 10) is unaddressed — catches post-admission drift', async () => {
    const store = new InMemoryEventStore()
    const draft = await draftReview(store)

    await expect(confirmHoldingReviewDraft(store, {
      review_id: draft.review_id,
      holding_id: draft.holding_id,
      causation_id: draft.event_id,
      actor_id: 'user_local',
      checklist_audit: withMissingFinding('shariah_drift'),
    })).rejects.toThrow(/missing: shariah_drift/)
  })

  it('is completion-blocked when data_completeness (item 11) is unaddressed', async () => {
    const store = new InMemoryEventStore()
    const draft = await draftReview(store)

    await expect(confirmHoldingReviewDraft(store, {
      review_id: draft.review_id,
      holding_id: draft.holding_id,
      causation_id: draft.event_id,
      actor_id: 'user_local',
      checklist_audit: withMissingFinding('data_completeness'),
    })).rejects.toThrow(/missing: data_completeness/)
  })

  it('records the re-underwrite answers human-authored (actor user); nothing is defaulted server-side', async () => {
    const store = new InMemoryEventStore()
    const draft = await draftReview(store)

    const confirmation = await confirmHoldingReviewDraft(store, {
      review_id: draft.review_id,
      holding_id: draft.holding_id,
      causation_id: draft.event_id,
      actor_id: 'user_local',
      checklist_audit: COMPLETE_AUDIT,
    })

    expect(confirmation.actor_type).toBe('user')
    expect(confirmation.confirmed_by_actor_type).toBe('user')
  })
})

// Phase 7 S3 (bypass close): overrideHoldingReviewDraft → holding_review_overridden is a SEPARATE,
// co-equal re-underwrite sign-off that writes the SAME confirmed thesis state. It must be gated on the
// SAME 17-item checklist as confirm; otherwise it reopens the gap S3 closed.
describe('re-underwrite override sign-off checklist completion-block (Phase 7 S3 bypass close)', () => {
  it('overrides when every checklist item is addressed and persists the answers', async () => {
    const store = new InMemoryEventStore()
    const draft = await draftReview(store)

    const override = await overrideHoldingReviewDraft(store, {
      review_id: draft.review_id,
      holding_id: draft.holding_id,
      causation_id: draft.event_id,
      actor_id: 'user_local',
      ...OVERRIDE_THESIS,
      checklist_audit: COMPLETE_AUDIT,
    })

    expect(override.event_type).toBe('holding_review_overridden')
    expect(override.user_approved).toBe(true)
    expect(override.user_overrode_provider).toBe(true)
    // Persisted append-only on the override re-underwrite artifact (auditable).
    expect(override.payload.checklist_audit).toEqual(COMPLETE_AUDIT)
  })

  it('throws and appends NOTHING when an item is unaddressed (the integrity test)', async () => {
    const store = new InMemoryEventStore()
    const draft = await draftReview(store)
    const before = (await store.list()).length

    await expect(overrideHoldingReviewDraft(store, {
      review_id: draft.review_id,
      holding_id: draft.holding_id,
      causation_id: draft.event_id,
      actor_id: 'user_local',
      ...OVERRIDE_THESIS,
      checklist_audit: withMissingFinding('moat_erosion'),
    })).rejects.toThrow(/Re-underwrite sign-off requires a complete audit; missing: moat_erosion/)

    // No append on the failed sign-off — throw-before-append.
    expect((await store.list()).length).toBe(before)
    const holding = projectHoldings(await store.list()).find((h) => h.holding_id === draft.holding_id)
    expect(holding?.latest_review_id).toBeUndefined()
    // The draft remains pending — nothing was overridden.
    expect(holding?.pending_review_id).toBe(draft.review_id)
  })

  it('rejects an EMPTY checklist on the override path (the twin of overriding nothing)', async () => {
    const store = new InMemoryEventStore()
    const draft = await draftReview(store)

    await expect(overrideHoldingReviewDraft(store, {
      review_id: draft.review_id,
      holding_id: draft.holding_id,
      causation_id: draft.event_id,
      actor_id: 'user_local',
      ...OVERRIDE_THESIS,
      checklist_audit: { version: CHECKLIST_PARAMS.version, business_findings: {}, cognitive_acknowledged: false },
    })).rejects.toThrow(/Re-underwrite sign-off requires a complete audit/)
  })

  it('is completion-blocked when shariah_drift (item 10) is unaddressed on the override path', async () => {
    const store = new InMemoryEventStore()
    const draft = await draftReview(store)

    await expect(overrideHoldingReviewDraft(store, {
      review_id: draft.review_id,
      holding_id: draft.holding_id,
      causation_id: draft.event_id,
      actor_id: 'user_local',
      ...OVERRIDE_THESIS,
      checklist_audit: withMissingFinding('shariah_drift'),
    })).rejects.toThrow(/missing: shariah_drift/)
  })

  it('is completion-blocked when data_completeness (item 11) is unaddressed on the override path', async () => {
    const store = new InMemoryEventStore()
    const draft = await draftReview(store)

    await expect(overrideHoldingReviewDraft(store, {
      review_id: draft.review_id,
      holding_id: draft.holding_id,
      causation_id: draft.event_id,
      actor_id: 'user_local',
      ...OVERRIDE_THESIS,
      checklist_audit: withMissingFinding('data_completeness'),
    })).rejects.toThrow(/missing: data_completeness/)
  })

  it('records the override answers human-authored (actor user); nothing is defaulted server-side', async () => {
    const store = new InMemoryEventStore()
    const draft = await draftReview(store)

    const override = await overrideHoldingReviewDraft(store, {
      review_id: draft.review_id,
      holding_id: draft.holding_id,
      causation_id: draft.event_id,
      actor_id: 'user_local',
      ...OVERRIDE_THESIS,
      checklist_audit: COMPLETE_AUDIT,
    })

    expect(override.actor_type).toBe('user')
    expect(override.overridden_by_actor_type).toBe('user')
  })
})
