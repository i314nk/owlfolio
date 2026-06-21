import { describe, expect, it } from 'vitest'

import {
  buildTierGroupedModelOptions,
  defaultModelForConnection,
  providerModeForOption,
  providerSelectionForConnection,
  providerSelectionForOption,
} from '../GuidedConnectionSelect'
import type { ProviderOption } from '../../lib/providerReadiness'

// These are the pure selection/menu helpers that back BOTH the guided-setup surface
// (/settings/providers) and the shared GuidedConnectionSelect component. The standalone onboarding
// wizard that previously re-exported and rendered them is retired; only the helper logic survives here.

const providerOptions: ProviderOption[] = [
  {
    provider_id: 'mock-provider',
    label: 'Mock provider',
    support_level: 'certified',
    description: 'Deterministic demo provider',
    default_model_id: 'mock-buffett-munger-demo',
  },
  {
    provider_id: 'claude',
    provider_surface_id: 'claude-cli',
    label: 'Claude',
    support_level: 'experimental',
    description: 'CLI-backed Claude provider path',
    default_model_id: 'claude-sonnet-4-6',
  },
  {
    provider_id: 'openrouter',
    provider_surface_id: 'openrouter-api',
    label: 'OpenRouter',
    support_level: 'experimental',
    description: 'Meta-aggregator routing many models behind one API key',
    default_model_id: 'openrouter/auto',
  },
  {
    provider_id: 'openai',
    provider_surface_id: 'openai-codex-cli',
    label: 'OpenAI',
    support_level: 'experimental',
    description: 'Recommended Codex CLI personal-local path; direct API certification remains advanced.',
    default_model_id: 'gpt-5.5',
    provider_family_label: 'OpenAI',
    recommended_sign_in_label: 'Connect Codex',
    recommended_sign_in_description: 'Run codex login outside Owlfolio; Owlfolio verifies the CLI session and never claims browser OAuth.',
    simple_next_step: 'Run codex login outside Owlfolio, then refresh readiness.',
    advanced_auth_options: [
      {
        label: 'OpenAI API key',
        description: 'Use a direct OpenAI API key for certification-oriented provider runs.',
        certification_note: 'Direct API certification remains separate from Codex CLI personal-local readiness.',
      },
    ],
  },
]

describe('GuidedConnectionSelect helpers', () => {
  it('forces advanced mock-provider selection back to demo mode outside Playwright test mode', () => {
    const mockProvider = providerOptions.find((provider) => provider.provider_id === 'mock-provider')
    if (mockProvider === undefined) {
      throw new Error('mock provider fixture missing')
    }

    expect(providerModeForOption('personal-local', mockProvider)).toBe('demo')
    expect(providerModeForOption('personal-local', mockProvider, true)).toBe('personal-local')
  })

  it('clears stale provider model ids when the provider selection changes', () => {
    const selected = providerSelectionForOption(
      { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' },
      {
        provider_id: 'openai',
        label: 'OpenAI',
        support_level: 'experimental',
        description: 'Experimental provider path',
      },
    )

    expect(selected).toEqual({ provider_id: 'openai', support_level: 'experimental' })
  })

  it('groups the OpenRouter model dropdown by tier, reading the curated catalog (not hardcoded)', () => {
    const groups = buildTierGroupedModelOptions('openrouter')
    const labels = groups.map((group) => group.label)

    expect(labels).toEqual(['Tier 1', 'Tier 2', 'Tier 3'])
    // A T1 frontier model appears in Tier 1.
    expect(groups[0]?.models.map((model) => model.model_id)).toContain('anthropic/claude-opus-4.8')
    // GPT-5.5 is suited to T1 AND T2, so it appears under both groups (each tier in tier_suitability).
    const gptInT1 = groups.find((group) => group.tier === 'T1')?.models.some((model) => model.model_id === 'openai/gpt-5.5')
    const gptInT2 = groups.find((group) => group.tier === 'T2')?.models.some((model) => model.model_id === 'openai/gpt-5.5')
    expect(gptInT1).toBe(true)
    expect(gptInT2).toBe(true)
  })

  it('groups the Claude Code model dropdown by tier (Opus T1, Sonnet T1/T2, Haiku T3)', () => {
    const groups = buildTierGroupedModelOptions('claude')
    const tier1 = groups.find((group) => group.tier === 'T1')?.models.map((model) => model.model_id) ?? []
    const tier3 = groups.find((group) => group.tier === 'T3')?.models.map((model) => model.model_id) ?? []

    expect(tier1).toContain('claude-opus-4-8')
    expect(tier1).toContain('claude-sonnet-4-6')
    expect(tier3).toContain('claude-haiku-4-5')
  })

  it('seeds a curated default model id when selecting a choose-provider connection (OpenRouter / Claude Code)', () => {
    const openRouterProvider = providerOptions.find((provider) => provider.provider_id === 'openrouter')!
    const claudeProvider = providerOptions.find((provider) => provider.provider_id === 'claude')!

    // OpenRouter: never the bare openrouter/auto default — the first curated real-tier model is pinned.
    const orSelection = providerSelectionForConnection(
      { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' },
      { key: 'openrouter', provider: openRouterProvider, mode: 'personal-local', title: '', badge: '', description: '', modelChoice: 'choose' },
    )
    expect(orSelection.model_id).toBe('anthropic/claude-opus-4.8')
    expect(orSelection.provider_id).toBe('openrouter')

    const claudeSelection = providerSelectionForConnection(
      { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' },
      { key: 'claude', provider: claudeProvider, mode: 'personal-local', title: '', badge: '', description: '', modelChoice: 'choose' },
    )
    expect(claudeSelection.model_id).toBe('claude-opus-4-8')
  })

  it('preserves an explicit model choice when re-selecting the same connection', () => {
    const openRouterProvider = providerOptions.find((provider) => provider.provider_id === 'openrouter')!
    const selection = providerSelectionForConnection(
      { provider_id: 'openrouter', support_level: 'experimental', model_id: 'google/gemini-3.5-flash' },
      { key: 'openrouter', provider: openRouterProvider, mode: 'personal-local', title: '', badge: '', description: '', modelChoice: 'choose' },
    )
    expect(selection.model_id).toBe('google/gemini-3.5-flash')
  })

  it('pins the Codex fixed model via defaultModelForConnection', () => {
    const codexProvider: ProviderOption = {
      provider_id: 'openai',
      provider_surface_id: 'openai-codex-cli',
      label: 'OpenAI',
      support_level: 'experimental',
      description: 'Codex CLI path',
      default_model_id: 'gpt-5.5',
    }
    const fixed = defaultModelForConnection({ key: 'codex', provider: codexProvider, mode: 'personal-local', title: '', badge: '', description: '', modelChoice: 'fixed' })
    expect(fixed).toBe('gpt-5.5')
  })
})
