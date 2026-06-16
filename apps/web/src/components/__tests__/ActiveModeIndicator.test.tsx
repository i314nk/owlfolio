import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActiveModeIndicator } from '../ActiveModeIndicator'

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

  it('renders the demo state as plain text', () => {
    const html = renderToStaticMarkup(
      createElement(ActiveModeIndicator, {
        status: { kind: 'demo', label: 'Demo · mock-provider (sample data)' },
      }),
    )

    expect(html).toContain('Demo · mock-provider (sample data)')
    expect(html).not.toContain('href=')
  })

  it('renders unconfigured as a clickable link to the providers fix page', () => {
    const html = renderToStaticMarkup(
      createElement(ActiveModeIndicator, {
        status: {
          kind: 'unconfigured',
          label: 'Not set up — choose a mode',
          href: '/settings/providers',
        },
      }),
    )

    expect(html).toContain('Not set up — choose a mode')
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
})
