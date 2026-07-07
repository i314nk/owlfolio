import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DiscoveryCandidateActions } from '../DiscoveryCandidateActions'
describe('DiscoveryCandidateActions', () => {
  it('discovered → accept + reject buttons', () => {
    const html = renderToStaticMarkup(createElement(DiscoveryCandidateActions, { candidateId: 'c1', status: 'discovered' }))
    expect(html).toMatch(/accept for screening/i)
    expect(html).toMatch(/reject/i)
  })
  it('queued → promote + reject buttons', () => {
    const html = renderToStaticMarkup(createElement(DiscoveryCandidateActions, { candidateId: 'c1', status: 'queued_for_quick_screen' }))
    expect(html).toMatch(/promote to research/i)
    expect(html).toMatch(/reject/i)
  })
})
