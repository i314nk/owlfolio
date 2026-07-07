import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { createResearchCase } from '@owlfolio/workflow'

import { startResearchRun } from '../workflow'

const RC = 'rc_srt_test_case'

async function seedCase(ledgerPath: string): Promise<void> {
  const store = new SQLiteEventStore(ledgerPath)
  try {
    await createResearchCase(store, {
      research_case_id: RC,
      company_id: 'company_tst',
      ticker: 'TST',
      strategy_id: 'buffett-munger',
      actor_id: 'user_local',
    })
  } finally {
    store.close()
  }
}

describe('startResearchRun', () => {
  let tempDir: string
  let ledgerPath: string
  let sourceLedgerPath: string
  let state: never

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-start-research-run-'))
    ledgerPath = join(tempDir, 'personal.sqlite')
    sourceLedgerPath = join(tempDir, 'source-ledger')
    state = {
      is_initialized: true,
      config: {
        ...defaultPersonalLocalAppConfig(),
        provider: {
          provider_id: 'mock-provider' as const,
          support_level: 'certified' as const,
          model_id: 'mock-buffett-munger-demo',
        },
        initialized_at: '2026-01-01T00:00:00.000Z',
        ledger_path: ledgerPath,
        source_ledger_path: sourceLedgerPath,
      },
    } as never
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('appends a research_run_requested event for the existing case, calls spawn once, returns research_case_id', async () => {
    await seedCase(ledgerPath)
    const spawn = vi.fn()

    const result = await startResearchRun(state, RC, { spawn })

    expect(result).toEqual({ research_case_id: RC })
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0]![0]).toMatchObject({
      ledgerPath,
      sourceLedgerPath,
    })

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      const runReq = events.filter((e) => e.event_type === 'research_run_requested')
      expect(runReq).toHaveLength(1)
      expect(runReq[0]).toMatchObject({
        event_id: `evt_research_run_requested_${RC}`,
        event_type: 'research_run_requested',
        aggregate_type: 'research_case',
        aggregate_id: RC,
        correlation_id: RC,
        actor_type: 'user',
        actor_id: 'user_local',
        source_ids: [],
        schema_version: 1,
        idempotency_key: `research-run-request:${RC}:v1`,
      })
      expect(runReq[0]?.payload).toMatchObject({
        research_case_id: RC,
        ticker: 'TST',
        requested_by: 'user_local',
        version: 1,
      })
    } finally {
      store.close()
    }
  })

  it('throws /already started/ when called a second time for the same case', async () => {
    await seedCase(ledgerPath)
    const spawn = vi.fn()

    await startResearchRun(state, RC, { spawn })
    await expect(startResearchRun(state, RC, { spawn })).rejects.toThrow(/already started/)
  })

  it('throws /Unknown research case/ for an unknown caseId', async () => {
    // Do NOT seed any case — ledger is empty.
    const spawn = vi.fn()
    await expect(startResearchRun(state, 'rc_does_not_exist', { spawn })).rejects.toThrow(/Unknown research case/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('throws when not personal-local initialized', async () => {
    const uninitState = { is_initialized: false, config: defaultPersonalLocalAppConfig() } as never
    await expect(startResearchRun(uninitState, RC, { spawn: vi.fn() })).rejects.toThrow('Personal-local workflow is not initialized')
  })
})
