import type { AggregateType, LedgerEventEnvelope } from './eventEnvelope'

function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key])
    }

    Object.freeze(value)
  }

  return value
}

function cloneAndFreeze<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

export class InMemoryEventStore<TEvent extends LedgerEventEnvelope<unknown> = LedgerEventEnvelope<unknown>> {
  private readonly events: TEvent[] = []
  private readonly eventsByIdempotencyKey = new Map<string, TEvent>()

  async append(event: TEvent): Promise<TEvent> {
    if (event.idempotency_key !== undefined) {
      const existing = this.eventsByIdempotencyKey.get(event.idempotency_key)
      if (existing !== undefined) {
        return existing
      }
    }

    const storedEvent = cloneAndFreeze(event)
    this.events.push(storedEvent)

    if (storedEvent.idempotency_key !== undefined) {
      this.eventsByIdempotencyKey.set(storedEvent.idempotency_key, storedEvent)
    }

    return storedEvent
  }

  async list(): Promise<TEvent[]> {
    return [...this.events]
  }

  async listByAggregate(
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<TEvent[]> {
    return this.events.filter(
      (event) => event.aggregate_type === aggregateType && event.aggregate_id === aggregateId,
    )
  }
}
