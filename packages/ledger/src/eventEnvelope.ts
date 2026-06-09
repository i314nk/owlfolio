export type ActorType = 'user' | 'system' | 'provider' | 'worker'
export type AggregateType =
  | 'strategy'
  | 'company'
  | 'discovery_candidate'
  | 'research_case'
  | 'watchlist_item'
  | 'holding'
  | 'decision'
  | 'accounting_snapshot'
  | 'purification_entry'
  | 'cash_account'
  | 'provider_run'
  | 'scheduled_task'
  | 'portfolio'

export type LedgerEventEnvelope<TPayload> = {
  event_id: string
  event_type: string
  aggregate_type: AggregateType
  aggregate_id: string
  causation_id?: string
  correlation_id?: string
  idempotency_key?: string
  actor_type: ActorType
  actor_id?: string
  payload: TPayload
  source_ids: string[]
  created_at: string
  schema_version: number
}
