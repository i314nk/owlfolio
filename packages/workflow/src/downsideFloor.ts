import { SIZING_PARAMS, type SizingParams } from '@owlfolio/strategies/sizingParams'
import type { Fundamentals } from './secEdgar'

// ---------------------------------------------------------------------------
// Phase 5 S2 — the CONCRETE downside FLOOR (a number), computed where the permanent-loss judgment lives.
//
// The Phase-5 permanent-loss cap (S3, next) needs a concrete per-share downside floor. The 4.2a
// `permanent_loss_risk` is only a LEVEL (low/med/high) + prose — no number. This module produces the
// floor as DETERMINISTIC balance-sheet arithmetic, GATED for reliability by that 4.2a level.
//
// The split is load-bearing:
//   - floor  = arithmetic (net cash, or — softer — stressed book), straight off the latest annual facts.
//   - level  = the grounded judgment of whether to TRUST that arithmetic. A `high` permanent-loss level
//              means the balance sheet may be encumbered/overstated (Horsehead-style: secured creditors
//              ahead of the apparent assets) — so even a superficially clean balance sheet must NOT be
//              sized on. The level GATES reliability, and `high` returns `cannot_floor`.
//
// Deterministic, no probability, no LLM here. The ONLY judgment input is the permanent_loss_level, which
// comes from the existing 4.2a output. Fail-closed: a missing/non-finite input NEVER substitutes a guess.
// ---------------------------------------------------------------------------

/** Which arithmetic produced the floor. `net_cash` is the hardest/most concrete; `stressed_book` is softer. */
export type DownsideFloorBasis = 'net_cash' | 'stressed_book'

/**
 * How much to trust the floor, GATED by the grounded 4.2a permanent-loss level:
 *   - `sound`      (level low)    — trust the arithmetic.
 *   - `qualified`  (level medium) — usable but hedged.
 *   - `unreliable` (level high)   — do NOT size on it; paired with `cannot_floor`.
 */
export type DownsideFloorReliability = 'sound' | 'qualified' | 'unreliable'

/** The balance-sheet components the floor was derived from (carried for auditability). */
export type DownsideFloorComponents = {
  cash_and_securities_musd?: number
  total_debt_musd?: number
  net_cash_musd?: number
  stockholders_equity_musd?: number
  book_value_haircut?: number
  diluted_shares_m?: number
}

export type DownsideFloor =
  | {
      status: 'floor'
      floor_per_share: number
      basis: DownsideFloorBasis
      reliability: DownsideFloorReliability
      components: DownsideFloorComponents
    }
  | { status: 'cannot_floor'; reason: string }

const finite = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Compute the concrete per-share downside floor from the latest annual balance sheet, gated for
 * reliability by the grounded 4.2a permanent-loss level.
 *
 *   net_cash_per_share  = (cash_and_securities − total_debt) / diluted_shares  — positive ⇒ the floor.
 *   stressed_book/share = (stockholders_equity × book_value_haircut) / diluted_shares  — the softer fallback.
 *
 * The 4.2a level gates reliability (the load-bearing coupling): `high` ⇒ `unreliable` AND `cannot_floor`
 * (the floor itself is at risk — the balance sheet may be encumbered/overstated; never size on it, even
 * with a superficially clean sheet). `medium` ⇒ `qualified`; `low` ⇒ `sound`. Any required field
 * missing/non-finite, or both floors non-positive ⇒ `cannot_floor` (fail-closed; never a guess).
 */
export function computeDownsideFloor(args: {
  fundamentals: Fundamentals
  permanent_loss_level: 'low' | 'medium' | 'high'
  /** Sizing config (the stressed-book haircut is read here). Defaults to the frozen SIZING_PARAMS. */
  params?: SizingParams
}): DownsideFloor {
  const { fundamentals, permanent_loss_level } = args
  const params = args.params ?? SIZING_PARAMS

  // Level gate FIRST (belt-and-suspenders; a `high` level is already not-admittable upstream). NEVER size
  // on a floor whose own grounded judgment says it is unreliable — even if the arithmetic looks healthy.
  if (permanent_loss_level === 'high') {
    return {
      status: 'cannot_floor',
      reason:
        'permanent_loss_risk is HIGH — the floor itself is unreliable (the balance sheet may be encumbered/'
        + 'overstated; secured creditors may sit ahead of the apparent assets). Do not size on it.',
    }
  }
  const reliability: DownsideFloorReliability = permanent_loss_level === 'medium' ? 'qualified' : 'sound'

  const annual = fundamentals.latest_annual
  const shares = annual.diluted_shares_m
  if (!finite(shares) || shares <= 0) {
    return { status: 'cannot_floor', reason: 'diluted_shares_m missing/non-positive — per-share floor not computable.' }
  }

  // Net cash — the hardest, most concrete floor (the Frontline liquidation logic 4.2a already cites).
  const cash = annual.cash_and_securities_musd
  const debt = annual.total_debt_musd
  if (finite(cash) && finite(debt)) {
    const netCash = cash - debt
    if (netCash > 0) {
      return {
        status: 'floor',
        floor_per_share: netCash / shares,
        basis: 'net_cash',
        reliability,
        components: {
          cash_and_securities_musd: cash,
          total_debt_musd: debt,
          net_cash_musd: netCash,
          diluted_shares_m: shares,
        },
      }
    }
  }

  // No positive net cash → the SOFTER stressed-book floor (equity × haircut). Requires equity present.
  const equity = annual.stockholders_equity_musd
  const haircut = params.book_value_haircut
  if (finite(equity) && finite(haircut)) {
    const stressedBook = equity * haircut
    if (stressedBook > 0) {
      return {
        status: 'floor',
        floor_per_share: stressedBook / shares,
        basis: 'stressed_book',
        reliability,
        components: {
          stockholders_equity_musd: equity,
          book_value_haircut: haircut,
          diluted_shares_m: shares,
          ...(finite(cash) ? { cash_and_securities_musd: cash } : {}),
          ...(finite(debt) ? { total_debt_musd: debt } : {}),
        },
      }
    }
  }

  return {
    status: 'cannot_floor',
    reason:
      'no positive net cash and no positive stressed book value — required balance-sheet inputs '
      + 'missing/non-positive; the downside floor is not computable (fail-closed, no substituted guess).',
  }
}
