import { NextResponse } from 'next/server'

import { getOnboardingState, getProviderReadinessSnapshot } from '../../../../../lib/onboarding'
import { recordSizingRecommendation, type RecordSizingRecommendationDeps } from '../../../../../lib/workflow'

export type SizingRouteContext = {
  params: Promise<{ caseId: string }>
}

/**
 * Test-only deps surface: injects fixture fundamentals/price + a readiness override (so the offline route
 * test can exercise the fail-closed path) without hitting live data feeds or the real provider-readiness
 * probe. The live path passes nothing.
 */
type RouteDeps = RecordSizingRecommendationDeps & {
  readinessOverride?: { is_ready: boolean; provider_id: string; status_label: string }
}

/**
 * POST — compute the SIZING recommendation for a case ON-DEMAND and emit it as an OBSERVATION
 * (`sizing_recommendation_recorded`). It runs ONLY when invoked (the human opens the sizing step). It
 * respects the SAME provider-readiness gating as /api/research/start (fail-closed if the provider isn't
 * ready), and rejects a case that is not a watched/admittable sizing candidate (no locked buy-below / no
 * recorded admit recommendation carrying the downside floor + risk levels). It NEVER opens the holding —
 * the buy stays the human-signed holding-open transition.
 */
export async function POST(_request: Request, { params }: SizingRouteContext, deps: RouteDeps = {}) {
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

  const workflowDeps: RecordSizingRecommendationDeps = {
    ...(deps.fundamentals === undefined ? {} : { fundamentals: deps.fundamentals }),
    ...(deps.resolvePrice === undefined ? {} : { resolvePrice: deps.resolvePrice }),
  }

  try {
    const outcome = await recordSizingRecommendation(state, caseId, workflowDeps)

    if (outcome.status === 'not_a_sizing_candidate') {
      return NextResponse.json(
        { error: { code: 'not_a_sizing_candidate', message: outcome.reason } },
        { status: 409 },
      )
    }

    return NextResponse.json(
      { sizing_recommendation_id: outcome.sizing_recommendation_id, recommendation: outcome.recommendation },
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
