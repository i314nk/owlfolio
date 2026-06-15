import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import type { ChecklistAnswer } from '@owlfolio/strategies/checklist'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { promoteResearchCaseToWatchlist } from '../../../../../lib/workflow'

export type PromoteToWatchlistRouteContext = {
  params: Promise<{ caseId: string }>
}

/**
 * Coerce an arbitrary value into a human checklist answer map. Only well-formed
 * `{ addressed: boolean; note: string }` entries are kept — DECISION-NEUTRAL, no scoring. The form posts
 * per-item `checklist_addressed[<id>]` / `checklist_note[<id>]` fields; programmatic JSON callers post a
 * `checklist_answers` object. We NEVER default/synthesize an answer here: an unaddressed item simply stays
 * unaddressed and the completion-block (in promoteResearchCaseToWatchlist) rejects it.
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
 * Reassemble per-item form fields into a checklist-answer map. The admit form posts each item as
 * `checklist_note[<id>]` (the human's note) and `checklist_addressed[<id>]` (the affirmation checkbox).
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
      // An HTML checkbox only appears in the form data when checked; its value is irrelevant.
      addressed.set(addressedMatch[1]!, true)
    }
  }
  const answers: Record<string, ChecklistAnswer> = {}
  for (const [id, note] of notes.entries()) {
    answers[id] = { addressed: addressed.get(id) === true, note }
  }
  return answers
}

type AdmitSubmission = {
  signedThesis: string
  checklistAnswers: Record<string, ChecklistAnswer>
}

/**
 * Read the human-typed `signed_thesis` AND the human checklist answers from a single request body read
 * (the body stream can only be consumed once). Both are REQUIRED on this path; neither is auto-filled.
 */
async function readAdmitSubmission(request: Request): Promise<AdmitSubmission> {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const body = (await request.json()) as unknown
      if (body !== null && typeof body === 'object') {
        const value = (body as { signed_thesis?: unknown }).signed_thesis
        return {
          signedThesis: typeof value === 'string' ? value : '',
          checklistAnswers: coerceChecklistAnswers((body as { checklist_answers?: unknown }).checklist_answers),
        }
      }
    } catch {
      return { signedThesis: '', checklistAnswers: {} }
    }
    return { signedThesis: '', checklistAnswers: {} }
  }

  const form = await request.formData()
  const value = form.get('signed_thesis')
  return {
    signedThesis: typeof value === 'string' ? value : '',
    checklistAnswers: readChecklistFromForm(form),
  }
}

export async function POST(request: Request, { params }: PromoteToWatchlistRouteContext) {
  const { caseId } = await params
  const state = await getOnboardingState()
  const { signedThesis, checklistAnswers } = await readAdmitSubmission(request)

  try {
    await promoteResearchCaseToWatchlist(state, caseId, signedThesis, checklistAnswers)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message.startsWith('A human-signed thesis is required')) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    // Completion-block: the hygiene/bias checklist was not fully addressed — 400 with the unaddressed ids.
    if (error instanceof Error && error.message.startsWith('The hygiene/bias checklist must be fully addressed')) {
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
