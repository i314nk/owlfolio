import type { ActorType, AggregateType } from './eventEnvelope'

export type DomainProjectionOwner =
  | 'shariah_status'
  | 'purification'
  | 'accounting'
  | 'provider_status'
  | 'audit'
  | 'worker_status'

export type DomainEventContract = {
  event_type: DomainEventType
  aggregate_type: AggregateType
  actor_type: ActorType
  projection_owner: DomainProjectionOwner
  payload_fields: readonly string[]
}

export type DomainProjectionContract = {
  projection_owner: DomainProjectionOwner
  package_owner: '@owlfolio/ledger' | '@owlfolio/providers'
  route_owner: string
}

export const domainEventTypes = [
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
] as const

export type DomainEventType = (typeof domainEventTypes)[number]

export const domainEventContracts: readonly DomainEventContract[] = [
  {
    event_type: 'scheduled_task_defined',
    aggregate_type: 'scheduled_task',
    actor_type: 'user',
    projection_owner: 'worker_status',
    payload_fields: ['scheduled_task_id', 'task_kind', 'cadence', 'enabled'],
  },
  {
    event_type: 'scheduled_task_run_started',
    aggregate_type: 'scheduled_task',
    actor_type: 'worker',
    projection_owner: 'worker_status',
    payload_fields: ['scheduled_task_id', 'run_id', 'started_at'],
  },
  {
    event_type: 'scheduled_task_run_completed',
    aggregate_type: 'scheduled_task',
    actor_type: 'worker',
    projection_owner: 'worker_status',
    payload_fields: ['scheduled_task_id', 'run_id', 'completed_at', 'result_summary'],
  },
  {
    event_type: 'scheduled_task_run_failed',
    aggregate_type: 'scheduled_task',
    actor_type: 'worker',
    projection_owner: 'worker_status',
    payload_fields: ['scheduled_task_id', 'run_id', 'failed_at', 'error_summary'],
  },
  {
    event_type: 'provider_run_started',
    aggregate_type: 'provider_run',
    actor_type: 'worker',
    projection_owner: 'provider_status',
    payload_fields: ['provider_run_id', 'provider_id', 'model_id', 'task_kind', 'started_at'],
  },
  {
    event_type: 'provider_run_completed',
    aggregate_type: 'provider_run',
    actor_type: 'provider',
    projection_owner: 'provider_status',
    payload_fields: ['provider_run_id', 'provider_id', 'model_id', 'completed_at', 'finish_reason'],
  },
  {
    event_type: 'provider_run_failed',
    aggregate_type: 'provider_run',
    actor_type: 'provider',
    projection_owner: 'provider_status',
    payload_fields: ['provider_run_id', 'provider_id', 'model_id', 'failed_at', 'error_summary'],
  },
  {
    event_type: 'certification_report_recorded',
    aggregate_type: 'provider_run',
    actor_type: 'worker',
    projection_owner: 'provider_status',
    payload_fields: ['certification_report_id', 'provider_id', 'support_level', 'generated_at', 'cases'],
  },
  {
    event_type: 'shariah_evaluation_recorded',
    aggregate_type: 'holding',
    actor_type: 'provider',
    projection_owner: 'shariah_status',
    payload_fields: ['evaluation_id', 'holding_id', 'status', 'policy_basis', 'source_ids'],
  },
  {
    event_type: 'shariah_status_changed',
    aggregate_type: 'holding',
    actor_type: 'user',
    projection_owner: 'shariah_status',
    payload_fields: ['holding_id', 'previous_status', 'new_status', 'changed_reason'],
  },
  {
    event_type: 'shariah_gate_decision_recorded',
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
  },
  {
    event_type: 'purification_obligation_recorded',
    aggregate_type: 'purification_entry',
    actor_type: 'worker',
    projection_owner: 'purification',
    payload_fields: ['obligation_id', 'holding_id', 'amount', 'currency', 'period_start', 'period_end'],
  },
  {
    event_type: 'purification_payment_recorded',
    aggregate_type: 'purification_entry',
    actor_type: 'user',
    projection_owner: 'purification',
    payload_fields: ['payment_id', 'obligation_id', 'amount', 'currency', 'paid_at', 'recipient'],
  },
  {
    event_type: 'accounting_snapshot_recorded',
    aggregate_type: 'accounting_snapshot',
    actor_type: 'worker',
    projection_owner: 'accounting',
    payload_fields: [
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
    ],
  },
  {
    event_type: 'cash_deposited',
    aggregate_type: 'cash_account',
    actor_type: 'user',
    projection_owner: 'accounting',
    payload_fields: ['cash_account_id', 'amount', 'currency', 'deposited_at'],
  },
  {
    event_type: 'cash_withdrawn',
    aggregate_type: 'cash_account',
    actor_type: 'user',
    projection_owner: 'accounting',
    payload_fields: ['cash_account_id', 'amount', 'currency', 'withdrawn_at'],
  },
] as const

export const domainProjectionContracts: readonly DomainProjectionContract[] = [
  { projection_owner: 'shariah_status', package_owner: '@owlfolio/ledger', route_owner: '/shariah' },
  { projection_owner: 'purification', package_owner: '@owlfolio/ledger', route_owner: '/purification' },
  { projection_owner: 'accounting', package_owner: '@owlfolio/ledger', route_owner: '/accounting' },
  { projection_owner: 'provider_status', package_owner: '@owlfolio/providers', route_owner: '/providers' },
  { projection_owner: 'audit', package_owner: '@owlfolio/ledger', route_owner: '/audit' },
  { projection_owner: 'worker_status', package_owner: '@owlfolio/ledger', route_owner: '/worker' },
]
