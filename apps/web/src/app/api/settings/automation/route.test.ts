import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultAutomationSettings, mergeAutomationSettings } from '@owlfolio/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GET, POST } from './route'

const originalEnv = {
  OWLFOLIO_APP_CONFIG_PATH: process.env.OWLFOLIO_APP_CONFIG_PATH,
  OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR,
}

describe('GET /api/settings/automation', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-settings-automation-get-'))
    process.env.OWLFOLIO_APP_CONFIG_PATH = join(tempDir, 'app-config.json')
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
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

  it('returns default automation settings when no config file exists', async () => {
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.automation).toEqual(defaultAutomationSettings())
  })
})

describe('POST /api/settings/automation', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-settings-automation-post-'))
    process.env.OWLFOLIO_APP_CONFIG_PATH = join(tempDir, 'app-config.json')
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
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

  it('merges a partial automation update and returns the full merged settings', async () => {
    const response = await POST(new Request('http://localhost/api/settings/automation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ research_engine_enabled: false }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.automation.research_engine_enabled).toBe(false)
    // Other defaults remain
    expect(body.automation.quick_screen_approval).toBe(defaultAutomationSettings().quick_screen_approval)
    expect(body.automation.thesis_review).toEqual(defaultAutomationSettings().thesis_review)
    expect((body.automation as Record<string, unknown>).deep_dive_mode).toBeUndefined()
  })

  it('merges a nested discovery update', async () => {
    const response = await POST(new Request('http://localhost/api/settings/automation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discovery: { enabled: true, cadence: 'weekly' } }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.automation.discovery).toEqual({ enabled: true, cadence: 'weekly' })
  })

  it('persists the update so a subsequent GET reflects the new price_refresh setting', async () => {
    await POST(new Request('http://localhost/api/settings/automation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_refresh: { enabled: true, cadence: 'weekly' } }),
    }))

    const getResponse = await GET()
    const getBody = await getResponse.json()
    expect(getBody.automation.price_refresh).toEqual({ enabled: true, cadence: 'weekly' })
  })

  it('rejects an invalid quick_screen_approval value with 400', async () => {
    const response = await POST(new Request('http://localhost/api/settings/automation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quick_screen_approval: 'invalid_value' }),
    }))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe('invalid_automation_update')
  })

  it('rejects removed auto_skip quick_screen_approval value with 400', async () => {
    const response = await POST(new Request('http://localhost/api/settings/automation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quick_screen_approval: 'auto_skip' }),
    }))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe('invalid_automation_update')
  })

  it('rejects an invalid cadence value for discovery with 400', async () => {
    const response = await POST(new Request('http://localhost/api/settings/automation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discovery: { enabled: true, cadence: 'hourly' } }),
    }))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe('invalid_automation_update')
  })

  it('returns merged defaults when an empty object is posted', async () => {
    const response = await POST(new Request('http://localhost/api/settings/automation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.automation).toEqual(mergeAutomationSettings({}))
  })
})
