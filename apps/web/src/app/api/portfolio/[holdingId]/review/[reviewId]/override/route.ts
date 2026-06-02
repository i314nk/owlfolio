import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../../../lib/onboarding'
import { overridePersonalHoldingReviewDraft } from '../../../../../../../lib/workflow'

type RouteContext = {
  params: Promise<{ holdingId: string; reviewId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const state = await getOnboardingState()
  const { holdingId, reviewId } = await context.params
  const formData = await request.formData()

  try {
    await overridePersonalHoldingReviewDraft(state, holdingId, reviewId, {
      thesis_health: formData.get('thesis_health'),
      action_stance: formData.get('action_stance'),
      rationale: formData.get('rationale'),
      evidence_summary: formData.get('evidence_summary'),
      uncertainty: formData.get('uncertainty'),
      next_review_at: formData.get('next_review_at'),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to override holding review' }, { status: 400 })
  }

  redirect('/portfolio')
}
