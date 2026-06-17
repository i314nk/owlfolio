import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createNotConfiguredCertificationReport, createQuotaLimitedCertificationReport, createReauthRequiredCertificationReport } from '@owlfolio/providers'
import { describe, expect, it } from 'vitest'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { getDemoSeedEvents } from '../../lib/demoSeed'
import { getOnboardingProviderOptions, getOnboardingState, getProviderReadinessSnapshot, initializeSelectedMode, resetOnboardingRuntime, switchMode, updateOnboardingConfig } from '../onboarding'

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
      expect(updated.provider.model_id).toBeUndefined()
      expect(updated.shariah.enabled).toBe(false)

      const state = await getOnboardingState({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })
      expect(state.config).toEqual(updated)
    })
  })

  it('keeps provider option descriptions concise while readiness evidence stays in the readiness snapshot', async () => {
    await withTempProject(async (projectDir) => {
      const reportDir = join(projectDir, 'data', 'provider-certifications')
      await mkdir(reportDir, { recursive: true })
      await writeFile(join(reportDir, 'claude.latest.json'), JSON.stringify(createNotConfiguredCertificationReport({
        provider_id: 'claude',
        generated_at: '2026-06-02T00:00:00.000Z',
        capabilities: {
          'text-generation': 'native',
          'structured-output': 'native',
          'tool-function-calling': 'unsupported',
          'streaming-observability': 'adapter',
          'multi-step-tool-loop': 'unsupported',
        },
        reason: 'Claude subscription access disabled',
      })), 'utf8')

      const options = await getOnboardingProviderOptions({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })
      const claudeOption = options.find((provider) => provider.provider_id === 'claude')
      const state = await getOnboardingState({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })
      const readiness = await getProviderReadinessSnapshot(
        {
          ...state.config,
          mode: 'personal-local',
          provider: { provider_id: 'claude', support_level: 'experimental' },
        },
        { env: { OWLFOLIO_PROJECT_DIR: projectDir } },
      )

      expect(claudeOption?.description).toBe('CLI-backed real provider path behind readiness and certification checks.')
      expect(readiness.status_label).toBe('Claude subscription access disabled')
    })
  })

  it('classifies OpenAI Codex CLI cached-session reauthentication from target certification without leaking secrets', async () => {
    await withTempProject(async (projectDir) => {
      const reportDir = join(projectDir, 'data', 'provider-certifications')
      const authPath = join(projectDir, '.codex', 'auth.json')
      await mkdir(reportDir, { recursive: true })
      await mkdir(join(projectDir, '.codex'), { recursive: true })
      await writeFile(authPath, '{"access_token":"real-cached-token"}', 'utf8')
      await writeFile(join(reportDir, 'openai-codex-cli-reauth.latest.json'), JSON.stringify(createReauthRequiredCertificationReport({
        provider_id: 'openai',
        generated_at: '2026-06-03T00:00:00.000Z',
        capabilities: unavailableProviderCapabilities(),
        reason: 'cached session expired at /tmp/secret/codex/auth.json with CODEX_ACCESS_TOKEN=secret-token',
        auth_mode: 'cli_cached_session',
      })), 'utf8')

      const readiness = await getProviderReadinessSnapshot(
        {
          ...(await getOnboardingState({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })).config,
          mode: 'personal-local',
          provider: { provider_id: 'openai', support_level: 'experimental' },
        },
        {
          env: {
            OWLFOLIO_PROJECT_DIR: projectDir,
            OWLFOLIO_CODEX_AUTH_PATH: authPath,
          },
        },
      )

      expect(readiness).toMatchObject({
        provider_id: 'openai',
        provider_surface_id: 'openai-codex-cli',
        vendor_id: 'openai',
        runtime_kind: 'cli',
        auth_mode: 'cli_cached_session',
        readiness_state: 'reauth_required',
        credential_source_category: 'configured_secret_file',
        credential_source_label: 'Codex OAuth credentials',
        support_level: 'unsupported',
        is_ready: false,
        auth_source: 'certification report',
        quota_status: 'unknown',
        headless_supported: false,
        scheduled_workflow_supported: false,
        automation_suitability: 'personal_local_interactive',
        reauth_action: 'Run codex login outside Owlfolio, then retry readiness.',
      })
      expect(readiness.status_label).toContain('[redacted-path]')
      expect(JSON.stringify(readiness)).not.toContain('/tmp/secret/codex/auth.json')
      expect(JSON.stringify(readiness)).not.toContain('secret-token')
      expect(JSON.stringify(readiness)).not.toContain(authPath)
      expect(JSON.stringify(readiness)).not.toContain('real-cached-token')
    })
  })

  it('classifies OpenAI Codex CLI access-token quota limits as unready without leaking token values', async () => {
    await withTempProject(async (projectDir) => {
      const reportDir = join(projectDir, 'data', 'provider-certifications')
      await mkdir(reportDir, { recursive: true })
      await writeFile(join(reportDir, 'openai-codex-cli-quota.latest.json'), JSON.stringify(createQuotaLimitedCertificationReport({
        provider_id: 'openai',
        generated_at: '2026-06-03T00:00:00.000Z',
        capabilities: unavailableProviderCapabilities(),
        reason: 'quota exhausted for Bearer bearer-secret-token',
        auth_mode: 'cli_access_token',
      })), 'utf8')

      const codexAccessToken = ['codex', 'redaction', 'token'].join('-')
      const readiness = await getProviderReadinessSnapshot(
        {
          ...(await getOnboardingState({ env: { OWLFOLIO_PROJECT_DIR: projectDir } })).config,
          mode: 'personal-local',
          provider: { provider_id: 'openai', support_level: 'experimental' },
        },
        {
          env: {
            OWLFOLIO_PROJECT_DIR: projectDir,
            CODEX_ACCESS_TOKEN: codexAccessToken,
          },
        },
      )

      expect(readiness).toMatchObject({
        provider_id: 'openai',
        provider_surface_id: 'openai-codex-cli',
        auth_mode: 'cli_access_token',
        readiness_state: 'quota_limited',
        credential_source_category: 'env_var',
        credential_source_label: 'CODEX_ACCESS_TOKEN',
        is_ready: false,
        auth_source: 'certification report',
        quota_source: 'subscription_tier',
        quota_status: 'limited',
      })
      expect(readiness.status_label).toContain('[redacted-secret]')
      expect(JSON.stringify(readiness)).not.toContain('bearer-secret-token')
      expect(JSON.stringify(readiness)).not.toContain(codexAccessToken)
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

  it('refuses to initialize demo mode outside test mode', async () => {
    await withTempProject(async (projectDir) => {
      await expect(
        initializeSelectedMode(
          { mode: 'demo', provider: { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' } },
          { env: { OWLFOLIO_PROJECT_DIR: projectDir, OWLFOLIO_DISABLE_TEST_DEFAULTS: '1' } },
        ),
      ).rejects.toThrow(/Demo mode is retired in production/)
    })
  })

  it('refuses to switch into demo mode outside test mode', async () => {
    await withTempProject(async (projectDir) => {
      await expect(
        switchMode('demo', { env: { OWLFOLIO_PROJECT_DIR: projectDir, OWLFOLIO_DISABLE_TEST_DEFAULTS: '1' } }),
      ).rejects.toThrow(/Demo mode is retired in production/)
    })
  })

  it('still allows personal-local init and switch outside test mode', async () => {
    await withTempProject(async (projectDir) => {
      const env = { OWLFOLIO_PROJECT_DIR: projectDir, OWLFOLIO_DISABLE_TEST_DEFAULTS: '1' }
      const initialized = await initializeSelectedMode(
        { mode: 'personal-local', provider: { provider_id: 'claude', support_level: 'certified' } },
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

  it('re-init (switchMode) is idempotent and non-destructive across demo↔personal-local re-entry', async () => {
    await withTempProject(async (projectDir) => {
      const env = { OWLFOLIO_PROJECT_DIR: projectDir }

      // First-run: initialize personal-local and record a durable user event.
      const personalConfig = await initializeSelectedMode(
        { mode: 'personal-local', provider: { provider_id: 'claude', support_level: 'certified' } },
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

      // Switch personal → demo: must NOT wipe/re-seed the personal ledger, points at the demo ledger.
      const demoConfig = await switchMode('demo', { env })
      expect(demoConfig.mode).toBe('demo')
      expect(demoConfig.ledger_path).not.toBe(personalLedgerPath)
      expect(await countEvents(personalLedgerPath)).toBe(1) // personal events preserved

      // Switch demo → personal: personal ledger + its event survive untouched, timestamp unchanged.
      const backToPersonal = await switchMode('personal-local', { env })
      expect(backToPersonal.mode).toBe('personal-local')
      expect(backToPersonal.ledger_path).toBe(personalLedgerPath)
      expect(backToPersonal.initialized_at).toBe(personalInitializedAt)
      expect(await countEvents(personalLedgerPath)).toBe(1)

      // Round-trip again to be sure re-entry is repeatable.
      await switchMode('demo', { env })
      const finalPersonal = await switchMode('personal-local', { env })
      expect(await countEvents(personalLedgerPath)).toBe(1)
      expect(finalPersonal.initialized_at).toBe(personalInitializedAt)
    })
  })

  it('re-selecting the current mode appends nothing, re-seeds nothing, and leaves initialized_at unchanged', async () => {
    await withTempProject(async (projectDir) => {
      const env = { OWLFOLIO_PROJECT_DIR: projectDir }

      const demoConfig = await initializeSelectedMode(
        { mode: 'demo', provider: { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' } },
        { env },
      )
      const demoLedgerPath = demoConfig.ledger_path!
      const demoInitializedAt = demoConfig.initialized_at!

      const countEvents = async (path: string): Promise<number> => {
        const store = new SQLiteEventStore(path)
        try {
          return (await store.list()).length
        } finally {
          store.close()
        }
      }
      const seededCount = await countEvents(demoLedgerPath)
      expect(seededCount).toBe(getDemoSeedEvents().length)

      // Re-selecting the SAME mode must be a no-op: no extra events, no duplicate seed, same timestamp.
      const reselected = await switchMode('demo', { env })
      expect(reselected.mode).toBe('demo')
      expect(reselected.initialized_at).toBe(demoInitializedAt)
      expect(reselected.ledger_path).toBe(demoLedgerPath)
      expect(await countEvents(demoLedgerPath)).toBe(seededCount) // seed not re-applied / duplicated
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

function unavailableProviderCapabilities() {
  return {
    'text-generation': 'native',
    'structured-output': 'adapter',
    'tool-function-calling': 'unsupported',
    'streaming-observability': 'adapter',
    'multi-step-tool-loop': 'unsupported',
  } as const
}
