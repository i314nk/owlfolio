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

  // SCALE-DOWN S5: the gate unblocks on a connected LLM alone — no capital, no market-data key.
  it('unblocks once an LLM is connected (scale-down S5: provider-only gate)', async () => {
    await withTemp(async (dir) => {
      const ledgerPath = join(dir, 'ledger.sqlite')
      const envPath = join(dir, '.env')

      const store = new SQLiteEventStore(ledgerPath)
      try {
        await recordProviderConnectedEvent(store, { provider_id: 'openrouter', env_key_name: 'OPENROUTER_API_KEY', connected_at: '2026-06-09T00:00:00Z' })
      } finally {
        store.close()
      }

      const gate = await evaluateOnboardingGate({ ledgerPath, envKeyOptions: { envPath } })
      expect(gate.is_complete).toBe(true)
      expect(gate.missing_items).toHaveLength(0)
    })
  })
})
