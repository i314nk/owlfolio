import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'

import {
  OnboardingWizard,
  buildTierGroupedModelOptions,
  defaultModelForConnection,
  providerModeForOption,
  providerSelectionForConnection,
  providerSelectionForOption,
} from '../../app/onboarding/OnboardingWizard'
import type { ProviderOption, ProviderReadiness } from '../../lib/providerReadiness'

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

function renderWizard(readiness: ProviderReadiness, providerId: string = readiness.provider_id) {
  const config = {
    ...defaultPersonalLocalAppConfig(),
    mode: providerId === 'mock-provider' ? 'demo' as const : 'personal-local' as const,
    provider: providerId === 'mock-provider'
      ? { provider_id: 'mock-provider' as const, support_level: 'certified' as const, model_id: 'mock-buffett-munger-demo' }
      : { provider_id: providerId as any, support_level: readiness.support_level },
  }

  return renderToStaticMarkup(
    createElement(OnboardingWizard, {
      initialConfig: config,
      initialIsInitialized: false,
      initialReadiness: readiness,
      providerOptions,
    }),
  )
}

describe('OnboardingWizard', () => {
  it('renders a short non-technical setup flow with demo first and local assistant choices', () => {
    const html = renderWizard({
      provider_id: 'openai',
      provider_surface_id: 'openai-codex-cli',
      support_level: 'experimental',
      is_ready: false,
      auth_source: 'missing',
      status_label: 'Missing OpenAI / Codex credentials',
      reauth_action: 'Run codex login outside Owlfolio, then retry readiness.',
    })

    expect(html).toContain('Start setup')
    expect(html).toContain('1. Choose how to explore')
    expect(html).toContain('2. Connect a local AI assistant')
    expect(html).toContain('3. Start using Owlfolio')
    expect(html).toContain('Try demo mode')
    expect(html).toContain('Use ChatGPT/Codex')
    expect(html).not.toContain('Use Gemini')
    expect(html.indexOf('Try demo mode')).toBeLessThan(html.indexOf('Use ChatGPT/Codex'))
    expect(html).toContain('Learn setup guide')
    expect(html).not.toContain('Provider connection')
    expect(html).not.toContain('Readiness check')
    expect(html).not.toContain('Start blocked')
    expect(html).not.toContain('Strategy')
    expect(html).not.toContain('Shariah defaults')
    expect(html).not.toContain('Market universe')
    expect(html).not.toContain('One-screen flow: choose provider family')
  })

  it('keeps blocked provider states plain-language without exposing advanced auth/certification prose inline', () => {
    const html = renderWizard({
      provider_id: 'openai',
      provider_surface_id: 'openai-codex-cli',
      support_level: 'experimental',
      is_ready: false,
      auth_source: 'missing',
      status_label: 'Missing OpenAI / Codex credentials',
      reauth_action: 'Run codex login outside Owlfolio, then retry readiness.',
    })

    expect(html).toContain('Needs setup')
    expect(html).toContain('Owlfolio cannot find your ChatGPT/Codex login yet.')
    expect(html).toContain('Sign in to ChatGPT/Codex on this computer, then come back and check again.')
    expect(html).toContain('You can keep exploring with demo mode while setup is incomplete.')
    expect(html).toContain('Learn setup guide')
    expect(html).not.toContain('Missing OpenAI / Codex credentials')
    expect(html).not.toContain('Run codex login outside Owlfolio')
    expect(html).not.toContain('credentials')
    expect(html).not.toContain('Provider cannot start yet')
    expect(html).not.toContain('Auth source:')
    expect(html).not.toContain('Effective support:')
    expect(html).not.toContain('Allowed use: Personal-local research drafts only')
    expect(html).not.toContain('Certification truth:')
    expect(html).not.toContain('Advanced auth and certification options')
  })

  it('no longer offers a Gemini connection lane (retired with the OpenRouter + Codex CLI reduction)', () => {
    const html = renderWizard({
      provider_id: 'openai',
      provider_surface_id: 'openai-codex-cli',
      support_level: 'experimental',
      is_ready: false,
      auth_source: 'missing',
      status_label: 'Missing OpenAI / Codex credentials',
      reauth_action: 'Run codex login outside Owlfolio, then retry readiness.',
    })

    expect(html).not.toContain('Use Gemini')
    expect(html).not.toContain('Local AI preview')
    expect(html).not.toContain('gemini login')
  })

  it('keeps the local demo path runnable from the simplified connect flow', () => {
    const html = renderWizard({
      provider_id: 'mock-provider',
      support_level: 'certified',
      is_ready: true,
      auth_source: 'built-in demo mode',
      status_label: 'Locally runnable through built-in deterministic demo mode',
    }, 'mock-provider')

    expect(html).toContain('Try demo mode')
    expect(html).toContain('Ready to start')
    expect(html).toContain('Start using Owlfolio')
    expect(html).toContain('Mock provider')
  })

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

  it('renders the four-option provider toggle (demo, Codex, OpenRouter, Claude Code)', () => {
    const html = renderWizard({
      provider_id: 'openai',
      provider_surface_id: 'openai-codex-cli',
      support_level: 'experimental',
      is_ready: false,
      auth_source: 'missing',
      status_label: 'Missing OpenAI / Codex credentials',
    })

    expect(html).toContain('Try demo mode')
    expect(html).toContain('Use ChatGPT/Codex')
    expect(html).toContain('Use OpenRouter')
    expect(html).toContain('Use Claude Code')
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

  it('renders OpenRouter onboarding with a tier-grouped model select seeded to a curated model', () => {
    const html = renderWizard({
      provider_id: 'openrouter',
      provider_surface_id: 'openrouter-api',
      support_level: 'experimental',
      is_ready: false,
      auth_source: 'missing',
      status_label: 'Missing OPENROUTER_API_KEY',
    }, 'openrouter')

    expect(html).toContain('Model (pick one)')
    expect(html).toContain('<optgroup label="Tier 1">')
    expect(html).toContain('<optgroup label="Tier 2">')
    expect(html).toContain('<optgroup label="Tier 3">')
    expect(html).toContain('anthropic/claude-opus-4.8')
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

  it('pins the Codex fixed model and shows no model chooser', () => {
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

    const html = renderWizard({
      provider_id: 'openai',
      provider_surface_id: 'openai-codex-cli',
      support_level: 'experimental',
      is_ready: false,
      auth_source: 'missing',
      status_label: 'Missing OpenAI / Codex credentials',
    })
    expect(html).toContain('gpt-5.5 (only model)')
    expect(html).not.toContain('Model (pick one)')
  })
})
