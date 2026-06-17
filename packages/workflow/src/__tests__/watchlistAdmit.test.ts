import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectNameLifecycle } from '@owlfolio/ledger/projections/nameLifecycleProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import { CHECKLIST_PARAMS, listBusinessItems, type ChecklistAudit } from '@owlfolio/strategies/checklistParams'
import { createResearchCase, draftDecision } from '../researchWorkflow'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { confirmWatchlistDraft, type ConfirmWatchlistDraftCommand } from '../watchlistWorkflow'

const SIGNED_THESIS =
  'I am admitting COST: a durable, low-cost-moat retailer compounding membership economics; I will buy only at a deep dislocation.'

/** A complete audit: a non-empty finding for every business item + the cognitive acknowledgement. */
function completeChecklistAudit(): ChecklistAudit {
  const business_findings: Record<string, string> = {}
  for (const item of listBusinessItems()) {
    business_findings[item.id] = `Marshaled finding for ${item.id}: grounded and reviewed.`
  }
  return { version: CHECKLIST_PARAMS.version, business_findings, cognitive_acknowledged: true }
}

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
    // Sign-off-frozen REFERENCE fair value — distinct from the MoS-discounted locked_buy_below (742.5).
    frozen_reference_fair_value: 990,
    frozen_iv_valuation_version: VALUATION_PARAMS.version,
    signed_thesis: SIGNED_THESIS,
    signed_thesis_draft: SIGNED_THESIS,
    checklist_audit: completeChecklistAudit(),
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
    // The signed human thesis is distinct from the agent-drafted summary.
    expect(created.signed_thesis).toBe(SIGNED_THESIS)
    expect(created.thesis_summary).not.toBe(created.signed_thesis)
    // Human-authored, append-only, no auto-admit.
    expect(created.actor_type).toBe('user')
    expect(created.created_by_actor_type).toBe('user')

    const [item] = projectWatchlist(await store.list())
    expect(item?.locked_buy_below).toBe(742.5)
    expect(item?.buy_below_valuation_version).toBe(VALUATION_PARAMS.version)
    expect(item?.signed_thesis).toBe(SIGNED_THESIS)
  })

  it('freezes the REFERENCE fair value at sign-off, distinct from the discounted buy-below (scope-reframe)', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    const created = await confirmWatchlistDraft(store, admitCommand())

    // The frozen reference is the reference fair value (990), NOT the MoS-discounted buy-below (742.5).
    expect(created.frozen_reference_fair_value).toBe(990)
    expect(created.frozen_iv_valuation_version).toBe(VALUATION_PARAMS.version)
    expect(created.frozen_reference_fair_value).not.toBe(created.locked_buy_below)

    const [item] = projectWatchlist(await store.list())
    expect(item?.frozen_reference_fair_value).toBe(990)
    expect(item?.frozen_iv_valuation_version).toBe(VALUATION_PARAMS.version)
  })

  it('omits the frozen reference when none is available at sign-off (fail-closed, never the buy-below)', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    const created = await confirmWatchlistDraft(
      store,
      admitCommand({ frozen_reference_fair_value: undefined, frozen_iv_valuation_version: undefined }),
    )

    // No reference → frozen_reference_fair_value absent; never backfilled from the discounted buy-below.
    expect(created.frozen_reference_fair_value).toBeUndefined()
    const [item] = projectWatchlist(await store.list())
    expect(item?.frozen_reference_fair_value).toBeUndefined()
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

  it('blocks admit when the audit is incomplete (the integrity completion-block)', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    // Drop one business finding entirely (missing marshaled finding).
    const missingOne = completeChecklistAudit()
    delete missingOne.business_findings['moat_erosion']
    await expect(confirmWatchlistDraft(store, admitCommand({ checklist_audit: missingOne }))).rejects.toThrow(
      /complete audit; missing:.*moat_erosion/i,
    )

    // A whitespace-only finding does NOT count as marshaled.
    const emptyFinding = completeChecklistAudit()
    emptyFinding.business_findings['quality_of_earnings'] = '   '
    await expect(confirmWatchlistDraft(store, admitCommand({ checklist_audit: emptyFinding }))).rejects.toThrow(
      /missing:.*quality_of_earnings/i,
    )

    // The cognitive acknowledgement not given blocks admit.
    const noAck = completeChecklistAudit()
    noAck.cognitive_acknowledged = false
    await expect(confirmWatchlistDraft(store, admitCommand({ checklist_audit: noAck }))).rejects.toThrow(
      /complete audit; missing:.*cognitive_acknowledgement/i,
    )

    // None of the blocked attempts appended a draft.
    expect((await store.list()).some((event) => event.event_type === 'watchlist_draft_created')).toBe(false)
  })

  it('persists the harness audit on the signed artifact and projects it (auditable)', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    const audit = completeChecklistAudit()
    const created = await confirmWatchlistDraft(store, admitCommand({ checklist_audit: audit }))

    // Persisted verbatim on the created draft payload.
    expect(created.checklist_audit).toEqual(audit)
    expect(Object.keys(created.checklist_audit.business_findings)).toHaveLength(listBusinessItems().length)

    // Projected onto the watchlist item so a name's audit travels with its thesis.
    const [item] = projectWatchlist(await store.list())
    expect(item?.checklist_audit?.business_findings['moat_erosion']).toEqual(audit.business_findings['moat_erosion'])
    expect(item?.checklist_audit?.cognitive_acknowledged).toBe(true)
  })

  it('derives thesis_amended: false when the human affirms the agent draft verbatim', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    const draft = 'Agent draft: durable membership-economics compounder; admit at the frozen buy-below.'
    const created = await confirmWatchlistDraft(
      store,
      admitCommand({ signed_thesis: draft, signed_thesis_draft: draft }),
    )

    expect(created.thesis_amended).toBe(false)
    expect(created.signed_thesis).toBe(draft)
    expect(created.signed_thesis_draft).toBe(draft)

    const [item] = projectWatchlist(await store.list())
    expect(item?.thesis_amended).toBe(false)
    expect(item?.signed_thesis_draft).toBe(draft)
  })

  it('derives thesis_amended: true when the human amends the agent draft', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    const draftThesis = 'Agent draft: durable compounder; admit at the frozen buy-below.'
    const finalThesis = 'Human amend: durable compounder BUT I require a wider margin of safety before buying.'
    const created = await confirmWatchlistDraft(
      store,
      admitCommand({ signed_thesis: finalThesis, signed_thesis_draft: draftThesis }),
    )

    expect(created.thesis_amended).toBe(true)
    expect(created.signed_thesis).toBe(finalThesis)
    expect(created.signed_thesis_draft).toBe(draftThesis)

    const [item] = projectWatchlist(await store.list())
    expect(item?.thesis_amended).toBe(true)
    expect(item?.signed_thesis).toBe(finalThesis)
    expect(item?.signed_thesis_draft).toBe(draftThesis)
  })

  it('admits when every checklist item is addressed', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    const created = await confirmWatchlistDraft(store, admitCommand())
    expect(created.event_type).toBe('watchlist_draft_created')
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

    // Phase 8 S4: a single gated admit lands the watched name confirmed (no separate approve step).
    await confirmWatchlistDraft(store, admitCommand())

    const lifecycle = projectNameLifecycle(await store.list())
    const watched = lifecycle.find((row) => row.ticker === 'COST')
    expect(watched?.state).toBe('watched')
    // The buy-below is FROZEN at admit, so the watched row carries the locked value as its buy-below.
    expect(watched?.buy_price_per_share).toBe(742.5)
    expect(watched?.locked_buy_below).toBe(742.5)
    expect(watched?.buy_below_valuation_version).toBe(VALUATION_PARAMS.version)
  })
})

