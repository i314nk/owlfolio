import { NextResponse } from 'next/server'

import { getOnboardingState, getProviderReadinessSnapshot } from '../../../../../lib/onboarding'
import { startResearchRun } from '../../../../../lib/workflow'
import type { SpawnWorkerPaths } from '../../../../../lib/workflow'

export type StartRunRouteContext = {
  params: Promise<{ caseId: string }>
}

/** Test-only deps surface (spawn override + readiness override); live passes nothing. */
type RouteDeps = {
  spawn?: (paths: SpawnWorkerPaths) => void
  readinessOverride?: { is_ready: boolean; provider_id: string; status_label: string }
}

/**
 * POST — enqueue a research run for an EXISTING case (e.g. a discovery-promoted case at stage 'discovered'
 * that has not yet had a run requested). Appends a `research_run_requested` event for the given caseId and
 * spawns the worker. Fail-closed on provider readiness; 409 when the run is already started or the case
 * is not initialized/not found.
 */
export async function POST(_request: Request, { params }: StartRunRouteContext, deps: RouteDeps = {}) {
  const { caseId } = await params
  const state = await getOnboardingState()

  // Provider-readiness gate (same fail-closed posture as /api/research/start and re-review).
  const readiness =
    deps.readinessOverride ?? (await getProviderReadinessSnapshot(state.config, { env: process.env }))
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

  try {
    const result = await startResearchRun(state, caseId, {
      ...(deps.spawn === undefined ? {} : { spawn: deps.spawn }),
    })
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (
      message.startsWith('Personal-local workflow is not initialized') ||
      message.startsWith('Research run already started for') ||
      message.startsWith('Unknown research case:')
    ) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
