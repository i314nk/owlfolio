import { describe, expect, it } from 'vitest'

import {
  domainEventContracts,
  domainProjectionContracts,
  type DomainEventType,
} from '../domainEventContracts'

function contract(eventType: DomainEventType) {
  return domainEventContracts.find((candidate) => candidate.event_type === eventType)
}

describe('Owlfolio v2 domain event boundary contracts', () => {
  it('freezes the event families needed by discovery, scheduler, providers, Shariah, purification, accounting, and cash lanes', () => {
    expect(domainEventContracts.map((entry) => entry.event_type)).toEqual([
      'discovery_candidate_discovered',
      'discovery_candidate_queued_for_quick_screen',
      'discovery_candidate_rejected',
      'discovery_candidate_promoted_to_research_case',
      'queued_for_deep_dive',
      'deep_dive_started',
      'specialist_finding_recorded',
      'deep_dive_synthesis_drafted',
      'deep_dive_completed',
      'holding_valuation_recorded',
      'scheduled_task_defined',
      'scheduled_task_run_started',
      'scheduled_task_run_completed',
      'scheduled_task_run_failed',
      'provider_run_started',
      'provider_run_completed',
      'provider_run_failed',
      'certification_report_recorded',
      'shariah_evaluation_recorded',
      'shariah_status_changed',
      'shariah_gate_decision_recorded',
      'purification_obligation_recorded',
      'purification_payment_recorded',
      'accounting_snapshot_recorded',
      'cash_deposited',
      'cash_withdrawn',
      'dividend_income_recorded',
      'fee_charged',
      'holding_realized_gain_loss_recorded',
      'research_run_requested',
      'research_run_claimed',
      'research_run_failed',
      'deep_dive_approval_pending',
      'deep_dive_run_requested',
      'investable_capital_set',
    ])
  })

  it('assigns each frozen event to a stable aggregate, actor, and projection owner', () => {
    expect(contract('discovery_candidate_discovered')).toMatchObject({
      aggregate_type: 'discovery_candidate',
      actor_type: 'provider',
      projection_owner: 'discovery',
      payload_fields: [
        'candidate_id',
        'ticker',
        'company_name',
        'market',
        'strategy_id',
        'strategy_version',
        'discovery_source',
        'source_ids',
        'discovered_at',
        'status',
        'dedupe_key',
      ],
    })
    expect(contract('discovery_candidate_queued_for_quick_screen')).toMatchObject({ aggregate_type: 'discovery_candidate', actor_type: 'system', projection_owner: 'discovery' })
    expect(contract('discovery_candidate_rejected')).toMatchObject({ aggregate_type: 'discovery_candidate', actor_type: 'user', projection_owner: 'discovery' })
    expect(contract('discovery_candidate_promoted_to_research_case')).toMatchObject({ aggregate_type: 'discovery_candidate', actor_type: 'user', projection_owner: 'discovery' })
    expect(contract('queued_for_deep_dive')).toMatchObject({
      aggregate_type: 'research_case',
      actor_type: 'system',
      projection_owner: 'discovery',
      payload_fields: ['research_case_id', 'queue_id', 'candidate_id', 'strategy_id', 'strategy_version', 'source_ids'],
    })
    expect(contract('deep_dive_started')).toMatchObject({
      aggregate_type: 'research_case',
      actor_type: 'worker',
      projection_owner: 'discovery',
      payload_fields: ['research_case_id', 'deep_dive_id', 'candidate_id', 'strategy_id', 'strategy_version', 'specialist_lanes', 'source_ids'],
    })
    expect(contract('specialist_finding_recorded')).toMatchObject({
      aggregate_type: 'research_case',
      actor_type: 'provider',
      projection_owner: 'discovery',
      payload_fields: [
        'research_case_id',
        'finding_id',
        'deep_dive_id',
        'candidate_id',
        'strategy_id',
        'strategy_version',
        'specialist_lane',
        'finding_summary',
        'source_ids',
        'confidence',
        'caveats',
        'provider_run_id',
      ],
    })
    expect(contract('deep_dive_synthesis_drafted')).toMatchObject({
      aggregate_type: 'research_case',
      actor_type: 'system',
      projection_owner: 'discovery',
      payload_fields: [
        'research_case_id',
        'synthesis_id',
        'deep_dive_id',
        'candidate_id',
        'strategy_id',
        'strategy_version',
        'synthesis_summary',
        'specialist_finding_ids',
        'source_ids',
        'confidence',
        'caveats',
        'provider_run_id',
      ],
    })
    expect(contract('deep_dive_completed')).toMatchObject({
      aggregate_type: 'research_case',
      actor_type: 'system',
      projection_owner: 'discovery',
      payload_fields: [
        'research_case_id',
        'completion_id',
        'deep_dive_id',
        'candidate_id',
        'synthesis_id',
        'strategy_id',
        'strategy_version',
        'source_ids',
        'confidence',
        'caveats',
        'provider_run_id',
      ],
    })
    expect(contract('holding_valuation_recorded')).toMatchObject({
      aggregate_type: 'holding',
      actor_type: 'worker',
      actor_types: ['user', 'worker'],
      projection_owner: 'accounting',
      payload_fields: [
        'snapshot_id',
        'holding_id',
        'price_per_share',
        'shares',
        'market_value',
        'currency',
        'valued_at',
        'valuation_source',
        'price_checked_at',
        'confidence',
        'caveat',
        'missing_data',
        'valued_by_actor_type',
        'valued_by_actor_id',
      ],
    })
    expect(contract('scheduled_task_run_started')).toMatchObject({ aggregate_type: 'scheduled_task', actor_type: 'worker', projection_owner: 'worker_status' })
    expect(contract('provider_run_completed')).toMatchObject({ aggregate_type: 'provider_run', actor_type: 'provider', projection_owner: 'provider_status' })
    expect(contract('certification_report_recorded')).toMatchObject({ aggregate_type: 'provider_run', actor_type: 'worker', projection_owner: 'provider_status' })
    expect(contract('shariah_evaluation_recorded')).toMatchObject({ aggregate_type: 'holding', actor_type: 'provider', projection_owner: 'shariah_status' })
    expect(contract('shariah_gate_decision_recorded')).toMatchObject({
      aggregate_type: 'decision',
      actor_type: 'system',
      projection_owner: 'shariah_status',
      payload_fields: [
        'gate_decision_id',
        'target_transition',
        'target_id',
        'research_case_id',
        'status',
        'allowed',
        'reasons',
        'required_source_ids',
        'missing_evidence',
        'conditional_allowed',
      ],
    })
    expect(contract('purification_payment_recorded')).toMatchObject({ aggregate_type: 'purification_entry', actor_type: 'user', projection_owner: 'purification' })
    expect(contract('accounting_snapshot_recorded')).toMatchObject({ aggregate_type: 'accounting_snapshot', actor_type: 'worker', projection_owner: 'accounting' })
    expect(contract('cash_deposited')).toMatchObject({ aggregate_type: 'cash_account', actor_type: 'user', projection_owner: 'accounting' })
    expect(contract('dividend_income_recorded')).toMatchObject({
      aggregate_type: 'cash_account',
      actor_type: 'user',
      projection_owner: 'accounting',
      payload_fields: ['dividend_id', 'holding_id', 'cash_account_id', 'amount', 'currency', 'received_at', 'taxable_status'],
    })
    expect(contract('fee_charged')).toMatchObject({
      aggregate_type: 'cash_account',
      actor_type: 'user',
      projection_owner: 'accounting',
      payload_fields: ['fee_id', 'cash_account_id', 'amount', 'currency', 'charged_at', 'fee_type'],
    })
    expect(contract('holding_realized_gain_loss_recorded')).toMatchObject({
      aggregate_type: 'holding',
      actor_type: 'user',
      projection_owner: 'accounting',
      payload_fields: ['realized_gain_loss_id', 'holding_id', 'amount', 'currency', 'realized_at'],
    })
    expect(contract('accounting_snapshot_recorded')?.payload_fields).toEqual([
      'snapshot_id',
      'period_start',
      'period_end',
      'nav',
      'current_value',
      'unrealized_gain_loss',
      'realized_gain_loss',
      'cash_balance',
      'deposits',
      'withdrawals',
      'dividends',
      'fees',
      'net_cash_flow',
      'audit_event_ids',
      'source_ids',
      'missing_data_warnings',
      'currency',
    ])
  })

  it('includes research run queue event types', () => {
    expect(domainEventContracts.map((entry) => entry.event_type)).toContain('research_run_requested')
    expect(domainEventContracts.map((entry) => entry.event_type)).toContain('research_run_claimed')
    expect(domainEventContracts.map((entry) => entry.event_type)).toContain('research_run_failed')
    expect(domainEventContracts.map((entry) => entry.event_type)).toContain('deep_dive_approval_pending')
    expect(domainEventContracts.map((entry) => entry.event_type)).toContain('deep_dive_run_requested')
  })

  it('defines route/page ownership for downstream UI lanes without requiring implementation yet', () => {
    expect(domainProjectionContracts).toEqual([
      { projection_owner: 'discovery', package_owner: '@owlfolio/ledger', route_owner: '/research/discovery' },
      { projection_owner: 'shariah_status', package_owner: '@owlfolio/ledger', route_owner: '/shariah' },
      { projection_owner: 'purification', package_owner: '@owlfolio/ledger', route_owner: '/purification' },
      { projection_owner: 'accounting', package_owner: '@owlfolio/ledger', route_owner: '/accounting' },
      { projection_owner: 'provider_status', package_owner: '@owlfolio/providers', route_owner: '/providers' },
      { projection_owner: 'audit', package_owner: '@owlfolio/ledger', route_owner: '/audit' },
      { projection_owner: 'worker_status', package_owner: '@owlfolio/ledger', route_owner: '/worker' },
      { projection_owner: 'portfolio', package_owner: '@owlfolio/ledger', route_owner: '/portfolio' },
    ])
  })
})
