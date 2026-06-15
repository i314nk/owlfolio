import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import type { ChecklistAnswer } from '@owlfolio/strategies/checklist'

import { getOnboardingState } from '../../../../../../../lib/onboarding'
import { confirmPersonalHoldingReviewDraft } from '../../../../../../../lib/workflow'

export type ConfirmHoldingReviewRouteContext = {
  params: Promise<{ holdingId: string; reviewId: string }>
}

/**
 * Coerce an arbitrary value into a human checklist answer map. Only well-formed
 * `{ addressed: boolean; note: string }` entries are kept — DECISION-NEUTRAL, no scoring. We NEVER
 * default/synthesize an answer here: an unaddressed item simply stays unaddressed and the completion-block
 * (in confirmPersonalHoldingReviewDraft) rejects it.
 */
function coerceChecklistAnswers(value: unknown): Record<string, ChecklistAnswer> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const answers: Record<string, ChecklistAnswer> = {}
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      continue
    }
    const addressed = (entry as { addressed?: unknown }).addressed
    const note = (entry as { note?: unknown }).note
    if (typeof addressed === 'boolean' && typeof note === 'string') {
      answers[id] = { addressed, note }
    }
  }
  return answers
}

/**
 * Reassemble per-item form fields into a checklist-answer map. The re-underwrite confirm form posts each
 * item as `checklist_note[<id>]` (the human's note) and `checklist_addressed[<id>]` (the affirmation
 * checkbox). A checkbox appears in the form data ONLY when checked.
 */
function readChecklistFromForm(form: FormData): Record<string, ChecklistAnswer> {
  const notes = new Map<string, string>()
  const addressed = new Map<string, boolean>()
  for (const [key, value] of form.entries()) {
    const noteMatch = /^checklist_note\[(.+)\]$/.exec(key)
    if (noteMatch !== null && typeof value === 'string') {
      notes.set(noteMatch[1]!, value)
      continue
    }
    const addressedMatch = /^checklist_addressed\[(.+)\]$/.exec(key)
    if (addressedMatch !== null) {
      addressed.set(addressedMatch[1]!, true)
    }
  }
  const answers: Record<string, ChecklistAnswer> = {}
  for (const [id, note] of notes.entries()) {
    answers[id] = { addressed: addressed.get(id) === true, note }
  }
  return answers
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
