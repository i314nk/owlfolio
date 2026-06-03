import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import { evaluateShariahPolicy, policyFromAppConfig, type ShariahAssessment, type ShariahStatus } from '@owlfolio/shariah'
import type { ShariahDefaults } from '@owlfolio/shared/appConfig'

export type ShariahGateStatus = ShariahStatus
export type ShariahGateTransition = 'watchlist_promotion' | 'watchlist_confirmation' | 'holding_open'

export type ShariahGateDecision = {
  gate_decision_id: string
  target_transition: ShariahGateTransition
  target_id: string
  research_case_id: string
  status: ShariahGateStatus
  allowed: boolean
  requires_user_confirmation: boolean
  reasons: string[]
  required_source_ids: string[]
  missing_evidence: string[]
  conditional_allowed: boolean
}

export type EvaluateResearchCaseShariahGateCommand = {
  research_case_id: string
  target_transition: ShariahGateTransition
  target_id: string
  shariah_defaults: ShariahDefaults
  idempotency_key?: string
}

type WorkflowEventStore = EventStore<LedgerEventEnvelope<unknown>>
type ResearchAnalysisStatus = 'COMPLIANT' | 'CONDITIONAL' | 'NON_COMPLIANT' | 'UNKNOWN'

type ResearchAnalysisPayload = {
  research_case_id: string
  ticker: string
  company_id: string
  shariah_status?: ResearchAnalysisStatus
}

