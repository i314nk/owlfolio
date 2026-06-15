import type { ChecklistAnswer } from '@owlfolio/strategies/checklist'

/**
 * Shared request-parsing helpers for the re-underwrite sign-off routes (Phase 7 S3). BOTH the confirm and
 * the override routes are co-equal re-underwrite sign-offs gated on the SAME 17-item hygiene/bias checklist,
 * so they read the human's answers identically. DECISION-NEUTRAL: no scoring. We NEVER default/synthesize an
 * answer — an unaddressed item simply stays unaddressed and the server completion-block rejects it.
 */

/**
 * Coerce an arbitrary value into a human checklist answer map. Only well-formed
 * `{ addressed: boolean; note: string }` entries are kept.
 */
export function coerceChecklistAnswers(value: unknown): Record<string, ChecklistAnswer> {
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
 * Reassemble per-item form fields into a checklist-answer map. The re-underwrite forms post each item as
 * `checklist_note[<id>]` (the human's note) and `checklist_addressed[<id>]` (the affirmation checkbox). A
 * checkbox appears in the form data ONLY when checked.
 */
export function readChecklistFromForm(form: FormData): Record<string, ChecklistAnswer> {
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
