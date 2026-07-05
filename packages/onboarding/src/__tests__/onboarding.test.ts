import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { getOnboardingState, initializeSelectedMode, resetOnboardingRuntime, switchMode, updateOnboardingConfig } from '../onboarding'

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

      expect(state.config.mode).toBe('unconfigured')
      expect(state.config.provider.provider_id).toBe('mock-provider')
      expect(state.is_initialized).toBe(false)
    })
  })

  it('persists selected mode, provider, and shariah settings', async () => {
    await withTempProject(async (projectDir) => {
      const updated = await updateOnboardingConfig(
        {
          mode: 'personal-local',
          provider: { provider_id: 'openrouter', support_level: 'experimental' },
          shariah: { enabled: false },
        },
        { env: { OWLFOLIO_PROJECT_DIR: projectDir } },
      )

      expect(updated.mode).toBe('personal-local')
      expect(updated.provider.provider_id).toBe('openrouter')
      expect(updated.provider.support_level).toBe('experimental')
      expect(updated.provider.model_id).toBeUndefined()
      expect(updated.shariah.enabled).toBe(false)

      const state = await getOnboardingState({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })
      expect(state.config).toEqual(updated)
    })
  })

  it('stamps the savings-rate vintage when the write sets a non-default savings rate (injected clock)', async () => {
    await withTempProject(async (projectDir) => {
      const now = '2026-06-28T10:00:00.000Z'
      const updated = await updateOnboardingConfig(
        { savings: { savings_expected_profit_rate: 0.035, savings_model: 'mudarabah', equity_risk_margin: 0.05 } },
        { env: { OWLFOLIO_PROJECT_DIR: projectDir }, now },
      )

      expect(updated.savings?.savings_expected_profit_rate).toBe(0.035)
      expect(updated.savings?.savings_rate_set_at).toBe(now)

      // A later write that does NOT change the rate must not re-stamp the vintage.
      const unchanged = await updateOnboardingConfig(
        { savings: { savings_expected_profit_rate: 0.035, savings_model: 'mudarabah', equity_risk_margin: 0.06 } },
        { env: { OWLFOLIO_PROJECT_DIR: projectDir }, now: '2026-07-01T00:00:00.000Z' },
      )
      expect(unchanged.savings?.savings_expected_profit_rate).toBe(0.035)
      expect(unchanged.savings?.equity_risk_margin).toBe(0.06)
      expect(unchanged.savings?.savings_rate_set_at).toBe(now)
    })
  })

  it('leaves the savings-rate vintage unset when no savings write occurs (default rate)', async () => {
    await withTempProject(async (projectDir) => {
      const updated = await updateOnboardingConfig(
        { mode: 'personal-local' },
        { env: { OWLFOLIO_PROJECT_DIR: projectDir }, now: '2026-06-28T10:00:00.000Z' },
      )
      expect(updated.savings?.savings_rate_set_at).toBeUndefined()
    })
  })

  it('allows personal-local init and switch back to unconfigured', async () => {
    await withTempProject(async (projectDir) => {
      const env = { OWLFOLIO_PROJECT_DIR: projectDir, OWLFOLIO_DISABLE_TEST_DEFAULTS: '1' }
      const initialized = await initializeSelectedMode(
        { mode: 'personal-local', provider: { provider_id: 'openrouter', support_level: 'certified' } },
        { env },
      )
      expect(initialized.mode).toBe('personal-local')

      const switched = await switchMode('unconfigured', { env })
      expect(switched.mode).toBe('unconfigured')
    })
  })

  it('initializes personal local mode with an empty durable ledger', async () => {
    await withTempProject(async (projectDir) => {
      const updated = await initializeSelectedMode(
        {
          mode: 'personal-local',
          provider: { provider_id: 'openrouter', support_level: 'certified' },
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
          provider: { provider_id: 'openrouter', support_level: 'certified' },
        },
        { cwd: nestedDir },
      )

      const state = await getOnboardingState({ cwd: nestedDir })
      expect(state.config.ledger_path).toBe(join(projectDir, 'data', 'personal-ledger.sqlite'))
      expect(state.config.source_ledger_path).toBe(join(projectDir, 'data', 'source-ledger'))
    })
  })

  it('re-init (switchMode) is idempotent and non-destructive across unconfigured↔personal-local re-entry', async () => {
    await withTempProject(async (projectDir) => {
      const env = { OWLFOLIO_PROJECT_DIR: projectDir }

      // First-run: initialize personal-local and record a durable user event.
      const personalConfig = await initializeSelectedMode(
        { mode: 'personal-local', provider: { provider_id: 'openrouter', support_level: 'certified' } },
        { env },
      )
      const personalLedgerPath = personalConfig.ledger_path!
      const personalInitializedAt = personalConfig.initialized_at!

      const seedStore = new SQLiteEventStore(personalLedgerPath)
      try {
        await seedStore.append({
          event_id: 'evt_reentry_001',
          event_type: 'research_case_created',
          aggregate_type: 'research_case',
          aggregate_id: 'rc_reentry_001',
          idempotency_key: 'reentry:research_case:rc_reentry_001:v1',
          actor_type: 'user',
          actor_id: 'user_local',
          payload: { research_case_id: 'rc_reentry_001', company_id: 'company_test', ticker: 'TEST', strategy_id: 'buffett-munger' },
          source_ids: [],
          created_at: '2026-06-09T00:00:00.000Z',
          schema_version: 1,
        })
      } finally {
        seedStore.close()
      }

      const countEvents = async (path: string): Promise<number> => {
        const store = new SQLiteEventStore(path)
        try {
          return (await store.list()).length
        } finally {
          store.close()
        }
      }
      expect(await countEvents(personalLedgerPath)).toBe(1)

      // Switch personal → unconfigured: unconfigured carries no ledger, and must NOT wipe the personal ledger.
      const unconfiguredConfig = await switchMode('unconfigured', { env })
      expect(unconfiguredConfig.mode).toBe('unconfigured')
      expect(await countEvents(personalLedgerPath)).toBe(1) // personal events preserved on disk

      // Switch unconfigured → personal: personal ledger + its event survive untouched, timestamp unchanged.
      const backToPersonal = await switchMode('personal-local', { env })
      expect(backToPersonal.mode).toBe('personal-local')
      expect(backToPersonal.ledger_path).toBe(personalLedgerPath)
      expect(backToPersonal.initialized_at).toBe(personalInitializedAt)
      expect(await countEvents(personalLedgerPath)).toBe(1)

      // Round-trip again to be sure re-entry is repeatable.
      await switchMode('unconfigured', { env })
      const finalPersonal = await switchMode('personal-local', { env })
      expect(await countEvents(personalLedgerPath)).toBe(1)
      expect(finalPersonal.initialized_at).toBe(personalInitializedAt)
    })
  })

  it('re-selecting the current mode appends nothing and leaves initialized_at unchanged', async () => {
    await withTempProject(async (projectDir) => {
      const env = { OWLFOLIO_PROJECT_DIR: projectDir }

      const personalConfig = await initializeSelectedMode(
        { mode: 'personal-local', provider: { provider_id: 'openrouter', support_level: 'certified' } },
        { env },
      )
      const personalLedgerPath = personalConfig.ledger_path!
      const personalInitializedAt = personalConfig.initialized_at!

      const countEvents = async (path: string): Promise<number> => {
        const store = new SQLiteEventStore(path)
        try {
          return (await store.list()).length
        } finally {
          store.close()
        }
      }
      expect(await countEvents(personalLedgerPath)).toBe(0) // personal-local starts empty

      // Re-selecting the SAME mode must be a no-op: no extra events, same timestamp/ledger.
      const reselected = await switchMode('personal-local', { env })
      expect(reselected.mode).toBe('personal-local')
      expect(reselected.initialized_at).toBe(personalInitializedAt)
      expect(reselected.ledger_path).toBe(personalLedgerPath)
      expect(await countEvents(personalLedgerPath)).toBe(0)
    })
  })

  it('resets onboarding runtime state back to defaults', async () => {
    await withTempProject(async (projectDir) => {
      await initializeSelectedMode(
        {
          mode: 'personal-local',
          provider: { provider_id: 'openrouter', support_level: 'certified' },
        },
        { env: { OWLFOLIO_PROJECT_DIR: projectDir } },
      )

      await resetOnboardingRuntime({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })

      const state = await getOnboardingState({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })
      expect(state.config.mode).toBe('unconfigured')
      expect(state.is_initialized).toBe(false)
      expect(state.config.ledger_path).toBeUndefined()
      expect(state.config.source_ledger_path).toBeUndefined()
      expect(state.config.initialized_at).toBeUndefined()
    })
  })
})
