// Phase 6 S5 — Munger-style bias-hygiene guards (pure, deterministic, no I/O, no LLM).
//
// These ATTACH ADVISORY CAVEATS to a sell recommendation — they NEVER block or change the decision. The
// actual blocking brake is the SEPARATE minimum-hold guard (S2, applyMinimumHoldGuard). A caveat is a
// "look harder before you pull the trigger" note for a human, not a verdict; these are the seeds of the
// Phase-7 bias checklist. Two biases, one guard each:
//
//   1. DISPOSITION EFFECT — selling a holding at a LOSS when the problem is FIXABLE/TEMPORARY. That is
//      loss-driven impatience: bailing into pessimism on a name that isn't actually impaired. A clean
//      impairment sell (permanent_impairment) is NOT the disposition effect, and an `unresolved` call is
//      already escalated to a human elsewhere, so neither raises a caveat here.
//
//   2. PURCHASE-PRICE ANCHORING — justifying a sell by reference to the COST BASIS (what you paid) rather
//      than to INTRINSIC VALUE. The caveat fires when the rationale's reference value hugs the cost basis
//      instead of IV — and only when cost and IV are meaningfully distinguishable (if cost ≈ IV we can't
//      tell anchoring from sound reasoning, so we FAIL-SAFE to no caveat rather than raise a false flag).
//
// Each guard returns `{ caveat: SellBiasCaveat | null }` (null = no concern). There is deliberately NO
// decision/verdict field on the return shape: these guards cannot block.

import type { ImpairmentCall } from './minimumHoldGuard'

/**
 * An advisory bias caveat attached to a sell recommendation. It carries NO verdict — it only names a
 * cognitive-bias risk for a human to weigh. The presence of a caveat never blocks or changes a sell.
 */
export type SellBiasCaveat = {
  kind: 'disposition' | 'anchoring'
  message: string
}

/**
 * Evaluate the DISPOSITION-EFFECT guard.
 *
 * @param at_loss          True when the candidate sale would realize a loss vs the cost basis.
 * @param impairment_call  The upstream fixable-vs-permanent judgment (consumed, never recomputed here).
 *
 * Caveat present IFF `at_loss === true && impairment_call === 'fixable_temporary'` — selling at a loss on a
 * problem judged fixable/temporary is the classic disposition effect (loss-driven impatience). All other
 * cases → null: not at a loss (no loss to be impatient about); `permanent_impairment` (a clean impairment
 * sell, not the bias); `unresolved` (already escalated to a human elsewhere — not this guard's concern).
 */
export function evaluateDispositionGuard({
  at_loss,
  impairment_call,
}: {
  at_loss: boolean
  impairment_call: ImpairmentCall
}): { caveat: SellBiasCaveat | null } {
  if (at_loss && impairment_call === 'fixable_temporary') {
    return {
      caveat: {
        kind: 'disposition',
        message:
          'Possible disposition effect: this is a loss sale on a problem judged fixable/temporary — '
          + 'selling here may be loss-driven impatience (bailing into pessimism on a name that is not '
          + 'actually impaired). Confirm the thesis really is broken before selling at a loss.',
      },
    }
  }

  return { caveat: null }
}

/**
 * Relative tolerance for treating the cost basis and the frozen IV as INDISTINGUISHABLE. When the gap
 * between cost and IV is within this fraction of the IV, "the proposed basis is near cost" carries no
 * signal (near-cost ≈ near-IV), so the anchoring guard fails SAFE to no caveat rather than flag. 2% is a
 * small relative band: large enough to absorb rounding/near-ties (e.g. cost 100 vs IV 100.5), small enough
 * not to swallow genuine cost-vs-IV separation.
 */
const ANCHORING_INDISTINGUISHABLE_REL_TOLERANCE = 0.02

/**
 * Evaluate the PURCHASE-PRICE ANCHORING guard.
 *
 * @param proposed_basis         The reference value the sell rationale leans on (the number the argument
 *                               for selling is anchored to).
 * @param cost_basis_per_share   What the position was bought at (the purchase price).
 * @param frozen_iv              The sign-off-frozen intrinsic value per share. Undefined/≤0 → null (we
 *                               can't assess anchoring without a usable IV — fail-safe).
 *
 * Caveat present IFF ALL of:
 *   - `frozen_iv` is defined and `> 0`, AND
 *   - cost and IV are meaningfully distinguishable (`|cost - IV|` exceeds a small relative tolerance of
 *     IV — if cost ≈ IV we can't tell anchoring from sound reasoning, so no caveat), AND
 *   - the proposed basis is at least as close to the cost basis as to IV:
 *     `|proposed - cost| <= |proposed - IV|`.
 *
 * In words: the sell reasons from the PURCHASE PRICE rather than from INTRINSIC VALUE. Fail-safe in every
 * ambiguous case — this guard never raises a false flag.
 */
export function evaluateAnchoringGuard({
  proposed_basis,
  cost_basis_per_share,
  frozen_iv,
}: {
  proposed_basis: number
  cost_basis_per_share: number
  frozen_iv: number | undefined
}): { caveat: SellBiasCaveat | null } {
  // FAIL-SAFE: no usable frozen IV → can't assess anchoring → no caveat.
  if (frozen_iv === undefined || !Number.isFinite(frozen_iv) || frozen_iv <= 0) {
    return { caveat: null }
  }

  // FAIL-SAFE: if cost and IV collapse onto each other, "near cost" carries no signal — no caveat.
  const costIvGap = Math.abs(cost_basis_per_share - frozen_iv)
  if (costIvGap <= ANCHORING_INDISTINGUISHABLE_REL_TOLERANCE * frozen_iv) {
    return { caveat: null }
  }

  const nearerCostThanIv =
    Math.abs(proposed_basis - cost_basis_per_share) <= Math.abs(proposed_basis - frozen_iv)
  if (nearerCostThanIv) {
    return {
      caveat: {
        kind: 'anchoring',
        message:
          'Possible purchase-price anchoring: the sell reasons from the cost basis '
          + `(${cost_basis_per_share}) rather than from intrinsic value (${frozen_iv}). Re-anchor the `
          + 'decision on intrinsic value, not on what you paid.',
      },
    }
  }

  return { caveat: null }
}

/**
 * Convenience combiner for S6: run both bias guards over a single sell candidate and return the caveats
 * that fired (disposition first, then anchoring). Order is stable; an empty array means no bias concerns.
 * This is purely advisory aggregation — it carries no verdict and blocks nothing.
 */
export function collectSellBiasCaveats({
  at_loss,
  impairment_call,
  proposed_basis,
  cost_basis_per_share,
  frozen_iv,
}: {
  at_loss: boolean
  impairment_call: ImpairmentCall
  proposed_basis: number
  cost_basis_per_share: number
  frozen_iv: number | undefined
}): SellBiasCaveat[] {
  const caveats: SellBiasCaveat[] = []

  const disposition = evaluateDispositionGuard({ at_loss, impairment_call })
  if (disposition.caveat) {
    caveats.push(disposition.caveat)
  }

  const anchoring = evaluateAnchoringGuard({ proposed_basis, cost_basis_per_share, frozen_iv })
  if (anchoring.caveat) {
    caveats.push(anchoring.caveat)
  }

  return caveats
}
