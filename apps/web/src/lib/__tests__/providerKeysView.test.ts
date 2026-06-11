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
      await setEnvKey('ANTHROPIC_API_KEY', 'sk-ant-secret-tail-ABCDEF', { envPath })

      const props = await buildProviderKeysPanelProps({
        ledgerPath: undefined,
        envKeyOptions: { envPath },
        repoRoot: dir,
        processEnv: {},
        activeProviderId: 'mock-provider',
        activeModel: 'mock-demo',
      })

      const anthropic = props.llmGroups.find((group) => group.id === 'anthropic')
      expect(anthropic?.selectable_in_registry).toBe(true)
      const anthropicKey = anthropic?.keys.find((key) => key.name === 'ANTHROPIC_API_KEY')
      expect(anthropicKey?.is_set).toBe(true)
      expect(anthropicKey?.tail).toBeDefined()

      // No raw secret anywhere in the props (acceptance test 6 at the data layer).
      const serialized = JSON.stringify(props)
      expect(serialized).not.toContain('sk-ant-secret-tail-ABCDEF')
      expect(serialized).not.toContain('secret-tail')
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
      expect(props.tierSummary.lines.length).toBeGreaterThan(0)
    })
  })
})
