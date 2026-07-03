import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import { ResearchRunProgress, pollRunProgressOnce } from '../ResearchRunProgress'
import { resolveRunProgress, type RunProgress } from '../../lib/researchRunProgress'

function render(props: Partial<Parameters<typeof ResearchRunProgress>[0]> = {}): string {
  const initial = props.initial ?? resolveRunProgress({ stage: 'deep_dive_in_progress', specialistFindingCount: 3 })
  return renderToStaticMarkup(
    createElement(ResearchRunProgress, {
      caseId: 'rc_msft_1',
      ticker: 'MSFT',
      initial,
      ...props,
    }),
  )
}

function statusResponse(progress: RunProgress, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => progress } as unknown as Response
}

describe('ResearchRunProgress — render', () => {
  it('renders the busy card, heading with the ticker, and the ordered stage checklist with the N/6 count', () => {
    const html = render()
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Researching MSFT…')
    expect(html).toContain('Queued — fetching filings')
    expect(html).toContain('Quick screen — Shariah + worth-it gate')
    expect(html).toContain('Circle of competence')
    expect(html).toContain('Deep dive — 3/6 specialists')
    expect(html).toContain('Synthesis &amp; valuation')
    expect(html).toContain('Decision drafted')
    // The current stage carries the current state marker class.
    expect(html).toContain('data-testid="run-progress-stage-deep_dive"')
    expect(html).toContain('owl-run-progress-stage-current')
  })

  it('falls back to the caseId in the heading when no ticker is known', () => {
    const html = renderToStaticMarkup(
      createElement(ResearchRunProgress, {
        caseId: 'rc_msft_1',
        initial: resolveRunProgress({ stage: 'deep_dive_in_progress', specialistFindingCount: 3 }),
      }),
    )
    expect(html).toContain('Researching rc_msft_1…')
  })
})

describe('pollRunProgressOnce — the poll/stop/refresh seam', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('updates progress on an in-flight response and does NOT signal done', async () => {
    const next = resolveRunProgress({ stage: 'deep_dive_in_progress', specialistFindingCount: 5 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse(next)))
    const onUpdate = vi.fn()
    const onDone = vi.fn()

    await pollRunProgressOnce({ caseId: 'rc_msft_1', onUpdate, onDone })

    expect(onUpdate).toHaveBeenCalledWith(next)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('signals done when the run is no longer in progress (terminal / failed / awaiting approval)', async () => {
    const terminal = resolveRunProgress({ stage: 'decision_drafted', specialistFindingCount: 7 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse(terminal)))
    const onUpdate = vi.fn()
    const onDone = vi.fn()

    await pollRunProgressOnce({ caseId: 'rc_msft_1', onUpdate, onDone })

    expect(onUpdate).toHaveBeenCalledWith(terminal)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('is fail-soft: a non-ok response updates nothing and never signals done', async () => {
    const ignored = resolveRunProgress({ stage: 'deep_dive_in_progress' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse(ignored, false)))
    const onUpdate = vi.fn()
    const onDone = vi.fn()

    await pollRunProgressOnce({ caseId: 'rc_msft_1', onUpdate, onDone })

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('is fail-soft: a rejected fetch is swallowed (keeps the last good state)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const onUpdate = vi.fn()
    const onDone = vi.fn()

    await expect(pollRunProgressOnce({ caseId: 'rc_msft_1', onUpdate, onDone })).resolves.toBeUndefined()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })
})
