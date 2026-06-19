import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { ActorType, LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import type { Provider } from '@owlfolio/providers'
import { evaluateChecklistCompletion } from '@owlfolio/strategies/checklist'
import type { ChecklistAudit } from '@owlfolio/strategies/checklistParams'
import { z } from 'zod'
import { ProposedSourcesSchema, runGroundedAgentWithTools, type GroundFn } from './groundedAgent'
import { groundProposedSources, groundProposedSourcesDeterministic, type GroundingDeps } from './sourceGrounding'

const HoldingReviewSchema = z.object({
  thesis_health: z.enum(['HEALTHY', 'WATCH', 'IMPAIRED', 'EXIT_CANDIDATE']),
  action_stance: z.enum(['HOLD', 'ADD_ON_PULLBACK', 'REDUCE', 'EXIT_REVIEW_NEEDED', 'RESEARCH_MORE']),
  rationale: z.string().min(1),
  evidence_summary: z.string().min(1),
  uncertainty: z.string().min(1),
  next_review_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_ids: z.array(z.string().min(1)),
  // The model's proposed primary sources; the harness fetches + content-hashes them, and the review's
  // thesis judgment is held to cite ONLY the verified subset (fail-closed when nothing verifies).
  proposed_sources: ProposedSourcesSchema,
})

const HOLDING_REVIEW_TIMEOUT_MS = 120_000

/**
 * The conservative ABSTAIN stance the draft degrades to when the model grounded NOTHING. A confident
 * thesis_health ('HEALTHY'/'IMPAIRED'/etc.) on ungrounded input must never be presented as if it were
 * grounded — mirroring how every research-path call fails closed on an empty verified corpus. The draft
 * still reaches the human (it is advisory), but it is visibly flagged `holding_review_ungrounded` and
 * carries a non-confident WATCH + RESEARCH_MORE stance rather than a confident judgment.
 */
const UNGROUNDED_THESIS_HEALTH: ThesisHealth = 'WATCH'
const UNGROUNDED_ACTION_STANCE: HoldingReviewActionStance = 'RESEARCH_MORE'

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
  /**
   * FAIL-CLOSED VISIBILITY: set true when the grounded-agent call produced NO content-verified sources the
   * thesis judgment could cite. In that case thesis_health/action_stance are degraded to a conservative
   * abstain (WATCH + RESEARCH_MORE), NOT the model's confident judgment — an ungrounded "thesis intact" must
   * never be presented as grounded. Absent/false = the judgment cite-verified against the corpus.
   */
  holding_review_ungrounded?: true
  /** Human-readable reason the draft degraded (only set with the flag above). */
  ungrounded_reason?: string
}

export type HoldingReviewDrafted = LedgerEventEnvelope<HoldingReviewDraftedPayload> & HoldingReviewDraftedPayload

export type HoldingReviewConfirmedPayload = Omit<
  HoldingReviewDraftedPayload,
  'user_approved' | 'reviewed_by_actor_type' | 'reviewed_by_actor_id'
