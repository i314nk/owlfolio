import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { StartResearchButton, submitStartResearch, type StartResearchRouter } from './StartResearchButton'

function render(props: { caseId: string } = { caseId: 'rc_test_001' }): string {
  return renderToStaticMarkup(createElement(StartResearchButton, props))
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response
}

describe('StartResearchButton — render', () => {
  it('renders with data-testid="start-research" and label "Start deep-dive research"', () => {
    const html = render()
    expect(html).toContain('data-testid="start-research"')
    expect(html).toContain('Start deep-dive research')
  })

  it('renders a button element', () => {
    const html = render()
    expect(html).toMatch(/<button/)
  })
})

describe('submitStartResearch', () => {
  afterEach(() => vi.restoreAllMocks())

  it('calls the correct endpoint and invokes router.refresh on success', async () => {
    const router: StartResearchRouter = { refresh: vi.fn() }
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ research_case_id: 'rc_test_001' }))

    const result = await submitStartResearch({ fetch: fetch as unknown as typeof globalThis.fetch, router, caseId: 'rc_test_001' })

    expect(fetch).toHaveBeenCalledWith(
      '/api/research/rc_test_001/start-run',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(router.refresh).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true })
  })

  it('returns ok:false with the error message on a non-ok response', async () => {
    const router: StartResearchRouter = { refresh: vi.fn() }
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'already started' }, { ok: false, status: 409 }))

    const result = await submitStartResearch({ fetch: fetch as unknown as typeof globalThis.fetch, router, caseId: 'rc_test_001' })

    expect(result).toEqual({ ok: false, error: 'already started' })
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it('returns ok:false with a fallback message on network error', async () => {
    const router: StartResearchRouter = { refresh: vi.fn() }
    const fetch = vi.fn().mockRejectedValue(new Error('network failure'))

    const result = await submitStartResearch({ fetch: fetch as unknown as typeof globalThis.fetch, router, caseId: 'rc_test_001' })

    expect(result).toEqual({ ok: false, error: 'network failure' })
  })
})
