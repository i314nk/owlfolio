import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../../../lib/onboarding'
import { overridePersonalHoldingReviewDraft } from '../../../../../../../lib/workflow'

type RouteContext = {
  params: Promise<{ holdingId: string; reviewId: string }>
}

/**
 * The override re-underwrite sign-off posts the human-authored thesis fields (their substitute judgment,
 * which stays) plus the SINGLE `cognitive_reflection_acknowledged` flag. We read the body ONCE (the stream
 * can only be consumed once): keep the authored fields AND the ack from the same read. The human NEVER posts
 * business findings — the server marshals them at sign-off so a finding can't be authored or spoofed.
 */
type OverrideRequestBody = {
  input: {
    thesis_health: FormDataEntryValue | null
    action_stance: FormDataEntryValue | null
    rationale: FormDataEntryValue | null
    evidence_summary: FormDataEntryValue | null
    uncertainty: FormDataEntryValue | null
    next_review_at: FormDataEntryValue | null
  }
  cognitiveAcknowledged: boolean
}

async function readOverrideRequest(request: Request): Promise<OverrideRequestBody> {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    let body: Record<string, unknown> = {}
    try {
      const parsed = (await request.json()) as unknown
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>
      }
    } catch {
      body = {}
    }
    const asString = (value: unknown): FormDataEntryValue | null => (typeof value === 'string' ? value : null)
    const ack = body['cognitive_reflection_acknowledged']
    return {
      input: {
        thesis_health: asString(body['thesis_health']),
        action_stance: asString(body['action_stance']),
        rationale: asString(body['rationale']),
        evidence_summary: asString(body['evidence_summary']),
        uncertainty: asString(body['uncertainty']),
        next_review_at: asString(body['next_review_at']),
      },
      // Accept `true` or the HTML checkbox-style 'on' for programmatic JSON callers.
      cognitiveAcknowledged: ack === true || ack === 'on',
    }
  }

  const formData = await request.formData()
  return {
    input: {
      thesis_health: formData.get('thesis_health'),
      action_stance: formData.get('action_stance'),
      rationale: formData.get('rationale'),
      evidence_summary: formData.get('evidence_summary'),
      uncertainty: formData.get('uncertainty'),
      next_review_at: formData.get('next_review_at'),
    },
    // An HTML checkbox only appears in the form data (value 'on') when checked.
    cognitiveAcknowledged: formData.get('cognitive_reflection_acknowledged') === 'on',
  }
}

export async function POST(request: Request, context: RouteContext) {
  const state = await getOnboardingState()
  const { holdingId, reviewId } = await context.params
  const { input, cognitiveAcknowledged } = await readOverrideRequest(request)

  try {
    await overridePersonalHoldingReviewDraft(state, holdingId, reviewId, input, cognitiveAcknowledged)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to override holding review' }, { status: 400 })
  }

  redirect('/portfolio')
}
