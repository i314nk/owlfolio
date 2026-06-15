import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { ActorType, LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { resolveResearchStrategyRef } from './researchStrategyRef'

type WatchlistEventStore = EventStore<LedgerEventEnvelope<unknown>>

type WatchlistDraftCreatedPayload = {
  watchlist_item_id: string
  research_case_id: string
  decision_id: string
  company_id: string
  ticker: string
  strategy_id: string
  strategy_version: string
  thesis_summary: string
  /**
   * The Phase-1 valuation buy-below (`buy_price_per_share`) FROZEN at the moment of admit — a snapshot,
   * NOT a live reference. Once admitted, the watched name's buy-below is this value; a later valuation
   * change does not silently move it.
   */
  locked_buy_below: number
  /**
   * `VALUATION_PARAMS.version` at freeze time — the MoS/valuation provenance the locked buy-below was
   * frozen under. A FUTURE MoS freeze under a different version that changes the buy-below is therefore a
   * VISIBLE, logged RE-PRICE (F.9/F.10), never a silent invalidation of the locked thesis.
   */
  buy_below_valuation_version: string
  /**
   * True while the MoS is PROVISIONAL (#124) — so the UI shows the buy-below as provisional-MoS-derived.
   */
  buy_below_mos_provisional: boolean
  /**
   * The UNDISCOUNTED intrinsic value (fair value per share) FROZEN at sign-off (Phase 6 S3) — DISTINCT
   * from the MoS-discounted `locked_buy_below`. The "valuation-inverted" sell trigger compares the live
   * price against THIS frozen number, never the provisional buy-below and never a recomputed fair value.
   * Don't-move-the-number (F.9/F.10): the agent cannot nudge it; only a re-underwrite (which re-runs the
   * freeze) may change it. ABSENT when the case had no undiscounted IV at sign-off (fail-closed — it is
   * NEVER backfilled from the discounted buy-below; the trigger then returns cannot_assess).
   */
  frozen_iv?: number
  /** `VALUATION_PARAMS.version` the frozen undiscounted IV was frozen under (sign-off valuation provenance). */
  frozen_iv_valuation_version?: string
  /**
   * The human's plain-language thesis (doc Gate 0 `[Hu]`), distinct from the agent-drafted
   * `thesis_summary`. A signed thesis is the human's commitment; it is required + non-empty on admit.
   */
  signed_thesis: string
  user_approved: false
  created_by_actor_type: ActorType
  created_by_actor_id: string
}

export type WatchlistDraftCreated = LedgerEventEnvelope<WatchlistDraftCreatedPayload> & WatchlistDraftCreatedPayload

export type ConfirmWatchlistDraftCommand = {
  watchlist_item_id: string
  research_case_id: string
  decision_id: string
  company_id: string
  ticker: string
  strategy_id: string
  strategy_version?: string
  thesis_summary: string
  /** The Phase-1 valuation buy-below, FROZEN as a snapshot at admit (see payload doc). */
  locked_buy_below: number
  /** `VALUATION_PARAMS.version` at freeze time — the MoS/valuation provenance (see payload doc). */
  buy_below_valuation_version: string
  /** True while the MoS is provisional (#124). */
  buy_below_mos_provisional: boolean
  /**
   * The UNDISCOUNTED intrinsic value FROZEN at sign-off (Phase 6 S3; see payload doc). Distinct from the
   * discounted `locked_buy_below`. Omit/undefined when the case has no undiscounted IV — fail-closed, NEVER
   * the buy-below. Explicit `undefined` is accepted (the caller may pass the optional case value through).
   */
  frozen_iv?: number | undefined
  /** `VALUATION_PARAMS.version` the frozen undiscounted IV was frozen under (see payload doc). */
  frozen_iv_valuation_version?: string | undefined
  /** The human's required, non-empty signed thesis (Gate 0 `[Hu]`). */
  signed_thesis: string
  actor_id: string
  /**
   * Admit is a HUMAN-AUTHORED transition: defaults to `user`. A non-`user` actor (worker/provider/system)
   * cannot admit — there is no auto-admit.
   */
  actor_type?: ActorType
  idempotency_key?: string
}

type WatchlistDraftConfirmedPayload = {
  watchlist_item_id: string
  research_case_id: string
  user_approved: true
  confirmed_by_actor_type: ActorType
  confirmed_by_actor_id: string
}

export type WatchlistDraftConfirmed = LedgerEventEnvelope<WatchlistDraftConfirmedPayload> & WatchlistDraftConfirmedPayload

export type ApproveWatchlistDraftCommand = {
  watchlist_item_id: string
  research_case_id: string
  causation_id: string
  actor_id: string
  idempotency_key?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function mergeEventPayload<TPayload extends object>(
  event: LedgerEventEnvelope<TPayload>,
): LedgerEventEnvelope<TPayload> & TPayload {
  return { ...event, ...event.payload }
}

export async function confirmWatchlistDraft(
  store: WatchlistEventStore,
  command: ConfirmWatchlistDraftCommand,
): Promise<WatchlistDraftCreated> {
  // Admit is human-authored: no auto-admit by worker/provider/system.
  const actorType: ActorType = command.actor_type ?? 'user'
  if (actorType !== 'user') {
    throw new Error(
      `Watchlist admit must be human-authored (actor_type 'user'); received '${actorType}'. No auto-admit.`,
    )
  }
  // The signed thesis is the human's commitment — required, non-empty.
  if (command.signed_thesis.trim().length === 0) {
    throw new Error('Watchlist admit requires a non-empty signed_thesis (the human commitment).')
  }

  const selectedStrategy = resolveResearchStrategyRef(command)
  const payload: WatchlistDraftCreatedPayload = {
    watchlist_item_id: command.watchlist_item_id,
    research_case_id: command.research_case_id,
    decision_id: command.decision_id,
    company_id: command.company_id,
    ticker: command.ticker,
    ...selectedStrategy,
    thesis_summary: command.thesis_summary,
    // Frozen at admit: buy-below snapshot + the MoS/valuation provenance it was frozen under.
    locked_buy_below: command.locked_buy_below,
    buy_below_valuation_version: command.buy_below_valuation_version,
    buy_below_mos_provisional: command.buy_below_mos_provisional,
    // Frozen at sign-off (Phase 6 S3): the UNDISCOUNTED IV + its valuation provenance. Conditionally
    // included so a case with no undiscounted IV freezes it as ABSENT (fail-closed) — never as the
    // discounted buy-below.
    ...(command.frozen_iv === undefined ? {} : { frozen_iv: command.frozen_iv }),
    ...(command.frozen_iv_valuation_version === undefined
      ? {}
      : { frozen_iv_valuation_version: command.frozen_iv_valuation_version }),
    signed_thesis: command.signed_thesis,
    user_approved: false,
    created_by_actor_type: 'user',
    created_by_actor_id: command.actor_id,
  }

  const event: LedgerEventEnvelope<WatchlistDraftCreatedPayload> = {
    event_id: `evt_watchlist_draft_created_${command.watchlist_item_id}`,
    event_type: 'watchlist_draft_created',
    aggregate_type: 'watchlist_item',
    aggregate_id: command.watchlist_item_id,
    causation_id: command.decision_id,
    correlation_id: command.research_case_id,
    actor_type: 'user',
    actor_id: command.actor_id,
    payload,
    source_ids: [],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)

  return mergeEventPayload(storedEvent as LedgerEventEnvelope<WatchlistDraftCreatedPayload>)
}

export async function approveWatchlistDraft(
  store: WatchlistEventStore,
  command: ApproveWatchlistDraftCommand,
): Promise<WatchlistDraftConfirmed> {
  const payload: WatchlistDraftConfirmedPayload = {
    watchlist_item_id: command.watchlist_item_id,
    research_case_id: command.research_case_id,
    user_approved: true,
    confirmed_by_actor_type: 'user',
    confirmed_by_actor_id: command.actor_id,
  }

  const event: LedgerEventEnvelope<WatchlistDraftConfirmedPayload> = {
    event_id: `evt_watchlist_draft_confirmed_${command.watchlist_item_id}`,
    event_type: 'watchlist_draft_confirmed',
    aggregate_type: 'watchlist_item',
    aggregate_id: command.watchlist_item_id,
    causation_id: command.causation_id,
    correlation_id: command.research_case_id,
    actor_type: 'user',
    actor_id: command.actor_id,
    payload,
    source_ids: [],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)

  return mergeEventPayload(storedEvent as LedgerEventEnvelope<WatchlistDraftConfirmedPayload>)
}
