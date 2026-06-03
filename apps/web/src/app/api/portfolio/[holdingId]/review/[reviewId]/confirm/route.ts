import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../../../lib/onboarding'
import { confirmPersonalHoldingReviewDraft } from '../../../../../../../lib/workflow'

export type ConfirmHoldingReviewRouteContext = {
  params: Promise<{ holdingId: string; reviewId: string }>
}

export async function POST(_request: Request, { params }: ConfirmHoldingReviewRouteContext) {
  const { holdingId, reviewId } = await params
  const state = await getOnboardingState()

  try {
    await confirmPersonalHoldingReviewDraft(state, holdingId, reviewId)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message.startsWith('Unknown holding review draft:')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    throw error
  }

  redirect('/portfolio')
}
