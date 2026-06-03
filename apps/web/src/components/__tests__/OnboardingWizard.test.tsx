import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'

import { OnboardingWizard, providerSelectionForOption } from '../../app/onboarding/OnboardingWizard'

describe('OnboardingWizard', () => {
  it('renders mode, provider, strategy, shariah, and market-universe setup sections', () => {
    const html = renderToStaticMarkup(
      createElement(OnboardingWizard, {
        initialConfig: defaultPersonalLocalAppConfig(),
        initialIsInitialized: false,
        initialReadiness: {
          provider_id: 'claude',
          support_level: 'certified',
          is_ready: true,
          auth_source: 'ANTHROPIC_API_KEY',
          status_label: 'Locally runnable via Anthropic API key',
        },
        providerOptions: [
          {
            provider_id: 'mock-provider',
            label: 'Mock provider',
            support_level: 'certified',
            description: 'Deterministic demo provider',
          },
          {
            provider_id: 'claude',
            label: 'Claude',
            support_level: 'certified',
            description: 'Primary real provider target',
          },
          {
            provider_id: 'openai',
            label: 'OpenAI',
            support_level: 'experimental',
            description: 'Experimental provider path',
            provider_family_label: 'OpenAI',
            recommended_sign_in_label: 'Connect ChatGPT via Codex CLI',
            recommended_sign_in_description: 'Run codex login outside Owlfolio so the local Codex CLI session can be verified without browser cookies.',
            simple_next_step: 'Run codex login outside Owlfolio, then refresh readiness.',
            advanced_auth_options: [
              {
                label: 'OpenAI API key',
                description: 'Direct API key path for certification-oriented provider runs.',
                certification_note: 'Separate direct API certification is required before production/headless use.',
              },
            ],
          },
        ],
      }),
    )

    expect(html).toContain('Choose mode')
    expect(html).toContain('Demo mode')
    expect(html).toContain('Personal local mode')
    expect(html).toContain('Connect provider')
    expect(html).toContain('Claude')
    expect(html).toContain('Locally runnable via Anthropic API key')
    expect(html).toContain('Claude is locally runnable for this workflow.')
    expect(html).toContain('Readiness action')
    expect(html).toContain('Action: initialize local ledger and open the Command Center.')
    expect(html).toContain('background:#0f172a')
    expect(html).toContain('border:1px solid rgba(124, 140, 255, 0.34)')
    expect(html).toContain('Strategy')
    expect(html).toContain('Buffett-Munger certified')
    expect(html).not.toContain('vertical slice')
    expect(html).not.toContain('v0.2 slice')
    expect(html).toContain('Shariah defaults')
    expect(html).toContain('AAOIFI')
    expect(html).toContain('Market universe')
    expect(html).toContain('Public equities discovery universe')
    expect(html).toContain('Initialize Owlfolio workflow')
  })

  it('renders provider families as a simple recommended sign-in path with progressive advanced options', () => {
    const html = renderToStaticMarkup(
      createElement(OnboardingWizard, {
        initialConfig: {
          ...defaultPersonalLocalAppConfig(),
          provider: { provider_id: 'openai', support_level: 'experimental' },
        },
        initialIsInitialized: false,
        initialReadiness: {
          provider_id: 'openai',
          provider_surface_id: 'openai-codex-cli',
          support_level: 'experimental',
          is_ready: false,
          auth_source: 'missing',
          status_label: 'Missing OpenAI / Codex credentials',
          reauth_action: 'Run codex login outside Owlfolio, then retry readiness.',
        },
        providerOptions: [
          {
            provider_id: 'openai',
            provider_surface_id: 'openai-codex-cli',
            label: 'OpenAI',
            support_level: 'experimental',
            description: 'Recommended ChatGPT/Codex personal-local path; direct API certification remains advanced.',
            provider_family_label: 'OpenAI',
            recommended_sign_in_label: 'Connect ChatGPT via Codex CLI',
            recommended_sign_in_description: 'Run codex login outside Owlfolio; Owlfolio verifies the CLI session and never uses browser cookies as provider credentials.',
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
            description: 'Recommended Google/Gemini CLI personal-local path; adapter certification is not complete.',
            provider_family_label: 'Gemini',
            recommended_sign_in_label: 'Sign in with Google via Gemini CLI',
            recommended_sign_in_description: 'Run gemini login outside Owlfolio; Owlfolio verifies the CLI session and never uses browser cookies as provider credentials.',
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
        ],
      }),
    )

    expect(html).toContain('Provider family: OpenAI')
    expect(html).toContain('Recommended sign-in')
    expect(html).toContain('Connect ChatGPT via Codex CLI')
    expect(html).toContain('Run codex login outside Owlfolio')
    expect(html).toContain('never uses browser cookies as provider credentials')
    expect(html).toContain('One-screen flow: choose provider family → recommended sign-in → verify readiness → start workflow.')
    expect(html).toContain('Advanced auth and certification options')
    expect(html).toContain('OpenAI API key')
    expect(html).toContain('Direct API certification remains separate from Codex CLI personal-local readiness')
    expect(html).toContain('Next step: Run codex login outside Owlfolio, then retry readiness.')
    expect(html).not.toContain('/.codex/')
  })

  it('disables start workflow with a concise inline explanation when the selected provider is unready', () => {
    const html = renderToStaticMarkup(
      createElement(OnboardingWizard, {
        initialConfig: defaultPersonalLocalAppConfig(),
        initialIsInitialized: false,
        initialReadiness: {
          provider_id: 'claude',
          support_level: 'experimental',
          is_ready: false,
          auth_source: 'missing',
          status_label: 'Missing Claude credentials',
        },
        providerOptions: [
          {
            provider_id: 'mock-provider',
            label: 'Mock provider',
            support_level: 'certified',
            description: 'Deterministic demo provider',
          },
          {
            provider_id: 'claude',
            label: 'Claude',
            support_level: 'experimental',
            description: 'Primary real provider target',
          },
        ],
      }),
    )

    expect(html).toContain('Provider cannot start yet')
    expect(html).toContain('Missing Claude credentials')
    expect(html).toContain('Action: configure credentials or choose demo mode before starting.')
    expect(html).toContain('OAuth/session not signed in or credential path missing')
    expect(html).toContain('color:#fecaca')
    expect(html).not.toContain('color:#7f1d1d')
    expect(html).toContain('Start blocked: Claude not locally runnable')
    expect(html).toContain('disabled=""')
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
