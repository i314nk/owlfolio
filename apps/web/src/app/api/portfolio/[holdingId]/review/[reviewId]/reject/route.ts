import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../../../lib/onboarding'
import { rejectPersonalHoldingReviewDraft } from '../../../../../../../lib/workflow'

type RouteContext = {
  params: Promise<{ holdingId: string; reviewId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const state = await getOnboardingState()
  const { holdingId, reviewId } = await context.params
  const formData = await request.formData()

  try {
    await rejectPersonalHoldingReviewDraft(state, holdingId, reviewId, {
      rejection_reason: formData.get('rejection_reason'),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to reject holding review' }, { status: 400 })
  }

  redirect('/portfolio')
}
