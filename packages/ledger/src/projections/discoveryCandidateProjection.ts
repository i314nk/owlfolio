import type { LedgerEventEnvelope } from '../eventEnvelope'

export type DiscoveryCandidateStatus =
  | 'discovered'
  | 'duplicate'
  | 'queued_for_quick_screen'
  | 'rejected'
  | 'promoted_to_research_case'

export type DiscoveryDuplicateTargetType = 'discovery_candidate' | 'research_case' | 'watchlist_item' | 'holding'

export type DiscoveryCandidateProjection = {
  candidate_id: string
  ticker: string
  company_name: string
  market: string
  strategy_id: string
  strategy_version: string
  discovery_source: string
  source_ids: string[]
  discovered_at: string
  status: DiscoveryCandidateStatus
  dedupe_key: string
  duplicate_target_type?: DiscoveryDuplicateTargetType
  duplicate_target_id?: string
  queue_id?: string
  reason?: string
  research_case_id?: string
  research_case_event_id?: string
  /**
   * Optional structured provenance carried by non-mock discovery sources. For source:'13f_clone' this
   * holds { signal_type, contributing_managers, conviction_pct, ticker_resolution, … }. Absent for
   * strategy-screen / user-submitted candidates. Opaque to the projection (recorded as-is).
   */
  discovery_metadata?: Record<string, unknown>
  updated_at: string
}

export type DiscoverySignalType = 'CLUSTER_BUY' | 'NEW_POSITION' | 'MEANINGFUL_ADD'

/**
 * The 13F discovery signal detail surfaced from a candidate's `discovery_metadata`. Tells the user WHY a
 * name surfaced: the signal class (CLUSTER_BUY > NEW_POSITION > MEANINGFUL_ADD), the managers behind it,
 * the conviction weight, and whether the ticker was resolved from the CUSIP (an unresolved ticker is
 * flagged, never guessed).
 */
export type DiscoverySignal = {
  signal_type: DiscoverySignalType
  contributing_managers: string[]
  conviction_pct: number
  ticker_unresolved: boolean
  rationale?: string
}

const SIGNAL_TYPES: DiscoverySignalType[] = ['CLUSTER_BUY', 'NEW_POSITION', 'MEANINGFUL_ADD']

/**
 * Pull the typed 13F signal out of a candidate's opaque `discovery_metadata`. Fail-closed: returns
 * undefined unless a recognized signal_type is present (so strategy-screen / user-submitted candidates,
 * which carry no signal, render without a badge).
 */
