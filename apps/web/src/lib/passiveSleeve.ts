import type { PassiveSleeveConfig, PassiveSplit } from '@owlfolio/shared/appConfig'

// ---------------------------------------------------------------------------------------------------
// B7 (Phase 4, book alignment): pure passive-sleeve arithmetic — the due-date read (rule 2: buy on a
// consistent schedule, no matter what) and the split-drift read (the chosen passive/active split vs
// what is actually recorded). Display-only; nothing here executes or nags beyond the panel.
// ---------------------------------------------------------------------------------------------------

export type PassiveDueStatus = {
  /** The next scheduled contribution date (YYYY-MM-DD). */
  next_due: string
  /** True when the CURRENT month's scheduled contribution has no recorded contribution yet and the
   *  schedule day has passed (rule 2 is being missed). */
  overdue: boolean
  /** True when a contribution is recorded for the current month (rule 2 satisfied this month). */
  contributed_this_month: boolean
}

/** The due read. `today` is an ISO date (YYYY-MM-DD) injected by the caller (never the clock here). */
export function computePassiveDue(
  config: Pick<PassiveSleeveConfig, 'schedule_day'>,
  lastContributionAt: string | undefined,
  today: string,
): PassiveDueStatus {
  const [y, m, d] = today.slice(0, 10).split('-').map(Number) as [number, number, number]
  const thisMonth = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`
  const contributedThisMonth = lastContributionAt !== undefined && lastContributionAt.slice(0, 7) === thisMonth
  const day = String(config.schedule_day).padStart(2, '0')
  const dueThisMonth = `${thisMonth}-${day}`
  // Next due: this month's date if it is still ahead OR unpaid; otherwise next month's.
  const nextMonthY = m === 12 ? y + 1 : y
  const nextMonthM = m === 12 ? 1 : m + 1
  const dueNextMonth = `${String(nextMonthY).padStart(4, '0')}-${String(nextMonthM).padStart(2, '0')}-${day}`
  const next_due = contributedThisMonth ? dueNextMonth : dueThisMonth
  const overdue = !contributedThisMonth && d > config.schedule_day
  return { next_due, overdue, contributed_this_month: contributedThisMonth }
}

export type PassiveSplitDrift = {
  target_passive_fraction: number
  /** Recorded passive contributions ÷ (passive + active). undefined when both sides are zero. */
  actual_passive_fraction?: number
  /** actual − target (positive = passive-heavy). undefined when not computable. */
  drift?: number
  /** The honesty caveat: the passive side is CONTRIBUTIONS AT COST (no market value tracking in v1). */
  basis_note: string
}

const SPLIT_FRACTION: Record<PassiveSplit, number> = { '80/20': 0.8, '60/40': 0.6, '100/0': 1.0 }

/** The drift read: recorded passive total (at cost) vs the active book's value. */
export function computeSplitDrift(args: {
  split: PassiveSplit
  passive_total_contributed: number
  active_value: number
}): PassiveSplitDrift {
  const target = SPLIT_FRACTION[args.split]
  const denominator = args.passive_total_contributed + args.active_value
  const actual = denominator > 0 ? args.passive_total_contributed / denominator : undefined
  return {
    target_passive_fraction: target,
    ...(actual !== undefined ? { actual_passive_fraction: actual, drift: actual - target } : {}),
    basis_note: 'Passive side = recorded contributions at cost (no index market value tracked in v1); active side = holdings at latest market value (cost basis where no quote). A directional read, not an account statement.',
  }
}
