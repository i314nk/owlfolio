import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectNameLifecycle } from '@owlfolio/ledger/projections/nameLifecycleProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import { CHECKLIST_PARAMS } from '@owlfolio/strategies/checklistParams'
import type { ChecklistAnswer } from '@owlfolio/strategies/checklist'
import { createResearchCase, draftDecision } from '../researchWorkflow'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { confirmWatchlistDraft, type ConfirmWatchlistDraftCommand } from '../watchlistWorkflow'

const SIGNED_THESIS =
  'I am admitting COST: a durable, low-cost-moat retailer compounding membership economics; I will buy only at a deep dislocation.'

/** A fully-addressed answer set: every checklist item affirmed with a non-empty reasoned note. */
function completeChecklistAnswers(): Record<string, ChecklistAnswer> {
  const answers: Record<string, ChecklistAnswer> = {}
  for (const item of CHECKLIST_PARAMS.items) {
    answers[item.id] = { addressed: true, note: `Addressed ${item.id}: considered and reasoned.` }
  }
  return answers
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
    buy_below_mos_provisional: true,
    // Sign-off-frozen UNDISCOUNTED IV — distinct from the MoS-discounted locked_buy_below (742.5).
    frozen_iv: 990,
    frozen_iv_valuation_version: VALUATION_PARAMS.version,
    signed_thesis: SIGNED_THESIS,
    checklist_answers: completeChecklistAnswers(),
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

  it('blocks admit when any hygiene/bias checklist item is unaddressed (the integrity completion-block)', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    // Drop one cognitive item entirely (missing answer).
    const missingOne = completeChecklistAnswers()
    delete missingOne['anchoring']
    await expect(confirmWatchlistDraft(store, admitCommand({ checklist_answers: missingOne }))).rejects.toThrow(
      /checklist item to be addressed; unaddressed:.*anchoring/i,
    )

    // An affirmed item with an empty note does NOT count as addressed.
    const emptyNote = completeChecklistAnswers()
    emptyNote['disposition'] = { addressed: true, note: '   ' }
    await expect(confirmWatchlistDraft(store, admitCommand({ checklist_answers: emptyNote }))).rejects.toThrow(
      /unaddressed:.*disposition/i,
    )

    // No empty answer set at all.
    await expect(confirmWatchlistDraft(store, admitCommand({ checklist_answers: {} }))).rejects.toThrow(
      /checklist item to be addressed/i,
    )

    // None of the blocked attempts appended a draft.
    expect((await store.list()).some((event) => event.event_type === 'watchlist_draft_created')).toBe(false)
  })

  it('persists the human checklist answers on the signed artifact and projects them (auditable)', async () => {
    const store = new InMemoryEventStore()
    await seedCase(store)

    const answers = completeChecklistAnswers()
    const created = await confirmWatchlistDraft(store, admitCommand({ checklist_answers: answers }))

    // Persisted verbatim on the created draft payload.
    expect(created.checklist_answers['anchoring']).toEqual(answers['anchoring'])
    expect(Object.keys(created.checklist_answers)).toHaveLength(CHECKLIST_PARAMS.items.length)

    // Projected onto the watchlist item so a name's checklist answers travel with its thesis.
    const [item] = projectWatchlist(await store.list())
    expect(item?.checklist_answers?.['moat_erosion']).toEqual(answers['moat_erosion'])
    expect(Object.keys(item?.checklist_answers ?? {})).toHaveLength(CHECKLIST_PARAMS.items.length)
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
    expect(watched?.buy_below_mos_provisional).toBe(true)
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
    // An unaddressed checklist item is rejected before any append.
    const missingOne = completeChecklistAnswers()
    delete missingOne['anchoring']
    await expect(confirmWatchlistDraft(store, admitCommand({ checklist_answers: missingOne }))).rejects.toThrow(/unaddressed/i)

    const events = await store.list()
    expect(events.some((event) => event.event_type === 'watchlist_draft_created')).toBe(false)
    expect(events.some((event) => event.event_type === 'watchlist_draft_confirmed')).toBe(false)
  })

  it('history-compat: a LEGACY two-event sequence (created user_approved:false THEN a separate confirmed) projects to the SAME confirmed end-state as the new atomic pair', async () => {
    // Build the legacy sequence by hand: created@T1 (user_approved:false), confirmed@T2 — the shape an
    // append-only ledger written before this consolidation still holds. It MUST replay identically.
    const legacyStore = new InMemoryEventStore()
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
      buy_below_mos_provisional: true,
      frozen_iv: 990,
      frozen_iv_valuation_version: VALUATION_PARAMS.version,
      signed_thesis: SIGNED_THESIS,
      checklist_answers: completeChecklistAnswers(),
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
    expect(legacyItem?.frozen_iv).toBe(newItem?.frozen_iv)
    expect(legacyItem?.signed_thesis).toBe(newItem?.signed_thesis)
  })
})
