import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { POST } from './route'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
}

describe('/api/calibration/start', () => {
  let tempDir: string
  let appConfigPath: string
  let ledgerPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-calibration-start-route-'))
    appConfigPath = join(tempDir, 'app-config.json')
    ledgerPath = join(tempDir, 'personal.sqlite')
    process.env.OWLFOLIO_APP_CONFIG_PATH = appConfigPath
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
    await writeFile(appConfigPath, JSON.stringify({
      ...defaultPersonalLocalAppConfig(),
      provider: { ...defaultPersonalLocalAppConfig().provider, provider_id: 'mock-provider' },
      ledger_path: ledgerPath,
      source_ledger_path: join(tempDir, 'source-ledger'),
      initialized_at: '2026-06-01T00:00:00.000Z',
    }), 'utf8')
  })

  afterEach(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key as keyof typeof originalEnv]
      else process.env[key as keyof typeof originalEnv] = value
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  it('returns 202 and records a calibration_run_requested event (no synchronous backtest)', async () => {
    const response = await POST()
    const payload = await response.json()

    expect(response.status).toBe(202)
    expect(payload.calibration_run_id).toMatch(/^cal_/)

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      expect(events.filter((e) => e.event_type === 'calibration_run_requested')).toHaveLength(1)
      expect(events.some((e) => e.event_type === 'calibration_run')).toBe(false)
    } finally {
      store.close()
    }
  })
})
