import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { updateAppearanceSettings, updateLanguageSettings, updateShariahSettings } from '../onboarding'

// CLOBBER GUARD (2026-07-17, sandbox dogfood: the theme reverted after unrelated settings writes):
// every partial settings updater must round-trip the OTHER settings untouched.

describe('settings updates preserve sibling settings', () => {
  let tempDir: string
  let configPath: string
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'owlfolio-settings-preserve-'))
    configPath = join(tempDir, 'app-config.json')
    process.env.OWLFOLIO_APP_CONFIG_PATH = configPath
    process.env.OWLFOLIO_PROJECT_DIR = tempDir
    await writeFile(configPath, JSON.stringify({
      mode: 'personal-local',
      provider: { provider_id: 'mock-provider' },
      strategy_id: 'buffett-munger',
      appearance: { theme: 'sapphire' },
      language: 'ar',
      shariah: { enabled: false },
    }), 'utf8')
  })

  afterEach(async () => {
    process.env.OWLFOLIO_APP_CONFIG_PATH = originalEnv.OWLFOLIO_APP_CONFIG_PATH
    process.env.OWLFOLIO_PROJECT_DIR = originalEnv.OWLFOLIO_PROJECT_DIR
    if (originalEnv.OWLFOLIO_APP_CONFIG_PATH === undefined) delete process.env.OWLFOLIO_APP_CONFIG_PATH
    if (originalEnv.OWLFOLIO_PROJECT_DIR === undefined) delete process.env.OWLFOLIO_PROJECT_DIR
    await rm(tempDir, { force: true, recursive: true })
  })

  async function fileConfig(): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
  }

  it('updateLanguageSettings keeps the theme and the shariah toggle', async () => {
    await updateLanguageSettings({ language: 'en' })
    const c = await fileConfig()
    expect(c.appearance).toEqual({ theme: 'sapphire' })
    expect(c.shariah).toEqual({ enabled: false })
    expect(c.language).toBe('en')
  })

  it('updateAppearanceSettings keeps the language and the shariah toggle', async () => {
    await updateAppearanceSettings({ theme: 'mono' })
    const c = await fileConfig()
    expect(c.language).toBe('ar')
    expect(c.shariah).toEqual({ enabled: false })
    expect(c.appearance).toEqual({ theme: 'mono' })
  })

  it('updateShariahSettings keeps the theme and the language', async () => {
    await updateShariahSettings({ enabled: true })
    const c = await fileConfig()
    expect(c.appearance).toEqual({ theme: 'sapphire' })
    expect(c.language).toBe('ar')
  })
})
