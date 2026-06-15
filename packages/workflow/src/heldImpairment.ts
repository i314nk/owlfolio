import { classifyAdmit, type ImpairmentCall, type RiskLevel } from './admitJudgment'

// ---------------------------------------------------------------------------
// Phase 6 S1 — the held-name entry point into the admit fixable-vs-permanent judgment.
//
// Phase 6 adds a "sell decision" operation for HELD positions. Its crux is a reconciliation: the
// 2–3 year minimum-hold guard must NOT fight the "thesis broke, sell" trigger. The reconciliation is
// that BOTH read the SAME fixable-vs-permanent judgment the admit layer already produces — the
// `impairment_call` — rather than the guard inventing a parallel clock-based test.
//
// This module is that single entry point: it re-runs the EXISTING admit classifier (classifyAdmit) on a
// held name's CURRENT facts. It carries NO new judgment math; delegation is identity. A held name that
// has re-impaired is judged by the very same forcing rule that gated its admit (permanent_loss_risk high
// ⇒ permanent_impairment, etc.), so "is this name now permanently impaired?" and "was it admittable?"
// can never drift apart.
// ---------------------------------------------------------------------------

// Re-export the admit judgment vocabulary so held-side consumers (the guard, the assembler) read the
// same RiskLevel / ImpairmentCall types without reaching back into admitJudgment.
export type { RiskLevel, ImpairmentCall }

/**
 * Re-runs the admit fixable-vs-permanent judgment on a HELD name's CURRENT facts. This is a thin
 * delegation to {@link classifyAdmit} — it returns EXACTLY what classifyAdmit returns for the same
 * inputs (no new judgment math). The minimum-hold guard reads the `impairment_call` from this result so
 * a broken-thesis sell and the hold-clock share one judgment instead of two competing ones.
 */
export function reassessHeldImpairment(args: {
  uncertainty: RiskLevel
  permanent_loss_risk: RiskLevel
  /** Did the research swarm say it's a good business (re-assessed on current facts)? */
  quality_verdict_passes: boolean
}): ReturnType<typeof classifyAdmit> {
  return classifyAdmit(args)
}
