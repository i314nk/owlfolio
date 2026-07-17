import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POST } from './route'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
}

describe('POST /api/settings/language (i18n S1)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-settings-language-'))
    process.env.OWLFOLIO_APP_CONFIG_PATH = join(tempDir, 'app-config.json')
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
    await writeFile(
      join(tempDir, 'app-config.json'),
      JSON.stringify({
        ...defaultPersonalLocalAppConfig(),
        ledger_path: join(tempDir, 'personal.sqlite'),
        source_ledger_path: join(tempDir, 'source-ledger'),
        initialized_at: '2026-01-01T00:00:00.000Z',
      }),
      'utf8',
    )
  })

  afterEach(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key as keyof typeof originalEnv]
      else process.env[key as keyof typeof originalEnv] = value
    }
    await rm(tempDir, { force: true, recursive: true })
  })

  it('persists a valid language', async () => {
    const response = await POST(new Request('http://localhost/api/settings/language', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'ar' }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ language: 'ar' })
  })

  it('rejects an unknown locale (400)', async () => {
    const response = await POST(new Request('http://localhost/api/settings/language', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'fr' }),
    }))
    expect(response.status).toBe(400)
  })
})
