import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { promoteResearchCaseToWatchlist } from '../../../../../lib/workflow'

export type PromoteToWatchlistRouteContext = {
  params: Promise<{ caseId: string }>
}

/**
 * Read the human-typed `signed_thesis` from the request. The admit control posts a normal HTML form,
 * so the thesis arrives as form-encoded data; we also accept JSON for programmatic callers. The thesis
 * is REQUIRED — there is no auto-fallback to the agent draft (Task 4.3); a missing one is rejected by
 * `promoteResearchCaseToWatchlist`.
 */
async function readSignedThesis(request: Request): Promise<string> {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const body = (await request.json()) as unknown
      if (body !== null && typeof body === 'object' && 'signed_thesis' in body) {
        const value = (body as { signed_thesis: unknown }).signed_thesis
        return typeof value === 'string' ? value : ''
      }
    } catch {
      return ''
    }
    return ''
  }

  const form = await request.formData()
  const value = form.get('signed_thesis')
  return typeof value === 'string' ? value : ''
}

export async function POST(request: Request, { params }: PromoteToWatchlistRouteContext) {
  const { caseId } = await params
  const state = await getOnboardingState()
  const signedThesis = await readSignedThesis(request)

  try {
    await promoteResearchCaseToWatchlist(state, caseId, signedThesis)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message.startsWith('A human-signed thesis is required')) {
      return NextResponse.json({ error: error.message }, { status: 400 })
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
