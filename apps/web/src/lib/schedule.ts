/**
 * Humanize cron expressions for display in the UI.
 * Only maps the cron strings actually used in this codebase.
 * Never returns raw cron syntax to the caller.
 */

const CRON_LABELS: Record<string, string> = {
  '0 7 * * 1-5': 'Weekdays at 07:00',
  '0 8 1 */3 *': 'Quarterly — 1st at 08:00',
  '0 7 * * *': 'Daily at 07:00',
  '0 8 1 * *': 'Monthly — 1st at 08:00',
  '0 0 1 1 *': 'Annually',
  '0 0 * * 0': 'Weekly',
}

/**
 * Escape special regex characters in a string so it can be used literally.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Return a human-readable label for a raw cron expression.
 * If the expression is not recognised, returns "On the worker schedule".
 */
export function humanizeCron(expr: string): string {
  const trimmed = expr.trim()
  return CRON_LABELS[trimmed] ?? 'On the worker schedule'
}

/**
 * Extract an embedded cron expression from a prose string, humanize it,
 * and rebuild the surrounding sentence in a readable form.
 *
 * Handles strings of the form:
 *   "valuation refresh cadence 0 7 * * 1-5; accounting recalculates from ledger events on load"
 *   "quarterly purification review cadence 0 8 1 *&#47;3 *"
 *
 * If no embedded cron is found, returns the generic label "On the worker schedule".
 */
export function humanizeCronProse(prose: string): string {
  for (const [cronExpr, label] of Object.entries(CRON_LABELS)) {
    // Build a regex that matches the exact cron expression surrounded by
    // spaces or string boundaries. We don't use word boundaries because
    // cron fields contain '*' which is not a word character.
    const pattern = new RegExp(`(^|\\s)${escapeRegex(cronExpr)}(\\s*;[^;]*|\\s*$)`)
    const match = pattern.exec(prose)
    if (match === null) {
      continue
    }

    // Derive the text before and after the cron expression.
    const cronStart = match.index + (match[1] ?? '').length
    const before = prose.slice(0, cronStart).trim()

    // After the cron expression: skip any leading '; ' separator.
    const afterRaw = prose.slice(cronStart + cronExpr.length).trim()
    const after = afterRaw.replace(/^;\s*/, '').trim()

    const prefix = before.length > 0
      ? before.charAt(0).toUpperCase() + before.slice(1) + ': '
      : ''
    const suffix = after.length > 0 ? ` — ${after}` : ''

    return `${prefix}${label}${suffix}`
  }

  // No known cron found — fall back to generic label rather than exposing raw cron.
  return 'On the worker schedule'
}
