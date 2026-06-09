import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { findLatestResearchCaseForTicker, projectResearchCaseVersionsForTicker } from '@owlfolio/ledger/projections/researchCaseProjection'
import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { enqueueResearchRun } from '../workflow'

describe('research-case versioning (user re-run supersedes prior)', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  function makeState(ledgerPath: string, sourceLedgerPath: string) {
    return {
      config: {
        ...defaultPersonalLocalAppConfig(),
        provider: {
          provider_id: 'mock-provider' as const,
          support_level: 'certified' as const,
          model_id: 'mock-buffett-munger-demo',
        },
        initialized_at: '2026-06-09T00:00:00.000Z',
        ledger_path: ledgerPath,
        source_ledger_path: sourceLedgerPath,
      },
      is_initialized: true,
    }
  }

  it('first enqueue for a ticker creates a v1 case with no supersedes field', async () => {
    // Use production-spawn path (no OWLFOLIO_TEST_MODE) to avoid inline swarm
    const previousTestMode = process.env.OWLFOLIO_TEST_MODE
    delete process.env.OWLFOLIO_TEST_MODE

    try {
      const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-versioning-first-'))
      dirs.push(projectDir)
      const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
      const sourceLedgerPath = join(projectDir, 'data', 'source-ledger')
      const state = makeState(ledgerPath, sourceLedgerPath)

      const result = await enqueueResearchRun(state, { ticker: 'AAPL' }, { spawn: () => {} })

      const store = new SQLiteEventStore(ledgerPath)
      try {
        const events = await store.list()

        // The research_run_requested event is present
        expect(events.some((e) => e.event_type === 'research_run_requested')).toBe(true)

        // The requested payload should have the research_case_id
        const requestedEvent = events.find((e) => e.event_type === 'research_run_requested')
        expect(requestedEvent?.payload).toMatchObject({ research_case_id: result.research_case_id, ticker: 'AAPL' })

        // The latest case lookup (before any research_case_created is written — that happens in the swarm)
        // returns undefined since no research_case_created event exists yet in spawn path.
        // But when the swarm later runs and creates the case, it will be v1 with no supersedes.
        // We test this via the projection after a second enqueue in the inline path test below.
      } finally {
        store.close()
      }
    } finally {
      if (previousTestMode === undefined) {
        delete process.env.OWLFOLIO_TEST_MODE
      } else {
        process.env.OWLFOLIO_TEST_MODE = previousTestMode
      }
    }
  })

  it('inline (playwright) path: first enqueue creates v1, second creates v2 superseding v1', async () => {
    const previousTestMode = process.env.OWLFOLIO_TEST_MODE
    process.env.OWLFOLIO_TEST_MODE = 'playwright'

    try {
      const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-versioning-v2-'))
      dirs.push(projectDir)
      const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
      const sourceLedgerPath = join(projectDir, 'data', 'source-ledger')

      // Create source ledger dir (required for inline path)
      const { mkdir } = await import('node:fs/promises')
      await mkdir(sourceLedgerPath, { recursive: true })

      const state = makeState(ledgerPath, sourceLedgerPath)

      // First run — creates v1
      const result1 = await enqueueResearchRun(state, { ticker: 'GOOG' })
      expect(result1.research_case_id).toMatch(/^rc_goog_/)

      const store = new SQLiteEventStore(ledgerPath)
      try {
        const eventsAfterFirst = await store.list()

        // v1 case is present
        const v1Versions = projectResearchCaseVersionsForTicker(eventsAfterFirst, 'GOOG')
        expect(v1Versions).toHaveLength(1)
        const v1 = v1Versions[0]
        expect(v1).toBeDefined()
        expect(v1?.version).toBe(1)
        expect(v1?.superseded).toBe(false)
        expect(v1?.supersedes_research_case_id).toBeUndefined()
        expect(v1?.research_case_id).toBe(result1.research_case_id)

        // The latest for ticker is v1
        const latestAfterFirst = findLatestResearchCaseForTicker(eventsAfterFirst, 'GOOG')
        expect(latestAfterFirst?.research_case_id).toBe(result1.research_case_id)
        expect(latestAfterFirst?.version).toBe(1)
      } finally {
        store.close()
      }

      // Second run — user re-run creates v2 superseding v1
      const result2 = await enqueueResearchRun(state, { ticker: 'GOOG' })
      expect(result2.research_case_id).toMatch(/^rc_goog_/)
      expect(result2.research_case_id).not.toBe(result1.research_case_id)

      const store2 = new SQLiteEventStore(ledgerPath)
      try {
        const eventsAfterSecond = await store2.list()

        const allVersions = projectResearchCaseVersionsForTicker(eventsAfterSecond, 'GOOG')
        expect(allVersions).toHaveLength(2)

        // v1 should now be marked superseded
        const projectedV1 = allVersions.find((c) => c.research_case_id === result1.research_case_id)
        expect(projectedV1).toBeDefined()
        expect(projectedV1?.version).toBe(1)
        expect(projectedV1?.superseded).toBe(true)

        // v2 should be the canonical latest
        const projectedV2 = allVersions.find((c) => c.research_case_id === result2.research_case_id)
        expect(projectedV2).toBeDefined()
        expect(projectedV2?.version).toBe(2)
        expect(projectedV2?.superseded).toBe(false)
        expect(projectedV2?.supersedes_research_case_id).toBe(result1.research_case_id)

        // Latest should be v2
        const latest = findLatestResearchCaseForTicker(eventsAfterSecond, 'GOOG')
        expect(latest?.research_case_id).toBe(result2.research_case_id)
        expect(latest?.version).toBe(2)
        expect(latest?.superseded).toBe(false)
      } finally {
        store2.close()
      }
    } finally {
      if (previousTestMode === undefined) {
        delete process.env.OWLFOLIO_TEST_MODE
      } else {
        process.env.OWLFOLIO_TEST_MODE = previousTestMode
      }
    }
  })

  it('existing single-case flow (vertical slice) is unchanged: one case, version 1, not superseded', async () => {
    const previousTestMode = process.env.OWLFOLIO_TEST_MODE
    process.env.OWLFOLIO_TEST_MODE = 'playwright'

    try {
      const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-versioning-single-'))
      dirs.push(projectDir)
      const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
      const sourceLedgerPath = join(projectDir, 'data', 'source-ledger')

      const { mkdir } = await import('node:fs/promises')
      await mkdir(sourceLedgerPath, { recursive: true })

      const state = makeState(ledgerPath, sourceLedgerPath)
      const result = await enqueueResearchRun(state, { ticker: 'MSFT' })

      const store = new SQLiteEventStore(ledgerPath)
      try {
        const events = await store.list()
        const versions = projectResearchCaseVersionsForTicker(events, 'MSFT')
        expect(versions).toHaveLength(1)
        const solo = versions[0]
        expect(solo?.version).toBe(1)
        expect(solo?.superseded).toBe(false)
        expect(solo?.supersedes_research_case_id).toBeUndefined()
        expect(solo?.research_case_id).toBe(result.research_case_id)
      } finally {
        store.close()
      }
    } finally {
      if (previousTestMode === undefined) {
        delete process.env.OWLFOLIO_TEST_MODE
      } else {
        process.env.OWLFOLIO_TEST_MODE = previousTestMode
      }
    }
  })
})
