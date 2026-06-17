import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { ActorType, LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { buffettMungerStrategy, discountRate, twoStageValuation } from '@owlfolio/strategies/buffettMunger'
import { evaluateChecklistCompletion } from '@owlfolio/strategies/checklist'
import type { ChecklistAudit } from '@owlfolio/strategies/checklistParams'
import { VALUATION_PARAMS } from '@owlfolio/strategies/valuationParams'
import { resolveResearchStrategyRef } from './researchStrategyRef'

/**
 * Derive the frozen REFERENCE fair value at sign-off (scope-reframe — the band/gap engine was removed). It
 * is the forward two-stage fair value off the frozen oe_ps + the sign-off ASSUMED GROWTH + the frozen
 * valuation params — a REFERENCE FV, NOT a band. The lightened valuation-inverted SELL is a price-vs-this-
 * reference sanity flag, and the anchoring bias guard (sellBiasGuards) — which reasons in PRICE units —
 * reads it as the price anchor. Returns undefined when the oe_ps / assumed growth are absent or the forward
 * value is not finite (the absurd-error guard fired) — fail-closed, never a fabricated reference.
 */
export function deriveFrozenReferenceFairValue(args: {
  frozen_oe_ps: number | undefined
  assumed_growth: number | undefined
}): number | undefined {
  const { frozen_oe_ps, assumed_growth } = args
  if (
    frozen_oe_ps === undefined
    || !Number.isFinite(frozen_oe_ps)
    || frozen_oe_ps <= 0
    || assumed_growth === undefined
    || !Number.isFinite(assumed_growth)
  ) {
    return undefined
  }
  const fair_value = twoStageValuation({
    oe_ps: frozen_oe_ps,
    g: assumed_growth,
    terminal_g: VALUATION_PARAMS.terminal_growth,
    discount: discountRate(buffettMungerStrategy),
    ceiling_multiple: VALUATION_PARAMS.fv_cap_multiple,
    absurd_multiple: VALUATION_PARAMS.fv_absurd_multiple,
    horizon: VALUATION_PARAMS.stage1_horizon,
    fade_years: VALUATION_PARAMS.growth_fade_years,
  }).fair_value
  return fair_value !== undefined && Number.isFinite(fair_value) ? fair_value : undefined
}

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
   * The SIGN-OFF-FROZEN normalized owner-earnings/share (scope-reframe). Frozen from the research case's
   * `valuation.normalized_owner_earnings_per_share` at admit. Pairs with `frozen_reference_fair_value`; the
   * lightened valuation-inverted SELL flag and the freeze fail closed together when it is ABSENT.
   */
  frozen_oe_ps?: number
  /**
   * The SIGN-OFF-FROZEN REFERENCE fair value per share (scope-reframe — the band/gap engine was removed).
   * The forward two-stage fair value off `frozen_oe_ps` + the sign-off assumed growth + the frozen valuation
   * params. The lightened "valuation-inverted" SELL is a LIGHT price-vs-this-reference sanity flag (advisory;
   * the human decides), and the anchoring bias guard (which reasons in PRICE units) reads it as the price
   * anchor. Don't-move-the-number (F.9/F.10): only a re-underwrite re-runs the freeze. ABSENT when the
   * oe_ps / assumed growth were absent at sign-off (fail-closed → sell cannot_assess; never backfilled from
   * the discounted buy-below). Legacy events carry the old `frozen_iv`, which the projection maps onto this.
   */
  frozen_reference_fair_value?: number
  /**
   * `VALUATION_PARAMS.version` the frozen oe_ps + reference were frozen under — the sign-off valuation
   * provenance (pins the discount/terminal/horizon/fade the reference was computed under).
   */
  frozen_iv_valuation_version?: string
  /**
   * The human's plain-language thesis (doc Gate 0 `[Hu]`), distinct from the agent-drafted
   * `thesis_summary`. A signed thesis is the human's FINAL commitment; it is required + non-empty on
   * admit. In the audit-and-decide model the human starts from `signed_thesis_draft` (the agent-drafted
   * thesis) and either AFFIRMS it verbatim or AMENDS it — either way THIS is the persisted final.
   */
  signed_thesis: string
  /**
   * The agent-drafted thesis the human reviewed before signing (the audit-and-decide draft). Captured so
   * the affirm-vs-amend provenance (`thesis_amended`) is auditable: the human's final `signed_thesis` is
   * compared against THIS draft. Distinct from `thesis_summary` (the watchlist summary reference).
   */
  signed_thesis_draft: string
  /**
   * Whether the human AMENDED the agent-drafted thesis: `signed_thesis.trim() !== signed_thesis_draft.trim()`.
   * Derived at sign-off, persisted append-only so the affirm (false) vs. amend (true) decision is auditable.
   */
  thesis_amended: boolean
  /**
   * The harness-marshaled audit captured at sign-off (audit-and-decide model): one business finding per
   * business item + the human's single cognitive acknowledgement. Admission is COMPLETION-BLOCKED: every
   * business item must carry a non-empty finding AND `cognitive_acknowledged === true` before this event is
   * appended (see confirmWatchlistDraft). DECISION-NEUTRAL: no score/count/weight is derived — the audit
   * forces the question, it never answers or ranks it.
   */
  checklist_audit: ChecklistAudit
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
  /**
   * The sign-off-frozen normalized owner-earnings/share (see payload doc). Omit/undefined when the case has
   * no oe_ps at sign-off — fail-closed.
   */
  frozen_oe_ps?: number | undefined
  /**
   * The sign-off-frozen REFERENCE fair value (see payload doc). When omitted but `frozen_oe_ps` +
   * `assumed_growth` are supplied, confirmWatchlistDraft derives it via deriveFrozenReferenceFairValue.
   * Explicit `undefined` is accepted.
   */
  frozen_reference_fair_value?: number | undefined
  /**
   * The sign-off ASSUMED near-term growth used to derive `frozen_reference_fair_value` when one is not passed
   * explicitly (the case's verdict-band high edge / model growth assumption). Not persisted; a derivation
   * input only.
   */
  assumed_growth?: number | undefined
  /**
   * `VALUATION_PARAMS.version` the frozen oe_ps + reference were frozen under — the sign-off valuation
   * provenance (see payload doc).
   */
  frozen_iv_valuation_version?: string | undefined
  /** The human's required, non-empty FINAL signed thesis (Gate 0 `[Hu]`) — affirmed or amended. */
  signed_thesis: string
  /**
   * The agent-drafted thesis the human reviewed (the audit-and-decide draft). REQUIRED so the
   * affirm-vs-amend provenance (`thesis_amended`) can be derived: `signed_thesis` is compared against it.
   */
  signed_thesis_draft: string
  /**
   * The harness-marshaled audit (business findings + cognitive acknowledgement). REQUIRED: the admit is
   * COMPLETION-BLOCKED — every business item must carry a non-empty finding AND `cognitive_acknowledged`
   * must be true, or the admit is rejected before any append (mirroring the signed_thesis guard).
   */
  checklist_audit: ChecklistAudit
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
  // COMPLETION-BLOCK (audit-and-decide): the harness-marshaled audit must be fully marshaled +
  // acknowledged before admit — same throw-before-append shape as the signed_thesis guard.
  // Decision-NEUTRAL: the evaluator only tells us WHICH blockers are still open (business items lacking a
  // finding, plus the cognitive acknowledgement); it never scores/counts them, and a "risk present"
  // finding never auto-rejects. We throw the missing ids so the human knows what still needs attention.
  const checklistCompletion = evaluateChecklistCompletion(command.checklist_audit)
  if (!checklistCompletion.complete) {
    throw new Error(
      `Watchlist admit requires a complete audit; missing: ${checklistCompletion.missing.join(', ')}`,
    )
  }

  // Affirm vs. amend provenance: the human either signed the agent draft verbatim or amended it.
  const thesisAmended = command.signed_thesis.trim() !== command.signed_thesis_draft.trim()

  const selectedStrategy = resolveResearchStrategyRef(command)

  // Derive the frozen REFERENCE fair value when the caller did not pass one but DID supply the oe_ps + the
  // sign-off assumed growth (scope-reframe: a forward FV REFERENCE, not a band). An explicit
  // command.frozen_reference_fair_value is honoured as-is.
  const frozenReferenceFairValue = command.frozen_reference_fair_value ?? deriveFrozenReferenceFairValue({
    frozen_oe_ps: command.frozen_oe_ps,
    assumed_growth: command.assumed_growth,
  })

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
    // Frozen at sign-off (scope-reframe): the normalized owner-earnings/share + the REFERENCE fair value the
    // lightened valuation-inverted SELL flag keys off (the anchoring bias guard reads the reference too),
    // plus the valuation-version provenance. Each conditionally included so a case with no oe_ps freezes them
    // as ABSENT (fail-closed) — the sell then returns cannot_assess rather than reading a wrong number. The
    // band edges are no longer frozen (the band/gap engine was removed).
    ...(command.frozen_oe_ps === undefined ? {} : { frozen_oe_ps: command.frozen_oe_ps }),
    ...(frozenReferenceFairValue === undefined ? {} : { frozen_reference_fair_value: frozenReferenceFairValue }),
    ...(command.frozen_iv_valuation_version === undefined
      ? {}
      : { frozen_iv_valuation_version: command.frozen_iv_valuation_version }),
    signed_thesis: command.signed_thesis,
    // The agent draft the human reviewed + whether they amended it (affirm-vs-amend provenance).
    signed_thesis_draft: command.signed_thesis_draft,
    thesis_amended: thesisAmended,
    // Persisted append-only as part of the human sign-off, alongside signed_thesis (verified complete
    // above). The harness marshals the business findings; the human acknowledges the cognitive reflection.
    checklist_audit: command.checklist_audit,
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

  // CONSOLIDATED SINGLE GATED STEP (Phase 8 S4): the admission's real human judgment (signed thesis +
  // the full checklist + the caller's Shariah gate) is captured HERE, at this one gated transition. The
  // former second human step (`approveWatchlistDraft` / "confirm watchlist draft") added no new human
  // input — it only re-asserted the SAME already-passed Shariah gate. So we emit the `watchlist_draft_confirmed`
  // event ATOMICALLY alongside the created draft: the item lands user_approved:true in one step.
  //
  // HISTORY-COMPAT (append-only): we REUSE the existing `watchlist_draft_confirmed` event type with the
  // SAME stable event_id (`evt_watchlist_draft_confirmed_<id>`), the same causation (the created draft),
  // and the same correlation (the research case) the legacy second step used. The projection fold is
  // UNCHANGED, so a legacy two-event ledger (created@T1, confirmed@T2) and this atomic pair replay to the
  // identical confirmed end-state.
  const confirmedPayload: WatchlistDraftConfirmedPayload = {
    watchlist_item_id: command.watchlist_item_id,
    research_case_id: command.research_case_id,
    user_approved: true,
    confirmed_by_actor_type: 'user',
    confirmed_by_actor_id: command.actor_id,
  }

  const confirmedEvent: LedgerEventEnvelope<WatchlistDraftConfirmedPayload> = {
    event_id: `evt_watchlist_draft_confirmed_${command.watchlist_item_id}`,
    event_type: 'watchlist_draft_confirmed',
    aggregate_type: 'watchlist_item',
    aggregate_id: command.watchlist_item_id,
    causation_id: `evt_watchlist_draft_created_${command.watchlist_item_id}`,
    correlation_id: command.research_case_id,
    actor_type: 'user',
    actor_id: command.actor_id,
    payload: confirmedPayload,
    source_ids: [],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined
      ? {}
      : { idempotency_key: `${command.idempotency_key}:confirm` }),
  }

  await store.append(confirmedEvent as LedgerEventEnvelope<unknown>)

  return mergeEventPayload(storedEvent as LedgerEventEnvelope<WatchlistDraftCreatedPayload>)
}

