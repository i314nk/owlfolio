'use client'

import { createElement, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import type { RunProgress, RunProgressStage } from '../lib/researchRunProgress'

// NOTE: createElement (not JSX) — the apps/web tsconfig sets `jsx: preserve`, so a component IMPORTED under
// vitest must avoid JSX to transform (mirrors ResearchCaseActions / ResearchCasePanel).

export type ResearchRunProgressProps = {
  caseId: string
  /** The first snapshot, computed server-side, so the view never flashes blank before the first poll. */
  initial: RunProgress
  /** Surfaced in the heading when known (e.g. MSFT); falls back to the caseId. */
  ticker?: string
  /** Poll interval in ms (default 2000). */
  pollIntervalMs?: number
  /** Test seam: a single poll step. Defaults to the real `/api/research/:id/status` fetch. */
  pollOnce?: (deps: PollDeps) => Promise<void>
}

export type PollDeps = {
  caseId: string
  onUpdate: (progress: RunProgress) => void
  onDone: () => void
}

/**
 * One poll step (extracted as a seam so the "on done → router.refresh()" behavior is unit-testable without a
 * DOM timer). Fetches the light status projection; on a good response it updates the rendered progress, and
 * when the run is no longer in flight (done OR failed OR awaiting approval) it signals completion so the
 * server component re-renders the dossier / failed / approval branch. A failed fetch is swallowed — the last
 * good state stays on screen and the next tick retries.
 */
export async function pollRunProgressOnce(deps: PollDeps): Promise<void> {
  try {
    const doFetch = fetch.bind(globalThis)
    const response = await doFetch(`/api/research/${deps.caseId}/status`, { cache: 'no-store' })
    if (!response.ok) {
      return
    }
    const progress = (await response.json()) as RunProgress
    deps.onUpdate(progress)
    if (progress.inProgress === false) {
      deps.onDone()
    }
  } catch {
    // fail-soft: keep the last good state, retry next tick.
  }
}

function markerFor(stage: RunProgressStage): string {
  if (stage.state === 'done') return '✓'
  if (stage.state === 'current') return '⟳'
  return '·'
}

function stageNode(stage: RunProgressStage): ReactNode {
  return createElement(
    'li',
    {
      key: stage.key,
      'data-testid': `run-progress-stage-${stage.key}`,
      'data-state': stage.state,
      className: `owl-run-progress-stage owl-run-progress-stage-${stage.state}`,
    },
    createElement('span', { 'aria-hidden': 'true', className: 'owl-run-progress-stage-marker' }, markerFor(stage)),
    createElement('span', null, stage.label),
  )
}

export function ResearchRunProgress({
  caseId,
  initial,
  ticker,
  pollIntervalMs = 2000,
  pollOnce = pollRunProgressOnce,
}: ResearchRunProgressProps): ReactNode {
  const router = useRouter()
  const [progress, setProgress] = useState<RunProgress>(initial)
  const doneRef = useRef(false)

  useEffect(() => {
    const interval = setInterval(() => {
      void pollOnce({
        caseId,
        onUpdate: setProgress,
        onDone: () => {
          if (doneRef.current) return
          doneRef.current = true
          clearInterval(interval)
          router.refresh()
        },
      })
    }, pollIntervalMs)
    return () => clearInterval(interval)
  }, [caseId, pollIntervalMs, pollOnce, router])

  const heading = `Researching ${ticker ?? caseId}…`

  return createElement(
    'section',
    {
      'aria-busy': 'true',
      'aria-live': 'polite',
      'data-testid': 'research-run-progress',
      className: 'owl-section-card',
    },
    createElement(
      'div',
      { className: 'owl-run-progress-header' },
      createElement('span', { 'aria-hidden': 'true', className: 'owl-run-progress-spinner' }),
      createElement(
        'div',
        null,
        createElement('p', { className: 'owl-empty-state-kicker' }, 'Research running'),
        createElement('h2', { className: 'owl-section-title' }, heading),
      ),
    ),
    createElement(
      'p',
      { className: 'owl-empty-state-description' },
      'The run passes through the Shariah gate, the circle of competence, five specialist lanes, the valuation judgment, synthesis, and a decision. This page updates as each stage completes.',
    ),
    createElement(
      'ol',
      { className: 'owl-run-progress-list' },
      ...progress.stages.map((stage) => stageNode(stage)),
    ),
  )
}
