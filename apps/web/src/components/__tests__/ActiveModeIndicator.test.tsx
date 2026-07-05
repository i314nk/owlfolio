import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ActiveModeIndicator } from '../ActiveModeIndicator'

// The interactive switcher uses the App Router; stub it so SSR rendering does not require a router context.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }))

describe('ActiveModeIndicator', () => {
  it('renders the ready state as plain text with no fix link', () => {
    const html = renderToStaticMarkup(
      createElement(ActiveModeIndicator, {
        status: { kind: 'ready', label: 'Personal-local · openrouter / claude-opus-4.8' },
      }),
    )

    expect(html).toContain('Personal-local · openrouter / claude-opus-4.8')
    expect(html).not.toContain('href=')
    expect(html).toContain('data-active-mode-kind="ready"')
  })

  it('renders unconfigured as a clickable link to the providers fix page', () => {
    const html = renderToStaticMarkup(
      createElement(ActiveModeIndicator, {
        status: {
          kind: 'unconfigured',
          label: 'No provider configured',
          href: '/settings/providers',
        },
      }),
    )

    expect(html).toContain('No provider configured')
    expect(html).toContain('href="/settings/providers"')
    expect(html).toContain('data-active-mode-kind="unconfigured"')
  })

  it('renders provider-not-connected as a clickable fix link', () => {
    const html = renderToStaticMarkup(
      createElement(ActiveModeIndicator, {
        status: {
          kind: 'provider-not-connected',
          label: 'Personal-local · provider not connected',
          href: '/settings/providers',
        },
      }),
    )

    expect(html).toContain('Personal-local · provider not connected')
    expect(html).toContain('href="/settings/providers"')
  })

  it('renders capital-not-set as a clickable fix link', () => {
    const html = renderToStaticMarkup(
      createElement(ActiveModeIndicator, {
        status: {
          kind: 'capital-not-set',
          label: 'Personal-local · capital not set',
          href: '/settings/providers',
        },
      }),
    )

    expect(html).toContain('Personal-local · capital not set')
    expect(html).toContain('href="/settings/providers"')
  })

  it('upgrades to the grouped model switcher when modelSwitcher is provided', () => {
    const html = renderToStaticMarkup(
      createElement(ActiveModeIndicator, {
        status: { kind: 'ready', label: 'Personal-local · openrouter / anthropic/claude-opus-4.8' },
        modelSwitcher: {
          active_provider_id: 'openrouter',
          active_model_id: 'anthropic/claude-opus-4.8',
          providers: [
            { provider_id: 'openrouter', label: 'OpenRouter', support_level: 'experimental', models: [{ model_id: 'anthropic/claude-opus-4.8' }, { model_id: 'openai/gpt-5.5' }] },
            { provider_id: 'anthropic-api', label: 'Anthropic', support_level: 'experimental', models: [{ model_id: 'claude-sonnet-4-6' }] },
          ],
        },
      }),
    )

    // It renders a real <select> with one optgroup per connected provider, listing each provider's models.
    expect(html).toContain('aria-label="Active provider and model"')
    expect(html).toContain('<optgroup label="OpenRouter"')
    expect(html).toContain('<optgroup label="Anthropic"')
    expect(html).toContain('openai/gpt-5.5')
    expect(html).toContain('claude-sonnet-4-6')
    // The active model is the selected option.
    expect(html).toMatch(/<option[^>]*selected[^>]*>anthropic\/claude-opus-4\.8<\/option>/)
  })
})
