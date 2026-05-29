import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { getDemoSeedEvents } from '../../lib/demoSeed'
import { getOnboardingState, initializeSelectedMode, resetOnboardingRuntime, updateOnboardingConfig } from '../onboarding'

describe('onboarding helpers', () => {
  async function withTempProject(assertion: (projectDir: string) => Promise<void>) {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-onboarding-'))
    try {
      await assertion(projectDir)
    } finally {
      await rm(projectDir, { force: true, recursive: true })
    }
  }

  it('returns default onboarding state when no config file exists', async () => {
    await withTempProject(async (projectDir) => {
      const state = await getOnboardingState({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })

      expect(state.config.mode).toBe('demo')
      expect(state.config.provider.provider_id).toBe('mock-provider')
      expect(state.is_initialized).toBe(false)
    })
  })

  it('persists selected mode, provider, and shariah settings', async () => {
    await withTempProject(async (projectDir) => {
      const updated = await updateOnboardingConfig(
        {
          mode: 'personal-local',
          provider: { provider_id: 'openai', support_level: 'experimental' },
          shariah: { enabled: false },
        },
        { env: { OWLFOLIO_PROJECT_DIR: projectDir } },
      )

      expect(updated.mode).toBe('personal-local')
      expect(updated.provider.provider_id).toBe('openai')
      expect(updated.provider.support_level).toBe('experimental')
      expect(updated.shariah.enabled).toBe(false)

      const state = await getOnboardingState({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })
      expect(state.config).toEqual(updated)
    })
  })

  it('initializes demo mode with seeded durable ledger events', async () => {
    await withTempProject(async (projectDir) => {
      const updated = await initializeSelectedMode(
        {
          mode: 'demo',
          provider: { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' },
        },
        { env: { OWLFOLIO_PROJECT_DIR: projectDir } },
      )

      expect(updated.mode).toBe('demo')
      expect(updated.ledger_path).toBeDefined()
      expect(updated.source_ledger_path).toBe(join(projectDir, 'data', 'source-ledger'))
      expect(updated.initialized_at).toBeDefined()

      const store = new SQLiteEventStore(updated.ledger_path!)
      try {
        const events = await store.list()
        expect(events).toHaveLength(getDemoSeedEvents().length)
      } finally {
        store.close()
      }
    })
  })

  it('initializes personal local mode with an empty durable ledger', async () => {
    await withTempProject(async (projectDir) => {
      const updated = await initializeSelectedMode(
        {
          mode: 'personal-local',
          provider: { provider_id: 'claude', support_level: 'certified' },
        },
        { env: { OWLFOLIO_PROJECT_DIR: projectDir } },
      )

      expect(updated.mode).toBe('personal-local')
      expect(updated.ledger_path).toBeDefined()
      expect(updated.source_ledger_path).toBe(join(projectDir, 'data', 'source-ledger'))
      expect(updated.initialized_at).toBeDefined()

      const store = new SQLiteEventStore(updated.ledger_path!)
      try {
        const events = await store.list()
        expect(events).toEqual([])
      } finally {
        store.close()
      }
    })
  })

  it('resolves personal local runtime paths from a nested app cwd back to the workspace root', async () => {
    await withTempProject(async (projectDir) => {
      const nestedDir = join(projectDir, 'apps', 'web', 'src')
      await rm(join(projectDir, 'data'), { force: true, recursive: true })
      await mkdir(nestedDir, { recursive: true })
      await writeFile(join(projectDir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n', 'utf8')
      await initializeSelectedMode(
        {
          mode: 'personal-local',
          provider: { provider_id: 'claude', support_level: 'certified' },
        },
        { cwd: nestedDir },
      )

      const state = await getOnboardingState({ cwd: nestedDir })
      expect(state.config.ledger_path).toBe(join(projectDir, 'data', 'personal-ledger.sqlite'))
      expect(state.config.source_ledger_path).toBe(join(projectDir, 'data', 'source-ledger'))
    })
  })

  it('resets onboarding runtime state back to defaults', async () => {
    await withTempProject(async (projectDir) => {
      await initializeSelectedMode(
        {
          mode: 'demo',
          provider: { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' },
        },
        { env: { OWLFOLIO_PROJECT_DIR: projectDir } },
      )

      await resetOnboardingRuntime({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })

      const state = await getOnboardingState({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })
      expect(state.config.mode).toBe('demo')
      expect(state.is_initialized).toBe(false)
      expect(state.config.ledger_path).toBeUndefined()
      expect(state.config.source_ledger_path).toBeUndefined()
      expect(state.config.initialized_at).toBeUndefined()
    })
  })
})
