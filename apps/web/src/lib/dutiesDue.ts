import type { AutomationSettings } from '@owlfolio/shared'

/**
 * Command-center DUTY NUDGES (owner, 2026-07-18): the worker has no autonomous scheduler in the
 * alpha — cadence settings describe intent, but a tick only happens when the user (or the on-demand
 * spawn paths) runs one. This resolver closes that honesty gap: it compares each duty's LAST
 * completed run (from the scheduled-task ledger projection) against the user's configured rhythm
 * and surfaces "it's time" rows in Needs-your-attention. Pure and IO-free; the command-center
 * assembly feeds it projected snapshots.
 *
 * A duty only nags when (a) its Settings toggle says the user wants it and (b) there is something
 * real to act on — a fresh ledger with nothing decided/held stays quiet.
 */

export type DutyDue = {
  id: 'discovery_13f' | 'thesis_check_in' | 'annual_re_analysis'
  headline: string
  detail: string
  href: string
  action_label: string
}

export type DutiesDueInput = {
  now: Date
  /** MERGED automation settings (mergeAutomationSettings output). */
  automation: AutomationSettings
  /** Projected scheduled tasks — only task_kind + last_completed_at are read. */
  tasks: { task_kind: string; last_completed_at?: string | undefined }[]
  /** Non-superseded research cases with a recorded decision (the check-in's re-review targets). */
  decided_case_count: number
  open_holding_count: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const QUARTER_DAYS = 92
const YEAR_DAYS = 366

function daysSince(now: Date, iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return undefined
  return Math.floor((now.getTime() - then) / DAY_MS)
}

function lastCompleted(input: DutiesDueInput, taskKind: string): string | undefined {
  return input.tasks.find((task) => task.task_kind === taskKind)?.last_completed_at
}

function agoLine(days: number | undefined): string {
  return days === undefined ? 'never run yet' : `last run ${days} days ago`
}

export function resolveDutiesDue(input: DutiesDueInput): DutyDue[] {
  const duties: DutyDue[] = []
  const { automation, now } = input

  // ── 13F discovery harvest — rhythm from Settings → Superinvestors (weekly/monthly). ──
  if (automation.discovery.enabled && automation.discovery.cadence !== 'off') {
    const periodDays = automation.discovery.cadence === 'weekly' ? 7 : 31
    const days = daysSince(now, lastCompleted(input, 'discovery_13f'))
    if (days === undefined || days > periodDays) {
      duties.push({
        id: 'discovery_13f',
        headline: 'A 13F discovery harvest is due',
        detail: `Your ${automation.discovery.cadence} discovery rhythm — ${agoLine(days)}. Run the harvest to pick up the tracked superinvestors' latest filings.`,
        href: '/discovery',
        action_label: 'Run discovery',
      })
    }
  }

  // ── Quarterly thesis check-in — new filings vs every decided name's recorded thesis. ──
  if (automation.thesis_review.enabled && input.decided_case_count > 0) {
    const days = daysSince(now, lastCompleted(input, 're_review_check'))
    if (days === undefined || days > QUARTER_DAYS) {
      duties.push({
        id: 'thesis_check_in',
        headline: 'The quarterly thesis check-in is due',
        detail: `${input.decided_case_count} decided ${input.decided_case_count === 1 ? 'name has' : 'names have'} a recorded thesis and ${agoLine(days)} — new filings since then may have changed them. Check in from any board row, or run the worker's re_review_check task.`,
        href: input.open_holding_count > 0 ? '/portfolio' : '/watchlist',
        action_label: 'Open the board',
      })
    }
  }

  // ── Annual re-analysis — held theses re-underwritten on the 10-K rhythm. ──
  if (automation.thesis_review.enabled && input.open_holding_count > 0) {
    const days = daysSince(now, lastCompleted(input, 're_underwrite'))
    if (days === undefined || days > YEAR_DAYS) {
      duties.push({
        id: 'annual_re_analysis',
        headline: 'The annual re-analysis of held names is due',
        detail: `${input.open_holding_count} held ${input.open_holding_count === 1 ? 'thesis' : 'theses'} — ${agoLine(days)}. Annual filings warrant a full re-analysis: re-run from each held name's dossier, or run the worker's re_underwrite task.`,
        href: '/portfolio',
        action_label: 'Open portfolio',
      })
    }
  }

  return duties
}
