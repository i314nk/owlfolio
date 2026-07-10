import { describe, expect, it, vi } from 'vitest'

import { submitRunDeepDive } from '../RunDeepDiveButton'

// The approve action must POST in place and refresh the dossier — never navigate the browser to the
// raw JSON API response (the plain-HTML-form dogfood find this component replaced, 2026-07-10).
describe('submitRunDeepDive', () => {
  it('POSTs the deep-dive approval and refreshes the page in place on success', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ research_case_id: 'rc_1' }), { status: 200 }))
    const router = { refresh: vi.fn() }
    const result = await submitRunDeepDive({ fetch: fetchMock as unknown as typeof fetch, router, caseId: 'rc_1' })
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/research/rc_1/deep-dive', expect.objectContaining({ method: 'POST' }))
    expect(router.refresh).toHaveBeenCalledOnce()
  })

  it('surfaces the API error without refreshing on failure', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'not awaiting approval' } }), { status: 409 }))
    const router = { refresh: vi.fn() }
    const result = await submitRunDeepDive({ fetch: fetchMock as unknown as typeof fetch, router, caseId: 'rc_1' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not awaiting approval/)
    expect(router.refresh).not.toHaveBeenCalled()
  })
})
