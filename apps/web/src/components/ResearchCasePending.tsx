'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export type ResearchCasePendingProps = {
  /** The research case id being awaited (surfaced for the user, e.g. rc_msft_…). */
  caseId: string
  /** Poll interval in ms for the server-component refresh (default 2000). */
  refreshIntervalMs?: number
}

/**
 * The post-start "Research running…" pending state. The worker authors `research_case_created` ~1s
 * after the web path enqueues `research_run_requested`, so on the redirect the case is briefly not yet
 * projected. Rather than 404, the page renders this thin client child, which calls `router.refresh()`
 * on an interval to re-run the server component until the case materializes (then the dossier renders).
 */
export function ResearchCasePending({ caseId, refreshIntervalMs = 2000 }: ResearchCasePendingProps) {
  const router = useRouter()

  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh()
    }, refreshIntervalMs)
    return () => clearInterval(interval)
  }, [router, refreshIntervalMs])

  return (
    <section aria-busy="true" aria-live="polite" className="owl-section-card">
      <p className="owl-empty-state-kicker">Research running</p>
      <h2 className="owl-section-title">Building your research case…</h2>
      <p className="owl-empty-state-description">
        The research worker is gathering sources and drafting the dossier for <code translate="no">{caseId}</code>.
        This page refreshes automatically — it will show the case as soon as the worker finishes.
      </p>
    </section>
  )
}
