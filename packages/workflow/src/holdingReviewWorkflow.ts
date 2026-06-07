import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { ActorType, LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import type { Provider, ProviderRunRequest } from '@owlfolio/providers'
import { z } from 'zod'

const HoldingReviewSchema = z.object({
  thesis_health: z.enum(['HEALTHY', 'WATCH', 'IMPAIRED', 'EXIT_CANDIDATE']),
  action_stance: z.enum(['HOLD', 'ADD_ON_PULLBACK', 'REDUCE', 'EXIT_REVIEW_NEEDED', 'RESEARCH_MORE']),
  rationale: z.string().min(1),
  evidence_summary: z.string().min(1),
  uncertainty: z.string().min(1),
  next_review_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_ids: z.array(z.string().min(1)),
})

export type ThesisHealth = z.infer<typeof HoldingReviewSchema>['thesis_health']
export type HoldingReviewActionStance = z.infer<typeof HoldingReviewSchema>['action_stance']

type HoldingReviewEventStore = EventStore<LedgerEventEnvelope<unknown>>

export type HoldingReviewDraftedPayload = {
  review_id: string
  holding_id: string
  research_case_id: string
  company_id?: string
  ticker?: string
  strategy_id: string
  thesis_health: ThesisHealth
  action_stance: HoldingReviewActionStance
  rationale: string
  evidence_summary: string
  uncertainty: string
  next_review_at: string
  user_approved: false
  reviewed_by_actor_type: ActorType
  reviewed_by_actor_id: string
}

export type HoldingReviewDrafted = LedgerEventEnvelope<HoldingReviewDraftedPayload> & HoldingReviewDraftedPayload

export type HoldingReviewConfirmedPayload = Omit<
  HoldingReviewDraftedPayload,
  'user_approved' | 'reviewed_by_actor_type' | 'reviewed_by_actor_id'
> & {
  user_approved: true
  confirmed_by_actor_type: ActorType
  confirmed_by_actor_id: string
}

export type HoldingReviewConfirmed = LedgerEventEnvelope<HoldingReviewConfirmedPayload> & HoldingReviewConfirmedPayload

export type HoldingReviewOverriddenPayload = Omit<
  HoldingReviewDraftedPayload,
  'user_approved' | 'reviewed_by_actor_type' | 'reviewed_by_actor_id'
> & {
  user_approved: true
  user_overrode_provider: true
  overridden_by_actor_type: ActorType
  overridden_by_actor_id: string
}

export type HoldingReviewOverridden = LedgerEventEnvelope<HoldingReviewOverriddenPayload> & HoldingReviewOverriddenPayload

export type HoldingReviewRejectedPayload = Pick<
  HoldingReviewDraftedPayload,
  'review_id' | 'holding_id' | 'research_case_id' | 'strategy_id'
> & {
  company_id?: string
  ticker?: string
  user_approved: false
  rejection_reason: string
  rejected_by_actor_type: ActorType
  rejected_by_actor_id: string
}

export type HoldingReviewRejected = LedgerEventEnvelope<HoldingReviewRejectedPayload> & HoldingReviewRejectedPayload

export type DraftHoldingReviewCommand = {
  review_id: string
  holding_id: string
  model_id: string
  causation_id: string
  idempotency_key?: string
}

export type ConfirmHoldingReviewDraftCommand = {
  review_id: string
  holding_id: string
  causation_id: string
  actor_id: string
  idempotency_key?: string
}

export type OverrideHoldingReviewDraftCommand = {
  review_id: string
  holding_id: string
  causation_id: string
  actor_id: string
  thesis_health: ThesisHealth
  action_stance: HoldingReviewActionStance
  rationale: string
  evidence_summary: string
  uncertainty: string
  next_review_at: string
  idempotency_key?: string
}

export type RejectHoldingReviewDraftCommand = {
  review_id: string
  holding_id: string
  causation_id: string
  actor_id: string
  rejection_reason: string
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

function buildReviewRequest(command: DraftHoldingReviewCommand, provider: Provider, holding: ReturnType<typeof projectHoldings>[number]): ProviderRunRequest {
  const ticker = holding.ticker ?? holding.company_id ?? holding.holding_id
  const valuationSummary = holding.latest_market_value === undefined
    ? 'No valuation snapshot has been recorded yet.'
    : `Latest valuation: ${holding.latest_market_value} ${holding.currency} at ${holding.latest_price_per_share ?? 'unknown'} per share on ${holding.latest_valuation_at ?? 'unknown date'}.`

  return {
    run_id: `run_${command.review_id}_holding_review`,
    provider_id: provider.provider_id,
    model_id: command.model_id,
    task_kind: 'structured-output',
    prompt: [
      `You are the Buffett-Munger holding review agent for Owlfolio holding ${holding.holding_id}.`,
      `Review ticker ${ticker} under the default Buffett-Munger strategy ${holding.strategy_id ?? 'buffett-munger'}.`,
      `Original thesis: ${holding.thesis_summary ?? 'No thesis summary recorded.'}`,
      `Cost basis: ${holding.total_cost_basis} ${holding.currency} for ${holding.shares} shares.`,
      valuationSummary,
      'Assess thesis drift, business quality, moat durability, management/capital allocation, Shariah status, valuation discipline, and concentration risk.',
      'Return only the structured fields requested by the JSON schema.',
    ].join(' '),
    timeout_ms: 120_000,
    budget: { max_tool_calls: 0, max_tokens: 4_000 },
    tool_allowlist: [],
    response_format: { kind: 'json-schema', schema_name: 'BuffettMungerHoldingReview' },
  }
}

export async function draftHoldingReview(
  store: HoldingReviewEventStore,
  provider: Provider,
  command: DraftHoldingReviewCommand,
): Promise<HoldingReviewDrafted> {
  const events = await store.list()
  const holding = projectHoldings(events).find((candidate) => candidate.holding_id === command.holding_id)
  if (holding === undefined) {
    throw new Error(`Unknown holding: ${command.holding_id}`)
  }

  const structured = await provider.structured(buildReviewRequest(command, provider, holding), HoldingReviewSchema)
  const payload: HoldingReviewDraftedPayload = {
    review_id: command.review_id,
    holding_id: holding.holding_id,
    research_case_id: holding.research_case_id,
    ...(holding.company_id === undefined ? {} : { company_id: holding.company_id }),
    ...(holding.ticker === undefined ? {} : { ticker: holding.ticker }),
    strategy_id: holding.strategy_id ?? 'buffett-munger',
    thesis_health: structured.thesis_health,
    action_stance: structured.action_stance,
    rationale: structured.rationale,
    evidence_summary: structured.evidence_summary,
    uncertainty: structured.uncertainty,
    next_review_at: structured.next_review_at,
    user_approved: false,
    reviewed_by_actor_type: 'provider',
    reviewed_by_actor_id: provider.provider_id,
  }

  const event: LedgerEventEnvelope<HoldingReviewDraftedPayload> = {
    event_id: `evt_holding_review_drafted_${command.review_id}`,
    event_type: 'holding_review_drafted',
    aggregate_type: 'holding',
    aggregate_id: holding.holding_id,
    causation_id: command.causation_id,
    correlation_id: holding.holding_id,
    actor_type: 'provider',
    actor_id: provider.provider_id,
    payload,
    source_ids: structured.source_ids,
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)
  return mergeEventPayload(storedEvent as LedgerEventEnvelope<HoldingReviewDraftedPayload>)
}

function isReviewDraftPayload(value: unknown): value is HoldingReviewDraftedPayload {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { review_id?: unknown }).review_id === 'string'
    && typeof (value as { holding_id?: unknown }).holding_id === 'string'
    && (value as { user_approved?: unknown }).user_approved === false
}

async function findPendingReviewDraft(
  store: HoldingReviewEventStore,
  reviewId: string,
  holdingId: string,
): Promise<LedgerEventEnvelope<HoldingReviewDraftedPayload>> {
  const events = await store.list()
  const draft = events
    .filter((event) => event.event_type === 'holding_review_drafted')
    .find((event) => isReviewDraftPayload(event.payload)
      && event.payload.review_id === reviewId
      && event.payload.holding_id === holdingId)

  if (draft === undefined || !isReviewDraftPayload(draft.payload)) {
    throw new Error(`Unknown holding review draft: ${reviewId}`)
  }

  const hasTerminalDecision = events.some((event) => event.event_type.startsWith('holding_review_')
    && event.event_type !== 'holding_review_drafted'
    && isRecord(event.payload)
    && event.payload.review_id === reviewId
    && event.payload.holding_id === holdingId)
  if (hasTerminalDecision) {
    throw new Error(`Holding review draft is already decided: ${reviewId}`)
  }

  const latestDraft = events
    .filter((event) => event.event_type === 'holding_review_drafted')
    .filter((event) => isReviewDraftPayload(event.payload)
      && event.payload.holding_id === holdingId)
    .at(-1)
  if (latestDraft === undefined
    || !isReviewDraftPayload(latestDraft.payload)
    || latestDraft.payload.review_id !== reviewId) {
    throw new Error('Holding review draft is not the latest pending draft')
  }

  return draft as LedgerEventEnvelope<HoldingReviewDraftedPayload>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export async function confirmHoldingReviewDraft(
  store: HoldingReviewEventStore,
  command: ConfirmHoldingReviewDraftCommand,
): Promise<HoldingReviewConfirmed> {
  const draft = await findPendingReviewDraft(store, command.review_id, command.holding_id)

  const payload: HoldingReviewConfirmedPayload = {
    review_id: draft.payload.review_id,
    holding_id: draft.payload.holding_id,
    research_case_id: draft.payload.research_case_id,
    ...(draft.payload.company_id === undefined ? {} : { company_id: draft.payload.company_id }),
    ...(draft.payload.ticker === undefined ? {} : { ticker: draft.payload.ticker }),
    strategy_id: draft.payload.strategy_id,
    thesis_health: draft.payload.thesis_health,
    action_stance: draft.payload.action_stance,
    rationale: draft.payload.rationale,
    evidence_summary: draft.payload.evidence_summary,
    uncertainty: draft.payload.uncertainty,
    next_review_at: draft.payload.next_review_at,
    user_approved: true,
    confirmed_by_actor_type: 'user',
    confirmed_by_actor_id: command.actor_id,
  }

  const event: LedgerEventEnvelope<HoldingReviewConfirmedPayload> = {
    event_id: `evt_holding_review_confirmed_${command.review_id}`,
    event_type: 'holding_review_confirmed',
    aggregate_type: 'holding',
    aggregate_id: command.holding_id,
    causation_id: command.causation_id,
    correlation_id: command.holding_id,
    actor_type: 'user',
    actor_id: command.actor_id,
    payload,
    source_ids: draft.source_ids,
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)
  return mergeEventPayload(storedEvent as LedgerEventEnvelope<HoldingReviewConfirmedPayload>)
}

export async function overrideHoldingReviewDraft(
  store: HoldingReviewEventStore,
  command: OverrideHoldingReviewDraftCommand,
): Promise<HoldingReviewOverridden> {
  const draft = await findPendingReviewDraft(store, command.review_id, command.holding_id)
  const payload: HoldingReviewOverriddenPayload = {
    review_id: draft.payload.review_id,
    holding_id: draft.payload.holding_id,
    research_case_id: draft.payload.research_case_id,
    ...(draft.payload.company_id === undefined ? {} : { company_id: draft.payload.company_id }),
    ...(draft.payload.ticker === undefined ? {} : { ticker: draft.payload.ticker }),
    strategy_id: draft.payload.strategy_id,
    thesis_health: command.thesis_health,
    action_stance: command.action_stance,
    rationale: command.rationale,
    evidence_summary: command.evidence_summary,
    uncertainty: command.uncertainty,
    next_review_at: command.next_review_at,
    user_approved: true,
    user_overrode_provider: true,
    overridden_by_actor_type: 'user',
    overridden_by_actor_id: command.actor_id,
  }

  const event: LedgerEventEnvelope<HoldingReviewOverriddenPayload> = {
    event_id: `evt_holding_review_overridden_${command.review_id}`,
    event_type: 'holding_review_overridden',
    aggregate_type: 'holding',
    aggregate_id: command.holding_id,
    causation_id: command.causation_id,
    correlation_id: command.holding_id,
    actor_type: 'user',
    actor_id: command.actor_id,
    payload,
    source_ids: draft.source_ids,
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)
  return mergeEventPayload(storedEvent as LedgerEventEnvelope<HoldingReviewOverriddenPayload>)
}

export async function rejectHoldingReviewDraft(
  store: HoldingReviewEventStore,
  command: RejectHoldingReviewDraftCommand,
): Promise<HoldingReviewRejected> {
  const draft = await findPendingReviewDraft(store, command.review_id, command.holding_id)
  const payload: HoldingReviewRejectedPayload = {
    review_id: draft.payload.review_id,
    holding_id: draft.payload.holding_id,
    research_case_id: draft.payload.research_case_id,
    ...(draft.payload.company_id === undefined ? {} : { company_id: draft.payload.company_id }),
    ...(draft.payload.ticker === undefined ? {} : { ticker: draft.payload.ticker }),
    strategy_id: draft.payload.strategy_id,
    user_approved: false,
    rejection_reason: command.rejection_reason,
    rejected_by_actor_type: 'user',
    rejected_by_actor_id: command.actor_id,
  }

  const event: LedgerEventEnvelope<HoldingReviewRejectedPayload> = {
    event_id: `evt_holding_review_rejected_${command.review_id}`,
    event_type: 'holding_review_rejected',
    aggregate_type: 'holding',
    aggregate_id: command.holding_id,
    causation_id: command.causation_id,
    correlation_id: command.holding_id,
    actor_type: 'user',
    actor_id: command.actor_id,
    payload,
    source_ids: draft.source_ids,
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)
  return mergeEventPayload(storedEvent as LedgerEventEnvelope<HoldingReviewRejectedPayload>)
}
