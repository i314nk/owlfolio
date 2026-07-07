import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RunDiscoveryButton } from '../RunDiscoveryButton'
describe('RunDiscoveryButton', () => {
  it('renders the run button', () => {
    const html = renderToStaticMarkup(createElement(RunDiscoveryButton))
    expect(html).toContain('data-testid="run-discovery"')
    expect(html).toMatch(/run discovery/i)
  })
})