describe('consolidated single-step admission (Phase 8 S4)', () => {
  it('emits BOTH watchlist_draft_created AND watchlist_draft_confirmed atomically; the item lands user_approved:true', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    await confirmWatchlistDraft(store, admitCommand())

    const events = await store.list()
    const created = events.find((event) => event.event_type === 'watchlist_draft_created')
    const confirmed = events.find((event) => event.event_type === 'watchlist_draft_confirmed')
    expect(created).toBeDefined()
    expect(confirmed).toBeDefined()
    // Stable, deterministic event ids preserved (history-compat with the legacy two-step sequence).
    expect(created?.event_id).toBe('evt_watchlist_draft_created_watch_cost_admit_001')
    expect(confirmed?.event_id).toBe('evt_watchlist_draft_confirmed_watch_cost_admit_001')
    // The confirmed event is causally linked to the created draft, on the same research-case correlation.
    expect(confirmed?.causation_id).toBe('evt_watchlist_draft_created_watch_cost_admit_001')
    expect(confirmed?.correlation_id).toBe('rc_cost_admit_001')
    expect(confirmed?.actor_type).toBe('user')

    // The item lands immediately confirmed in one gated step.
    const [item] = projectWatchlist(events)
    expect(item?.user_approved).toBe(true)
    expect(item?.confirmed_by_actor_type).toBe('user')
  })

  it('STILL gates the single step on signed_thesis + the full checklist (Phase 4/7 gates preserved) — no confirmed event leaks on a blocked admit', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    // Empty signed thesis is rejected BEFORE any append (neither created nor confirmed leaks).
    await expect(confirmWatchlistDraft(store, admitCommand({ signed_thesis: '   ' }))).rejects.toThrow(/signed[_ ]thesis/i)
    // An incomplete audit is rejected before any append.
    const missingOne = completeChecklistAudit()
    delete missingOne.business_findings['moat_erosion']
    await expect(confirmWatchlistDraft(store, admitCommand({ checklist_audit: missingOne }))).rejects.toThrow(/missing/i)

    const events = await store.list()
    expect(events.some((event) => event.event_type === 'watchlist_draft_created')).toBe(false)
    expect(events.some((event) => event.event_type === 'watchlist_draft_confirmed')).toBe(false)
  })

  it('history-compat: a LEGACY two-event sequence (created user_approved:false THEN a separate confirmed) projects to the SAME confirmed end-state as the new atomic pair', async () => {
    // Build the legacy sequence by hand: created@T1 (user_approved:false), confirmed@T2 — the shape an
    // append-only ledger written before this consolidation still holds. It MUST replay identically. NOTE
    // the OLD payload carries `checklist_answers` (the pre-audit-and-decide field), NOT `checklist_audit`.
    const legacyStore = new InMemoryEventStore()
    const legacyChecklistAnswers: Record<string, { addressed: boolean; note: string }> = Object.fromEntries(
      CHECKLIST_PARAMS.items.map((item) => [item.id, { addressed: true, note: `Legacy answer ${item.id}.` }]),
    )
    const createdPayload = {
      watchlist_item_id: 'watch_cost_admit_001',
      research_case_id: 'rc_cost_admit_001',
      decision_id: 'decision_cost_admit_001',
      company_id: 'company_cost',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      strategy_version: '1',
      thesis_summary: 'Agent-drafted: durable quality compounder; wait for margin of safety.',
      locked_buy_below: 742.5,
      buy_below_valuation_version: VALUATION_PARAMS.version,
      frozen_iv: 990,
      frozen_iv_valuation_version: VALUATION_PARAMS.version,
      signed_thesis: SIGNED_THESIS,
      checklist_answers: legacyChecklistAnswers,
      user_approved: false,
      created_by_actor_type: 'user',
      created_by_actor_id: 'user_local',
    }
    await legacyStore.append({
      event_id: 'evt_watchlist_draft_created_watch_cost_admit_001',
      event_type: 'watchlist_draft_created',
      aggregate_type: 'watchlist_item',
      aggregate_id: 'watch_cost_admit_001',
      causation_id: 'decision_cost_admit_001',
      correlation_id: 'rc_cost_admit_001',
      actor_type: 'user',
      actor_id: 'user_local',
      payload: createdPayload,
      source_ids: [],
      created_at: '2026-01-01T00:00:00.000Z',
      schema_version: 1,
    } as LedgerEventEnvelope<unknown>)
    await legacyStore.append({
      event_id: 'evt_watchlist_draft_confirmed_watch_cost_admit_001',
      event_type: 'watchlist_draft_confirmed',
      aggregate_type: 'watchlist_item',
      aggregate_id: 'watch_cost_admit_001',
      causation_id: 'evt_watchlist_draft_created_watch_cost_admit_001',
      correlation_id: 'rc_cost_admit_001',
      actor_type: 'user',
      actor_id: 'user_local',
      payload: {
        watchlist_item_id: 'watch_cost_admit_001',
        research_case_id: 'rc_cost_admit_001',
        user_approved: true,
        confirmed_by_actor_type: 'user',
        confirmed_by_actor_id: 'user_local',
      },
      source_ids: [],
      created_at: '2026-01-02T00:00:00.000Z',
      schema_version: 1,
    } as LedgerEventEnvelope<unknown>)

    // The new atomic path.
    const newStore = new InMemoryEventStore()
    await seedCase(newStore)
    await confirmWatchlistDraft(newStore, admitCommand())

    const [legacyItem] = projectWatchlist(await legacyStore.list())
    const [newItem] = projectWatchlist(await newStore.list())

    // Same confirmed end-state: user_approved + the confirming-actor + every frozen field.
    expect(legacyItem?.user_approved).toBe(true)
    expect(newItem?.user_approved).toBe(true)
    expect(legacyItem?.confirmed_by_actor_type).toBe(newItem?.confirmed_by_actor_type)
    expect(legacyItem?.confirmed_by_actor_id).toBe(newItem?.confirmed_by_actor_id)
    expect(legacyItem?.locked_buy_below).toBe(newItem?.locked_buy_below)
    // LEGACY TOLERANCE: the old event's frozen_iv (990) maps onto the new frozen_reference_fair_value.
    expect(legacyItem?.frozen_reference_fair_value).toBe(newItem?.frozen_reference_fair_value)
    expect(legacyItem?.frozen_reference_fair_value).toBe(990)
    expect(legacyItem?.signed_thesis).toBe(newItem?.signed_thesis)

    // LEGACY TOLERANCE: the old event carried `checklist_answers` (no `checklist_audit`) — it must still
    // project without throwing, surfacing the legacy answers and leaving the new audit field undefined.
    expect(legacyItem?.checklist_answers?.['moat_erosion']).toEqual(legacyChecklistAnswers['moat_erosion'])
    expect(legacyItem?.checklist_audit).toBeUndefined()
    // The new atomic path carries the audit (no legacy answers).
    expect(newItem?.checklist_audit?.cognitive_acknowledged).toBe(true)
    expect(newItem?.checklist_answers).toBeUndefined()
  })
})
