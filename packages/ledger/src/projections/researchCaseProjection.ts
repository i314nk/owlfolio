import type { LedgerEventEnvelope } from '../eventEnvelope'

export type ResearchCaseStage =
  | 'discovered'
  | 'quick_screened'
  | 'awaiting_deep_dive_approval'
  | 'queued_for_deep_dive'
  | 'deep_dive_started'
  | 'specialist_finding_recorded'
  | 'deep_dive_in_progress'
  | 'deep_dive_synthesis_drafted'
  | 'deep_dive_completed'
  | 'deep_dive_complete'
  | 'decision_pending'
  | 'watchlist'
  | 'holding'
  | 'rejected'
  | 'pass'
  | 'analysis_drafted'
  | 'decision_drafted'
  | 'watchlist_draft'

export type ResearchCaseOwnerEarningsValuationProjection = {
  summary?: string
  normalized_owner_earnings?: string
  assumptions?: string[]
  fair_value_range?: string
  buy_price_range?: string
  margin_of_safety?: string
  sources?: string[]
  confidence?: string
  caveats?: string[]
}

export type ResearchCaseSpecialistFindingProjection = {
  finding_id: string
  deep_dive_id?: string
  specialist_lane?: string
  finding_summary?: string
  confidence?: string
  caveats?: string[]
  source_ids?: string[]
  provider_run_id?: string
  owner_earnings_valuation?: ResearchCaseOwnerEarningsValuationProjection
}

export type ResearchCaseValuationProjection = {
  moat_class?: string
  moat_passes_gate?: boolean
  hurdle_rate?: number
  growth_assumptions?: string
  growth_rate?: number
  normalized_owner_earnings_per_share?: number
  buy_price_per_share?: number
  value_basis?: string
}

export type ResearchCaseProjection = {
  research_case_id: string
  version: number
  supersedes_research_case_id?: string
  superseded: boolean
  stage: ResearchCaseStage
  candidate_id?: string
  company_id?: string
  ticker?: string
  strategy_id?: string
  strategy_version?: string
  quick_screen_id?: string
  screening_result?: string
  business_quality?: string
  moat?: string
  management_capital_allocation?: string
  financial_quality?: string
  valuation_sanity?: string
  red_flags?: string[]
  confidence?: string
  caveats?: string[]
  deep_dive_id?: string
  finding_id?: string
  specialist_lane?: string
  specialist_findings?: ResearchCaseSpecialistFindingProjection[]
  owner_earnings_valuation?: ResearchCaseOwnerEarningsValuationProjection
  valuation?: ResearchCaseValuationProjection
  synthesis_id?: string
  decision_id?: string
  investment_verdict?: string
  strategy_compliance?: string
  shariah_status?: string
  valuation_status?: string
  next_required_action?: string
  decision?: string
  user_approved?: boolean
  reason?: string
  thesis_summary?: string
  evidence_summary?: string
  valuation_rationale?: string
  shariah_rationale?: string
  risks?: string[]
  open_questions?: string[]
  updated_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function getBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key]
  return typeof value === 'boolean' ? value : undefined
}

function getStringArray(payload: Record<string, unknown>, key: string): string[] | undefined {
  const value = payload[key]
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return undefined
  }

  return [...value]
}

function getNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key]
  return typeof value === 'number' && isFinite(value) ? value : undefined
}

function getValuation(payload: Record<string, unknown>): ResearchCaseValuationProjection | undefined {
  const value = payload['valuation']
  if (!isRecord(value)) {
    return undefined
  }

  const projected: ResearchCaseValuationProjection = {}
  const moat_class = getString(value, 'moat_class')
  if (moat_class !== undefined) projected.moat_class = moat_class
  const moat_passes_gate = typeof value['moat_passes_gate'] === 'boolean' ? value['moat_passes_gate'] : undefined
  if (moat_passes_gate !== undefined) projected.moat_passes_gate = moat_passes_gate
  const growth_assumptions = getString(value, 'growth_assumptions')
  if (growth_assumptions !== undefined) projected.growth_assumptions = growth_assumptions
  const hurdle_rate = getNumber(value, 'hurdle_rate')
  if (hurdle_rate !== undefined) projected.hurdle_rate = hurdle_rate
  const growth_rate = getNumber(value, 'growth_rate')
  if (growth_rate !== undefined) projected.growth_rate = growth_rate
  const normalized_owner_earnings_per_share = getNumber(value, 'normalized_owner_earnings_per_share')
  if (normalized_owner_earnings_per_share !== undefined) projected.normalized_owner_earnings_per_share = normalized_owner_earnings_per_share
  const buy_price_per_share = getNumber(value, 'buy_price_per_share')
  if (buy_price_per_share !== undefined) projected.buy_price_per_share = buy_price_per_share
  const value_basis = getString(value, 'value_basis')
  if (value_basis !== undefined) projected.value_basis = value_basis

  return Object.keys(projected).length === 0 ? undefined : projected
}

