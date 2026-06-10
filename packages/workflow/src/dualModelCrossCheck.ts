// model-tiering-spec "Dual-Model Cross-Check (high-stakes classifications only)".
//
// For MOAT CLASS and SHARIAH SECTOR STATUS only: when the registry configures a DISTINCT cross-check
// model for that role, run the classification twice (two different models) and compare:
//   - Agreement  → proceed with confidence noted (crosscheck.agreed = true).
//   - Disagreement → automatic escalation to a human; the CONSERVATIVE answer (lower moat tier /
//                    stricter Shariah status) HOLDS in the meantime, and requires_human_escalation is
//                    flagged (appended to open_questions by the orchestrator).
// "Don't extend this everywhere — it doubles cost for components where the harness defenses already
// suffice." OFF by default: no distinct cross-check model configured → the orchestrator never calls
// this and runs a single classification, unchanged.
//
// This module is the PURE comparison + a thin wiring resolver (the live classifier is injected), so the
// agreement/disagreement/degrade logic is unit-tested with stubs — no provider calls here.

export type MoatClass = 'narrow' | 'moderate' | 'wide' | 'monopoly'
export type ShariahSectorStatus = 'compliant' | 'conditional' | 'non_compliant'
export type CrossCheckClassification = MoatClass | ShariahSectorStatus

/** Moat tiers, most conservative → most aggressive. Conservative = LOWER index. */
const MOAT_ORDER: MoatClass[] = ['narrow', 'moderate', 'wide', 'monopoly']
/** Shariah statuses, least → most strict. Conservative = MORE strict (higher index). */
const SHARIAH_STRICTNESS: ShariahSectorStatus[] = ['compliant', 'conditional', 'non_compliant']

export type ComparisonResult<T> = {
  agreed: boolean
  /** The conservative answer that HOLDS on disagreement (or the agreed value on agreement). */
  conservative: T
}

/** Compare two moat classifications; conservative = the LOWER tier. */
export function compareMoatClass(a: MoatClass, b: MoatClass): ComparisonResult<MoatClass> {
  const ia = MOAT_ORDER.indexOf(a)
  const ib = MOAT_ORDER.indexOf(b)
  const conservative = ia <= ib ? a : b
  return { agreed: a === b, conservative }
}

/** Compare two Shariah sector statuses; conservative = the STRICTER status. */
export function compareShariahSectorStatus(a: ShariahSectorStatus, b: ShariahSectorStatus): ComparisonResult<ShariahSectorStatus> {
  const ia = SHARIAH_STRICTNESS.indexOf(a)
  const ib = SHARIAH_STRICTNESS.indexOf(b)
  const conservative = ia >= ib ? a : b
  return { agreed: a === b, conservative }
}

export type CrossCheckDimension = 'moat_class' | 'shariah_sector_status'

export type ResolveCrossCheckArgs<T extends CrossCheckClassification> = {
  dimension: CrossCheckDimension
  /** The primary model's classification (already produced by the main lane/synthesis). */
  primary: T
  primaryModel: string
  crossCheckModel: string
  /** Run the SECOND (cross-check) model's classification. Injected; may throw (→ degrade). */
  runCrossCheck: () => Promise<T>
  compare: (a: T, b: T) => ComparisonResult<T>
}

export type CrossCheckLayer = {
  models: [string, string]
  /** undefined when the cross-check run degraded (failed) before a comparison could be made. */
  agreed?: boolean
  primary?: CrossCheckClassification
  crosscheck?: CrossCheckClassification
}

export type ResolveCrossCheckResult<T extends CrossCheckClassification> = {
  /** true: the cross-check was attempted (a distinct model was configured). */
  ran: boolean
  /** The value that HOLDS: agreed value, conservative-on-disagreement, or primary-on-degrade. */
  value: T
  crosscheck?: CrossCheckLayer
  requires_human_escalation: boolean
  /** Set on disagreement — surfaced to open_questions by the orchestrator. */
  escalation_note?: string
  /** Set when the cross-check run failed (degraded) — primary holds; gap surfaced, NOT an escalation. */
  degraded_note?: string
}

/**
 * Run the cross-check classification, compare, and resolve the held value + escalation. The live
 * classifier (`runCrossCheck`) is injected. A throw degrades (primary holds, gap surfaced, no false
 * escalation — a failed run is not a disagreement). Agreement proceeds; disagreement takes the
 * conservative answer and flags human escalation.
 */
export async function resolveCrossCheck<T extends CrossCheckClassification>(
  args: ResolveCrossCheckArgs<T>,
): Promise<ResolveCrossCheckResult<T>> {
  const models: [string, string] = [args.primaryModel, args.crossCheckModel]
  let second: T
  try {
    second = await args.runCrossCheck()
  } catch (error) {
    return {
      ran: true,
      value: args.primary,
      crosscheck: { models, primary: args.primary },
      requires_human_escalation: false,
      degraded_note:
        `dual_model_crosscheck_degraded: the ${args.dimension} cross-check run on ${args.crossCheckModel} `
        + `did not complete (${error instanceof Error ? error.message : String(error)}); the primary `
        + `${args.primaryModel} classification (${args.primary}) holds un-cross-checked.`,
    }
  }

  const comparison = args.compare(args.primary, second)
  const crosscheck: CrossCheckLayer = { models, agreed: comparison.agreed, primary: args.primary, crosscheck: second }
  if (comparison.agreed) {
    return { ran: true, value: args.primary, crosscheck, requires_human_escalation: false }
  }
  return {
    ran: true,
    value: comparison.conservative,
    crosscheck,
    requires_human_escalation: true,
    escalation_note:
      `dual_model_crosscheck_disagreement: ${args.dimension} disagreement — ${args.primaryModel} said `
      + `'${args.primary}', ${args.crossCheckModel} said '${second}'. The conservative answer `
      + `('${comparison.conservative}') holds pending human review (automatic escalation).`,
  }
}
