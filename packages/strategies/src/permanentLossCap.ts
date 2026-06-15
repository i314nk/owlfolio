// Phase 5 S3 — the permanent-loss CAP, computed on the CONCRETE downside floor (a number) from S2.
//
// This is the size ceiling that asks: "if this name fell all the way to its concrete floor, how much of
// the book would that PERMANENTLY impair?" It is the deliberate anti-Kelly: the loss is taken DOWN TO
// THE CONCRETE FLOOR, with NO probability weighting and NO odds. A probability-weighted partial drawdown
// would smuggle Kelly-style odds back in — forbidden. You lose down to the floor; that is the number.
//
// The cap binds on the FLOOR (a number), NOT on a quality/moat re-judgment. There is intentionally NO
// moat/quality/uncertainty field in this module's inputs: the quality judgment already happened upstream
// (admit + the S2 reliability gate). If S2 says `cannot_floor` (e.g. a `high` permanent-loss level made
// the balance sheet untrustworthy — Horsehead-style), the cap FAILS CLOSED to `cannot_size` rather than
// sizing on a quality-only guess.
//
// ISLAND: pure, deterministic, no I/O, no LLM, no probability. Every constant is read from SizingParams.

import { SIZING_PARAMS, type SizingParams } from './sizingParams'

/** The S2 floor, as read off the admit recommendation: either a concrete per-share floor or cannot_floor. */
export type DownsideFloorInput = { floor_per_share: number } | { cannot_floor: true }

export type PermanentLossCapResult =
  | {
      status: 'ok'
      /** The max position value ($) that keeps book impairment at the floor ≤ book_recovery_threshold. */
      max_sizeable_value: number
      /** position_loss_at_floor / book_nav for the PROPOSED value (the impairment being checked). */
      book_impairment_fraction: number
      /** True when the proposed value would exceed the threshold (max_sizeable_value < proposed_value). */
      binding: boolean
      reason: string
    }
  /** Floor unavailable (S2 cannot_floor) or a non-finite/non-positive input → fail-closed, never sized. */
  | { status: 'cannot_size'; reason: string }

const finite = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Evaluate the permanent-loss cap for a proposed position value, on the CONCRETE downside floor.
 *
 *   realistic_downside_per_share = max(entry_price_per_share − floor_per_share, 0)   — DETERMINISTIC,
 *       NO probability weighting (the loss is down to the concrete floor, not an expected partial drawdown).
 *   shares                       = proposed_value / entry_price_per_share
 *   position_loss_at_floor       = shares × realistic_downside_per_share
 *   book_impairment_fraction     = position_loss_at_floor / book_nav
 *
 * ALLOWED iff book_impairment_fraction ≤ book_recovery_threshold. When the proposed value would exceed
 * it, return the MAX value that keeps impairment ≤ threshold, with binding: true and a reason that NAMES
 * the floor.
 *
 * Fail-closed: a `cannot_floor` floor, or a non-finite/non-positive entry price or book NAV → cannot_size
 * (never substitute a quality-only guess; the cap binds on the floor — a number — not a quality re-judgment).
 */
export function evaluatePermanentLossCap(args: {
  entry_price_per_share: number
  downside_floor: DownsideFloorInput
  book_nav: number
  proposed_value: number
  params?: SizingParams
}): PermanentLossCapResult {
  const params = args.params ?? SIZING_PARAMS
  const threshold = params.book_recovery_threshold

  // Fail-closed: the floor must be a concrete number. A cannot_floor (S2 level-gated, Horsehead-style)
  // NEVER sizes on a quality-only guess — the cap binds on the FLOOR, a number.
  if ('cannot_floor' in args.downside_floor) {
    return {
      status: 'cannot_size',
      reason:
        'downside floor unavailable (S2 cannot_floor — e.g. a HIGH permanent-loss level made the balance '
        + 'sheet untrustworthy). The permanent-loss cap binds on the concrete floor (a number), never on a '
        + 'quality re-judgment; fail-closed, no size.',
    }
  }

  const entry = args.entry_price_per_share
  const floor = args.downside_floor.floor_per_share
  if (!finite(entry) || entry <= 0) {
    return { status: 'cannot_size', reason: 'entry_price_per_share missing/non-positive — cannot size on the floor.' }
  }
  if (!finite(floor)) {
    return { status: 'cannot_size', reason: 'floor_per_share non-finite — cannot size on the floor.' }
  }
  if (!finite(args.book_nav) || args.book_nav <= 0) {
    return { status: 'cannot_size', reason: 'book_nav missing/non-positive — cannot compute book impairment.' }
  }
  if (!finite(args.proposed_value) || args.proposed_value < 0) {
    return { status: 'cannot_size', reason: 'proposed_value missing/negative — nothing to size.' }
  }
  if (!finite(threshold) || threshold <= 0) {
    return { status: 'cannot_size', reason: 'book_recovery_threshold missing/non-positive — fail-closed.' }
  }

  // DETERMINISTIC downside to the concrete floor (no probability weighting). Floor ≥ entry ⇒ zero downside.
  const realisticDownsidePerShare = Math.max(entry - floor, 0)

  // The max position value that keeps impairment ≤ threshold. With zero downside, nothing impairs → no cap.
  // loss_at_floor(value) = (value / entry) × realisticDownsidePerShare = value × (downside/entry).
  // Solve value × (downside/entry) ≤ threshold × book_nav  →  value ≤ threshold × book_nav × entry / downside.
  const maxSizeableValue =
    realisticDownsidePerShare <= 0
      ? Number.POSITIVE_INFINITY
      : (threshold * args.book_nav * entry) / realisticDownsidePerShare

  const shares = args.proposed_value / entry
  const positionLossAtFloor = shares * realisticDownsidePerShare
  const bookImpairmentFraction = positionLossAtFloor / args.book_nav

  const binding = args.proposed_value > maxSizeableValue
  const allowedValue = binding ? maxSizeableValue : args.proposed_value
  const pct = (n: number): string => `${(n * 100).toFixed(2)}%`

  const reason = binding
    ? `permanent-loss cap binds: downside to the concrete floor $${floor} (realistic downside $`
      + `${realisticDownsidePerShare.toFixed(2)}/share from entry $${entry}) at the proposed $`
      + `${args.proposed_value} would impair ${pct(bookImpairmentFraction)} of book NAV > the `
      + `${pct(threshold)} recovery threshold; max sizeable is $${maxSizeableValue.toFixed(2)}.`
    : `permanent-loss cap clear: downside to the concrete floor $${floor} (realistic downside $`
      + `${realisticDownsidePerShare.toFixed(2)}/share) at $${args.proposed_value} impairs `
      + `${pct(bookImpairmentFraction)} of book NAV ≤ the ${pct(threshold)} recovery threshold.`

  return {
    status: 'ok',
    max_sizeable_value: allowedValue,
    book_impairment_fraction: bookImpairmentFraction,
    binding,
    reason,
  }
}
