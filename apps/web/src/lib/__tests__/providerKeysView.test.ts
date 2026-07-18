import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildProviderKeysPanelProps } from '../providerKeysView'
import { setEnvKey } from '../envKeys'

async function withTemp(assertion: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'owlfolio-keysview-'))
  try {
    await assertion(dir)
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}

describe('buildProviderKeysPanelProps', () => {
  it('builds masked LLM/tool groups and marks a group selectable once its key is set', async () => {
    await withTemp(async (dir) => {
      const envPath = join(dir, '.env')
      await setEnvKey('OPENROUTER_API_KEY', 'sk-or-secret-tail-ABCDEF', { envPath })

      const props = await buildProviderKeysPanelProps({
        ledgerPath: undefined,
        envKeyOptions: { envPath },
        repoRoot: dir,
        processEnv: {},
        activeProviderId: 'mock-provider',
      })

      const openrouter = props.llmGroups.find((group) => group.id === 'openrouter')
      expect(openrouter?.selectable_in_registry).toBe(true)
      const openrouterKey = openrouter?.keys.find((key) => key.name === 'OPENROUTER_API_KEY')
      expect(openrouterKey?.is_set).toBe(true)
      expect(openrouterKey?.tail).toBeDefined()

      // PROVIDER CONSOLIDATION: only OpenRouter + the experimental local group survive.
      expect(props.llmGroups.map((group) => group.id).sort()).toEqual(['local', 'openrouter'])

      // No raw secret anywhere in the props (acceptance test 6 at the data layer).
      const serialized = JSON.stringify(props)
      expect(serialized).not.toContain('sk-or-secret-tail-ABCDEF')
      expect(serialized).not.toContain('secret-tail')
    })
  })

  it('treats a provider key stored ONLY in the env file as connected (no contradiction across sections)', async () => {
    await withTemp(async (dir) => {
      const envPath = join(dir, '.env')
      // OpenRouter is env-key-only (deterministic, no credentials-file fallback). The key lives ONLY in
      // the local env file — never in the process env passed below.
      await setEnvKey('OPENROUTER_API_KEY', 'or-file-only-key', { envPath })

      const props = await buildProviderKeysPanelProps({
        ledgerPath: undefined,
        envKeyOptions: { envPath },
        repoRoot: dir,
        processEnv: {},
        activeProviderId: 'openrouter',
      })

      // The gate must reflect that OpenRouter is connected — the key being "set" (Section B) and
      // "connected" must never contradict "not connected" elsewhere.
      expect(props.onboardingGate.is_complete).toBe(true)
    })
  })

  it('reports the env-file path and its git-ignored status, and a fresh onboarding gate', async () => {
    await withTemp(async (dir) => {
      const envPath = join(dir, '.env')
      const props = await buildProviderKeysPanelProps({
        ledgerPath: undefined,
        envKeyOptions: { envPath },
        repoRoot: '/some/repo',
        processEnv: {},
        activeProviderId: 'mock-provider',
      })
      expect(props.envFile.path).toBe(envPath)
      expect(props.envFile.is_git_ignored).toBe(true) // outside the repo
      // SCALE-DOWN S5: the gate is provider-only; mock-provider is always ready → complete.
      expect(props.onboardingGate.is_complete).toBe(true)
      expect(props.onboardingGate.items).toHaveLength(1)
    })
  })

})

describe('key runtime state (restart-to-apply signal)', () => {
  it('flags a key CHANGED on disk after boot as stale_changed and a file-only key as not_loaded', async () => {
    await withTemp(async (dir) => {
      const envPath = join(dir, '.env')
      await setEnvKey('OPENROUTER_API_KEY', 'sk-or-NEW-file-value', { envPath })
      await setEnvKey('OWLFOLIO_LOCAL_API_KEY', 'sk-local-saved-after-boot', { envPath })

      const props = await buildProviderKeysPanelProps({
        ledgerPath: undefined,
        envKeyOptions: { envPath },
        repoRoot: dir,
        // The running server booted with a DIFFERENT OpenRouter key and no local key at all.
        processEnv: { OPENROUTER_API_KEY: 'sk-or-OLD-boot-value' },
        activeProviderId: 'mock-provider',
      })

      const openrouterKey = props.llmGroups.find((g) => g.id === 'openrouter')?.keys.find((k) => k.name === 'OPENROUTER_API_KEY')
      expect(openrouterKey?.runtime_state).toBe('stale_changed')
      const localKey = props.llmGroups.find((g) => g.id === 'local')?.keys.find((k) => k.name === 'OWLFOLIO_LOCAL_API_KEY')
      expect(localKey?.runtime_state).toBe('not_loaded')
      // No raw secret leaks through the new field.
      const serialized = JSON.stringify(props)
      expect(serialized).not.toContain('sk-or-NEW-file-value')
      expect(serialized).not.toContain('sk-local-saved-after-boot')
    })
  })

  it('a key whose file and process values MATCH is active (no restart nag)', async () => {
    await withTemp(async (dir) => {
      const envPath = join(dir, '.env')
      await setEnvKey('OPENROUTER_API_KEY', 'sk-or-same', { envPath })
      const props = await buildProviderKeysPanelProps({
        ledgerPath: undefined,
        envKeyOptions: { envPath },
        repoRoot: dir,
        processEnv: { OPENROUTER_API_KEY: 'sk-or-same' },
        activeProviderId: 'mock-provider',
      })
      const openrouterKey = props.llmGroups.find((g) => g.id === 'openrouter')?.keys.find((k) => k.name === 'OPENROUTER_API_KEY')
      expect(openrouterKey?.runtime_state).toBe('active')
    })
  })
})