function nowIso(): string {
  return new Date().toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function analysisPayload(event: LedgerEventEnvelope<unknown>): ResearchAnalysisPayload | undefined {
  if (event.event_type !== 'buffett_munger_analysis_drafted' || !isRecord(event.payload)) {
    return undefined
  }

  const researchCaseId = getString(event.payload, 'research_case_id')
  const ticker = getString(event.payload, 'ticker')
  const companyId = getString(event.payload, 'company_id')
  if (researchCaseId === undefined || ticker === undefined || companyId === undefined) {
    return undefined
  }

  const rawStatus = getString(event.payload, 'shariah_status')
  const shariahStatus = rawStatus === 'COMPLIANT' || rawStatus === 'CONDITIONAL' || rawStatus === 'NON_COMPLIANT' || rawStatus === 'UNKNOWN'
    ? rawStatus
    : undefined

  return {
    research_case_id: researchCaseId,
    ticker,
    company_id: companyId,
    ...(shariahStatus === undefined ? {} : { shariah_status: shariahStatus }),
  }
}

function latestAnalysisFor(events: LedgerEventEnvelope<unknown>[], researchCaseId: string): LedgerEventEnvelope<unknown> | undefined {
  return events
    .filter((event) => analysisPayload(event)?.research_case_id === researchCaseId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0]
}

function sourceIdAt(sourceIds: string[], index: number): string | undefined {
  return sourceIds[index] ?? sourceIds[0]
}

function assessmentFromAnalysis(status: ResearchAnalysisStatus | undefined, sourceIds: string[], defaults: ShariahDefaults): ShariahAssessment {
  if (status === undefined || status === 'UNKNOWN' || sourceIds.length === 0) {
    return { evidence: [] }
  }

  const businessSourceId = sourceIdAt(sourceIds, 0)
  const incomeSourceId = sourceIdAt(sourceIds, 1)
  const evidence = [
    ...(businessSourceId === undefined ? [] : [{ requirement_id: 'business_activity' as const, source_id: businessSourceId, summary: `Research analysis supplied ${status} business activity evidence.` }]),
    ...(incomeSourceId === undefined ? [] : [{ requirement_id: 'non_compliant_income_ratio' as const, source_id: incomeSourceId, summary: `Research analysis supplied ${status} non-compliant income evidence.` }]),
  ]

  if (status === 'COMPLIANT') {
    return {
      business_activity: 'permissible',
      non_compliant_income_ratio: Math.max(0, defaults.non_compliant_income_threshold - 0.001),
      evidence,
    }
  }

  if (status === 'CONDITIONAL') {
    return {
      business_activity: 'uncertain',
      non_compliant_income_ratio: Math.max(0, defaults.non_compliant_income_threshold - 0.001),
      evidence,
    }
  }

  return {
    business_activity: 'prohibited',
    non_compliant_income_ratio: Math.min(1, defaults.non_compliant_income_threshold + 0.001),
    evidence,
  }
}

function gateDecisionId(transition: ShariahGateTransition, targetId: string): string {
  return `gate_${transition}_${targetId}`
}

export async function evaluateResearchCaseShariahGate(
  store: WorkflowEventStore,
  command: EvaluateResearchCaseShariahGateCommand,
): Promise<ShariahGateDecision> {
  const events = await store.list()
  const analysis = latestAnalysisFor(events, command.research_case_id)
  const payload = analysis === undefined ? undefined : analysisPayload(analysis)
  const sourceIds = analysis?.source_ids ?? []
  const policy = policyFromAppConfig(command.shariah_defaults)
  const subject: { ticker?: string; company_name?: string } = {}
  if (payload?.ticker !== undefined) {
    subject.ticker = payload.ticker
  }
  if (payload?.company_id !== undefined) {
    subject.company_name = payload.company_id
  }
  const result = evaluateShariahPolicy({
    policy,
    subject,
    assessment: assessmentFromAnalysis(payload?.shariah_status, sourceIds, command.shariah_defaults),
  })
  const allowed = result.status === 'COMPLIANT' || (result.status === 'CONDITIONAL' && command.shariah_defaults.allow_conditional)
  const decisionId = gateDecisionId(command.target_transition, command.target_id)
  const evaluationEventId = `evt_shariah_evaluation_recorded_${decisionId}`
  const createdAt = nowIso()

  const evaluationEvent: LedgerEventEnvelope<unknown> = {
    event_id: evaluationEventId,
    event_type: 'shariah_evaluation_recorded',
    aggregate_type: 'holding',
    aggregate_id: command.target_id,
    correlation_id: command.research_case_id,
    actor_type: 'provider',
    actor_id: analysis?.actor_id ?? 'research-analysis',
    payload: {
      evaluation_id: `eval_${decisionId}`,
      holding_id: command.target_id,
      status: result.status,
      policy_basis: result.policy_basis,
      source_ids: sourceIds,
      reasons: result.reasons,
      failed_requirements: result.failed_requirements,
      conditional_requirements: result.conditional_requirements,
      missing_evidence: result.missing_evidence,
    },
    source_ids: sourceIds,
    created_at: createdAt,
    schema_version: 1,
  }
  if (analysis?.event_id !== undefined) {
    evaluationEvent.causation_id = analysis.event_id
  }
  if (command.idempotency_key !== undefined) {
    evaluationEvent.idempotency_key = `${command.idempotency_key}:evaluation`
  }
  await store.append(evaluationEvent)

  const decision: ShariahGateDecision = {
    gate_decision_id: decisionId,
    target_transition: command.target_transition,
    target_id: command.target_id,
    research_case_id: command.research_case_id,
    status: result.status,
    allowed,
    requires_user_confirmation: result.requires_user_confirmation,
    reasons: result.reasons,
    required_source_ids: sourceIds,
    missing_evidence: result.missing_evidence,
    conditional_allowed: command.shariah_defaults.allow_conditional,
  }

  await store.append({
    event_id: `evt_shariah_gate_decision_recorded_${decisionId}`,
    event_type: 'shariah_gate_decision_recorded',
    aggregate_type: 'decision',
    aggregate_id: decisionId,
    causation_id: evaluationEventId,
    correlation_id: command.research_case_id,
    actor_type: 'system',
    payload: decision,
    source_ids: sourceIds,
    created_at: createdAt,
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: `${command.idempotency_key}:gate-decision` }),
  })

  return decision
}

export function assertShariahGateAllowsTransition(decision: ShariahGateDecision): void {
  if (decision.allowed) {
    return
  }

  const reasonText = decision.reasons.length > 0 ? decision.reasons.join(' ') : 'No passing Shariah gate decision is available.'
  const missingText = decision.missing_evidence.length > 0 ? ` Missing evidence: ${decision.missing_evidence.join(', ')}.` : ''
  const sourceText = decision.required_source_ids.length > 0 ? ` Required sources: ${decision.required_source_ids.join(', ')}.` : ''
  throw new Error(`Shariah gate blocked ${decision.target_transition} for ${decision.target_id}: ${reasonText}${missingText}${sourceText}`)
}
