import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { projectDiscoveryCandidates } from '@owlfolio/ledger/projections/discoveryCandidateProjection'
import { discoverCandidate } from '@owlfolio/workflow/discoveryCandidateWorkflow'

import { POST as accept } from './[id]/accept/route'
import { POST as reject } from './[id]/reject/route'
import { POST as promote } from './[id]/promote/route'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const req = (body?: unknown) =>
  body === undefined
    ? new Request('http://localhost/x', { method: 'POST' })
    : new Request('http://localhost/x', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      })

describe('discovery triage routes', () => {
  let tempDir: string
  let ledgerPath: string
  let candidateId: string

  async function status(id: string): Promise<string | undefined> {
    const store = new SQLiteEventStore(ledgerPath)
    try {
      return projectDiscoveryCandidates(await store.list()).find((c) => c.candidate_id === id)?.status
    } finally {
      store.close()
    }
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-discovery-routes-'))
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

  it('accept → 200 and status queued_for_quick_screen', async () => {
    const res = await accept(req(), ctx(candidateId))
    expect(res.status).toBe(200)
    expect(await status(candidateId)).toBe('queued_for_quick_screen')
  })

  it('promote before accept → 409', async () => {
    const res = await promote(req(), ctx(candidateId))
    expect(res.status).toBe(409)
  })

  it('accept then promote → 200 with research_case_id', async () => {
    await accept(req(), ctx(candidateId))
    const res = await promote(req(), ctx(candidateId))
    expect(res.status).toBe(200)
    expect((await res.json()).research_case_id).toMatch(/^rc_/)
  })

  it('reject with reason → 200 and status rejected', async () => {
    const res = await reject(req({ reason: 'nope' }), ctx(candidateId))
    expect(res.status).toBe(200)
    expect(await status(candidateId)).toBe('rejected')
  })

  it('reject with empty/missing body → 200 and status rejected', async () => {
    const res = await reject(req(), ctx(candidateId))
    expect(res.status).toBe(200)
    expect(await status(candidateId)).toBe('rejected')
  })
})
