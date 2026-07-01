import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'

/**
 * The ledger records ONLY THAT a provider was connected — provider id, the env
 * key NAME, and a timestamp. The credential value is never a parameter here and
 * never enters the ledger, so "connected" stays derivable honestly while the
 * secret lives only in the local `.env`. (Acceptance test 6.)
 */

export type ProviderConnectedPayload = {
  provider_id: string
  /** The env var NAME that was set (never the value). */
  env_key_name: string
  connected_at: string
}

export type RecordProviderConnectedArgs = {
  provider_id: string
  env_key_name: string
  connected_at?: string
}

/**
 * Append a user-authored `provider_connected` event. Idempotent per
 * provider+key so re-saving a key does not duplicate the connection record.
 */
export async function recordProviderConnectedEvent(
  store: EventStore,
  args: RecordProviderConnectedArgs,
): Promise<void> {
  const connectedAt = args.connected_at ?? new Date().toISOString()
  const safeProvider = args.provider_id.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  const safeKey = args.env_key_name.toLowerCase().replace(/[^a-z0-9]+/g, '_')

  await store.append({
    event_id: `evt_provider_connected_${safeProvider}_${safeKey}`,
    event_type: 'provider_connected',
    aggregate_type: 'provider_run',
    aggregate_id: `provider_connection_${safeProvider}`,
    actor_type: 'user',
    actor_id: 'user_local',
    correlation_id: `provider_connection_${safeProvider}`,
    payload: {
      provider_id: args.provider_id,
      env_key_name: args.env_key_name,
      connected_at: connectedAt,
    } satisfies ProviderConnectedPayload,
    source_ids: [],
    created_at: connectedAt,
    schema_version: 1,
    idempotency_key: `provider-connected:${safeProvider}:${safeKey}:v1`,
  })
}

function isProviderConnectedEvent(
  event: LedgerEventEnvelope<unknown>,
): event is LedgerEventEnvelope<ProviderConnectedPayload> {
  return event.event_type === 'provider_connected'
}

/** Derive the set of connected provider ids from the ledger event stream. */
export function projectConnectedProviders(events: LedgerEventEnvelope<unknown>[]): string[] {
  const connected = new Set<string>()
  for (const event of events) {
    if (isProviderConnectedEvent(event)) {
      connected.add(event.payload.provider_id)
    }
  }
  return [...connected]
}
