import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { GuidedSetupPanel, type GuidedSetupPanelProps } from '../GuidedSetupPanel'
import type { ProviderOption } from '../../lib/providerReadiness'

const providerOptions: ProviderOption[] = [
  { provider_id: 'mock-provider', label: 'Mock provider', support_level: 'certified', description: 'Demo', default_model_id: 'mock-buffett-munger-demo' },
  { provider_id: 'local', provider_surface_id: 'local', label: 'Local (Ollama / vLLM) — experimental, untested', support_level: 'experimental', description: 'UNSTABLE / EXPERIMENTAL / UNTESTED: a local OpenAI-compatible endpoint (Ollama or vLLM) you run yourself.', default_model_id: 'llama3.3:70b' },
  { provider_id: 'openrouter', provider_surface_id: 'openrouter-api', label: 'OpenRouter', support_level: 'experimental', description: 'OpenRouter', default_model_id: 'openrouter/auto' },
]

function baseProps(overrides: Partial<GuidedSetupPanelProps> = {}): GuidedSetupPanelProps {
  return {
    initialConfig: {
      version: 1,
      mode: 'personal-local',
      provider: { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' },
      strategy_id: 'buffett-munger',
    } as GuidedSetupPanelProps['initialConfig'],
    initialIsInitialized: true,
    providerOptions,
    ...overrides,
  }
}

describe('GuidedSetupPanel — guided onboarding surface', () => {
  it('renders the provider & model selection step (no separate mode toggle)', () => {
    const html = renderToStaticMarkup(createElement(GuidedSetupPanel, baseProps()))
    expect(html).toContain('Provider &amp; model')
    expect(html).toContain('Choose a provider and model')
    // The redundant Demo/Personal-local mode toggle was removed — selecting a provider initializes personal-local.
    expect(html).not.toContain('Choose a mode')
  })

  it('renders the shared provider toggle + model selection', () => {
    const html = renderToStaticMarkup(createElement(GuidedSetupPanel, baseProps()))
    expect(html).toContain('Use OpenRouter')
    // The experimental local lane is a selectable card, loudly labelled.
    expect(html).toContain('Use a local model (Ollama / vLLM)')
    expect(html).toContain('UNSTABLE / EXPERIMENTAL / UNTESTED')
    // The CLI/OAuth lanes (Codex, Claude CLI) were retired — not onboarding connections.
    expect(html).not.toContain('Use ChatGPT/Codex')
    expect(html).not.toContain('Use Claude Code')
  })

  it('no longer duplicates per-provider key guidance (that lives in the LLM-providers + logins sections)', () => {
    const html = renderToStaticMarkup(createElement(GuidedSetupPanel, baseProps()))
    // The redundant Step-2 "How to get a key or sign in" box was removed — key guidance is not duplicated here.
    expect(html).not.toContain('How to get a key or sign in')
    expect(html).not.toContain('https://openrouter.ai/keys')
    // The selection surface keeps the honest "quality depends on the model you choose" framing.
    expect(html).toContain('Research quality depends on the model you choose')
  })

  it('does not include a separate Set-capital step (capital lives on the Portfolio page / gate)', () => {
    const html = renderToStaticMarkup(createElement(GuidedSetupPanel, baseProps()))
    expect(html).not.toContain('Step 4')
    expect(html).not.toContain('Set investable capital on the portfolio')
  })

  it('does not render any secret value', () => {
    const html = renderToStaticMarkup(createElement(GuidedSetupPanel, baseProps()))
    expect(html).not.toMatch(/sk-/)
  })

  it('hides the demo connection card when mock-provider is absent (production)', () => {
    const productionOptions = providerOptions.filter((option) => option.provider_id !== 'mock-provider')
    const html = renderToStaticMarkup(
      createElement(
        GuidedSetupPanel,
        baseProps({
          providerOptions: productionOptions,
          initialConfig: {
            version: 1,
            mode: 'personal-local',
            provider: { provider_id: 'openrouter', support_level: 'experimental', model_id: 'openrouter/auto' },
            strategy_id: 'buffett-munger',
          } as GuidedSetupPanelProps['initialConfig'],
        }),
      ),
    )
    // No "Try demo mode" connection card and no demo key-guidance card.
    expect(html).not.toContain('Try demo mode')
    expect(html).not.toContain('About demo mode')
    // Real connections remain.
    expect(html).toContain('Use OpenRouter')
  })
})
