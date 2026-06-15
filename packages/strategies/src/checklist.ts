// Phase 7 S1 — the pure, decision-NEUTRAL checklist completion evaluator.
//
// Given the human's answers, it reports ONLY which checklist items remain unaddressed and whether
// every item is addressed. It FORCES the question (which items are still open); it NEVER scores,
// counts, tallies, ranks, or weighs the answers, and a "risk present" answer never auto-rejects.
//
// LOAD-BEARING INVARIANT (mirrors the no-Kelly discipline): the return type is exactly
// { complete: boolean; unaddressed: string[] }. There is NO numeric field — no count, ratio, score,
// percentage, pass/fail-other-than-complete, or ranking — neither in the return shape NOR computed
// internally and discarded. The structure makes scoring unrepresentable. Do not add arithmetic over
// answers that feeds a verdict.
//
// Pure, deterministic, no I/O, no LLM. Iterates CHECKLIST_PARAMS.items so a newly-added item (a pure
// data edit in checklistParams.ts) is automatically required here — extensibility with no code change.

import { CHECKLIST_PARAMS, type ChecklistParams } from './checklistParams'

/**
 * One human answer to a checklist item. An item is "addressed" iff the human affirmed it AND wrote a
 * non-empty reasoned note — both are required (an empty note is treated as not addressed).
 */
export type ChecklistAnswer = {
  /** The human's explicit affirmation that they engaged with the question. */
  addressed: boolean
  /** The reasoned note. Must be non-empty (after trim) for the item to count as addressed. */
  note: string
}

/**
 * The completion result. DECISION-NEUTRAL by construction: `complete` says whether every item is
 * addressed; `unaddressed` lists the ids still open. NOTHING numeric — no count/score/ratio/verdict.
 */
export type ChecklistCompletion = {
  /** True iff every item in the checklist is addressed. */
  complete: boolean
  /** The ids of items that are not yet addressed (in checklist order). */
  unaddressed: string[]
}

/** An item is addressed iff the human affirmed it AND left a non-empty (trimmed) note. */
function isAddressed(answer: ChecklistAnswer | undefined): boolean {
  return answer?.addressed === true && answer.note.trim().length > 0
}

/**
 * Evaluates checklist completion against the answer set, decision-neutrally.
 *
 * @param answers map of item id → the human's answer (a missing id is treated as not addressed).
 * @param params  the checklist set to evaluate against (default CHECKLIST_PARAMS). Passing an extended
 *                params makes any newly-added item automatically required — extensibility.
 * @returns ONLY `{ complete, unaddressed }` — no numeric/score/tally field, by design.
 */
export function evaluateChecklistCompletion(
  answers: Record<string, ChecklistAnswer | undefined>,
  params: ChecklistParams = CHECKLIST_PARAMS,
): ChecklistCompletion {
  const unaddressed: string[] = []
  for (const item of params.items) {
    if (!isAddressed(answers[item.id])) {
      unaddressed.push(item.id)
    }
  }
  return { complete: unaddressed.length === 0, unaddressed }
}
