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
