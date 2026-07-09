import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  GuidedConnectionSelect,
  buildConnectionOptions,
  buildTierGroupedModelOptions,
  providerModeForOption,
  providerSelectionForConnection,
  providerSelectionForOption,
  renderModelSelection,
  type ConnectionOption,
} from '../GuidedConnectionSelect'
import type { ProviderOption } from '../../lib/providerReadiness'

function openRouterConnection(): ConnectionOption {
  const connection = buildConnectionOptions([
    { provider_id: 'openrouter', provider_surface_id: 'openrouter-api', label: 'OpenRouter', support_level: 'experimental', description: 'Meta-aggregator', default_model_id: 'openrouter/auto' },
  ]).find((option) => option.key === 'openrouter')
  if (connection === undefined) {
    throw new Error('openrouter connection fixture missing')
  }
  return connection
}

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
    provider_id: 'openrouter',
    provider_surface_id: 'openrouter-api',
    label: 'OpenRouter',
    support_level: 'experimental',
    description: 'Meta-aggregator routing many models behind one API key',
    default_model_id: 'openrouter/auto',
  },
]

describe('GuidedConnectionSelect helpers', () => {
  it('resolves mock-provider selection to personal-local (demo mode is retired)', () => {
    const mockProvider = providerOptions.find((provider) => provider.provider_id === 'mock-provider')
    if (mockProvider === undefined) {
      throw new Error('mock provider fixture missing')
    }

    expect(providerModeForOption('personal-local', mockProvider)).toBe('personal-local')
    expect(providerModeForOption('personal-local', mockProvider, true)).toBe('personal-local')
  })

  it('clears stale provider model ids when the provider selection changes', () => {
    const selected = providerSelectionForOption(
      { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' },
      {
        provider_id: 'openai-api',
        label: 'OpenAI (API key)',
        support_level: 'experimental',
        description: 'Experimental provider path',
      },
    )

    expect(selected).toEqual({ provider_id: 'openai-api', support_level: 'experimental' })
  })

  it('renders a SEARCHABLE picker over the full OpenRouter catalog when live models are provided', () => {
    const html = renderToStaticMarkup(renderModelSelection(
      openRouterConnection(),
      undefined,
      () => {},
      [
        { id: 'z-ai/glm-5.2', name: 'GLM 5.2', reasoning: true, tools: true, structured_output: true },
        { id: 'anthropic/claude-opus-4.8', name: 'Claude Opus 4.8 (also curated)', reasoning: true, tools: true, structured_output: true },
        { id: 'x-ai/grok-4.3', name: 'Grok 4.3 (also curated)', reasoning: true, tools: true, structured_output: true },
      ],
    ))
    // The searchable input + its datalist over the live catalog.
    expect(html).toContain('list="owl-openrouter-live-models"')
    expect(html).toContain('Search or type any model id')
    // A live-only model is selectable (the GLM the owner wanted).
    expect(html).toContain('z-ai/glm-5.2')
    // Curated picks are still surfaced (deduped against the live list, labelled recommended).
    expect(html).toContain('anthropic/claude-opus-4.8')
    expect(html).toContain('recommended')
    // Honest framing: non-curated models are experimental / fail-closed.
    expect(html).toContain('experimental')
  })

  it('falls back to the curated tier select for OpenRouter when no live models are available (fail-closed)', () => {
    const html = renderToStaticMarkup(renderModelSelection(openRouterConnection(), undefined, () => {}, []))
    expect(html).not.toContain('owl-openrouter-live-models')
    // The curated tier-grouped <select> remains.
    expect(html).toContain('Model (pick one)')
    expect(html).toContain('anthropic/claude-opus-4.8')
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

  it('seeds a curated default model id when selecting a choose-provider connection (OpenRouter)', () => {
    const openRouterProvider = providerOptions.find((provider) => provider.provider_id === 'openrouter')!

    // OpenRouter: never the bare openrouter/auto default — the first curated real-tier model is pinned.
    const orSelection = providerSelectionForConnection(
      { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' },
      { key: 'openrouter', provider: openRouterProvider, mode: 'personal-local', title: '', badge: '', description: '', modelChoice: 'choose' },
    )
    expect(orSelection.model_id).toBe('anthropic/claude-opus-4.8')
    expect(orSelection.provider_id).toBe('openrouter')
  })

  it('does not offer Claude as a connection option (claude login unsupported with third-party harnesses)', () => {
    const options = buildConnectionOptions(providerOptions)
    expect(options.map((option) => option.key)).not.toContain('claude')
    // The retired Claude CLI login is gone; the Anthropic *API-key* provider is a distinct, selectable card.
    expect(options.some((option) => option.title === 'Use Claude Code')).toBe(false)
  })

  it('offers the direct-API providers (Anthropic/OpenAI/Gemini) as selectable cards when present', () => {
    const withDirectApi: ProviderOption[] = [
      ...providerOptions,
      { provider_id: 'anthropic-api', label: 'Anthropic (Claude API key)', support_level: 'experimental', description: 'Direct Anthropic API', default_model_id: 'claude-sonnet-4-6' },
      { provider_id: 'openai-api', label: 'OpenAI (API key)', support_level: 'experimental', description: 'Direct OpenAI API', default_model_id: 'gpt-5.5' },
      { provider_id: 'gemini-developer-api', label: 'Gemini (Google API key)', support_level: 'experimental', description: 'Direct Gemini API', default_model_id: 'gemini-3.5-flash' },
    ]
    const keys = buildConnectionOptions(withDirectApi).map((option) => option.key)
    expect(keys).toContain('anthropic-api')
    expect(keys).toContain('openai-api')
    expect(keys).toContain('gemini-developer-api')
    // All three are 'choose' cards (curated multi-model lists), not fixed-model.
    const anthropic = buildConnectionOptions(withDirectApi).find((option) => option.key === 'anthropic-api')
    expect(anthropic?.modelChoice).toBe('choose')
  })

  it('preserves an explicit model choice when re-selecting the same connection', () => {
    const openRouterProvider = providerOptions.find((provider) => provider.provider_id === 'openrouter')!
    const selection = providerSelectionForConnection(
      { provider_id: 'openrouter', support_level: 'experimental', model_id: 'google/gemini-3.5-flash' },
      { key: 'openrouter', provider: openRouterProvider, mode: 'personal-local', title: '', badge: '', description: '', modelChoice: 'choose' },
    )
    expect(selection.model_id).toBe('google/gemini-3.5-flash')
  })

  it('renders an explicit "Set model" button + confirmation for the OpenRouter searchable picker', () => {
    const connection = openRouterConnection()
    const liveModels = [{ id: 'z-ai/glm-5.2-max', name: 'GLM 5.2 Max' }] as unknown as Parameters<typeof renderModelSelection>[3]

    const html = renderToStaticMarkup(
      createElement('div', null, renderModelSelection(connection, undefined, () => {}, liveModels)),
    )

    // The searchable input AND an explicit commit button both render (no more per-keystroke auto-persist).
    expect(html).toContain('Search or enter an OpenRouter model id')
    expect(html).toContain('Set model')
    // With no model set yet, the confirmation line prompts the user to Set one.
    expect(html).toContain('No model set yet')
  })
})

describe('model capability note (the saved probe verdict)', () => {
  const noteProps = (modelCapability: { state: 'capable' | 'failed' | 'unverified'; summary?: string }) => ({
    connectionOptions: [],
    selectedProviderId: 'openrouter' as const,
    selectedModelId: 'z-ai/glm-5.2',
    onSelectConnection: () => {},
    onSelectModel: () => {},
    modelCapability,
  })

  it('renders the recorded verdict top-of-selection with the Verify button', () => {
    const html = renderToStaticMarkup(createElement(GuidedConnectionSelect, noteProps({ state: 'capable', summary: '4/4 probe scenarios passed' })))
    expect(html).toContain('data-testid="model-capability-note"')
    expect(html).toContain('Model verified capable — 4/4 probe scenarios passed')
    expect(html).toContain('data-testid="verify-model-button"')
    expect(html).toContain('Re-verify model')
  })

  it('failed state shows the per-scenario WHY; unverified is honest; no prop → no note', () => {
    const failed = renderToStaticMarkup(createElement(GuidedConnectionSelect, noteProps({
      state: 'failed', summary: '2/4 probe scenarios passed',
      failure_reasons: ['multi-step-tool-loop: provider declared the capability unsupported'],
    } as never)))
    expect(failed).toContain('failed the capability probe')
    expect(failed).toContain('data-testid="verify-model-failure-reasons"')
    expect(failed).toContain('multi-step-tool-loop: provider declared the capability unsupported')
    expect(renderToStaticMarkup(createElement(GuidedConnectionSelect, noteProps({ state: 'unverified' })))).toContain('not verified yet')
    const { modelCapability: _unused, ...bare } = noteProps({ state: 'unverified' })
    void _unused
    expect(renderToStaticMarkup(createElement(GuidedConnectionSelect, bare))).not.toContain('model-capability-note')
  })
})