export function extractDiscoverySignal(metadata: Record<string, unknown> | undefined): DiscoverySignal | undefined {
  if (!isRecord(metadata)) {
    return undefined
  }
  const rawSignal = metadata['signal_type']
  if (typeof rawSignal !== 'string' || !SIGNAL_TYPES.includes(rawSignal as DiscoverySignalType)) {
    return undefined
  }
  const managers = Array.isArray(metadata['contributing_managers'])
    ? metadata['contributing_managers'].filter((entry): entry is string => typeof entry === 'string')
    : []
  const conviction = metadata['conviction_pct']
  const rationale = metadata['rationale']
  return {
    signal_type: rawSignal as DiscoverySignalType,
    contributing_managers: managers,
    conviction_pct: typeof conviction === 'number' && Number.isFinite(conviction) ? conviction : 0,
    ticker_unresolved: metadata['ticker_resolution'] === 'unresolved',
    ...(typeof rationale === 'string' ? { rationale } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function getStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key]
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string')
}

function candidateIdFor(event: LedgerEventEnvelope<unknown>, payload: Record<string, unknown>): string {
  return getString(payload, 'candidate_id') ?? event.aggregate_id
}

function upsertCandidate(
  candidates: Map<string, DiscoveryCandidateProjection>,
  event: LedgerEventEnvelope<unknown>,
  payload: Record<string, unknown>,
  status: DiscoveryCandidateStatus,
): DiscoveryCandidateProjection | undefined {
  const candidateId = candidateIdFor(event, payload)
  const existing = candidates.get(candidateId)
  if (existing !== undefined) {
    existing.status = status
    existing.updated_at = event.created_at
    return existing
  }

  const ticker = getString(payload, 'ticker')
  const companyName = getString(payload, 'company_name')
  const market = getString(payload, 'market')
  const strategyId = getString(payload, 'strategy_id')
  const strategyVersion = getString(payload, 'strategy_version')
  const discoverySource = getString(payload, 'discovery_source')
  const discoveredAt = getString(payload, 'discovered_at') ?? event.created_at
  const dedupeKey = getString(payload, 'dedupe_key')
  if (
    ticker === undefined
    || companyName === undefined
    || market === undefined
    || strategyId === undefined
    || strategyVersion === undefined
    || discoverySource === undefined
    || dedupeKey === undefined
  ) {
    return undefined
  }

  const created: DiscoveryCandidateProjection = {
    candidate_id: candidateId,
    ticker,
    company_name: companyName,
    market,
    strategy_id: strategyId,
    strategy_version: strategyVersion,
    discovery_source: discoverySource,
    source_ids: getStringArray(payload, 'source_ids').length > 0 ? getStringArray(payload, 'source_ids') : [...event.source_ids],
    discovered_at: discoveredAt,
    status,
    dedupe_key: dedupeKey,
    updated_at: event.created_at,
  }
  const discoveryMetadata = payload['discovery_metadata']
  if (isRecord(discoveryMetadata)) {
    created.discovery_metadata = discoveryMetadata
  }
  candidates.set(candidateId, created)
  return created
}

function isDuplicateTargetType(value: string | undefined): value is DiscoveryDuplicateTargetType {
  return value === 'discovery_candidate' || value === 'research_case' || value === 'watchlist_item' || value === 'holding'
}

function applyString(
  candidate: DiscoveryCandidateProjection,
  key: keyof Pick<
    DiscoveryCandidateProjection,
    'duplicate_target_id' | 'queue_id' | 'reason' | 'research_case_id' | 'research_case_event_id'
  >,
  value: string | undefined,
): void {
  if (value !== undefined) {
    candidate[key] = value
  }
}

export function projectDiscoveryCandidates(events: LedgerEventEnvelope<unknown>[]): DiscoveryCandidateProjection[] {
  const candidates = new Map<string, DiscoveryCandidateProjection>()

  for (const event of events) {
    if (!event.event_type.startsWith('discovery_candidate_') || !isRecord(event.payload)) {
      continue
    }

    if (event.event_type === 'discovery_candidate_discovered') {
      const status = getString(event.payload, 'status') === 'duplicate' ? 'duplicate' : 'discovered'
      const candidate = upsertCandidate(candidates, event, event.payload, status)
      if (candidate === undefined) {
        continue
      }
      const duplicateTargetType = getString(event.payload, 'duplicate_target_type')
      if (isDuplicateTargetType(duplicateTargetType)) {
        candidate.duplicate_target_type = duplicateTargetType
      }
      applyString(candidate, 'duplicate_target_id', getString(event.payload, 'duplicate_target_id'))
      continue
    }

    if (event.event_type === 'discovery_candidate_queued_for_quick_screen') {
      const candidate = upsertCandidate(candidates, event, event.payload, 'queued_for_quick_screen')
      if (candidate === undefined) {
        continue
      }
      applyString(candidate, 'queue_id', getString(event.payload, 'queue_id'))
      continue
    }

    if (event.event_type === 'discovery_candidate_rejected') {
      const candidate = upsertCandidate(candidates, event, event.payload, 'rejected')
      if (candidate === undefined) {
        continue
      }
      applyString(candidate, 'reason', getString(event.payload, 'reason'))
      continue
    }

    if (event.event_type === 'discovery_candidate_promoted_to_research_case') {
      const candidate = upsertCandidate(candidates, event, event.payload, 'promoted_to_research_case')
      if (candidate === undefined) {
        continue
      }
      applyString(candidate, 'research_case_id', getString(event.payload, 'research_case_id'))
      applyString(candidate, 'research_case_event_id', getString(event.payload, 'research_case_event_id'))
    }
  }

  return [...candidates.values()]
}
