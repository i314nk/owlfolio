export type WorkflowExecutionPolicy = {
  max_retries: number
  idempotency_scope: 'workflow-run'
  ledger_update_mode: 'proposal-before-write'
}

export const defaultWorkflowExecutionPolicy: WorkflowExecutionPolicy = {
  max_retries: 2,
  idempotency_scope: 'workflow-run',
  ledger_update_mode: 'proposal-before-write',
}

export type SpecialistRunRequest = {
  workflow_run_id: string
  research_case_id: string
  provider_id: string
  model_id: string
  specialist_id: string
  ticker: string
  company_id: string
  strategy_id: string
  source_record_ids: string[]
}

export type SpecialistRunResult = {
  workflow_run_id: string
  research_case_id: string
  specialist_id: string
  summary: string
  source_record_ids: string[]
  ledger_update_proposals: LedgerUpdateProposal[]
}

export type SynthesisRunRequest = {
  workflow_run_id: string
  research_case_id: string
  provider_id: string
  model_id: string
  strategy_id: string
  specialist_results: SpecialistRunResult[]
}

export type SynthesisRunResult = {
  workflow_run_id: string
  research_case_id: string
  verdict: 'BUY' | 'WATCH' | 'PASS' | 'RESEARCH_MORE'
  summary: string
  ledger_update_proposals: LedgerUpdateProposal[]
}

export type LedgerUpdateProposal = {
  aggregate_type: string
  aggregate_id: string
  event_type: string
  payload: Record<string, unknown>
  source_record_ids: string[]
}
