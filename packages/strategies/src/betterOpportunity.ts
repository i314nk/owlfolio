// Phase 6 S4 — the "better opportunity under capital constraint" sell trigger (pure, deterministic, no
// I/O, no LLM).
//
// One of the four Phase-6 sell triggers, and the most CHURN-PRONE: you'd sell a held name only to FUND a
// materially better one. Buffett/Pabrai: "patient holding dies by a thousand switches" — every switch
// pays taxes + spreads (friction) AND rests on a comparative judgment that is easy to get wrong. Two
// design choices fall out of that:
//
//   1. HIGH HURDLE. A candidate must beat the held name by a large NET owner-earnings-yield margin
//      (better_opportunity_min_margin, default 0.05) AFTER switching friction. The friction (taxes /
//      spreads expressed as a yield-equivalent drag) REDUCES the effective margin, so a thin edge that
//      the friction eats never warrants a switch. Every constant is read from SELL_PARAMS (no magic
//      numbers).
//
//   2. ALWAYS HUMAN SIGN-OFF, NEVER MECHANICAL. `requires_human_signoff` is the LITERAL `true` in both
//      the return TYPE and the return VALUE, on EVERY return shape — there is deliberately no
//      mechanical-switch path. Clearing the hurdle (`switch_warranted: true`) is a NECESSARY precondition,
//      not sufficient: it surfaces a candidate for a human comparative decision, it does not authorize a
//      sale. Encoding sign-off as a structural literal (rather than a runtime boolean that could be
//      computed to `false`) makes "this trigger is never automatic" unrepresentable-otherwise at the type
//      level.

import { SELL_PARAMS, type SellParams } from './sellParams'

/**
 * Result of the better-opportunity evaluation.
 *
 * `requires_human_signoff` is typed as the literal `true` (not `boolean`) on purpose: this trigger is
 * NEVER mechanical, so the field cannot structurally be anything but `true`. See the module header (2).
 */
export type BetterOpportunityResult = {
  /**
   * True IFF the NET margin clears the configured hurdle. NOTE: this is a precondition for surfacing a
   * switch to a human — it is NOT authorization. `requires_human_signoff` is always true regardless.
   */
  switch_warranted: boolean
  /** The NET margin: `candidate_oe_yield - held_oe_yield - switching_friction` (friction reduces it). */
  margin: number
  /** Structurally always `true` — the switch is never mechanical and always needs a human decision. */
  requires_human_signoff: true
  /** Human-readable reason: whether the hurdle cleared and by how much, plus the always-sign-off note. */
  reason: string
}

/**
 * Evaluate the "better opportunity under capital constraint" sell trigger.
 *
 * @param held_oe_yield       Owner-earnings yield of the currently HELD name.
 * @param candidate_oe_yield  Owner-earnings yield of the candidate name being considered to fund the
 *                            switch.
 * @param switching_friction  Taxes/spreads expressed as a yield-equivalent DRAG; REDUCES the effective
 *                            margin (so a thin gross edge eaten by friction never warrants a switch).
 * @param params              Sell parameter set (defaults to SELL_PARAMS); `better_opportunity_min_margin`
 *                            is the hurdle.
 *
 *   margin           = candidate_oe_yield - held_oe_yield - switching_friction
 *   switch_warranted = margin >= params.better_opportunity_min_margin
 *
 * `requires_human_signoff` is the literal `true` on EVERY return — there is no mechanical-switch path.
 */
export function evaluateBetterOpportunity({
  held_oe_yield,
  candidate_oe_yield,
  switching_friction,
  params = SELL_PARAMS,
}: {
  held_oe_yield: number
  candidate_oe_yield: number
  switching_friction: number
  params?: SellParams
}): BetterOpportunityResult {
  // Friction REDUCES the effective margin: the gross yield pickup must survive the tax/spread drag.
  const margin = candidate_oe_yield - held_oe_yield - switching_friction
  const switch_warranted = margin >= params.better_opportunity_min_margin

  const reason = switch_warranted
    ? `Candidate beats the held name by a NET ${(margin * 100).toFixed(1)} yield points after friction `
      + `(${(switching_friction * 100).toFixed(1)} pts), clearing the high hurdle of `
      + `${(params.better_opportunity_min_margin * 100).toFixed(1)} pts — switch warranted, but human `
      + 'sign-off is ALWAYS required (this trigger is never mechanical).'
    : `Candidate's NET margin of ${(margin * 100).toFixed(1)} yield points after friction `
      + `(${(switching_friction * 100).toFixed(1)} pts) is below the high hurdle of `
      + `${(params.better_opportunity_min_margin * 100).toFixed(1)} pts — switch not warranted (the edge `
      + 'does not justify the churn). Human sign-off would in any case be required.'

  return {
    switch_warranted,
    margin,
    // Literal true on every return: this trigger is never mechanical (see module header).
    requires_human_signoff: true,
    reason,
  }
}