function todayIsoDate(): string {
  return nowIso().slice(0, 10)
}

export type WatchlistItemPrunedPayload = {
  watchlist_item_id: string
  ticker: string
  research_case_id?: string
  pruned_at: string
  /** Why the watched name was pruned — typically mirrors the tripped falsifier reason. */
  reason: string
  /** This IS the (soft) exit execution — not a draft/observation. */
  is_execution: true
  /** The prune is gated to human authoring. */
  requires_user_authoring: true
  message?: string
}

export type WatchlistItemPruned = LedgerEventEnvelope<WatchlistItemPrunedPayload> & WatchlistItemPrunedPayload

export type PruneWatchlistItemCommand = {
  watchlist_item_id: string
  ticker: string
  research_case_id?: string
  pruned_at?: string
  reason: string
  /**
   * Authoring actor. The watched-name prune is HUMAN-authored ONLY — a worker/provider/agent actor is
   * rejected (see pruneWatchlistItem). Typed as ActorType so the guard is explicit at the call site.
   */
  actor_type: ActorType
  actor_id: string
  causation_id?: string
  message?: string
  idempotency_key?: string
}

export async function pruneWatchlistItem(
  store: WatchlistEventStore,
  command: PruneWatchlistItemCommand,
): Promise<WatchlistItemPruned> {
  // KEY INVARIANT: the watched-name prune is HUMAN-authored ONLY — the softer mirror of the holding close
  // (closeHolding). A worker/provider/agent actor is rejected BEFORE any append: the falsifier DETECTION may
  // be machine-authored (the watchlist_monitor_alert / Shariah re-screen observation), but the EXIT (removing
  // the name from the watchlist) must be signed by a user. Mirrors the user-only holding_closed transition.
  if (command.actor_type !== 'user') {
    throw new Error(
      `watchlist_item_pruned is human-authored only: actor_type '${command.actor_type}' cannot author the prune of ${command.watchlist_item_id}`,
    )
  }

  const payload: WatchlistItemPrunedPayload = {
    watchlist_item_id: command.watchlist_item_id,
    ticker: command.ticker,
    ...(command.research_case_id === undefined ? {} : { research_case_id: command.research_case_id }),
    pruned_at: command.pruned_at ?? todayIsoDate(),
    reason: command.reason,
    is_execution: true,
    requires_user_authoring: true,
    ...(command.message === undefined ? {} : { message: command.message }),
  }

  const event: LedgerEventEnvelope<WatchlistItemPrunedPayload> = {
    event_id: `evt_watchlist_item_pruned_${command.watchlist_item_id}`,
    event_type: 'watchlist_item_pruned',
    aggregate_type: 'watchlist_item',
    aggregate_id: command.watchlist_item_id,
    causation_id: command.causation_id ?? command.watchlist_item_id,
    ...(command.research_case_id === undefined ? {} : { correlation_id: command.research_case_id }),
    actor_type: 'user',
    actor_id: command.actor_id,
    payload,
    source_ids: [],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)

  return mergeEventPayload(storedEvent as LedgerEventEnvelope<WatchlistItemPrunedPayload>)
}
