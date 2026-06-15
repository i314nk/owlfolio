// Phase 6 S1 — the minimum-hold "clock" (pure, deterministic, no I/O, no LLM).
//
// The Phase-6 sell decision pairs a 2–3 year minimum-hold guard with a "thesis broke, sell" trigger.
// This module supplies ONLY the clock: how long a name has been held, and whether that age is still
// inside the configured minimum-hold window. It does NOT decide whether to sell — the guard (a later
// slice) combines this with the shared impairment judgment (reassessHeldImpairment → impairment_call)
// so the clock never fights a broken-thesis sell. Every constant is read from SELL_PARAMS.

import { SELL_PARAMS } from './sellParams'

/** Average days per month used to convert a day span into fractional months (Gregorian mean). */
const DAYS_PER_MONTH = 365.25 / 12

/**
 * Whole/fractional months between two ISO timestamps, by calendar-month difference plus a fractional
 * remainder.
 *
 * CONVENTION: the integer part is the number of whole calendar months from `opened_at` to the
 * same-day-of-month on/before `now`; the fractional part is the trailing partial month measured in days
 * over the Gregorian mean month length (~30.44 days). This keeps exact whole-month spans exact (e.g.
 * 2024-01-15 → 2026-01-15 = 24.0) while giving a smooth fraction for partial months. Negative spans
 * (now before opened_at) are clamped to 0.
 */
export function computeHoldingAgeMonths(opened_at: string, now: string): number {
  const start = new Date(opened_at)
  const end = new Date(now)
  const startMs = start.getTime()
  const endMs = end.getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0
  }

  // Whole calendar months from start to the same day-of-month at/before end.
  let wholeMonths =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth())
  // The "anchor" is opened_at advanced by `wholeMonths` whole months; if it overshot `end` (because the
  // day-of-month had not yet been reached), back off one whole month so the remainder is non-negative.
  const anchor = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + wholeMonths,
      start.getUTCDate(),
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds(),
    ),
  )
  if (anchor.getTime() > endMs) {
    wholeMonths -= 1
    anchor.setUTCMonth(anchor.getUTCMonth() - 1)
  }

  const remainderDays = (endMs - anchor.getTime()) / (24 * 60 * 60 * 1000)
  return wholeMonths + remainderDays / DAYS_PER_MONTH
}

/** The minimum-hold clock result: the holding age (null when unknown) and whether it is inside the window. */
export type MinimumHoldStatus = {
  /** Holding age in months, or null when `opened_at` is unknown. */
  age_months: number | null
  /** True while the name is still inside the minimum-hold window (or its open date is unknown). */
  within_window: boolean
}

/**
 * Computes the minimum-hold status for a held name.
 *
 * FAIL-CLOSED: when `opened_at` is missing/undefined, returns `{ age_months: null, within_window: true }`
 * — a name with no known open date is treated as STILL INSIDE the window so the guard stays active. It
 * must NEVER default to "window passed". Otherwise the name is inside the window while its age is strictly
 * less than `params.minimum_hold_months`.
 */
export function holdingMinimumHoldStatus({
  opened_at,
  now,
  params = SELL_PARAMS,
}: {
  opened_at: string | undefined
  now: string
  params?: typeof SELL_PARAMS
}): MinimumHoldStatus {
  if (opened_at === undefined) {
    return { age_months: null, within_window: true }
  }
  const age_months = computeHoldingAgeMonths(opened_at, now)
  return { age_months, within_window: age_months < params.minimum_hold_months }
}
