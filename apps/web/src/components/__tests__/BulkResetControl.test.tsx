import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import {
  BulkResetControl,
  CONFIRM_WORD,
  isBulkResetConfirmEnabled,
  submitBulkReset,
  type BulkResetRouter,
} from '../BulkResetControl'

function render(): string {
  return renderToStaticMarkup(createElement(BulkResetControl))
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response
}

describe('BulkResetControl — render', () => {
  it('renders the destructive dev/test tool label and the calm primary trigger only (no armed confirm)', () => {
    const html = render()
    expect(html).toContain('Developer / test tools — destructive')
    expect(html).toContain('Reset all research')
    expect(html).toContain('data-testid="bulk-reset-trigger"')
    // The destructive confirm + type-to-confirm input are NOT present until the operator arms the control,
    // so nothing irreversible can fire from the initial render.
    expect(html).not.toContain('data-testid="bulk-reset-confirm"')
    expect(html).not.toContain('data-testid="bulk-reset-input"')
    expect(html).not.toContain('data-testid="bulk-reset-confirm-button"')
  })

  it('uses owl danger styling tokens', () => {
    const html = render()
    expect(html).toContain('var(--owl-color-risk')
    expect(html).toContain('owl-button-danger')
  })
})

describe('submitBulkReset', () => {
  afterEach(() => vi.restoreAllMocks())

  it('POSTs to /api/research/reset and refreshes with the cleared count on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ reset: true, cleared_events: 12 }))
    const router: BulkResetRouter = { refresh: vi.fn() }

    const result = await submitBulkReset({ fetch: fetchMock as unknown as typeof fetch, router })

    expect(result).toEqual({ ok: true, clearedEvents: 12 })
    expect(fetchMock).toHaveBeenCalledWith('/api/research/reset', expect.objectContaining({ method: 'POST' }))
    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it('returns the error and does NOT refresh on a failed reset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'Not found' }, { ok: false, status: 404 }))
    const router: BulkResetRouter = { refresh: vi.fn() }

    const result = await submitBulkReset({ fetch: fetchMock as unknown as typeof fetch, router })

    expect(result).toEqual({ ok: false, error: 'Not found' })
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it('surfaces a thrown network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    const router: BulkResetRouter = { refresh: vi.fn() }

    const result = await submitBulkReset({ fetch: fetchMock as unknown as typeof fetch, router })

    expect(result).toEqual({ ok: false, error: 'network down' })
  })

  it('exports the type-to-confirm word required to arm the final confirm', () => {
    expect(CONFIRM_WORD).toBe('RESET')
  })
})

describe('isBulkResetConfirmEnabled — the type-to-confirm gate', () => {
  it('is DISABLED until the exact confirmation word is typed', () => {
    expect(isBulkResetConfirmEnabled({ typed: '', submitting: false })).toBe(false)
    expect(isBulkResetConfirmEnabled({ typed: 'reset', submitting: false })).toBe(false)
    expect(isBulkResetConfirmEnabled({ typed: 'RESE', submitting: false })).toBe(false)
  })

  it('is ENABLED once the exact word is typed and no submit is in flight', () => {
    expect(isBulkResetConfirmEnabled({ typed: CONFIRM_WORD, submitting: false })).toBe(true)
  })

  it('is DISABLED while a submit is in flight even with the word typed', () => {
    expect(isBulkResetConfirmEnabled({ typed: CONFIRM_WORD, submitting: true })).toBe(false)
  })
})
