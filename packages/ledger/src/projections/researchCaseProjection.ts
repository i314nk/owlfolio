import type { LedgerEventEnvelope } from '../eventEnvelope'

export type ResearchCaseStage =
  | 'created'
  | 'analysis_drafted'
  | 'decision_drafted'
  | 'watchlist_draft'
  | 'watchlist_confirmed'
  | 'holding_opened'

export type ResearchCaseProjection = {
  research_case_id: string
  stage: ResearchCaseStage
  company_id?: string
  ticker?: string
  strategy_id?: string
  decision_id?: string
  investment_verdict?: string
  strategy_compliance?: string
  shariah_status?: string
  valuation_status?: string
  next_required_action?: string
  decision?: string
  user_approved?: boolean
  reason?: string
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

function applyString(
  target: ResearchCaseProjection,
  key: keyof Pick<
    ResearchCaseProjection,
    | 'company_id'
    | 'ticker'
    | 'strategy_id'
    | 'decision_id'
    | 'investment_verdict'
    | 'strategy_compliance'
    | 'shariah_status'
    | 'valuation_status'
    | 'next_required_action'
    | 'decision'
    | 'reason'
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
      const researchCase = upsertCase(researchCases, event.aggregate_id, 'created', event.created_at)
      applyString(researchCase, 'company_id', getString(event.payload, 'company_id'))
      applyString(researchCase, 'ticker', getString(event.payload, 'ticker'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
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
      applyBoolean(researchCase, 'user_approved', getBoolean(event.payload, 'user_approved'))
      continue
    }

    if (event.event_type === 'watchlist_draft_confirmed') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'watchlist_confirmed', event.created_at)
      applyBoolean(researchCase, 'user_approved', true)
      continue
    }

    if (event.event_type === 'holding_opened') {
      const researchCaseId = researchCaseIdFor(event, event.payload)
      if (researchCaseId === undefined) {
        continue
      }

      const researchCase = upsertCase(researchCases, researchCaseId, 'holding_opened', event.created_at)
      applyString(researchCase, 'company_id', getString(event.payload, 'company_id'))
      applyString(researchCase, 'ticker', getString(event.payload, 'ticker'))
      applyString(researchCase, 'strategy_id', getString(event.payload, 'strategy_id'))
      applyBoolean(researchCase, 'user_approved', true)
    }
  }

  return [...researchCases.values()]
}