> & {
  user_approved: true
  /**
   * The harness-marshaled audit captured at the re-underwrite sign-off (audit-and-decide model): one
   * business finding per business item + the human's single cognitive acknowledgement — append-only. The
   * sign-off is COMPLETION-BLOCKED: every business item must carry a non-empty finding AND
   * `cognitive_acknowledged === true` before this event is appended (see confirmHoldingReviewDraft). This
   * is the re-underwrite host: it makes `holding_review_confirmed` go from validating NOTHING to validating
   * that the audit is complete — the integrity fix. DECISION-NEUTRAL: no score/count/weight is derived.
   */
  checklist_audit: ChecklistAudit
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
  /**
   * The harness-marshaled audit captured at the OVERRIDE re-underwrite sign-off — the co-equal twin of
   * `holding_review_confirmed.checklist_audit`. The override writes the SAME confirmed thesis state as
   * confirm, so it is COMPLETION-BLOCKED on the SAME audit: every business item must carry a non-empty
   * finding AND `cognitive_acknowledged === true` before this event is appended (see overrideHoldingReviewDraft).
   * Gating only confirm and not override would reopen the exact gap S3 closed. DECISION-NEUTRAL: no
   * score/count/weight is derived.
   */
  checklist_audit: ChecklistAudit
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
  /**
   * The harness-marshaled audit (business findings + cognitive acknowledgement). REQUIRED: the
   * re-underwrite sign-off is COMPLETION-BLOCKED — every business item must carry a non-empty finding AND
   * `cognitive_acknowledged` must be true, or the sign-off is rejected before any append.
   */
  checklist_audit: ChecklistAudit
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
  /**
   * The harness-marshaled audit (business findings + cognitive acknowledgement). REQUIRED: the override
   * re-underwrite sign-off is COMPLETION-BLOCKED exactly like confirm — every business item must carry a
   * non-empty finding AND `cognitive_acknowledged` must be true, or the sign-off is rejected before any append.
   */
  checklist_audit: ChecklistAudit
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

/** The grounded prompt for the holding-review judgment (Phase-1 gather → Phase-2 thesis assessment). */
function buildReviewPrompt(holding: ReturnType<typeof projectHoldings>[number]): string {
  const ticker = holding.ticker ?? holding.company_id ?? holding.holding_id
  const valuationSummary = holding.latest_market_value === undefined
    ? 'No valuation snapshot has been recorded yet.'
    : `Latest valuation: ${holding.latest_market_value} ${holding.currency} at ${holding.latest_price_per_share ?? 'unknown'} per share on ${holding.latest_valuation_at ?? 'unknown date'}.`

  return [
    `You are the Buffett-Munger holding review agent for Owlfolio holding ${holding.holding_id}.`,
    `Review ticker ${ticker} under the default Buffett-Munger strategy ${holding.strategy_id ?? 'buffett-munger'}.`,
    `Original thesis: ${holding.thesis_summary ?? 'No thesis summary recorded.'}`,
    `Cost basis: ${holding.total_cost_basis} ${holding.currency} for ${holding.shares} shares.`,
    valuationSummary,
    'Assess thesis drift, business quality, moat durability, management/capital allocation, Shariah status, valuation discipline, and concentration risk.',
    'Gather PRIMARY sources (use the grounded tools to fetch + content-hash them) and ground your thesis_health/action_stance ONLY in sources you fetched and that verified.',
    'List every cited source id in source_ids; cite ONLY verified ids. Return only the structured fields requested by the JSON schema.',
  ].join(' ')
}

export type DraftHoldingReviewDeps = {
  /** Grounding fn (injectable for tests). Defaults to the live grounder (deterministic for the mock provider). */
  ground?: GroundFn
  /** Extra grounding deps (fetch impl, timeouts, excerpt length). */
  grounding?: GroundingDeps
  /** Advanced research-depth knob: max grounded tool calls (undefined → loop default). */
  maxToolCalls?: number
}

export async function draftHoldingReview(
  store: HoldingReviewEventStore,
  provider: Provider,
  command: DraftHoldingReviewCommand,
  deps: DraftHoldingReviewDeps = {},
): Promise<HoldingReviewDrafted> {
  const events = await store.list()
  const holding = projectHoldings(events).find((candidate) => candidate.holding_id === command.holding_id)
  if (holding === undefined) {
    throw new Error(`Unknown holding: ${command.holding_id}`)
  }

  // Route through the SAME grounded-agent path the research lanes / circle gate use: the model proposes (or
  // tool-fetches) primary sources, the harness fetches + content-hashes them, and the thesis judgment is
  // cite-verified against the content_hash-confirmed corpus. Default the grounder to deterministic for the
  // mock provider (offline/test), else the live SSRF+sha256 grounder — mirroring the research path.
  // Cast: groundProposedSources(Deterministic) accept ProposedSource[] (exactOptionalPropertyTypes) while
  // GroundFn is typed over z.infer<ProposedSourcesSchema>; the runtime shapes are identical.
  const ground: GroundFn = deps.ground ?? (
    provider.provider_id === 'mock-provider'
      ? groundProposedSourcesDeterministic as unknown as GroundFn
      : groundProposedSources as unknown as GroundFn
  )

  const { degraded_no_tools: _degraded, ...agent } = await runGroundedAgentWithTools(
    provider,
    {
      run_id: `run_${command.review_id}_holding_review`,
      model_id: command.model_id,
      prompt: buildReviewPrompt(holding),
      timeout_ms: HOLDING_REVIEW_TIMEOUT_MS,
      schema_name: 'BuffettMungerHoldingReview',
    },
    HoldingReviewSchema,
    {
      ground,
      ...(deps.grounding === undefined ? {} : { grounding: deps.grounding }),
      ...(deps.maxToolCalls === undefined ? {} : { maxToolCalls: deps.maxToolCalls }),
    },
  )
  void _degraded
  const structured = agent.analysis

  // Build the verified cite-check set from ONLY content_hash-confirmed sources (the SAME hardened primitive
  // the research lanes / circle gate use — a captured-but-unverified id must NOT satisfy a citation).
  const verified = new Set<string>()
  for (const captured of agent.captured) {
    if (captured.content_hash === undefined) continue
    verified.add(captured.content_hash)
    verified.add(captured.source_id)
  }
  for (const id of agent.verified_ids) verified.add(id)
  const groundedCitations = structured.source_ids.filter((id) => verified.has(id))

  // FAIL CLOSED: the judgment is grounded ONLY when the harness verified ≥1 source AND the review actually
  // cites a verified source. Otherwise the model grounded nothing — degrade VISIBLY to a conservative
  // abstain (a confident ungrounded thesis_health must never be presented as grounded).
  const isGrounded = agent.verified_ids.length > 0 && groundedCitations.length > 0
  const ungroundedReason = isGrounded
    ? undefined
    : agent.verified_ids.length === 0
      ? 'holding_review_ungrounded: the model produced no content-verified sources (fail-closed). thesis_health degraded to a conservative WATCH / RESEARCH_MORE pending a grounded re-review — NOT a confident judgment.'
      : 'holding_review_ungrounded: the model produced verified sources but its thesis_health/action_stance cited none of them (fail-closed). Degraded to a conservative WATCH / RESEARCH_MORE pending a grounded re-review.'

  const payload: HoldingReviewDraftedPayload = {
    review_id: command.review_id,
    holding_id: holding.holding_id,
    research_case_id: holding.research_case_id,
    ...(holding.company_id === undefined ? {} : { company_id: holding.company_id }),
    ...(holding.ticker === undefined ? {} : { ticker: holding.ticker }),
    strategy_id: holding.strategy_id ?? 'buffett-munger',
    thesis_health: isGrounded ? structured.thesis_health : UNGROUNDED_THESIS_HEALTH,
    action_stance: isGrounded ? structured.action_stance : UNGROUNDED_ACTION_STANCE,
    rationale: isGrounded
      ? structured.rationale
      : `Grounded re-review needed before a thesis verdict. ${ungroundedReason ?? ''}`.trim(),
    evidence_summary: isGrounded
      ? structured.evidence_summary
      : 'No content-verified primary sources were captured for this review; no thesis evidence can be asserted.',
    uncertainty: isGrounded
      ? structured.uncertainty
      : 'Thesis health is UNKNOWN until a grounded re-review captures verified primary sources.',
    next_review_at: structured.next_review_at,
    user_approved: false,
    reviewed_by_actor_type: 'provider',
    reviewed_by_actor_id: provider.provider_id,
    ...(isGrounded || ungroundedReason === undefined
      ? {}
      : { holding_review_ungrounded: true, ungrounded_reason: ungroundedReason }),
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
    // The cited corpus = the verified citations (grounded) — never the model's raw, unverified source_ids.
    source_ids: groundedCitations,
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

  // COMPLETION-BLOCK (Phase 7 S3): the re-underwrite sign-off is the twin of the watchlist-admit sign-off
  // — every hygiene/bias checklist item must be ADDRESSED before this confirmation is appended. This is
  // the INTEGRITY FIX: `holding_review_confirmed` previously validated NOTHING (a confirmation that
  // confirms nothing); now it validates that the same 17-item checklist has been addressed, catching
  // post-admission deterioration (e.g. shariah_drift, data_completeness) that re-underwrite is the only
  // place to catch. Throw-before-append, mirroring confirmWatchlistDraft. Decision-NEUTRAL: the evaluator
  // only tells us WHICH blockers are still open; it never scores/counts them, and a "risk present" finding
  // never auto-rejects. The harness marshals the findings; the human acknowledges the cognitive reflection.
  const checklistCompletion = evaluateChecklistCompletion(command.checklist_audit)
  if (!checklistCompletion.complete) {
    throw new Error(
      `Re-underwrite sign-off requires a complete audit; missing: ${checklistCompletion.missing.join(', ')}`,
    )
  }

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
    // Persisted append-only as part of the human re-underwrite sign-off (verified complete above). The
    // harness marshals the business findings; the human acknowledges the cognitive reflection.
    checklist_audit: command.checklist_audit,
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

  // COMPLETION-BLOCK (Phase 7 S3 — bypass close): the OVERRIDE is a co-equal re-underwrite sign-off that
  // writes the SAME confirmed thesis state as confirm. It MUST be gated on the same 17-item hygiene/bias
  // checklist; gating only confirm would reopen the exact gap S3 closed (a sign-off that signs off on
  // nothing). Throw-before-append, mirroring confirmHoldingReviewDraft. Decision-NEUTRAL: the evaluator only
  // tells us WHICH blockers are still open; never scores/counts. The harness marshals the findings; the
  // human acknowledges the cognitive reflection.
  const checklistCompletion = evaluateChecklistCompletion(command.checklist_audit)
  if (!checklistCompletion.complete) {
    throw new Error(
      `Re-underwrite sign-off requires a complete audit; missing: ${checklistCompletion.missing.join(', ')}`,
    )
  }

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
    // Persisted append-only as part of the human override sign-off (verified complete above). The harness
    // marshals the business findings; the human acknowledges the cognitive reflection.
    checklist_audit: command.checklist_audit,
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
