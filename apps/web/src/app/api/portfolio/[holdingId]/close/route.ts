import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { closePersonalHolding } from '../../../../../lib/workflow'

export type CloseHoldingRouteContext = {
  params: Promise<{ holdingId: string }>
}

/**
 * POST — the human-authored, irreversible holding close (holding_closed). The position leaves every
 * active view (its watchlist item returns to plain watching); the raw events + any post-mortem
 * remain the audit record. Machine actors are rejected by the workflow primitive itself.
 */
export async function POST(request: Request, { params }: CloseHoldingRouteContext) {
  const { holdingId } = await params
  const state = await getOnboardingState()
  const formData = await request.formData()

  try {
    await closePersonalHolding(state, holdingId, {
      exit_price_per_share: formData.get('exit_price_per_share'),
      closed_at: formData.get('closed_at'),
      reason_code: formData.get('reason_code'),
      message: formData.get('message'),
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message.startsWith('Unknown holding:')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof Error && (error.message.startsWith('Exit price') || error.message.startsWith('Close reason'))) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }

  redirect('/portfolio')
}