function getOwnerEarningsValuation(payload: Record<string, unknown>): ResearchCaseOwnerEarningsValuationProjection | undefined {
  const value = payload.owner_earnings_valuation
  if (!isRecord(value)) {
    return undefined
  }

  const projected: ResearchCaseOwnerEarningsValuationProjection = {}
  const stringKeys = [
    'summary',
    'normalized_owner_earnings',
    'fair_value_range',
    'buy_price_range',
    'margin_of_safety',
    'confidence',
  ] as const
  for (const key of stringKeys) {
    const stringValue = getString(value, key)
    if (stringValue !== undefined) {
      projected[key] = stringValue
    }
  }
  const assumptions = getStringArray(value, 'assumptions')
  if (assumptions !== undefined) {
    projected.assumptions = assumptions
  }
  const sources = getStringArray(value, 'sources')
  if (sources !== undefined) {
    projected.sources = sources
  }
  const caveats = getStringArray(value, 'caveats')
  if (caveats !== undefined) {
    projected.caveats = caveats
  }

  return Object.keys(projected).length === 0 ? undefined : projected
}

function applyString(
  target: ResearchCaseProjection,
  key: keyof Pick<
    ResearchCaseProjection,
    | 'company_id'
    | 'ticker'
    | 'candidate_id'
    | 'strategy_id'
    | 'strategy_version'
    | 'quick_screen_id'
    | 'screening_result'
    | 'business_quality'
    | 'moat'
    | 'management_capital_allocation'
    | 'financial_quality'
    | 'valuation_sanity'
    | 'deep_dive_id'
    | 'finding_id'
    | 'specialist_lane'
    | 'synthesis_id'
    | 'decision_id'
    | 'investment_verdict'
    | 'strategy_compliance'
    | 'shariah_status'
    | 'valuation_status'
    | 'next_required_action'
    | 'decision'
    | 'reason'
    | 'thesis_summary'
    | 'evidence_summary'
    | 'valuation_rationale'
    | 'shariah_rationale'
    | 'confidence'
    | 'supersedes_research_case_id'
  >,
  value: string | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function applyBoolean(
  target: ResearchCaseProjection,
  key: keyof Pick<ResearchCaseProjection, 'user_approved'>,
  value: boolean | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function applyStringArray(
  target: ResearchCaseProjection,
  key: keyof Pick<ResearchCaseProjection, 'red_flags' | 'caveats' | 'risks' | 'open_questions'>,
  value: string[] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function recordSpecialistFinding(
  target: ResearchCaseProjection,
  payload: Record<string, unknown>,
): void {
  const findingId = getString(payload, 'finding_id')
  if (findingId === undefined) {
    return
  }

  const finding: ResearchCaseSpecialistFindingProjection = {
    finding_id: findingId,
  }
  const deepDiveId = getString(payload, 'deep_dive_id')
  const specialistLane = getString(payload, 'specialist_lane')
  const findingSummary = getString(payload, 'finding_summary')
  const confidence = getString(payload, 'confidence')
  const caveats = getStringArray(payload, 'caveats')
  const sourceIds = getStringArray(payload, 'source_ids')
  const providerRunId = getString(payload, 'provider_run_id')
  const ownerEarningsValuation = getOwnerEarningsValuation(payload)

  if (deepDiveId !== undefined) {
    finding.deep_dive_id = deepDiveId
  }
  if (specialistLane !== undefined) {
    finding.specialist_lane = specialistLane
  }
  if (findingSummary !== undefined) {
    finding.finding_summary = findingSummary
  }
  if (confidence !== undefined) {
    finding.confidence = confidence
  }
  if (caveats !== undefined) {
    finding.caveats = caveats
  }
  if (sourceIds !== undefined) {
    finding.source_ids = sourceIds
  }
  if (providerRunId !== undefined) {
    finding.provider_run_id = providerRunId
  }
  if (ownerEarningsValuation !== undefined) {
    finding.owner_earnings_valuation = ownerEarningsValuation
    target.owner_earnings_valuation = ownerEarningsValuation
  }

  const previousFindings = target.specialist_findings ?? []
  target.specialist_findings = [
    ...previousFindings.filter((previousFinding) => previousFinding.finding_id !== findingId),
    finding,
  ]
}

function researchCaseIdFor(event: LedgerEventEnvelope<unknown>, payload: Record<string, unknown>): string | undefined {
  if (event.aggregate_type === 'research_case') {
    return event.aggregate_id
  }

  return getString(payload, 'research_case_id') ?? event.correlation_id
}

function upsertCase(
  researchCases: Map<string, ResearchCaseProjection>,
  researchCaseId: string,
  stage: ResearchCaseStage,
  updatedAt: string,
): ResearchCaseProjection {
  const existing = researchCases.get(researchCaseId)
  if (existing !== undefined) {
    existing.stage = stage
    existing.updated_at = updatedAt
    return existing
  }

  const created: ResearchCaseProjection = {
    research_case_id: researchCaseId,
    version: 1,
    superseded: false,
    stage,
    updated_at: updatedAt,
  }
  researchCases.set(researchCaseId, created)
  return created
}

export function projectResearchCases(events: LedgerEventEnvelope<unknown>[]): ResearchCaseProjection[] {
  const researchCases = new Map<string, ResearchCaseProjection>()

  for (const event of events) {
    if (!isRecord(event.payload)) {
      continue
    }

    if (event.event_type === 'research_case_created') {
      const researchCase = upsertCase(researchCases, event.aggregate_id, 'discovered', event.created_at)
      applyString(researchCase, 'company_id', getString(event.payload, 'company_id'))
      applyString(researchCase, 'ticker', getString(event.payload, 'ticker'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      const version = getNumber(event.payload, 'version')
      if (version !== undefined) {
        researchCase.version = version
      }
      applyString(researchCase, 'supersedes_research_case_id', getString(event.payload, 'supersedes_research_case_id'))
      continue
    }

    if (event.event_type === 'quick_screen_drafted') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const screeningResult = getString(event.payload, 'screening_result')
      const stage = screeningResult === 'reject' ? 'rejected' : screeningResult === 'pass' ? 'pass' : 'quick_screened'
      const researchCase = upsertCase(researchCases, researchCaseId, stage, event.created_at)
      applyString(researchCase, 'company_id', getString(event.payload, 'company_id'))
      applyString(researchCase, 'ticker', getString(event.payload, 'ticker'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyString(researchCase, 'quick_screen_id', getString(event.payload, 'quick_screen_id'))
      applyString(researchCase, 'screening_result', screeningResult)
      applyString(researchCase, 'business_quality', getString(event.payload, 'business_quality'))
      applyString(researchCase, 'moat', getString(event.payload, 'moat'))
      applyString(researchCase, 'management_capital_allocation', getString(event.payload, 'management_capital_allocation'))
      applyString(researchCase, 'financial_quality', getString(event.payload, 'financial_quality'))
      applyString(researchCase, 'valuation_sanity', getString(event.payload, 'valuation_sanity'))
      applyString(researchCase, 'shariah_status', getString(event.payload, 'shariah_status'))
      applyStringArray(researchCase, 'red_flags', getStringArray(event.payload, 'red_flags'))
      applyString(researchCase, 'confidence', getString(event.payload, 'confidence'))
      applyStringArray(researchCase, 'caveats', getStringArray(event.payload, 'caveats'))
      applyString(researchCase, 'next_required_action', getString(event.payload, 'summary'))
      continue
    }

    if (event.event_type === 'deep_dive_approval_pending') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      // Only set stage to awaiting_deep_dive_approval if no queued_for_deep_dive or decision has happened yet.
      // (If the deep dive was subsequently triggered, the queued_for_deep_dive event supersedes this.)
      const existing = researchCases.get(researchCaseId)
      const alreadyProgressed = existing !== undefined && (
        existing.stage === 'queued_for_deep_dive'
        || existing.stage === 'deep_dive_started'
        || existing.stage === 'specialist_finding_recorded'
        || existing.stage === 'deep_dive_in_progress'
        || existing.stage === 'deep_dive_synthesis_drafted'
        || existing.stage === 'deep_dive_completed'
        || existing.stage === 'deep_dive_complete'
        || existing.stage === 'analysis_drafted'
        || existing.stage === 'decision_drafted'
        || existing.stage === 'decision_pending'
        || existing.stage === 'watchlist_draft'
        || existing.stage === 'watchlist'
        || existing.stage === 'holding'
        || existing.stage === 'rejected'
        || existing.stage === 'pass'
      )
      if (!alreadyProgressed) {
        upsertCase(researchCases, researchCaseId, 'awaiting_deep_dive_approval', event.created_at)
      }
      continue
    }

    if (event.event_type === 'queued_for_deep_dive') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'queued_for_deep_dive', event.created_at)
      applyString(researchCase, 'candidate_id', getString(event.payload, 'candidate_id'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      continue
    }

    if (event.event_type === 'deep_dive_started') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'deep_dive_started', event.created_at)
      applyString(researchCase, 'candidate_id', getString(event.payload, 'candidate_id'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyString(researchCase, 'deep_dive_id', getString(event.payload, 'deep_dive_id'))
      continue
    }

    if (event.event_type === 'specialist_finding_recorded') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'specialist_finding_recorded', event.created_at)
      applyString(researchCase, 'candidate_id', getString(event.payload, 'candidate_id'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyString(researchCase, 'deep_dive_id', getString(event.payload, 'deep_dive_id'))
      applyString(researchCase, 'finding_id', getString(event.payload, 'finding_id'))
      applyString(researchCase, 'specialist_lane', getString(event.payload, 'specialist_lane'))
      applyString(researchCase, 'confidence', getString(event.payload, 'confidence'))
      applyStringArray(researchCase, 'caveats', getStringArray(event.payload, 'caveats'))
      recordSpecialistFinding(researchCase, event.payload)
      continue
    }

    if (event.event_type === 'deep_dive_synthesis_drafted') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'deep_dive_synthesis_drafted', event.created_at)
      applyString(researchCase, 'candidate_id', getString(event.payload, 'candidate_id'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyString(researchCase, 'deep_dive_id', getString(event.payload, 'deep_dive_id'))
      applyString(researchCase, 'synthesis_id', getString(event.payload, 'synthesis_id'))
      applyString(researchCase, 'confidence', getString(event.payload, 'confidence'))
      applyStringArray(researchCase, 'caveats', getStringArray(event.payload, 'caveats'))
      continue
    }

    if (event.event_type === 'deep_dive_completed') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'deep_dive_completed', event.created_at)
      applyString(researchCase, 'candidate_id', getString(event.payload, 'candidate_id'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyString(researchCase, 'deep_dive_id', getString(event.payload, 'deep_dive_id'))
      applyString(researchCase, 'synthesis_id', getString(event.payload, 'synthesis_id'))
      applyString(researchCase, 'confidence', getString(event.payload, 'confidence'))
      applyStringArray(researchCase, 'caveats', getStringArray(event.payload, 'caveats'))
      continue
    }

    if (event.event_type === 'strategy_decision_drafted') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'decision_pending', event.created_at)
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyString(researchCase, 'decision_id', getString(event.payload, 'decision_id') ?? event.aggregate_id)
      applyString(researchCase, 'decision', getString(event.payload, 'decision'))
      applyString(researchCase, 'reason', getString(event.payload, 'decision_summary'))
      applyBoolean(researchCase, 'user_approved', false)
      continue
    }

    if (event.event_type === 'buffett_munger_analysis_drafted') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'analysis_drafted', event.created_at)
      applyString(researchCase, 'investment_verdict', getString(event.payload, 'investment_verdict'))
      applyString(researchCase, 'strategy_compliance', getString(event.payload, 'strategy_compliance'))
      applyString(researchCase, 'shariah_status', getString(event.payload, 'shariah_status'))
      applyString(researchCase, 'valuation_status', getString(event.payload, 'valuation_status'))
      applyString(researchCase, 'next_required_action', getString(event.payload, 'next_required_action'))
      const valuation = getValuation(event.payload)
      if (valuation !== undefined) {
        researchCase.valuation = valuation
      }
      continue
    }

    if (event.event_type === 'decision_drafted') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'decision_drafted', event.created_at)
      applyString(researchCase, 'decision_id', getString(event.payload, 'decision_id') ?? event.aggregate_id)
      applyString(researchCase, 'decision', getString(event.payload, 'decision'))
      applyBoolean(researchCase, 'user_approved', getBoolean(event.payload, 'user_approved'))
      applyString(researchCase, 'reason', getString(event.payload, 'reason'))
      applyString(researchCase, 'thesis_summary', getString(event.payload, 'thesis_summary'))
      applyString(researchCase, 'evidence_summary', getString(event.payload, 'evidence_summary'))
      applyString(researchCase, 'valuation_rationale', getString(event.payload, 'valuation_rationale'))
      applyString(researchCase, 'shariah_rationale', getString(event.payload, 'shariah_rationale'))
      applyStringArray(researchCase, 'risks', getStringArray(event.payload, 'risks'))
      applyStringArray(researchCase, 'open_questions', getStringArray(event.payload, 'open_questions'))
      continue
    }

    if (event.event_type === 'watchlist_draft_created') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'watchlist_draft', event.created_at)
      applyString(researchCase, 'company_id', getString(event.payload, 'company_id'))
      applyString(researchCase, 'ticker', getString(event.payload, 'ticker'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyBoolean(researchCase, 'user_approved', getBoolean(event.payload, 'user_approved'))
      continue
    }

    if (event.event_type === 'watchlist_draft_confirmed') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'watchlist', event.created_at)
      applyBoolean(researchCase, 'user_approved', true)
      continue
    }

    if (event.event_type === 'holding_opened') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'holding', event.created_at)
      applyString(researchCase, 'company_id', getString(event.payload, 'company_id'))
      applyString(researchCase, 'ticker', getString(event.payload, 'ticker'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyString(researchCase, 'strategy_version', getString(event.payload, 'strategy_version'))
      applyBoolean(researchCase, 'user_approved', true)
    }
  }

  // Compute superseded: a case is superseded if any other case has supersedes_research_case_id pointing to it.
  const supersededIds = new Set<string>()
  for (const researchCase of researchCases.values()) {
    if (researchCase.supersedes_research_case_id !== undefined) {
      supersededIds.add(researchCase.supersedes_research_case_id)
    }
  }
  for (const researchCase of researchCases.values()) {
    researchCase.superseded = supersededIds.has(researchCase.research_case_id)
  }

  return [...researchCases.values()]
}

/**
 * Returns all versions of research cases for a given ticker, ordered by version ascending.
 * The last entry (highest version) is the canonical latest.
 */
export function projectResearchCaseVersionsForTicker(events: LedgerEventEnvelope<unknown>[], ticker: string): ResearchCaseProjection[] {
  const all = projectResearchCases(events)
  return all
    .filter((researchCase) => researchCase.ticker?.toUpperCase() === ticker.toUpperCase())
    .sort((a, b) => a.version - b.version)
}

/**
 * Returns the latest non-superseded research case for the given ticker, or undefined if none exists.
 */
export function findLatestResearchCaseForTicker(events: LedgerEventEnvelope<unknown>[], ticker: string): ResearchCaseProjection | undefined {
  const versions = projectResearchCaseVersionsForTicker(events, ticker)
  // The latest version is the one with the highest version number and not superseded
  // (which by definition is the last in sorted order since superseded means a newer one points to it)
  const nonSuperseded = versions.filter((researchCase) => !researchCase.superseded)
  if (nonSuperseded.length === 0) {
    return undefined
  }
  // Return the highest version among non-superseded (should be exactly one in normal flow)
  return nonSuperseded.reduce((best, current) => current.version > best.version ? current : best)
}
