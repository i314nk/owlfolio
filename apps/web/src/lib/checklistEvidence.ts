// ---------------------------------------------------------------------------
// Phase 7 S4 — the EVIDENCE READ-LAYER (reads-only; NEVER recomputes).
//
// For each BUSINESS checklist item that carries a `reads` hint (a dotted path into the persisted
// research-case projection), marshal the value at that path beside the item so the human reads grounded
// evidence before affirming. This is a PURE read of the already-persisted projection: it resolves the
// `reads` path and formats the value. It calls NO valuation / cluster / shariah engine — the work was
// done upstream and persisted; here we only surface it.
//
// Cognitive items have no `reads` field and are deliberately evidence-free (human-only, introspective).
// A business item whose projected value is ABSENT yields NO entry — we never fabricate evidence.
//
// LOAD-BEARING DISCIPLINE: this layer is decision-NEUTRAL. It surfaces a value; it does not score, rank,
// or pass/fail anything. The human still affirms each item.
// ---------------------------------------------------------------------------

import { CHECKLIST_PARAMS, listBusinessItems } from '@owlfolio/strategies/checklistParams'
import type { ResearchCaseProjection } from '@owlfolio/ledger/projections/researchCaseProjection'

/** Resolve a dotted path (e.g. 'valuation.growth_window_years') against the projection. Pure read. */
function readPath(source: unknown, path: string): unknown {
  let current: unknown = source
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** Format a marshaled projection value for read-only display. Objects render compactly; absent → undefined. */
function formatEvidence(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined
  if (typeof value === 'string') return value.length > 0 ? value : undefined
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (Array.isArray(value)) return value.length > 0 ? value.map((v) => String(v)).join(', ') : undefined
  // A structured field (e.g. the owner-earnings bridge): render a compact JSON snapshot so the human can
  // read the persisted shape without us interpreting (no scoring/derivation).
  try {
    const json = JSON.stringify(value)
    return json !== undefined && json !== '{}' ? json : undefined
  } catch {
    return undefined
  }
}

/**
 * Build the per-item evidence map: businessItemId -> displayValue, for every business item whose `reads`
 * path resolves to a present value in the projection. Cognitive items (no `reads`) and items with an
 * absent projected value are omitted. Pure read of the projection — NO engine call.
 */
export function resolveChecklistEvidence(
  projection: ResearchCaseProjection | undefined,
): Record<string, string> {
  const evidence: Record<string, string> = {}
  if (projection === undefined) return evidence
  for (const item of CHECKLIST_PARAMS.items) {
    if (item.reads === undefined) continue // cognitive items + non-groundable business items: no evidence.
    const display = formatEvidence(readPath(projection, item.reads))
    if (display !== undefined) evidence[item.id] = display
  }
  return evidence
}

const QUALITATIVE_FINDING =
  'Qualitative — no automated metric; audit against the signed thesis and research brief.'
const GROUNDED_ABSENT_FINDING = 'No grounded value available in this case.'

/**
 * One marshaled finding per BUSINESS item (read-only audit surface).
 * - groundable (`reads` set) + value present → formatted value
 * - groundable + value absent → honest "no grounded value" (never fabricated)
 * - non-groundable (no `reads`) → qualitative pointer to the thesis/research
 * Cognitive items are intentionally excluded (the agent must not author them).
 */
/**
 * Derive the agent-drafted thesis the human audits at admission (audit-and-decide). This is the SAME
 * draft the admit command persists as `signed_thesis_draft`, computed in ONE place so the pre-filled
 * form textarea, the server's persisted draft, and the affirm-vs-amend provenance all agree. Pure read of
 * the projection — no engine call.
 */
export function resolveAdmissionThesisDraft(
  projection: ResearchCaseProjection | undefined,
): string {
  const ticker = projection?.ticker ?? projection?.company_id ?? projection?.research_case_id ?? 'this name'
  const reason = projection?.reason
  if (reason !== undefined && reason.trim().length > 0) {
    return `Watch ${ticker}: ${reason}`
  }
  const nextAction = projection?.next_required_action
  if (nextAction !== undefined && nextAction.trim().length > 0) {
    return nextAction
  }
  const decision = projection?.decision
  return `Watch ${ticker} after drafted decision ${decision ?? 'WATCH'}`
}

export function resolveBusinessFindings(
  projection: ResearchCaseProjection | undefined,
): Record<string, string> {
  const findings: Record<string, string> = {}
  for (const item of listBusinessItems()) {
    if (item.reads === undefined) {
      findings[item.id] = QUALITATIVE_FINDING
      continue
    }
    const value = readPath(projection, item.reads)
    const formatted = value === undefined ? undefined : formatEvidence(value)
    findings[item.id] =
      formatted !== undefined && formatted.length > 0 ? formatted : GROUNDED_ABSENT_FINDING
  }
  return findings
}
