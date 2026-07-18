import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POST } from './route'

const SECRET = 'sk-ant-supersecret-value-K3jQAA'

const original = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
  OWLFOLIO_ENV_FILE: process.env.OWLFOLIO_ENV_FILE,
}

describe('/api/onboarding/credentials', () => {
  let tempDir: string
  let envPath: string
  let ledgerPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-credentials-route-'))
    envPath = join(tempDir, '.env')
    ledgerPath = join(tempDir, 'personal.sqlite')
    process.env.OWLFOLIO_APP_CONFIG_PATH = join(tempDir, 'app-config.json')
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
    process.env.OWLFOLIO_ENV_FILE = envPath
    await writeFile(process.env.OWLFOLIO_APP_CONFIG_PATH, JSON.stringify({
      ...defaultPersonalLocalAppConfig(),
      ledger_path: ledgerPath,
      source_ledger_path: join(tempDir, 'source-ledger'),
      initialized_at: '2026-06-01T00:00:00.000Z',
    }), 'utf8')
  })

  afterEach(async () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key as keyof typeof original]
      else process.env[key as keyof typeof original] = value
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  function form(name: string, value: string): Request {
    const body = new URLSearchParams({ name, value })
    return new Request('http://localhost/api/onboarding/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  }

  it('writes the key to the local env file and records a provider-connected event WITHOUT the secret', async () => {
    const response = await POST(form('OPENROUTER_API_KEY', SECRET))
    expect([200, 303]).toContain(response.status)

    // The secret is in the local env file only.
    const rawEnv = await readFile(envPath, 'utf8')
    expect(rawEnv).toContain('OPENROUTER_API_KEY=')
    expect(rawEnv).toContain(SECRET)

    // The ledger records the connection but NEVER the secret.
    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      const connected = events.find((event) => event.event_type === 'provider_connected')
      expect(connected).toBeDefined()
      const serialized = JSON.stringify(events)
      expect(serialized).not.toContain(SECRET)
      expect(serialized).not.toContain('supersecret')
      expect(serialized).toContain('OPENROUTER_API_KEY')
    } finally {
      store.close()
    }
  })

  it('rejects an unsafe key name with a 400', async () => {
    const response = await POST(form('bad name', 'x'))
    expect(response.status).toBe(400)
  })

  it('does not record a provider-connected event for a non-LLM tool key', async () => {
    await POST(form('OWLFOLIO_MARKET_DATA_API_KEY', 'md-key-123456'))
    const store = new SQLiteEventStore(ledgerPath)
    try {
      const events = await store.list()
      expect(events.find((event) => event.event_type === 'provider_connected')).toBeUndefined()
    } finally {
      store.close()
    }
  })
})
