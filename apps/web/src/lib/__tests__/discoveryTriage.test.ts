import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { projectDiscoveryCandidates } from '@owlfolio/ledger/projections/discoveryCandidateProjection'
import { discoverCandidate } from '@owlfolio/workflow/discoveryCandidateWorkflow'

import { acceptDiscoveryCandidate, rejectDiscoveryCandidate, promoteDiscoveryCandidate } from '../workflow'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
}

describe('discovery triage wrappers', () => {
  let tempDir: string
  let ledgerPath: string
  let candidateId: string
  let state: never

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-discovery-triage-'))
    const appConfigPath = join(tempDir, 'app-config.json')
    ledgerPath = join(tempDir, 'personal.sqlite')
    process.env.OWLFOLIO_APP_CONFIG_PATH = appConfigPath
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
    await writeFile(
      appConfigPath,
      JSON.stringify({
        ...defaultPersonalLocalAppConfig(),
        ledger_path: ledgerPath,
        initialized_at: '2026-01-01T00:00:00.000Z',
      }),
      'utf8',
    )

    state = { is_initialized: true, config: { ...defaultPersonalLocalAppConfig(), ledger_path: ledgerPath } } as never

    // Seed a discovered candidate
    candidateId = `cand_test_${Date.now()}`
    const store = new SQLiteEventStore(ledgerPath)
    try {
      await discoverCandidate(store, {
        candidate_id: candidateId,
        ticker: 'AAPL',
        company_name: 'Apple Inc.',
        market: 'NASDAQ',
        strategy_id: 'buffett-munger',
        discovery_source: 'test-fixture',
        source_ids: ['src_fixture_001'],
        actor_id: 'test_actor',
      })
    } finally {
      store.close()
    }
  })

  afterEach(async () => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k as keyof typeof originalEnv]
      else process.env[k as keyof typeof originalEnv] = v
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  async function status(id: string): Promise<string | undefined> {
    const store = new SQLiteEventStore(ledgerPath)
    try {
      return projectDiscoveryCandidates(await store.list()).find((c) => c.candidate_id === id)?.status
    } finally {
      store.close()
    }
  }

  it('accept moves discovered → queued_for_quick_screen', async () => {
    await acceptDiscoveryCandidate(state, candidateId)
    expect(await status(candidateId)).toBe('queued_for_quick_screen')
  })

  it('reject moves discovered → rejected', async () => {
    await rejectDiscoveryCandidate(state, candidateId, 'not a fit')
    expect(await status(candidateId)).toBe('rejected')
  })

  it('promote before accept throws (must be queued first)', async () => {
    await expect(promoteDiscoveryCandidate(state, candidateId)).rejects.toThrow(/queued for quick screen/i)
  })

  it('accept then promote → promoted + returns research_case_id + creates research case', async () => {
    await acceptDiscoveryCandidate(state, candidateId)
    const { research_case_id } = await promoteDiscoveryCandidate(state, candidateId)
    expect(research_case_id).toMatch(/^rc_/)
    expect(await status(candidateId)).toBe('promoted_to_research_case')
    // assert a research_case_created event exists
    const store = new SQLiteEventStore(ledgerPath)
    try {
      expect((await store.list()).some((e) => e.event_type === 'research_case_created')).toBe(true)
    } finally {
      store.close()
    }
  })
})
