import { describe, expect, it } from 'vitest'

import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'

import { projectConnectedProviders, recordProviderConnectedEvent } from '../providerConnections'

const SECRET = 'sk-ant-supersecret-value-K3jQAA'

describe('recordProviderConnectedEvent (acceptance test 6 — no secret in ledger)', () => {
  it('records THAT a provider connected (id + timestamp) and NEVER the secret value', async () => {
    const store = new InMemoryEventStore()

    await recordProviderConnectedEvent(store, {
      provider_id: 'anthropic',
      env_key_name: 'ANTHROPIC_API_KEY',
      connected_at: '2026-06-09T00:00:00Z',
      // The raw secret is intentionally NOT a parameter — the recorder cannot see it.
    })

    const events = await store.list()
    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.event_type).toBe('provider_connected')
    expect(event.actor_type).toBe('user')
    expect(event.aggregate_type).toBe('provider_run')

    // The load-bearing assertion: the secret value appears NOWHERE in the event.
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain(SECRET)
    expect(serialized).not.toContain('supersecret')
    // Only the env key NAME and provider id are recorded.
    expect(serialized).toContain('ANTHROPIC_API_KEY')
    expect(serialized).toContain('anthropic')
  })

  it('is idempotent per provider+key so re-saving a key does not duplicate the connection', async () => {
    const store = new InMemoryEventStore()
    const args = { provider_id: 'anthropic', env_key_name: 'ANTHROPIC_API_KEY', connected_at: '2026-06-09T00:00:00Z' }
    await recordProviderConnectedEvent(store, args)
    await recordProviderConnectedEvent(store, { ...args, connected_at: '2026-06-10T00:00:00Z' })
    const events = await store.list()
    expect(events).toHaveLength(1)
  })
})

describe('projectConnectedProviders', () => {
  it('derives connected provider ids from the ledger', async () => {
    const store = new InMemoryEventStore()
    await recordProviderConnectedEvent(store, { provider_id: 'anthropic', env_key_name: 'ANTHROPIC_API_KEY', connected_at: '2026-06-09T00:00:00Z' })
    await recordProviderConnectedEvent(store, { provider_id: 'openai', env_key_name: 'OPENAI_API_KEY', connected_at: '2026-06-09T00:00:00Z' })

    const connected = projectConnectedProviders(await store.list())
    expect(connected).toContain('anthropic')
    expect(connected).toContain('openai')
    expect(connected).not.toContain('gemini')
  })
})
