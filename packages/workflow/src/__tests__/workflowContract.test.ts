import { describe, expect, it } from 'vitest'

import {
  defaultSourceLedgerStorage,
  defaultWorkflowExecutionPolicy,
  type LedgerUpdateProposal,
  type SpecialistRunRequest,
} from '../index'

describe('workflow contract freeze', () => {
  it('defines a stable specialist run request shape', () => {
    const request: SpecialistRunRequest = {
      workflow_run_id: 'workflow_run_001',
      research_case_id: 'rc_msft_001',
      provider_id: 'claude',
      model_id: 'claude-sonnet',
      specialist_id: 'financial_analyst',
      ticker: 'MSFT',
      company_id: 'company_msft',
      strategy_id: 'buffett-munger',
      source_record_ids: [],
    }

    expect(request.specialist_id).toBe('financial_analyst')
    expect(request.provider_id).toBe('claude')
  })

  it('defines source-ledger storage relative to the project runtime', () => {
    expect(defaultSourceLedgerStorage.relative_dir).toBe('data/source-ledger')
    expect(defaultSourceLedgerStorage.file_prefix).toBe('research-source-bundle')
  })

  it('defines retry, idempotency, and ledger update proposal contracts', () => {
    const proposal: LedgerUpdateProposal = {
      aggregate_type: 'research_case',
      aggregate_id: 'rc_msft_001',
      event_type: 'research_sources_captured',
      payload: { source_record_ids: ['src_msft_10k_2025'] },
      source_record_ids: ['src_msft_10k_2025'],
    }

    expect(defaultWorkflowExecutionPolicy.max_retries).toBe(2)
    expect(defaultWorkflowExecutionPolicy.idempotency_scope).toBe('workflow-run')
    expect(proposal.event_type).toBe('research_sources_captured')
  })
})
