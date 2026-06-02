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
  it('freezes the event families needed by scheduler, providers, Shariah, purification, accounting, and cash lanes', () => {
    expect(domainEventContracts.map((entry) => entry.event_type)).toEqual([
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
    ])
  })

  it('assigns each frozen event to a stable aggregate, actor, and projection owner', () => {
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
    expect(contract('accounting_snapshot_recorded')?.payload_fields).toEqual([
      'snapshot_id',
      'period_start',
      'period_end',
      'nav',
      'current_value',
      'unrealized_gain_loss',
      'cash_balance',
      'deposits',
      'withdrawals',
      'currency',
    ])
  })

  it('defines route/page ownership for downstream UI lanes without requiring implementation yet', () => {
    expect(domainProjectionContracts).toEqual([
      { projection_owner: 'shariah_status', package_owner: '@owlfolio/ledger', route_owner: '/shariah' },
      { projection_owner: 'purification', package_owner: '@owlfolio/ledger', route_owner: '/purification' },
      { projection_owner: 'accounting', package_owner: '@owlfolio/ledger', route_owner: '/accounting' },
      { projection_owner: 'provider_status', package_owner: '@owlfolio/providers', route_owner: '/providers' },
      { projection_owner: 'audit', package_owner: '@owlfolio/ledger', route_owner: '/audit' },
      { projection_owner: 'worker_status', package_owner: '@owlfolio/ledger', route_owner: '/worker' },
    ])
  })
})
