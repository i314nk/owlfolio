import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import type { ChecklistAnswer } from '@owlfolio/strategies/checklist'

import { getOnboardingState } from '../../../../../../../lib/onboarding'
import {
  coerceChecklistAnswers,
  readChecklistFromForm,
} from '../../../../../../../lib/holdingReviewChecklistRequest'
import { confirmPersonalHoldingReviewDraft } from '../../../../../../../lib/workflow'

export type ConfirmHoldingReviewRouteContext = {
  params: Promise<{ holdingId: string; reviewId: string }>
}

/**
 * Read the human checklist answers from a single request body read (the body stream can only be consumed
 * once). The form posts per-item fields; programmatic JSON callers post a `checklist_answers` object.
 */
async function readChecklistAnswers(request: Request): Promise<Record<string, ChecklistAnswer>> {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const body = (await request.json()) as unknown
      if (body !== null && typeof body === 'object') {
        return coerceChecklistAnswers((body as { checklist_answers?: unknown }).checklist_answers)
      }
    } catch {
      return {}
    }
    return {}
  }

  const form = await request.formData()
  return readChecklistFromForm(form)
}

export async function POST(request: Request, { params }: ConfirmHoldingReviewRouteContext) {
  const { holdingId, reviewId } = await params
  const state = await getOnboardingState()
  const checklistAnswers = await readChecklistAnswers(request)

  try {
    await confirmPersonalHoldingReviewDraft(state, holdingId, reviewId, checklistAnswers)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    // Completion-block: the hygiene/bias checklist was not fully addressed — 400 with the unaddressed ids.
    if (error instanceof Error && error.message.startsWith('Re-underwrite sign-off requires every quality/bias checklist item to be addressed')) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (error instanceof Error && error.message.startsWith('Unknown holding review draft:')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    throw error
  }

  redirect('/portfolio')
}
