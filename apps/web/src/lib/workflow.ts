import type { ResearchCaseProjection } from '@owlfolio/ledger/projections/researchCaseProjection'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import {
  projectResearchCaseTimeline,
  type ResearchCaseTimelineEntry,
} from '@owlfolio/ledger/projections/researchCaseTimelineProjection'
import type { HoldingProjection } from '@owlfolio/ledger/projections/holdingProjection'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import type { WatchlistProjection } from '@owlfolio/ledger/projections/watchlistProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { resolveProvider } from '@owlfolio/providers'
import type { AppConfig } from '@owlfolio/shared'
import {
  approveWatchlistDraft,
  assertShariahGateAllowsTransition,
  confirmHoldingReviewDraft,
  confirmWatchlistDraft,
  draftHoldingReview,
  evaluateResearchCaseShariahGate,
  openHoldingFromWatchlist,
  overrideHoldingReviewDraft,
  recordHoldingValuationSnapshot,
  rejectHoldingReviewDraft,
  runClaudeBuffettMungerResearch,
} from '@owlfolio/workflow'

import type { StatusBadgeTone } from '../components/StatusBadge'
import { getDemoResearchCaseFromStore, getDemoWatchlistItemsFromStore } from './demo'
import type { OnboardingState } from './onboarding'
import { buildProviderStatusRows } from './providerStatus'

export type WorkflowMode = AppConfig['mode']

export type AppGateChecklistItem = {
  label: string
  status: string
  tone: StatusBadgeTone
}

export type AppResearchCase = ResearchCaseProjection & {
  gate_checklist: AppGateChecklistItem[]
  source_ids: string[]
  ledger_timeline: ResearchCaseTimelineEntry[]
}

export type AppWatchlistItem = WatchlistProjection & {
  buy_zone_status?: string
  holding_id?: string
}

export type AppHolding = HoldingProjection

export type OpenPersonalHoldingInput = {
  shares?: FormDataEntryValue | number | string | null
  cost_basis_per_share?: FormDataEntryValue | number | string | null
  currency?: FormDataEntryValue | string | null
  opened_at?: FormDataEntryValue | string | null
}

export type RecordPersonalHoldingValuationInput = {
  price_per_share?: FormDataEntryValue | number | string | null
  currency?: FormDataEntryValue | string | null
  valued_at?: FormDataEntryValue | string | null
}

export type OverridePersonalHoldingReviewInput = {
  thesis_health?: FormDataEntryValue | string | null
  action_stance?: FormDataEntryValue | string | null
  rationale?: FormDataEntryValue | string | null
  evidence_summary?: FormDataEntryValue | string | null
  uncertainty?: FormDataEntryValue | string | null
  next_review_at?: FormDataEntryValue | string | null
}

export type RejectPersonalHoldingReviewInput = {
  rejection_reason?: FormDataEntryValue | string | null
}

const pendingChecklist: AppGateChecklistItem[] = [
  { label: 'Quality business', status: 'Pending', tone: 'neutral' },
  { label: 'Management alignment', status: 'Pending', tone: 'neutral' },
  { label: 'Margin of safety', status: 'Pending', tone: 'neutral' },
]

export function resolveActiveWorkflowMode(config: Pick<AppConfig, 'mode'>): WorkflowMode {
  return config.mode
}

export async function createPersonalResearchCase(
  state: OnboardingState,
  input: { ticker: string; company_id?: string },
) {
  if (
    !state.is_initialized
    || state.config.mode !== 'personal-local'
    || state.config.ledger_path === undefined
    || state.config.source_ledger_path === undefined
  ) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const ticker = input.ticker.trim().toUpperCase()
  if (ticker.length === 0) {
    throw new Error('Ticker is required')
  }

  const companyId = input.company_id?.trim() || `company_${ticker.toLowerCase()}`
  const researchCaseId = `rc_${ticker.toLowerCase()}_${Date.now()}`
  const decisionId = `decision_${ticker.toLowerCase()}_${Date.now()}`
  await assertConfiguredProviderIsReady(state)
  const provider = resolveProvider({ provider_id: state.config.provider.provider_id })

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const result = await runClaudeBuffettMungerResearch(store, provider, {
      research_case_id: researchCaseId,
      company_id: companyId,
      ticker,
      strategy_id: state.config.strategy_id,
      actor_id: 'user_local',
      idempotency_key: `personal:create:${ticker}:${researchCaseId}`,
      model_id: resolveModelIdForProvider(state.config),
      source_ledger_path: state.config.source_ledger_path,
      analysis_idempotency_key: `analysis:${researchCaseId}:${provider.provider_id}:v1`,
      decision_id: decisionId,
      decision_idempotency_key: `decision:${researchCaseId}:${decisionId}:v1`,
    })

    return result.research_case
  } finally {
    store.close()
  }
}

