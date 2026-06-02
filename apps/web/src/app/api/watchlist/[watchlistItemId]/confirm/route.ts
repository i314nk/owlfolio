import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { confirmPersonalWatchlistDraft } from '../../../../../lib/workflow'

export type ConfirmWatchlistRouteContext = {
  params: Promise<{ watchlistItemId: string }>
}

export async function POST(_request: Request, { params }: ConfirmWatchlistRouteContext) {
  const { watchlistItemId } = await params
  const state = await getOnboardingState()

  try {
    await confirmPersonalWatchlistDraft(state, watchlistItemId)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message.startsWith('Unknown watchlist item:')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    throw error
  }

  redirect('/watchlist')
}
