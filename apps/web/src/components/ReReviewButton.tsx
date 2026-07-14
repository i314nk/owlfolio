'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import { resolveErrorMessage } from '../app/research/new/resolveErrorMessage'

// createElement (no JSX) — repo convention for components imported under vitest (jsx: preserve).

/** The subset of next/navigation's router these actions use — a testable seam (see ResearchCaseActions). */
export type ReReviewRouter = {
  push: (href: string) => void
  refresh: () => void
}

/**
 * Run the on-demand thesis RE-REVIEW: check for filings NEW since this case's decision (its persisted
 * corpus + decision date) and, when any exist, record a DIFF against the recorded thesis (an
 * observation — never a verdict; a BROKEN diff points at the dossier's re-run action). Zero provider
 * spend when nothing new was filed. Shared by the dossier actions and the watchlist/portfolio launches.
 */
export async function submitReReview(
  deps: { fetch: typeof fetch; router: ReReviewRouter; caseId: string },
): Promise<{ ok: true; note?: string } | { ok: false; error: string }> {
  try {
    // Bind to the global (see submitReRun): the browser fetch rejects a non-Window `this`.
    const doFetch = deps.fetch.bind(globalThis)
    const response = await doFetch(`/api/research/${deps.caseId}/re-review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      return { ok: false, error: resolveErrorMessage(body) }
    }
    if (body.status === 'recorded') {
      deps.router.refresh()
      return { ok: true }
    }
    // A threshold-meeting insider-selling cluster (§3.3) is a STRONG signal even with no new conventional
    // filings — surface it instead of a bare "nothing to compare".
    const cluster = body.insider_cluster as { distinct_sellers?: number; discretionary_sell_value?: number } | undefined
    const insiderNote = cluster === undefined
      ? ''
      : ` Insider-selling cluster (STRONG): ${cluster.distinct_sellers ?? 0} insiders sold ~$${Math.round(cluster.discretionary_sell_value ?? 0).toLocaleString('en-US')} recently — consider a full re-run.`
    // 10-K cadence: a new annual report makes the FULL re-analysis the right tool — say so here too
    // (the durable prompt is the monitor alert + the dossier card line).
    const annual = body.new_annual_filing as { form?: string; filed?: string } | undefined
    const annualNote = annual === undefined
      ? ''
      : ` Annual report filed (${annual.form ?? '10-K'}, ${annual.filed ?? ''}) — a full re-analysis is recommended.`
    const base = body.status === 'no_new_filings'
      ? (cluster === undefined
          ? 'No new filings since this decision — the check-in has nothing to compare.'
          : 'No new conventional filings since this decision, but an insider-selling cluster fired.')
      : body.status === 'no_prior_corpus'
        ? 'No persisted source corpus for this case (it predates ledger persistence) — the honest refresh is a full re-run.'
        : 'Could not resolve SEC filings for this ticker right now — try again later.'
    return { ok: true, note: `${base}${insiderNote}${annualNote}` }
  } catch (caughtError) {
    return { ok: false, error: caughtError instanceof Error ? caughtError.message : 'Unable to run the check-in' }
  }
}

/**
 * useRouter, tolerant of running OUTSIDE an app-router mount (static server render in unit tests, where
 * the panels render via renderToStaticMarkup with no router context). In the app it is the real router;
 * outside it degrades to a location-based shim — the button only navigates on user interaction, which
 * never happens in a static render.
 */
function useSafeRouter(): ReReviewRouter {
  try {
    return useRouter()
  } catch {
    return {
      push: (href: string) => { window.location.href = href },
      refresh: () => { window.location.reload() },
    }
  }
}

const noteStyle: CSSProperties = {
  color: 'var(--owl-color-quiet)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  letterSpacing: '0.04em',
  margin: 0,
}

/**
 * The compact re-review launch used on the watchlist and portfolio desks (the dossier has its own
 * confirm-row treatment in ResearchCaseActions). One inline confirm step (it can spend provider quota),
 * then the zero-spend outcomes ("no new filings") report inline; a recorded diff refreshes the page —
 * the alert/dossier card is the display surface.
 */
export function ReReviewButton({ caseId }: { caseId: string }): ReactNode {
  const router = useSafeRouter()
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  async function onConfirm(): Promise<void> {
    setSubmitting(true)
    setError(undefined)
    setNote(undefined)
    const result = await submitReReview({ fetch, router, caseId })
    if (result.ok) {
      setConfirming(false)
      if (result.note !== undefined) setNote(result.note)
    } else {
      setError(result.error)
    }
    setSubmitting(false)
  }

  return createElement(
    'div',
    { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)', marginTop: '0.4rem' } },
    confirming
      ? createElement(
          'div',
          { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' }, 'data-testid': 'rereview-confirm' },
          createElement(
            'span',
            { style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)', maxWidth: '28rem' } },
            'Checks EDGAR for filings NEW since this decision; only if any exist, a grounded check-in runs (uses provider quota). Continue?',
          ),
          createElement(
            'button',
            { type: 'button', className: 'owl-button owl-button-secondary owl-focusable', disabled: submitting, onClick: () => void onConfirm() },
            submitting ? 'Checking…' : 'Confirm check-in',
          ),
          createElement(
            'button',
            { type: 'button', className: 'owl-button owl-button-secondary owl-focusable', disabled: submitting, onClick: () => setConfirming(false) },
            'Cancel',
          ),
        )
      : createElement(
          'button',
          {
            type: 'button',
            className: 'owl-button owl-button-secondary owl-focusable',
            style: { cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 } as CSSProperties,
            disabled: submitting,
            'data-testid': 'rereview-button',
            onClick: () => {
              setError(undefined)
              setNote(undefined)
              setConfirming(true)
            },
          },
          'Check-in vs new filings',
        ),
    note === undefined ? null : createElement('p', { 'data-testid': 'rereview-note', style: noteStyle }, note),
    error === undefined
      ? null
      : createElement('p', { 'data-testid': 'rereview-error', style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-sm)', margin: 0 } }, error),
  )
}
