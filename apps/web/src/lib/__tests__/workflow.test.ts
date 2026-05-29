import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createPersonalResearchCase,
  getAppResearchCaseFromStore,
  getAppWatchlistItemsFromStore,
  resolveActiveWorkflowMode,
} from '../workflow'

describe('workflow helpers', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  it('creates the first personal-local research case in the configured durable ledger', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-workflow-'))
    dirs.push(projectDir)

    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
    const created = await createPersonalResearchCase(
      {
        config: {
          ...defaultPersonalLocalAppConfig(),
          initialized_at: '2026-05-29T12:00:00.000Z',
          ledger_path: ledgerPath,
        },
        is_initialized: true,
      },
      { ticker: 'MSFT', company_id: 'company_msft' },
    )

    const store = new SQLiteEventStore(ledgerPath)
    try {
      expect(created.research_case_id).toMatch(/^rc_msft_/) 
      const researchCase = await getAppResearchCaseFromStore(store, 'personal-local', created.research_case_id)
      expect(researchCase).toMatchObject({
        ticker: 'MSFT',
        company_id: 'company_msft',
        stage: 'created',
        next_required_action: 'Start Buffett-Munger research for MSFT',
      })
    } finally {
      store.close()
    }
  })

  it('returns an empty watchlist for a newly initialized personal ledger', async () => {
    const store = new SQLiteEventStore()
    try {
      await expect(getAppWatchlistItemsFromStore(store, 'personal-local')).resolves.toEqual([])
    } finally {
      store.close()
    }
  })

  it('keeps demo mode routed through the seeded demo loaders', () => {
    expect(resolveActiveWorkflowMode({ mode: 'demo' })).toBe('demo')
    expect(resolveActiveWorkflowMode({ mode: 'personal-local' })).toBe('personal-local')
  })
})
