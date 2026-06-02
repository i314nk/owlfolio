import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { createPersonalHoldingReviewDraft } from '../../../../../lib/workflow'

export type CreateHoldingReviewRouteContext = {
  params: Promise<{ holdingId: string }>
}

export async function POST(_request: Request, { params }: CreateHoldingReviewRouteContext) {
  const { holdingId } = await params
  const state = await getOnboardingState()

  try {
    await createPersonalHoldingReviewDraft(state, holdingId)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message.startsWith('Unknown holding:')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof Error && error.message.startsWith('Provider ')) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    throw error
  }

  redirect('/portfolio')
}
