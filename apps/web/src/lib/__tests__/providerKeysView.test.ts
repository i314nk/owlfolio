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
      await setEnvKey('OPENAI_API_KEY', 'sk-openai-secret-tail-ABCDEF', { envPath })

      const props = await buildProviderKeysPanelProps({
        ledgerPath: undefined,
        envKeyOptions: { envPath },
        repoRoot: dir,
        processEnv: {},
        activeProviderId: 'mock-provider',
        activeModel: 'mock-demo',
      })

      const openai = props.llmGroups.find((group) => group.id === 'openai')
      expect(openai?.selectable_in_registry).toBe(true)
      const openaiKey = openai?.keys.find((key) => key.name === 'OPENAI_API_KEY')
      expect(openaiKey?.is_set).toBe(true)
      expect(openaiKey?.tail).toBeDefined()

      // No raw secret anywhere in the props (acceptance test 6 at the data layer).
      const serialized = JSON.stringify(props)
      expect(serialized).not.toContain('sk-openai-secret-tail-ABCDEF')
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
        activeModel: 'openai/gpt-5.5',
        cwd: dir,
      })

      // The tier badges must reflect that OpenRouter is connected — the key being "set" (Section B) and
      // "connected" must never contradict "not connected" elsewhere. With OpenRouter the active provider,
      // every tier resolves to it.
      expect(props.roleConfig.tiers.every((tier) => tier.target_provider_connected)).toBe(true)
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
        activeModel: 'mock-demo',
      })
      expect(props.envFile.path).toBe(envPath)
      expect(props.envFile.is_git_ignored).toBe(true) // outside the repo
      expect(props.onboardingGate.is_complete).toBe(false)
      // Three tier rows (T1/T2/T3).
      expect(props.roleConfig.tiers.length).toBe(3)
      expect(props.roleConfig.tiers.map((t) => t.tier)).toEqual(['T1', 'T2', 'T3'])
    })
  })

  it('builds the per-tier config view: a tier override wins + source/warning are honest', async () => {
    await withTemp(async (dir) => {
      const envPath = join(dir, '.env')
      // A file override pins the T1 representative role (synthesis) onto a provider with NO creds here.
      await setEnvKey('OWLFOLIO_MODEL_ROLE_SYNTHESIS', 'deepseek:r1@0.0', { envPath })

      const props = await buildProviderKeysPanelProps({
        ledgerPath: undefined,
        envKeyOptions: { envPath },
        repoRoot: dir,
        processEnv: {},
        activeProviderId: 'mock-provider',
        activeModel: 'mock-demo',
        cwd: dir,
      })

      const t1 = props.roleConfig.tiers.find((t) => t.tier === 'T1')
      expect(t1?.source).toBe('file')
      expect(t1?.resolved_provider_id).toBe('deepseek')
      expect(t1?.resolved_model).toBe('r1')
      expect(t1?.target_provider_connected).toBe(false) // no deepseek creds → fail-closed warning
      expect(t1?.current_value).toBe('deepseek:r1@0.0')
      // The tier names the roles it covers (the fan-out targets).
      expect(t1?.roles).toContain('synthesis')

      // A non-overridden tier inherits the run provider/model (default source).
      const t3 = props.roleConfig.tiers.find((t) => t.tier === 'T3')
      expect(t3?.source).toBe('default')
      expect(t3?.resolved_provider_id).toBe('mock-provider')
      expect(t3?.resolved_model).toBe('mock-demo')

      // The tier menus are scoped to the primary provider, and nothing carries a secret.
      expect(props.roleConfig.active_provider_id).toBe('mock-provider')
      expect(props.roleConfig.tiers).toHaveLength(3)
    })
  })
})
