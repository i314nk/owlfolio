import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CommandCenter } from '../CommandCenter'
import { getDemoCommandCenter } from '../../lib/demo'

describe('CommandCenter', () => {
  it('renders demo workflow status and the next recommended action', () => {
    const html = renderToStaticMarkup(createElement(CommandCenter, { dashboard: getDemoCommandCenter() }))

    expect(html).toContain('Owlfolio')
    expect(html).toContain('Setup ready')
    expect(html).toContain('Mock provider / demo mode')
    expect(html).toContain('Buffett-Munger certified')
    expect(html).toContain('Research cases')
    expect(html).toContain('Watchlist drafts')
    expect(html).toContain('Review COST research case and confirm the watchlist draft')
  })
})