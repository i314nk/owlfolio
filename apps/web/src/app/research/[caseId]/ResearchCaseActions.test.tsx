import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import {
  ResearchCaseActions,
  submitArchive,
  submitReRun,
  submitReReview,
  type ActionRouter,
} from './ResearchCaseActions'

function render(props: Partial<Parameters<typeof ResearchCaseActions>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(ResearchCaseActions, {
      caseId: 'rc_msft_1',
      ticker: 'MSFT',
      isArchived: false,
      engineStale: false,
      ...props,
    }),
  )
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response
}

describe('ResearchCaseActions — render', () => {
  it('renders both actions (re-run + archive) by default', () => {
    const html = render()
    expect(html).toContain('Re-run on current engine')
    expect(html).toContain('Archive this run')
  })

  it('HIDES the archive action when the run is already archived', () => {
    const html = render({ isArchived: true })
    expect(html).toContain('Re-run on current engine')
    expect(html).not.toContain('Archive this run')
  })

  it('DISABLES the re-run button and shows a hint when the case has no ticker', () => {
    const html = render({ ticker: undefined })
    // The re-run button renders disabled (attribute order-independent: disabled appears on the button).
    expect(html).toMatch(/<button[^>]*data-testid="research-case-rerun-button"[^>]*disabled|<button[^>]*disabled[^>]*data-testid="research-case-rerun-button"/)
    expect(html).toContain('data-testid="research-case-rerun-disabled-hint"')
    expect(html).toContain('no ticker on this case')
  })

  it('EMPHASIZES the re-run when the engine is stale (gold treatment + refresh note)', () => {
    const html = render({ engineStale: true })
    expect(html).toContain('data-engine-stale="true"')
    // Gold-emphasis = the gold gradient on the plain owl-button base (NOT the secondary calm treatment,
    // and NOT owl-button-primary whose teal would mislead).
    expect(html).toContain('var(--owl-color-gold)')
    expect(html).not.toContain('owl-button-primary')
    expect(html).not.toMatch(/<button[^>]*owl-button-secondary[^>]*data-testid="research-case-rerun-button"/)
    expect(html).toContain('older engine — refresh recommended')
  })

  it('keeps the re-run a calm SECONDARY control when the engine is current', () => {
    const html = render({ engineStale: false })
    expect(html).toContain('data-engine-stale="false"')
    // The re-run button carries the secondary class (no gold treatment) when fresh.
    expect(html).toMatch(/<button[^>]*owl-button-secondary[^>]*data-testid="research-case-rerun-button"/)
    expect(html).not.toContain('var(--owl-color-gold)')
    expect(html).not.toContain('older engine — refresh recommended')
  })
})

describe('submitReRun', () => {
  afterEach(() => vi.restoreAllMocks())

  it('POSTs to /api/research/start with the supersedes id and navigates to the new dossier on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ research_case_id: 'rc_msft_2' }))
    const router: ActionRouter = { push: vi.fn(), refresh: vi.fn() }

    const result = await submitReRun({ fetch: fetchMock as unknown as typeof fetch, router, caseId: 'rc_msft_1', ticker: 'MSFT' })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/research/start', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body).toEqual({ ticker: 'MSFT', supersedes_research_case_id: 'rc_msft_1' })
    expect(router.push).toHaveBeenCalledWith('/research/rc_msft_2')
    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it('returns the resolved error message and does NOT navigate on a failed start', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'out_of_circle', message: 'Out of circle of competence: SIC 6022' } }, { ok: false, status: 400 }),
    )
    const router: ActionRouter = { push: vi.fn(), refresh: vi.fn() }

    const result = await submitReRun({ fetch: fetchMock as unknown as typeof fetch, router, caseId: 'rc_msft_1', ticker: 'MSFT' })

    expect(result).toEqual({ ok: false, error: 'Out of circle of competence: SIC 6022' })
    expect(router.push).not.toHaveBeenCalled()
  })

  it('invokes fetch bound to the global, never as a method on the deps object (Window-interface safety)', async () => {
    // Regression: a bare browser `fetch` reached as `deps.fetch(...)` is invoked with `this = deps`, which
    // the browser rejects ("'fetch' called on an object that does not implement interface Window"). The seam
    // must bind to the global so `this` is the global regardless of how fetch was passed.
    const seenThis: unknown[] = []
    const probe = vi.fn(function (this: unknown) {
      seenThis.push(this)
      return Promise.resolve(jsonResponse({ research_case_id: 'rc_msft_2' }))
    })
    const router: ActionRouter = { push: vi.fn(), refresh: vi.fn() }

    await submitReRun({ fetch: probe as unknown as typeof fetch, router, caseId: 'rc_msft_1', ticker: 'MSFT' })

    expect(seenThis[0]).toBe(globalThis)
  })
})

