import { NextResponse } from 'next/server'

import { getOnboardingState, getProviderReadinessSnapshot } from '../../../../../lib/onboarding'
import { runResearchCaseReReview, type RunReReviewDeps } from '../../../../../lib/workflow'

export type ReReviewRouteContext = {
  params: Promise<{ caseId: string }>
}

/** Test-only deps surface (fake provider / ground / fundamentals + readiness override); live passes nothing. */
type RouteDeps = RunReReviewDeps & {
  readinessOverride?: { is_ready: boolean; provider_id: string; status_label: string }
}

/**
 * POST — run the on-demand thesis RE-REVIEW for a case: check for filings NEW since the decision's
 * persisted corpus and, when any exist, ground them and record a DIFF against the recorded thesis
 * (`research_case_re_review_recorded`: INTACT | WEAKENED | BROKEN | UNVERIFIED, fail-closed). It is an
 * OBSERVATION — never a verdict, never a transition; a BROKEN diff points the human at the existing
 * supersession re-run. Zero provider spend when there is nothing new or no computable delta.
 */
export async function POST(_request: Request, { params }: ReReviewRouteContext, deps: RouteDeps = {}) {
  const { caseId } = await params
  const state = await getOnboardingState()

  // Provider-readiness gate (same fail-closed posture as /api/research/start).
  const readiness = deps.readinessOverride
    ?? await getProviderReadinessSnapshot(state.config, { env: process.env })
  if (!readiness.is_ready) {
    return NextResponse.json(
      { error: { code: 'provider_not_ready', message: `Provider ${readiness.provider_id} is not ready: ${readiness.status_label}` } },
      { status: 400 },
    )
  }

  const workflowDeps: RunReReviewDeps = {
    ...(deps.provider === undefined ? {} : { provider: deps.provider }),
    ...(deps.ground === undefined ? {} : { ground: deps.ground }),
    ...(deps.fetchFundamentals === undefined ? {} : { fetchFundamentals: deps.fetchFundamentals }),
  }

  try {
    const outcome = await runResearchCaseReReview(state, caseId, workflowDeps)

    if (outcome.status === 'no_recorded_thesis') {
      return NextResponse.json(
        { error: { code: 'no_recorded_thesis', message: 'This case has no recorded thesis to compare against.' } },
        { status: 409 },
      )
    }
    // Zero-spend informational outcomes — 200 with a status the UI can phrase.
    if (outcome.status === 'no_prior_corpus' || outcome.status === 'no_new_filings' || outcome.status === 'fundamentals_unresolved') {
      return NextResponse.json(outcome, { status: 200 })
    }
    return NextResponse.json(outcome, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
