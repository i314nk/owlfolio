import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { promoteResearchCaseToWatchlist } from '../../../../../lib/workflow'

export type PromoteToWatchlistRouteContext = {
  params: Promise<{ caseId: string }>
}

export async function POST(_request: Request, { params }: PromoteToWatchlistRouteContext) {
  const { caseId } = await params
  const state = await getOnboardingState()

  try {
    await promoteResearchCaseToWatchlist(state, caseId)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message.startsWith('Unknown research case:')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof Error && error.message.startsWith('Research case is not ready for watchlist promotion:')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    throw error
  }

  redirect('/watchlist')
}
