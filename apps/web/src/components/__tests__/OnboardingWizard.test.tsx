import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'

import { OnboardingWizard } from '../../app/onboarding/OnboardingWizard'

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
          status_label: 'Ready via Anthropic API key',
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
    expect(html).toContain('Ready via Anthropic API key')
    expect(html).toContain('Strategy')
    expect(html).toContain('Buffett-Munger certified')
    expect(html).toContain('Shariah defaults')
    expect(html).toContain('AAOIFI')
    expect(html).toContain('Market universe')
    expect(html).toContain('Public equities discovery universe')
    expect(html).toContain('Start workflow')
  })
})
