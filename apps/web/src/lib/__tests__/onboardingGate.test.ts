import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { describe, expect, it } from 'vitest'

import { evaluateOnboardingGate } from '../onboardingGate'
import { recordProviderConnectedEvent } from '../providerConnections'

async function withTemp(assertion: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'owlfolio-gate-'))
  try {
    await assertion(dir)
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}

describe('evaluateOnboardingGate (acceptance test 1 — deep-dive refusal)', () => {
  it('refuses on a fresh install and names a missing item', async () => {
    await withTemp(async (dir) => {
      const ledgerPath = join(dir, 'ledger.sqlite')
      const envPath = join(dir, '.env')
      const gate = await evaluateOnboardingGate({ ledgerPath, envKeyOptions: { envPath } })
      expect(gate.is_complete).toBe(false)
      expect(gate.blocked_reason).toBeDefined()
      expect(gate.missing_items.length).toBeGreaterThan(0)
    })
  })

  it('unblocks once an LLM is connected and capital exists — NO market-data key required (EDGAR direct)', async () => {
    await withTemp(async (dir) => {
      const ledgerPath = join(dir, 'ledger.sqlite')
      const envPath = join(dir, '.env')

      const store = new SQLiteEventStore(ledgerPath)
      try {
        await recordProviderConnectedEvent(store, { provider_id: 'anthropic', env_key_name: 'ANTHROPIC_API_KEY', connected_at: '2026-06-09T00:00:00Z' })
        await store.append({
          event_id: 'evt_investable_capital_set_1',
          event_type: 'investable_capital_set',
          aggregate_type: 'portfolio',
          aggregate_id: 'portfolio_local',
          actor_type: 'user',
          actor_id: 'user_local',
          payload: { amount: 10000, currency: 'USD', as_of: '2026-06-09T00:00:00Z' },
          source_ids: [],
          created_at: '2026-06-09T00:00:00Z',
          schema_version: 1,
        })
      } finally {
        store.close()
      }

      // No OWLFOLIO_MARKET_DATA_API_KEY is set: the gate is provider + capital only.
      const gate = await evaluateOnboardingGate({ ledgerPath, envKeyOptions: { envPath } })
      expect(gate.is_complete).toBe(true)
      expect(gate.blocked_reason).toBeUndefined()
      // The gate no longer carries a market-data item at all.
      expect(gate.items.map((item) => item.id)).toEqual(['frontier_llm', 'investable_capital'])
      expect(gate.items.some((item) => item.id === ('market_data' as string))).toBe(false)
    })
  })
})