describe('submitArchive', () => {
  afterEach(() => vi.restoreAllMocks())

  it('POSTs to the archive route and returns to the library on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    const router: ActionRouter = { push: vi.fn(), refresh: vi.fn() }

    const result = await submitArchive({ fetch: fetchMock as unknown as typeof fetch, router, caseId: 'rc_msft_1' })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/research/rc_msft_1/archive', expect.objectContaining({ method: 'POST' }))
    expect(router.push).toHaveBeenCalledWith('/research')
    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it('returns the resolved error message and does NOT navigate on a failed archive', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'Archive is only available in personal-local mode' }, { ok: false, status: 400 }),
    )
    const router: ActionRouter = { push: vi.fn(), refresh: vi.fn() }

    const result = await submitArchive({ fetch: fetchMock as unknown as typeof fetch, router, caseId: 'rc_msft_1' })

    expect(result).toEqual({ ok: false, error: 'Archive is only available in personal-local mode' })
    expect(router.push).not.toHaveBeenCalled()
  })

  it('invokes fetch bound to the global, never as a method on the deps object (Window-interface safety)', async () => {
    const seenThis: unknown[] = []
    const probe = vi.fn(function (this: unknown) {
      seenThis.push(this)
      return Promise.resolve(jsonResponse({ ok: true }))
    })
    const router: ActionRouter = { push: vi.fn(), refresh: vi.fn() }

    await submitArchive({ fetch: probe as unknown as typeof fetch, router, caseId: 'rc_msft_1' })

    expect(seenThis[0]).toBe(globalThis)
  })
})

describe('submitReReview', () => {
  afterEach(() => vi.restoreAllMocks())

  it('POSTs to the re-review route and refreshes when a diff was recorded', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'recorded', re_review: { assessment: 'INTACT' } }))
    const router: ActionRouter = { push: vi.fn(), refresh: vi.fn() }

    const result = await submitReReview({ fetch: fetchMock as unknown as typeof fetch, router, caseId: 'rc_msft_1' })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/research/rc_msft_1/re-review', expect.objectContaining({ method: 'POST' }))
    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it('returns an informational note (no refresh) for zero-spend outcomes like no_new_filings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'no_new_filings', checked_at: '2026-07-05T00:00:00.000Z' }))
    const router: ActionRouter = { push: vi.fn(), refresh: vi.fn() }

    const result = await submitReReview({ fetch: fetchMock as unknown as typeof fetch, router, caseId: 'rc_msft_1' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.note).toMatch(/No new filings/)
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it('surfaces the resolved error on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'no_recorded_thesis', message: 'This case has no recorded thesis to compare against.' } }, { ok: false, status: 409 }),
    )
    const router: ActionRouter = { push: vi.fn(), refresh: vi.fn() }

    const result = await submitReReview({ fetch: fetchMock as unknown as typeof fetch, router, caseId: 'rc_msft_1' })

    expect(result).toEqual({ ok: false, error: 'This case has no recorded thesis to compare against.' })
  })
})
