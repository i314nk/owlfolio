import type { AggregateType, LedgerEventEnvelope } from './eventEnvelope'

export class InMemoryEventStore {
  private readonly events: LedgerEventEnvelope<unknown>[] = []
  private readonly eventsByIdempotencyKey = new Map<string, LedgerEventEnvelope<unknown>>()

  async append<TPayload>(event: LedgerEventEnvelope<TPayload>): Promise<LedgerEventEnvelope<TPayload>> {
    if (event.idempotency_key !== undefined) {
      const existing = this.eventsByIdempotencyKey.get(event.idempotency_key)
      if (existing !== undefined) {
        return existing as LedgerEventEnvelope<TPayload>
      }
    }

    this.events.push(event)

    if (event.idempotency_key !== undefined) {
      this.eventsByIdempotencyKey.set(event.idempotency_key, event)
    }

    return event
  }

  async list(): Promise<LedgerEventEnvelope<unknown>[]> {
    return [...this.events]
  }

  async listByAggregate(
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<LedgerEventEnvelope<unknown>[]> {
    return this.events.filter(
      (event) => event.aggregate_type === aggregateType && event.aggregate_id === aggregateId,
    )
  }
}
