import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { createResearchCase } from '@owlfolio/workflow'

import { POST } from './route'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
}

const RC = 'rc_srt_route_test'

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

const READY_OVERRIDE = { is_ready: true, provider_id: 'mock-provider', status_label: 'ready' }
const NOT_READY_OVERRIDE = { is_ready: false, provider_id: 'openrouter', status_label: 'missing key' }

function callRoute(caseId: string, deps?: unknown) {
  return POST(
    new Request(`http://localhost/api/research/${caseId}/start-run`, { method: 'POST' }),
    { params: Promise.resolve({ caseId }) },
    deps as never,
  )
}

describe('/api/research/[caseId]/start-run', () => {
  let tempDir: string
  let ledgerPath: string
  let sourceLedgerPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-start-run-route-'))
    const appConfigPath = join(tempDir, 'app-config.json')
    ledgerPath = join(tempDir, 'personal.sqlite')
    sourceLedgerPath = join(tempDir, 'source-ledger')
    process.env.OWLFOLIO_APP_CONFIG_PATH = appConfigPath
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key'
    await writeFile(
      appConfigPath,
      JSON.stringify({
        ...defaultPersonalLocalAppConfig(),
        ledger_path: ledgerPath,
        source_ledger_path: sourceLedgerPath,
        initialized_at: '2026-06-01T00:00:00.000Z',
      }),
      'utf8',
    )
  })

  afterEach(async () => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k as keyof typeof originalEnv]
      else process.env[k as keyof typeof originalEnv] = v
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  it('200 + research_case_id when provider ready and case exists', async () => {
    await seedCase(ledgerPath)
    const spawn = vi.fn()

    const res = await callRoute(RC, { readinessOverride: READY_OVERRIDE, spawn })
    expect(res.status).toBe(200)
    const body = await res.json() as { research_case_id: string }
    expect(body.research_case_id).toBe(RC)
    expect(spawn).toHaveBeenCalledTimes(1)

    // Assert the run-requested event was written to the ledger.
    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      expect(events.some((e) => e.event_type === 'research_run_requested' && e.aggregate_id === RC)).toBe(true)
    } finally {
      store.close()
    }
  })

  it('400 when provider is not ready', async () => {
    await seedCase(ledgerPath)
    const res = await callRoute(RC, { readinessOverride: NOT_READY_OVERRIDE, spawn: vi.fn() })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('provider_not_ready')
  })

  it('409 when run already started (double-start guard)', async () => {
    await seedCase(ledgerPath)
    const spawn = vi.fn()
    // First call succeeds.
    await callRoute(RC, { readinessOverride: READY_OVERRIDE, spawn })
    // Second call should 409.
    const res = await callRoute(RC, { readinessOverride: READY_OVERRIDE, spawn })
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/already started/)
  })

  it('409 when case does not exist', async () => {
    const res = await callRoute('rc_does_not_exist', { readinessOverride: READY_OVERRIDE, spawn: vi.fn() })
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/Unknown research case/)
  })
})
