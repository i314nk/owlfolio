import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { OWL_THEMES } from '@owlfolio/shared/appConfig'

import { ThemeSwitcher } from '../ThemeSwitcher'

describe('ThemeSwitcher (palettes 2026-07-16)', () => {
  it('renders every registered palette as an option with the current one selected', () => {
    const html = renderToStaticMarkup(createElement(ThemeSwitcher, { current: 'sapphire' }))
    for (const t of OWL_THEMES) {
      expect(html).toContain(`value="${t.id}"`)
      expect(html).toContain(t.label)
    }
    expect(html).toContain('data-testid="theme-switcher"')
  })
})
