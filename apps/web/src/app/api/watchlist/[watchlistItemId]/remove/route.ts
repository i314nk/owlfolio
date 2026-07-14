import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { removePersonalWatchlistItem } from '../../../../../lib/workflow'

export type RemoveWatchlistItemRouteContext = {
  params: Promise<{ watchlistItemId: string }>
}

/**
 * POST — the human-authored watchlist prune (watchlist_item_pruned). The name leaves every active
 * view; the raw events remain the audit record. A held name is rejected — close the holding first.
 */
export async function POST(request: Request, { params }: RemoveWatchlistItemRouteContext) {
  const { watchlistItemId } = await params
  const state = await getOnboardingState()
  const formData = await request.formData()

  try {
    await removePersonalWatchlistItem(state, watchlistItemId, {
      reason: formData.get('reason'),
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message.startsWith('Unknown watchlist item:')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof Error && error.message.startsWith('Watchlist item is held:')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    throw error
  }

  redirect('/watchlist')
}
