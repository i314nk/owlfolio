import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../../../lib/onboarding'
import { confirmPersonalHoldingReviewDraft } from '../../../../../../../lib/workflow'

export type ConfirmHoldingReviewRouteContext = {
  params: Promise<{ holdingId: string; reviewId: string }>
}

/**
 * Read the human's SINGLE input from one request-body read (the stream can only be consumed once): the
 * `cognitive_reflection_acknowledged` flag (audit-and-decide). Confirm APPLIES the provider draft, so there
 * is nothing else for the human to author. The human NEVER posts business findings — the server marshals
 * them at sign-off so a finding can't be authored or spoofed.
 */
async function readCognitiveAcknowledged(request: Request): Promise<boolean> {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const body = (await request.json()) as unknown
      if (body !== null && typeof body === 'object') {
        const ack = (body as { cognitive_reflection_acknowledged?: unknown }).cognitive_reflection_acknowledged
        // Accept `true` or the HTML checkbox-style 'on' for programmatic JSON callers.
        return ack === true || ack === 'on'
      }
    } catch {
      return false
    }
    return false
  }

  const form = await request.formData()
  // An HTML checkbox only appears in the form data (value 'on') when checked.
  return form.get('cognitive_reflection_acknowledged') === 'on'
}

export async function POST(request: Request, { params }: ConfirmHoldingReviewRouteContext) {
  const { holdingId, reviewId } = await params
  const state = await getOnboardingState()
  const cognitiveAcknowledged = await readCognitiveAcknowledged(request)

  try {
    await confirmPersonalHoldingReviewDraft(state, holdingId, reviewId, cognitiveAcknowledged)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    // Completion-block: the audit was not fully marshaled/acknowledged (in practice, the single cognitive
    // acknowledgement was missing) — 400 with the missing ids from confirmHoldingReviewDraft.
    if (error instanceof Error && error.message.startsWith('Re-underwrite sign-off requires')) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (error instanceof Error && error.message.startsWith('Unknown holding review draft:')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    throw error
  }

  redirect('/portfolio')
}
