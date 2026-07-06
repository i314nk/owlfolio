import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RefreshPricesButton } from '../RefreshPricesButton'
describe('RefreshPricesButton', () => {
  it('renders the refresh button', () => {
    const html = renderToStaticMarkup(createElement(RefreshPricesButton))
    expect(html).toContain('data-testid="refresh-prices"')
    expect(html).toMatch(/refresh prices/i)
  })
})
