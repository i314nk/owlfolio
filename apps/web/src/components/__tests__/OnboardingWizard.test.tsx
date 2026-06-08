import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'

import { OnboardingWizard, providerModeForOption, providerSelectionForOption } from '../../app/onboarding/OnboardingWizard'
import type { ProviderOption, ProviderReadiness } from '../../lib/providerReadiness'

const providerOptions: ProviderOption[] = [
  {
    provider_id: 'mock-provider',
    label: 'Mock provider',
    support_level: 'certified',
    description: 'Deterministic demo provider',
  },
  {
    provider_id: 'openai',
    provider_surface_id: 'openai-codex-cli',
    label: 'OpenAI',
    support_level: 'experimental',
    description: 'Recommended Codex CLI personal-local path; direct API certification remains advanced.',
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
  {
    provider_id: 'gemini-cli' as any,
    provider_surface_id: 'gemini-cli',
    label: 'Gemini',
    support_level: 'unsupported',
    description: 'Recommended Gemini CLI setup-only sign-in path; workflow execution waits for adapter certification.',
    provider_family_label: 'Gemini',
    recommended_sign_in_label: 'Connect Gemini',
    recommended_sign_in_description: 'Run gemini login outside Owlfolio; Owlfolio checks the CLI session for setup readiness only.',
    simple_next_step: 'Run gemini login outside Owlfolio, then refresh readiness.',
    advanced_auth_options: [
      {
        label: 'Gemini Developer API key',
        description: 'Use a Gemini Developer API key for future direct API certification.',
        certification_note: 'Certification is required before provider-backed workflow starts.',
      },
      {
        label: 'Vertex AI / service account',
        description: 'Use Google Cloud Vertex credentials for enterprise certification lanes.',
        certification_note: 'Enterprise/headless certification is separate from personal-local CLI sign-in.',
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
    expect(html).toContain('Use Gemini')
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

  it('shows Gemini as a setup-only connection without implying executable OAuth or workflow support', () => {
    const html = renderWizard({
      provider_id: 'gemini-cli' as any,
      provider_surface_id: 'gemini-cli',
      support_level: 'experimental',
      is_ready: false,
      auth_source: 'Gemini CLI Google sign-in session',
      status_label: 'Gemini CLI Google sign-in session detected for setup only; Owlfolio cannot execute Gemini CLI workflows until a safe adapter and target-specific certification exist.',
      runtime_kind: 'cli',
      auth_mode: 'cli_cached_session',
      readiness_state: 'unsupported_surface',
      credential_source_category: 'configured_secret_file',
      credential_source_label: 'Gemini CLI Google sign-in session',
      headless_supported: false,
      scheduled_workflow_supported: false,
      automation_suitability: 'personal_local_interactive',
    }, 'gemini-cli')

    expect(html).toContain('Use Gemini')
    expect(html).toContain('Local AI preview')
    expect(html).toContain('Needs setup')
    expect(html).toContain('Gemini sign-in can be detected, but Owlfolio cannot run the full workflow with Gemini yet.')
    expect(html).toContain('You can keep exploring with demo mode while Gemini workflow support is incomplete.')
    expect(html).not.toContain('Review provider states for Gemini adapter/certification availability')
    expect(html).not.toContain('Run gemini login outside Owlfolio, then retry readiness.')
    expect(html).not.toContain('Initialize Owlfolio workflow')
    expect(html).not.toContain('Workflow execution stays blocked until a Gemini CLI adapter and certification exist.')
    expect(html).not.toContain('Gemini Developer API, Vertex, or production automation')
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
})
