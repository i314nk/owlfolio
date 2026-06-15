import { NextResponse } from 'next/server'

import { getOnboardingState, getProviderReadinessSnapshot } from '../../../../../lib/onboarding'
import {
  isMinimumHoldTrigger,
  recordSellDecision,
  type RecordSellDecisionDeps,
  type RecordSellDecisionInput,
} from '../../../../../lib/workflow'

export type SellDecisionRouteContext = {
  params: Promise<{ caseId: string }>
}

/**
 * Test-only deps surface: injects a fixture price resolver + a readiness override (so the offline route
 * test can exercise the fail-closed path) without hitting live feeds or the real provider-readiness probe.
 * The live path passes nothing.
 */
type RouteDeps = RecordSellDecisionDeps & {
  readinessOverride?: { is_ready: boolean; provider_id: string; status_label: string }
}

const VALID_TRIGGERS = 'thesis_broke | valuation_inverted | better_opportunity | original_mistake'

/**
 * POST — compute the SELL DECISION for a HELD name's research case ON-DEMAND and emit it as an advisory
 * OBSERVATION (`holding_sell_review_drafted`, is_observation:true). It runs ONLY when invoked (the human
 * opens the sell-review step, or a cadence signal raises a trigger). It respects the SAME provider-readiness
 * gating as the sibling on-demand routes (fail-closed if the provider isn't ready), validates the request
 * body's `trigger` against the minimum-hold trigger union, and rejects a non-held name (409). It NEVER
 * closes the holding — the close stays the human-signed closeHolding transition.
 */
export async function POST(request: Request, { params }: SellDecisionRouteContext, deps: RouteDeps = {}) {
  const { caseId } = await params
  const state = await getOnboardingState()

  // Provider-readiness gate (same fail-closed posture as the sibling on-demand routes).
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

  // Parse + validate the body. The human/UI (or a cadence-raised signal) picks WHICH minimum-hold trigger
  // to evaluate; an invalid/missing trigger is a 422 (the close never proceeds on an unrecognized trigger).
  let body: Record<string, unknown> = {}
  try {
    const parsed = (await request.json()) as unknown
    if (parsed !== null && typeof parsed === 'object') body = parsed as Record<string, unknown>
  } catch {
    body = {}
  }
  if (!isMinimumHoldTrigger(body.trigger)) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_trigger',
          message: `Invalid or missing sell trigger. Expected one of: ${VALID_TRIGGERS}.`,
        },
      },
      { status: 422 },
    )
  }

  const input: RecordSellDecisionInput = {
    trigger: body.trigger,
    ...(typeof body.candidate_oe_yield === 'number' ? { candidate_oe_yield: body.candidate_oe_yield } : {}),
    ...(typeof body.held_oe_yield === 'number' ? { held_oe_yield: body.held_oe_yield } : {}),
    ...(typeof body.switching_friction === 'number' ? { switching_friction: body.switching_friction } : {}),
  }

  const workflowDeps: RecordSellDecisionDeps = {
    ...(deps.resolvePrice === undefined ? {} : { resolvePrice: deps.resolvePrice }),
  }

  try {
    const outcome = await recordSellDecision(state, caseId, input, workflowDeps)

    if (outcome.status === 'not_a_held_position') {
      return NextResponse.json(
        { error: { code: 'not_a_held_position', message: outcome.reason } },
        { status: 409 },
      )
    }
    if (outcome.status === 'cannot_assess') {
      return NextResponse.json(
        { error: { code: 'cannot_assess', message: outcome.reason } },
        { status: 502 },
      )
    }

    return NextResponse.json(
      { sell_review_id: outcome.sell_review_id, recommendation: outcome.recommendation },
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
    if (message.startsWith('Invalid minimum-hold trigger:')) {
      return NextResponse.json({ error: message }, { status: 422 })
    }
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