export async function getAppResearchCaseFromStore(
  store: EventStore,
  mode: WorkflowMode,
  caseId: string,
): Promise<AppResearchCase> {
  if (mode === 'demo') {
    return getDemoResearchCaseFromStore(store, caseId)
  }

  const events = await store.list()
  const researchCase = projectResearchCases(events).find((candidate) => candidate.research_case_id === caseId)
  if (researchCase === undefined) {
    throw new Error(`Unknown research case: ${caseId}`)
  }

  return buildPersonalResearchCase(events, researchCase)
}

export async function getAppWatchlistItemsFromStore(
  store: EventStore,
  mode: WorkflowMode,
): Promise<AppWatchlistItem[]> {
  if (mode === 'demo') {
    return getDemoWatchlistItemsFromStore(store)
  }

  return buildPersonalWatchlistItems(await store.list())
}

export async function getAppHoldingsFromStore(
  store: EventStore,
  _mode: WorkflowMode,
): Promise<AppHolding[]> {
  return projectHoldings(await store.list())
}

export async function promoteResearchCaseToWatchlist(
  state: OnboardingState,
  researchCaseId: string,
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const researchCase = projectResearchCases(await store.list()).find((candidate) => candidate.research_case_id === researchCaseId)
    if (researchCase === undefined) {
      throw new Error(`Unknown research case: ${researchCaseId}`)
    }
    if (researchCase.decision === undefined || researchCase.decision_id === undefined) {
      throw new Error(`Research case is not ready for watchlist promotion: ${researchCaseId}`)
    }

    const fallbackTicker = researchCase.company_id ?? researchCase.research_case_id
    const ticker = researchCase.ticker ?? fallbackTicker
    const watchlistItemId = `watch_${ticker.toLowerCase()}_${Date.now()}`
    const gateDecision = await evaluateResearchCaseShariahGate(store, {
      research_case_id: researchCase.research_case_id,
      target_transition: 'watchlist_promotion',
      target_id: watchlistItemId,
      shariah_defaults: state.config.shariah,
      idempotency_key: `shariah:${researchCase.research_case_id}:watchlist-promotion:${watchlistItemId}:v1`,
    })
    assertShariahGateAllowsTransition(gateDecision)
    const thesisSummary = researchCase.reason === undefined
      ? researchCase.next_required_action ?? `Watch ${ticker} after drafted decision ${researchCase.decision}`
      : `Watch ${ticker}: ${researchCase.reason}`

    return await confirmWatchlistDraft(store, {
      watchlist_item_id: watchlistItemId,
      research_case_id: researchCase.research_case_id,
      decision_id: researchCase.decision_id,
      company_id: researchCase.company_id ?? `company_${ticker.toLowerCase()}`,
      ticker,
      strategy_id: researchCase.strategy_id ?? state.config.strategy_id,
      thesis_summary: thesisSummary,
      actor_id: 'user_local',
      idempotency_key: `decision:${researchCase.research_case_id}:watchlist:v1`,
    })
  } finally {
    store.close()
  }
}

export async function confirmPersonalWatchlistDraft(
  state: OnboardingState,
  watchlistItemId: string,
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const watchlistItem = projectWatchlist(await store.list()).find((candidate) => candidate.watchlist_item_id === watchlistItemId)
    if (watchlistItem === undefined) {
      throw new Error(`Unknown watchlist item: ${watchlistItemId}`)
    }

    const gateDecision = await evaluateResearchCaseShariahGate(store, {
      research_case_id: watchlistItem.research_case_id,
      target_transition: 'watchlist_confirmation',
      target_id: watchlistItem.watchlist_item_id,
      shariah_defaults: state.config.shariah,
      idempotency_key: `shariah:${watchlistItem.research_case_id}:watchlist-confirmation:${watchlistItem.watchlist_item_id}:v1`,
    })
    assertShariahGateAllowsTransition(gateDecision)

    return await approveWatchlistDraft(store, {
      watchlist_item_id: watchlistItem.watchlist_item_id,
      research_case_id: watchlistItem.research_case_id,
      causation_id: `evt_watchlist_draft_created_${watchlistItem.watchlist_item_id}`,
      actor_id: 'user_local',
      idempotency_key: `watchlist:${watchlistItem.watchlist_item_id}:confirm:v1`,
    })
  } finally {
    store.close()
  }
}

