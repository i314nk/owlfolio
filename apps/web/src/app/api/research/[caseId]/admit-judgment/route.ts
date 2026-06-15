import { NextResponse } from 'next/server'

import { getOnboardingState, getProviderReadinessSnapshot } from '../../../../../lib/onboarding'
import { recordAdmitJudgment, type RecordAdmitJudgmentDeps } from '../../../../../lib/workflow'

export type AdmitJudgmentRouteContext = {
  params: Promise<{ caseId: string }>
}

/**
 * Test-only deps surface: injects the fake provider + fixture fundamentals/price + a readiness override
 * (so the offline route test can exercise the fail-closed path) without hitting live data feeds or the
 * real provider-readiness probe. The live path passes nothing.
 */
type RouteDeps = RecordAdmitJudgmentDeps & {
  readinessOverride?: { is_ready: boolean; provider_id: string; status_label: string }
}

/**
 * POST — compute the admit-judgment recommendation for a case ON-DEMAND and emit it as an OBSERVATION
 * (`admit_judgment_recorded`). It runs ONLY when invoked (the human opens the admit step). It respects
 * the SAME provider-readiness gating as /api/research/start (fail-closed if the provider isn't ready),
 * and rejects a case that is not a deep-dive-complete / gate-passing admission candidate. It NEVER
 * transitions the name — the human still admits via the watchlist confirm (signed thesis).
 */
export async function POST(_request: Request, { params }: AdmitJudgmentRouteContext, deps: RouteDeps = {}) {
  const { caseId } = await params
  const state = await getOnboardingState()

  // Provider-readiness gate (same fail-closed posture as /api/research/start).
  const readiness = deps.readinessOverride
    ?? await getProviderReadinessSnapshot(state.config, { env: process.env })
  if (!readiness.is_ready) {
    return NextResponse.json(
      {
        error: {
          code: 'provider_not_ready',
          message: `Provider ${readiness.provider_id} is not ready: ${readiness.status_label}`,
        },
      },
      { status: 400 },
    )
  }

  const workflowDeps: RecordAdmitJudgmentDeps = {
    ...(deps.provider === undefined ? {} : { provider: deps.provider }),
    ...(deps.ground === undefined ? {} : { ground: deps.ground }),
    ...(deps.fundamentals === undefined ? {} : { fundamentals: deps.fundamentals }),
    ...(deps.resolvePrice === undefined ? {} : { resolvePrice: deps.resolvePrice }),
  }

  try {
    const outcome = await recordAdmitJudgment(state, caseId, workflowDeps)

    if (outcome.status === 'not_an_admission_candidate') {
      return NextResponse.json(
        { error: { code: 'not_an_admission_candidate', message: outcome.reason } },
        { status: 409 },
      )
    }
    if (outcome.status === 'admit_judgment_incomplete') {
      return NextResponse.json(
        { error: { code: 'admit_judgment_incomplete', message: outcome.reason } },
        { status: 502 },
      )
    }

    return NextResponse.json(
      { admit_judgment_id: outcome.admit_judgment_id, recommendation: outcome.recommendation },
      { status: 200 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (message.startsWith('Unknown research case:')) {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    if (message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
