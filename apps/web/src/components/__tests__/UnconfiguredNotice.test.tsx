import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { UnconfiguredNotice } from '../UnconfiguredNotice'

describe('UnconfiguredNotice', () => {
  it('renders a choose-a-mode / go-to-setup state steering to the providers page', () => {
    const html = renderToStaticMarkup(createElement(UnconfiguredNotice, { feature: 'Watchlist' }))

    // It names the gated feature and explains nothing is set up yet.
    expect(html).toContain('Watchlist')
    expect(html).toContain('Choose a mode to begin')
    // It steers toward provider/onboarding setup — NEVER demo data.
    expect(html).toContain('href="/settings/providers"')
    // It must not pretend there is data: no demo seed labels.
    expect(html).not.toContain('demo research case')
    expect(html).not.toContain('Mock provider / demo mode')
  })
})
