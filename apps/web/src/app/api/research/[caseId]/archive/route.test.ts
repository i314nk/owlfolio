import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { createResearchCase } from '@owlfolio/workflow'

import { POST } from './route'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
}

async function seedCase(ledgerPath: string): Promise<string> {
  const rc = 'rc_archive_route'
  const store = new SQLiteEventStore(ledgerPath)
  try {
    await createResearchCase(store, {
      research_case_id: rc, company_id: 'company_tst', ticker: 'TST',
      strategy_id: 'buffett-munger', actor_id: 'user_local',
    })
  } finally {
    store.close()
  }
  return rc
}

function callRoute(caseId: string) {
  return POST(
    new Request(`http://localhost/api/research/${caseId}/archive`, { method: 'POST' }),
    { params: Promise.resolve({ caseId }) },
  )
}

describe('/api/research/[caseId]/archive', () => {
  let tempDir: string
  let ledgerPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-archive-route-'))
    const appConfigPath = join(tempDir, 'app-config.json')
    ledgerPath = join(tempDir, 'personal.sqlite')
    process.env.OWLFOLIO_APP_CONFIG_PATH = appConfigPath
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
    await writeFile(appConfigPath, JSON.stringify({
      ...defaultPersonalLocalAppConfig(),
      ledger_path: ledgerPath,
      source_ledger_path: join(tempDir, 'source-ledger'),
      initialized_at: '2026-06-01T00:00:00.000Z',
    }), 'utf8')
  })

  afterEach(async () => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k as keyof typeof originalEnv]
      else process.env[k as keyof typeof originalEnv] = v
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  it('archives a case (append-only) and returns the case id; the case still projects, marked archived', async () => {
    const caseId = await seedCase(ledgerPath)
    const res = await callRoute(caseId)
    expect(res.status).toBe(200)
    const body = await res.json() as { research_case_id: string }
    expect(body.research_case_id).toBe(caseId)

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      expect(events.filter((e) => e.event_type === 'research_case_archived')).toHaveLength(1)
      // append-only: the prior create event is untouched and the case still projects (marked archived).
      expect(events.filter((e) => e.event_type === 'research_case_created')).toHaveLength(1)
      const projected = projectResearchCases(events).find((c) => c.research_case_id === caseId)
      expect(projected?.archived).toBe(true)
    } finally {
      store.close()
    }
  })

  it('is idempotent — re-archiving the same case keeps a single archive event', async () => {
    const caseId = await seedCase(ledgerPath)
    await callRoute(caseId)
    const res = await callRoute(caseId)
    expect(res.status).toBe(200)

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const archiveEvents = (await store.list()).filter((e) => e.event_type === 'research_case_archived')
      expect(archiveEvents).toHaveLength(1)
    } finally {
      store.close()
    }
  })

  it('returns 404 for an unknown research case', async () => {
    await seedCase(ledgerPath)
    const res = await callRoute('rc_does_not_exist')
    expect(res.status).toBe(404)
  })
})
