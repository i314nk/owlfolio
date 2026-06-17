import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { GuidedSetupPanel, type GuidedSetupPanelProps } from '../GuidedSetupPanel'
import type { ProviderOption } from '../../lib/providerReadiness'

const providerOptions: ProviderOption[] = [
  { provider_id: 'mock-provider', label: 'Mock provider', support_level: 'certified', description: 'Demo', default_model_id: 'mock-buffett-munger-demo' },
  { provider_id: 'openai', provider_surface_id: 'openai-codex-cli', label: 'OpenAI', support_level: 'experimental', description: 'Codex', default_model_id: 'gpt-5.5' },
  { provider_id: 'openrouter', provider_surface_id: 'openrouter-api', label: 'OpenRouter', support_level: 'experimental', description: 'OpenRouter', default_model_id: 'openrouter/auto' },
  { provider_id: 'claude', provider_surface_id: 'claude-cli', label: 'Claude', support_level: 'experimental', description: 'Claude', default_model_id: 'claude-opus-4-8' },
]

function baseProps(overrides: Partial<GuidedSetupPanelProps> = {}): GuidedSetupPanelProps {
  return {
    initialConfig: {
      version: 1,
      mode: 'demo',
      provider: { provider_id: 'mock-provider', support_level: 'certified', model_id: 'mock-buffett-munger-demo' },
      strategy_id: 'buffett-munger',
    } as GuidedSetupPanelProps['initialConfig'],
    initialIsInitialized: true,
    providerOptions,
    missingItems: [
      { id: 'frontier_llm', label: 'At least one frontier LLM provider connected', done: false },
      { id: 'investable_capital', label: 'Investable capital set in the ledger', done: false },
    ],
    ...overrides,
  }
}

describe('GuidedSetupPanel — guided onboarding surface', () => {
  it('renders a mode switch with Demo and Personal-local choices', () => {
    const html = renderToStaticMarkup(createElement(GuidedSetupPanel, baseProps()))
    expect(html.toLowerCase()).toContain('demo')
    expect(html.toLowerCase()).toContain('personal-local')
    // The mode control posts to the idempotent mode route (not a re-implemented init).
    expect(html).toContain('Guided setup')
  })

  it('renders the shared provider toggle + tier-grouped model selection', () => {
    const html = renderToStaticMarkup(createElement(GuidedSetupPanel, baseProps()))
    expect(html).toContain('Try demo mode')
    expect(html).toContain('Use ChatGPT/Codex')
    expect(html).toContain('Use OpenRouter')
    expect(html).toContain('Use Claude Code')
  })

  it('renders per-provider key-guidance one-liners + links to the right destinations', () => {
    const html = renderToStaticMarkup(createElement(GuidedSetupPanel, baseProps()))
    expect(html).toContain('https://openrouter.ai/keys')
    expect(html).toContain('https://console.anthropic.com/settings/keys')
    // Codex sign-in guidance references the local sign-in command.
    expect(html).toContain('codex login')
  })

  it('renders the set-investable-capital next step linking to the portfolio capital step', () => {
    const html = renderToStaticMarkup(createElement(GuidedSetupPanel, baseProps()))
    expect(html.toLowerCase()).toContain('investable capital')
    expect(html).toContain('/portfolio')
  })

  it('surfaces the S4 gate missing-items so the remaining path is visible', () => {
    const html = renderToStaticMarkup(createElement(GuidedSetupPanel, baseProps()))
    expect(html).toContain('At least one frontier LLM provider connected')
    expect(html).toContain('Investable capital set in the ledger')
  })

  it('does not render any secret value', () => {
    const html = renderToStaticMarkup(createElement(GuidedSetupPanel, baseProps()))
    expect(html).not.toMatch(/sk-/)
  })

  it('hides the demo card and the Demo mode toggle when mock-provider is absent (production)', () => {
    const productionOptions = providerOptions.filter((option) => option.provider_id !== 'mock-provider')
    const html = renderToStaticMarkup(
      createElement(
        GuidedSetupPanel,
        baseProps({
          providerOptions: productionOptions,
          initialConfig: {
            version: 1,
            mode: 'personal-local',
            provider: { provider_id: 'openai', support_level: 'experimental', model_id: 'gpt-5.5' },
            strategy_id: 'buffett-munger',
          } as GuidedSetupPanelProps['initialConfig'],
        }),
      ),
    )
    // No "Try demo mode" connection card and no demo key-guidance card.
    expect(html).not.toContain('Try demo mode')
    expect(html).not.toContain('About demo mode')
    // No "Demo" mode toggle button; only Personal-local is offered.
    expect(html).not.toContain('>Demo<')
    expect(html).toContain('Personal-local')
    // Real connections remain.
    expect(html).toContain('Use ChatGPT/Codex')
  })

  it('shows the demo card and Demo toggle when mock-provider is present (test harness)', () => {
    const html = renderToStaticMarkup(createElement(GuidedSetupPanel, baseProps()))
    expect(html).toContain('Try demo mode')
    expect(html).toContain('>Demo<')
  })
})