export async function openPersonalHoldingFromWatchlist(
  state: OnboardingState,
  watchlistItemId: string,
  input: OpenPersonalHoldingInput = {},
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const events = await store.list()
    const watchlistItem = projectWatchlist(events).find((candidate) => candidate.watchlist_item_id === watchlistItemId)
    if (watchlistItem === undefined) {
      throw new Error(`Unknown watchlist item: ${watchlistItemId}`)
    }
    if (!watchlistItem.user_approved) {
      throw new Error(`Watchlist item is not confirmed: ${watchlistItemId}`)
    }

    const ticker = watchlistItem.ticker ?? watchlistItem.company_id ?? watchlistItem.watchlist_item_id
    const lot = parseHoldingLotInput(input)
    const holdingId = `holding_${ticker.toLowerCase()}_${Date.now()}`
    const gateDecision = await evaluateResearchCaseShariahGate(store, {
      research_case_id: watchlistItem.research_case_id,
      target_transition: 'holding_open',
      target_id: holdingId,
      shariah_defaults: state.config.shariah,
      idempotency_key: `shariah:${watchlistItem.research_case_id}:holding-open:${holdingId}:v1`,
    })
    assertShariahGateAllowsTransition(gateDecision)
    return await openHoldingFromWatchlist(store, {
      holding_id: holdingId,
      watchlist_item_id: watchlistItem.watchlist_item_id,
      research_case_id: watchlistItem.research_case_id,
      company_id: watchlistItem.company_id ?? `company_${ticker.toLowerCase()}`,
      ticker,
      strategy_id: watchlistItem.strategy_id ?? state.config.strategy_id,
      thesis_summary: watchlistItem.thesis_summary ?? `Initial holding opened from watchlist item ${watchlistItem.watchlist_item_id}`,
      shares: lot.shares,
      cost_basis_per_share: lot.cost_basis_per_share,
      currency: lot.currency,
      opened_at: lot.opened_at,
      causation_id: `evt_watchlist_draft_confirmed_${watchlistItem.watchlist_item_id}`,
      actor_id: 'user_local',
      idempotency_key: `holding:${watchlistItem.watchlist_item_id}:open:v1`,
    })
  } finally {
    store.close()
  }
}

export async function recordPersonalHoldingValuation(
  state: OnboardingState,
  holdingId: string,
  input: RecordPersonalHoldingValuationInput = {},
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const holding = projectHoldings(await store.list()).find((candidate) => candidate.holding_id === holdingId)
    if (holding === undefined) {
      throw new Error(`Unknown holding: ${holdingId}`)
    }

    const valuation = parseHoldingValuationInput(input, holding.currency)
    const safeValuedAt = valuation.valued_at.replaceAll('-', '_')
    return await recordHoldingValuationSnapshot(store, {
      snapshot_id: `valuation_${holding.holding_id}_${safeValuedAt}_${Date.now()}`,
      holding_id: holding.holding_id,
      price_per_share: valuation.price_per_share,
      currency: valuation.currency,
      valued_at: valuation.valued_at,
      causation_id: `evt_holding_opened_${holding.holding_id}`,
      actor_id: 'user_local',
      idempotency_key: `holding:${holding.holding_id}:valuation:${valuation.valued_at}:${Date.now()}`,
    })
  } finally {
    store.close()
  }
}

export async function createPersonalHoldingReviewDraft(
  state: OnboardingState,
  holdingId: string,
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const holding = projectHoldings(await store.list()).find((candidate) => candidate.holding_id === holdingId)
    if (holding === undefined) {
      throw new Error(`Unknown holding: ${holdingId}`)
    }

    const reviewId = `review_${holding.holding_id}_${Date.now()}`
    await assertConfiguredProviderIsReady(state)
    const provider = resolveProvider({ provider_id: state.config.provider.provider_id })
    return await draftHoldingReview(store, provider, {
      review_id: reviewId,
      holding_id: holding.holding_id,
      model_id: resolveModelIdForProvider(state.config),
      causation_id: holding.latest_review_id === undefined
        ? `evt_holding_opened_${holding.holding_id}`
        : `evt_holding_review_confirmed_${holding.latest_review_id}`,
      idempotency_key: `holding:${holding.holding_id}:review:${reviewId}:draft`,
    })
  } finally {
    store.close()
  }
}

