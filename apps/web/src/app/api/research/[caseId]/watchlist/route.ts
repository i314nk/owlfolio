import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { promoteResearchCaseToWatchlist } from '../../../../../lib/workflow'

export type PromoteToWatchlistRouteContext = {
  params: Promise<{ caseId: string }>
}

type AdmitSubmission = {
  signedThesis: string
  /** The human's SINGLE cognitive-reflection acknowledgement (audit-and-decide). */
  cognitiveAcknowledged: boolean
}

/**
 * Read the human's two inputs from a single request-body read (the body stream can only be consumed once):
 * the final `signed_thesis` (affirmed-or-amended from the pre-filled draft) and the single
 * `cognitive_reflection_acknowledged` flag. The human NEVER posts business findings — the server marshals
 * them at sign-off so a finding can't be authored or spoofed.
 */
async function readAdmitSubmission(request: Request): Promise<AdmitSubmission> {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const body = (await request.json()) as unknown
      if (body !== null && typeof body === 'object') {
        const thesis = (body as { signed_thesis?: unknown }).signed_thesis
        const ack = (body as { cognitive_reflection_acknowledged?: unknown }).cognitive_reflection_acknowledged
        return {
          signedThesis: typeof thesis === 'string' ? thesis : '',
          // Accept `true` or the HTML checkbox-style 'on' for programmatic JSON callers.
          cognitiveAcknowledged: ack === true || ack === 'on',
        }
      }
    } catch {
      return { signedThesis: '', cognitiveAcknowledged: false }
    }
    return { signedThesis: '', cognitiveAcknowledged: false }
  }

  const form = await request.formData()
  const thesis = form.get('signed_thesis')
  // An HTML checkbox only appears in the form data (value 'on') when checked.
  return {
    signedThesis: typeof thesis === 'string' ? thesis : '',
    cognitiveAcknowledged: form.get('cognitive_reflection_acknowledged') === 'on',
  }
}

export async function POST(request: Request, { params }: PromoteToWatchlistRouteContext) {
  const { caseId } = await params
  const state = await getOnboardingState()
  const { signedThesis, cognitiveAcknowledged } = await readAdmitSubmission(request)

  try {
    await promoteResearchCaseToWatchlist(state, caseId, signedThesis, cognitiveAcknowledged)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message.startsWith('A human-signed thesis is required')) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    // Completion-block (audit-and-decide): the audit was not fully marshaled/acknowledged (in practice, the
    // single cognitive acknowledgement was missing) — 400 with the missing ids from confirmWatchlistDraft.
    if (error instanceof Error && error.message.startsWith('Watchlist admit requires a complete audit')) {
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
