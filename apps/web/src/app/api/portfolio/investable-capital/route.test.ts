import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { projectInvestableCapital } from '@owlfolio/ledger/projections/investableCapitalProjection'

import { POST } from './route'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
}

function formRequest(fields: Record<string, string>): Request {
  const body = new URLSearchParams(fields)
  return new Request('http://localhost/api/portfolio/investable-capital', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

describe('/api/portfolio/investable-capital', () => {
  let tempDir: string
  let appConfigPath: string
  let ledgerPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-investable-capital-route-'))
    appConfigPath = join(tempDir, 'app-config.json')
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
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key as keyof typeof originalEnv]
      } else {
        process.env[key as keyof typeof originalEnv] = value
      }
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  it('appends a user-authored investable_capital_set event and redirects to /portfolio', async () => {
    // redirect() throws a NEXT_REDIRECT control-flow error; treat that as the success signal.
    await expect(POST(formRequest({ amount: '50000', currency: 'USD' }))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    })

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      const capitalEvents = events.filter((event) => event.event_type === 'investable_capital_set')
      expect(capitalEvents).toHaveLength(1)
      expect(capitalEvents[0]?.actor_type).toBe('user')

      const snapshot = projectInvestableCapital(events)
      expect(snapshot).toMatchObject({ amount: 50000, currency: 'USD' })
    } finally {
      store.close()
    }
  })

  it('returns a clean 400 JSON error when the amount is not greater than zero', async () => {
    const response = await POST(formRequest({ amount: '0', currency: 'USD' }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/Investable capital amount must be greater than zero/),
    })

    const store = new SQLiteEventStore(ledgerPath)
    try {
      expect((await store.list()).filter((event) => event.event_type === 'investable_capital_set')).toHaveLength(0)
    } finally {
      store.close()
    }
  })

  it('returns a clean 400 JSON error when the currency is not a valid ISO 4217 code', async () => {
    const response = await POST(formRequest({ amount: '1000', currency: 'ZZZZ' }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/Investable capital currency must be a valid ISO 4217 currency code/),
    })
  })
})
