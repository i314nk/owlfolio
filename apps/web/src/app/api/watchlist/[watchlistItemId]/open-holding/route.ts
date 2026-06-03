import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { openPersonalHoldingFromWatchlist } from '../../../../../lib/workflow'

export type OpenHoldingRouteContext = {
  params: Promise<{ watchlistItemId: string }>
}

export async function POST(request: Request, { params }: OpenHoldingRouteContext) {
  const { watchlistItemId } = await params
  const state = await getOnboardingState()
  const formData = await request.formData()

  try {
    await openPersonalHoldingFromWatchlist(state, watchlistItemId, {
      shares: formData.get('shares'),
      cost_basis_per_share: formData.get('cost_basis_per_share'),
      currency: formData.get('currency'),
      opened_at: formData.get('opened_at'),
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message.startsWith('Unknown watchlist item:')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof Error && error.message.startsWith('Watchlist item is not confirmed:')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && (
      error.message.startsWith('Holding shares')
      || error.message.startsWith('Holding currency')
      || error.message.startsWith('Cost basis')
      || error.message.startsWith('Opened date')
    )) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    throw error
  }

  redirect('/watchlist')
}
