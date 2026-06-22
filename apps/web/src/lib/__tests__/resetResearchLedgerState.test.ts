import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import type { AppConfig } from '@owlfolio/shared'

import type { OnboardingState } from '../onboarding'
import { resetResearchLedgerState } from '../workflow'

type ResearchEvent = LedgerEventEnvelope<{ ticker: string; strategy_id: string }>

function researchEvent(index: number): ResearchEvent {
  return {
    event_id: `evt_${index}`,
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: `rc_${index}`,
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { ticker: 'COST', strategy_id: 'buffett-munger' },
    source_ids: [],
    created_at: '2026-05-27T00:00:00.000Z',
    schema_version: 1,
  }
}

function buildState(overrides: Partial<AppConfig>): OnboardingState {
  return {
    config: {
      mode: 'personal-local',
      provider: { provider_id: 'mock-provider', support_level: 'certified' },
      ...overrides,
    } as AppConfig,
    is_initialized: true,
  }
}

describe('resetResearchLedgerState', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'owlfolio-reset-'))
  })

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true })
  })

  it('clears all events, leaves an appendable empty ledger, and empties source bundles', async () => {
    const ledgerPath = join(dir, 'ledger.sqlite')
    const sourceLedgerPath = join(dir, 'source-ledger')

    // Seed N events.
    const store = new SQLiteEventStore<ResearchEvent>(ledgerPath)
    try {
      await store.append(researchEvent(1))
      await store.append(researchEvent(2))
      await store.append(researchEvent(3))
      expect((await store.list()).length).toBe(3)
    } finally {
      store.close()
    }

    // Seed a source-ledger bundle directory with content.
    await mkdir(join(sourceLedgerPath, 'bundle-a'), { recursive: true })
    await writeFile(join(sourceLedgerPath, 'bundle-a', 'source.json'), '{}')
    await writeFile(join(sourceLedgerPath, 'loose.json'), '{}')

    const state = buildState({ ledger_path: ledgerPath, source_ledger_path: sourceLedgerPath })

    const summary = await resetResearchLedgerState(state, { env: { OWLFOLIO_DEV_TOOLS: '1' } })

    expect(summary).toEqual({ cleared_events: 3 })

    // The ledger DB is still usable and empty, and can be appended again.
    const reopened = new SQLiteEventStore<ResearchEvent>(ledgerPath)
    try {
      expect(await reopened.list()).toEqual([])
      await reopened.append(researchEvent(99))
      expect((await reopened.list()).length).toBe(1)
    } finally {
      reopened.close()
    }

    // Source bundle directory CONTENTS cleared, directory preserved.
    expect(await readdir(sourceLedgerPath)).toEqual([])
  })

  it('throws when the dev-tools gate is not enabled (defense in depth)', async () => {
    const ledgerPath = join(dir, 'ledger.sqlite')
    const state = buildState({ ledger_path: ledgerPath, source_ledger_path: join(dir, 'source-ledger') })

    await expect(resetResearchLedgerState(state, { env: {} })).rejects.toThrow(/not enabled/i)
  })

  it('is a harmless success on an uninitialized environment (no ledger_path)', async () => {
    const state = buildState({})

    const summary = await resetResearchLedgerState(state, { env: { OWLFOLIO_DEV_TOOLS: '1' } })

    expect(summary).toEqual({ cleared_events: 0 })
  })
})
