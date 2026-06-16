// Phase 7 — the pure, decision-NEUTRAL completion engine for the audit-and-decide sign-off.
//
// The sign-off is INVERTED: the harness marshals one business finding per business item, and the human
// makes a single acknowledgement that they reflected on the 6 cognitive bias prompts. This engine
// reports ONLY what still blocks the decision and whether the audit is complete. It FORCES the question
// (which findings/acks are still open); it NEVER scores, counts, tallies, ranks, or weighs anything, and
// a "risk present" finding never auto-rejects.
//
// LOAD-BEARING INVARIANT (mirrors the no-Kelly discipline): the return type is exactly
// { complete: boolean; missing: string[] }. There is NO numeric field — no count, ratio, score,
// percentage, pass/fail-other-than-complete, or ranking — neither in the return shape NOR computed
// internally and discarded. The structure makes scoring unrepresentable. Do not add arithmetic over the
// audit that feeds a verdict.
//
// Pure, deterministic, no I/O, no LLM. Iterates the business items of CHECKLIST_PARAMS so a newly-added
// business item (a pure data edit in checklistParams.ts) is automatically required here — extensibility
// with no code change.

import {
  CHECKLIST_PARAMS,
  listBusinessItems,
  type ChecklistAudit,
  type ChecklistParams,
} from './checklistParams'

/**
 * One human answer to a checklist item, retained for compatibility with not-yet-migrated callers.
 *
 * NOTE: this answers-based shape is the OLD sign-off model (the human authored every field). It is
 * preserved only so downstream slices (workflow payloads, projections, forms, routes) keep compiling
 * until they migrate to the audit-and-decide model. The completion engine below no longer consumes it.
 */
export type ChecklistAnswer = {
  /** The human's explicit affirmation that they engaged with the question. */
  addressed: boolean
  /** The reasoned note. Must be non-empty (after trim) for the item to count as addressed. */
  note: string
}

/**
 * The completion result. DECISION-NEUTRAL by construction: `complete` says whether the audit is fully
 * marshaled and acknowledged; `missing` lists what still blocks the decision. NOTHING numeric — no
 * count/score/ratio/verdict.
 */
export type ChecklistCompletion = {
  /** True iff every business item has a finding AND the human acknowledged the cognitive reflection. */
  complete: boolean
  /**
   * The blockers still open, in business-item order: business item ids lacking a finding, plus the
   * sentinel `cognitive_acknowledgement` if the human has not acknowledged the cognitive reflection.
   */
  missing: string[]
}

/** Sentinel pushed into `missing` when the human has not acknowledged the cognitive reflection. */
const COGNITIVE_ACK_SENTINEL = 'cognitive_acknowledgement'

/** A business item is satisfied iff its marshaled finding is a non-empty (trimmed) string. */
function hasFinding(findings: Record<string, string>, id: string): boolean {
  const value = findings[id]
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Decision-neutral completion of the audit-and-decide checklist.
 *
 * Complete IFF every business item has a non-empty marshaled finding AND the human acknowledged the
 * cognitive reflection. No scoring/tally — `missing` simply lists what blocks the decision.
 *
 * @param audit  the harness-authored audit captured at sign-off.
 * @param params the checklist set to evaluate against (default CHECKLIST_PARAMS). Passing an extended
 *               params makes any newly-added business item automatically required — extensibility.
 * @returns ONLY `{ complete, missing }` — no numeric/score/tally field, by design.
 */
export function evaluateChecklistCompletion(
  audit: ChecklistAudit,
  params: ChecklistParams = CHECKLIST_PARAMS,
): ChecklistCompletion {
  const missing: string[] = []
  for (const item of listBusinessItems(params)) {
    if (!hasFinding(audit.business_findings, item.id)) missing.push(item.id)
  }
  if (audit.cognitive_acknowledged !== true) missing.push(COGNITIVE_ACK_SENTINEL)
  return { complete: missing.length === 0, missing }
}
