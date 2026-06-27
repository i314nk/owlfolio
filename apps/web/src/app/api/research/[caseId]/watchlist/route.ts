import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { promoteResearchCaseToWatchlist } from '../../../../../lib/workflow'

export type PromoteToWatchlistRouteContext = {
  params: Promise<{ caseId: string }>
}

/**
 * Review-and-promote: the human reviewed the dossier (the bear case, the key wrong assumption, and the
 * thesis-break triggers) and clicked "Promote to watchlist". That explicit click is the human-authored
 * transition — there is NO required signed-thesis or cognitive-acknowledgement body to read. The route
 * just runs the promotion (which still enforces the Shariah gate) and redirects. The signed-thesis
 * provenance recorded on the ledger event is server-sourced; the client posts nothing.
 */
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