export async function confirmPersonalHoldingReviewDraft(
  state: OnboardingState,
  holdingId: string,
  reviewId: string,
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    return await confirmHoldingReviewDraft(store, {
      review_id: reviewId,
      holding_id: holdingId,
      causation_id: `evt_holding_review_drafted_${reviewId}`,
      actor_id: 'user_local',
      idempotency_key: `holding:${holdingId}:review:${reviewId}:confirm`,
    })
  } finally {
    store.close()
  }
}

export async function overridePersonalHoldingReviewDraft(
  state: OnboardingState,
  holdingId: string,
  reviewId: string,
  input: OverridePersonalHoldingReviewInput,
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const override = parseHoldingReviewOverrideInput(input)
  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    return await overrideHoldingReviewDraft(store, {
      review_id: reviewId,
      holding_id: holdingId,
      causation_id: `evt_holding_review_drafted_${reviewId}`,
      actor_id: 'user_local',
      thesis_health: override.thesis_health,
      action_stance: override.action_stance,
      rationale: override.rationale,
      evidence_summary: override.evidence_summary,
      uncertainty: override.uncertainty,
      next_review_at: override.next_review_at,
      idempotency_key: `holding:${holdingId}:review:${reviewId}:override`,
    })
  } finally {
    store.close()
  }
}

export async function rejectPersonalHoldingReviewDraft(
  state: OnboardingState,
  holdingId: string,
  reviewId: string,
  input: RejectPersonalHoldingReviewInput,
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const rejectionReason = parseRequiredText(input.rejection_reason, 'Rejection reason')
  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    return await rejectHoldingReviewDraft(store, {
      review_id: reviewId,
      holding_id: holdingId,
      causation_id: `evt_holding_review_drafted_${reviewId}`,
      actor_id: 'user_local',
      rejection_reason: rejectionReason,
      idempotency_key: `holding:${holdingId}:review:${reviewId}:reject`,
    })
  } finally {
    store.close()
  }
}

function parseHoldingLotInput(input: OpenPersonalHoldingInput): {
  shares: number
  cost_basis_per_share: number
  currency: string
  opened_at: string
} {
  const shares = parseRequiredNumber(input.shares ?? 1, 'Holding shares')
  const costBasisPerShare = parseRequiredNumber(input.cost_basis_per_share ?? 0, 'Cost basis per share')
  const currency = parseCurrency(input.currency, 'Holding currency', 'USD')
  const openedAt = String(input.opened_at ?? new Date().toISOString().slice(0, 10)).trim()

  if (shares <= 0) {
    throw new Error('Holding shares must be greater than zero')
  }
  if (costBasisPerShare < 0) {
    throw new Error('Cost basis per share cannot be negative')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(openedAt)) {
    throw new Error('Opened date must use YYYY-MM-DD format')
  }

  return {
    shares,
    cost_basis_per_share: costBasisPerShare,
    currency,
    opened_at: openedAt,
  }
}

function parseHoldingValuationInput(input: RecordPersonalHoldingValuationInput, fallbackCurrency: string): {
  price_per_share: number
  currency: string
  valued_at: string
} {
  const pricePerShare = parseRequiredNumber(input.price_per_share, 'Valuation price per share')
  const currency = parseCurrency(input.currency, 'Valuation currency', fallbackCurrency)
  const valuedAt = String(input.valued_at ?? new Date().toISOString().slice(0, 10)).trim()

  if (pricePerShare < 0) {
    throw new Error('Valuation price per share cannot be negative')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valuedAt)) {
    throw new Error('Valuation date must use YYYY-MM-DD format')
  }

  return {
    price_per_share: pricePerShare,
    currency,
    valued_at: valuedAt,
  }
}

