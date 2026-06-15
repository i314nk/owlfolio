import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import type { ChecklistAnswer } from '@owlfolio/strategies/checklist'

import { getOnboardingState } from '../../../../../../../lib/onboarding'
import {
  coerceChecklistAnswers,
  readChecklistFromForm,
} from '../../../../../../../lib/holdingReviewChecklistRequest'
import { overridePersonalHoldingReviewDraft } from '../../../../../../../lib/workflow'

type RouteContext = {
  params: Promise<{ holdingId: string; reviewId: string }>
}

/**
 * The override re-underwrite sign-off form posts the four required thesis fields. We read the body ONCE (the
 * stream can only be consumed once): keep the thesis fields AND the per-item checklist answers from the same
 * read. The checklist gates the override identically to confirm (Phase 7 S3 bypass close).
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
  checklistAnswers: Record<string, ChecklistAnswer>
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
    return {
      input: {
        thesis_health: asString(body['thesis_health']),
        action_stance: asString(body['action_stance']),
        rationale: asString(body['rationale']),
        evidence_summary: asString(body['evidence_summary']),
        uncertainty: asString(body['uncertainty']),
        next_review_at: asString(body['next_review_at']),
      },
      checklistAnswers: coerceChecklistAnswers(body['checklist_answers']),
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
    checklistAnswers: readChecklistFromForm(formData),
  }
}

export async function POST(request: Request, context: RouteContext) {
  const state = await getOnboardingState()
  const { holdingId, reviewId } = await context.params
  const { input, checklistAnswers } = await readOverrideRequest(request)

  try {
    await overridePersonalHoldingReviewDraft(state, holdingId, reviewId, input, checklistAnswers)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to override holding review' }, { status: 400 })
  }

  redirect('/portfolio')
}