function parseHoldingReviewOverrideInput(input: OverridePersonalHoldingReviewInput): {
  thesis_health: 'HEALTHY' | 'WATCH' | 'IMPAIRED' | 'EXIT_CANDIDATE'
  action_stance: 'HOLD' | 'ADD_ON_PULLBACK' | 'REDUCE' | 'EXIT_REVIEW_NEEDED' | 'RESEARCH_MORE'
  rationale: string
  evidence_summary: string
  uncertainty: string
  next_review_at: string
} {
  const thesisHealth = parseRequiredText(input.thesis_health, 'Override thesis health')
  const actionStance = parseRequiredText(input.action_stance, 'Override action stance')
  const nextReviewAt = parseRequiredText(input.next_review_at, 'Override next review date')

  if (!['HEALTHY', 'WATCH', 'IMPAIRED', 'EXIT_CANDIDATE'].includes(thesisHealth)) {
    throw new Error('Override thesis health is invalid')
  }
  if (!['HOLD', 'ADD_ON_PULLBACK', 'REDUCE', 'EXIT_REVIEW_NEEDED', 'RESEARCH_MORE'].includes(actionStance)) {
    throw new Error('Override action stance is invalid')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextReviewAt)) {
    throw new Error('Override next review date must use YYYY-MM-DD format')
  }

  return {
    thesis_health: thesisHealth as 'HEALTHY' | 'WATCH' | 'IMPAIRED' | 'EXIT_CANDIDATE',
    action_stance: actionStance as 'HOLD' | 'ADD_ON_PULLBACK' | 'REDUCE' | 'EXIT_REVIEW_NEEDED' | 'RESEARCH_MORE',
    rationale: parseRequiredText(input.rationale, 'Override rationale'),
    evidence_summary: parseRequiredText(input.evidence_summary, 'Override evidence summary'),
    uncertainty: parseRequiredText(input.uncertainty, 'Override uncertainty'),
    next_review_at: nextReviewAt,
  }
}

function parseRequiredText(value: FormDataEntryValue | string | null | undefined, label: string): string {
  const parsed = String(value ?? '').trim()
  if (parsed.length === 0) {
    throw new Error(`${label} is required`)
  }
  return parsed
}

function parseRequiredNumber(value: FormDataEntryValue | number | string | null | undefined, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number`)
  }
  return parsed
}

function parseCurrency(value: FormDataEntryValue | string | null | undefined, label: string, fallback: string): string {
  const parsed = String(value ?? fallback).trim().toUpperCase() || fallback
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: parsed }).format(0)
  } catch {
    throw new Error(`${label} must be a valid ISO 4217 currency code`)
  }
  return parsed
}

function buildPersonalWatchlistItems(events: Awaited<ReturnType<EventStore['list']>>): AppWatchlistItem[] {
  const holdingsByWatchlistId = new Map(projectHoldings(events).map((holding) => [holding.watchlist_item_id, holding]))

  return projectWatchlist(events).map((item) => {
    const holding = holdingsByWatchlistId.get(item.watchlist_item_id)
    return {
      ...item,
      ...(holding === undefined ? {} : { holding_id: holding.holding_id }),
    }
  })
}

function buildPersonalResearchCase(
  events: Awaited<ReturnType<EventStore['list']>>,
  researchCase: ResearchCaseProjection,
): AppResearchCase {
  const timeline = projectResearchCaseTimeline(events, researchCase.research_case_id)

  return {
    ...researchCase,
    gate_checklist: pendingChecklist.map((gate) => ({ ...gate })),
    source_ids: [...new Set(timeline.flatMap((entry) => entry.source_ids))],
    ledger_timeline: timeline,
    next_required_action: researchCase.next_required_action ?? `Start Buffett-Munger research for ${researchCase.ticker ?? researchCase.research_case_id}`,
  }
}

async function assertConfiguredProviderIsReady(state: OnboardingState): Promise<void> {
  const rows = await buildProviderStatusRows()
  const provider = rows.find((row) => row.provider_id === state.config.provider.provider_id)
  if (provider === undefined) {
    throw new Error(`Unknown provider: ${state.config.provider.provider_id}`)
  }
  if (!provider.is_ready) {
    throw new Error(`Provider ${provider.provider_id} is not ready: ${provider.status_label}`)
  }
}

export function resolveModelIdForProvider(config: Pick<AppConfig, 'provider'>): string {
  if (config.provider.model_id !== undefined && config.provider.model_id.length > 0) {
    return config.provider.model_id
  }

  if (config.provider.provider_id === 'mock-provider') {
    return 'mock-buffett-munger-demo'
  }

  if (config.provider.provider_id === 'claude') {
    return 'claude-sonnet-4-6'
  }

  return 'gpt-5.5'
}
