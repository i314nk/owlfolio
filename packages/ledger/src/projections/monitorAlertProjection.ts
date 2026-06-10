import type { LedgerEventEnvelope } from '../eventEnvelope'

// Monitor-alerts projection.
//
// Folds the worker-authored lifecycle-monitor events into a structured, severity-ranked MonitorAlert[]
// the UI can render. EVERY alert is an OBSERVATION or a human-decision DRAFT — never an execution, a
// recommendation to act, or a state advance. Each alert carries a human_action LINK to the surface where
// the user authors the decision; nothing here advances state.
//
// Source events (all worker-authored):
//   - watchlist_monitor_alert_recorded  → buy_window / staleness (suppressed) / shariah_rescreen
//   - holding_monitor_alert_recorded    → tranche / concentration / annual_rerun (alert_kind is a
//                                          '+'-joined composite; we split into one alert per kind)
//   - holding_shariah_grace_started     → shariah_grace (with the 90-day deadline + days-left)
//   - holding_sell_review_drafted       → divest_required (unresolvable_shariah_breach) | sell_review
//
// Grouping/resolution (kept honest + simple):
//   - One alert per (subject, kind): the LATEST open event wins (by created_at).
//   - A watchlist subject is RESOLVED (alerts dropped) once it is opened into a holding (holding_opened).
//   - A holding subject is RESOLVED once the position is exited (position_post_mortem_recorded, or a
//     holding_exited/holding_closed event if one is ever emitted).
//   - A no-signal watchlist observation is not an alert.

export type MonitorAlertKind =
  | 'buy_window'
  | 'tranche'
  | 'concentration'
  | 'shariah_grace'
  | 'shariah_rescreen'
  | 'divest_required'
  | 'sell_review'
  | 'annual_rerun'
  | 'staleness'

export type MonitorAlertSeverity = 'info' | 'attention' | 'urgent'

export type MonitorAlertSubject = {
  ticker?: string
  name?: string
  holding_id?: string
  watchlist_item_id?: string
  research_case_id?: string
}

export type MonitorAlert = {
  id: string
  kind: MonitorAlertKind
  subject: MonitorAlertSubject
  severity: MonitorAlertSeverity
  headline: string
  detail: string
  recorded_at: string
  /** True for worker observations (monitor alerts, grace start). */
  is_observation: boolean
  /** True for human-decision drafts (sell-review / divest-required). */
  is_draft: boolean
  human_action: { label: string; href: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function getNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getBoolean(payload: Record<string, unknown>, key: string): boolean {
  return payload[key] === true
}

function getStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key]
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

const SEVERITY_RANK: Record<MonitorAlertSeverity, number> = { urgent: 0, attention: 1, info: 2 }

function fmtPct(value: number | undefined): string {
  return value === undefined ? '' : `${value}%`
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
}

type RawAlert = {
  key: string
  recorded_at: string
  alert: MonitorAlert
}

function watchlistAlerts(event: LedgerEventEnvelope<unknown>, payload: Record<string, unknown>): MonitorAlert[] {
  const watchlistItemId = getString(payload, 'watchlist_item_id') ?? event.aggregate_id
  const ticker = getString(payload, 'ticker')
  const researchCaseId = getString(payload, 'research_case_id')
  const subject: MonitorAlertSubject = {
    ...(ticker === undefined ? {} : { ticker }),
    watchlist_item_id: watchlistItemId,
    ...(researchCaseId === undefined ? {} : { research_case_id: researchCaseId }),
  }
  const label = ticker ?? watchlistItemId
  const action = { label: 'Review buy-window', href: '/watchlist' }
  const id = getString(payload, 'alert_id') ?? event.event_id

  // Buy-window fired on a fresh, gate-clean, cheap case → attention.
  if (getBoolean(payload, 'buy_window_alert')) {
    const discount = getNumber(payload, 'discount_to_buy_pct')
    return [{
      id,
      kind: 'buy_window',
      subject,
      severity: 'attention',
      headline: `${label}: buy-window open`,
      detail: discount === undefined
        ? 'Price is at or below the case buy price on a fresh, gate-clean case. Observation only — opening a holding is your decision.'
        : `Price is ${fmtPct(discount)} below the case buy price on a fresh, gate-clean case. Observation only — opening a holding is your decision.`,
      recorded_at: event.created_at,
      is_observation: true,
      is_draft: false,
      human_action: action,
    }]
  }

  // Cheap-but-suppressed (stale / re-run-needed) → staleness, info.
  if (getBoolean(payload, 'suppressed') || getBoolean(payload, 'rerun_needed')) {
    const reason = getString(payload, 'suppression_reason')
    return [{
      id,
      kind: 'staleness',
      subject,
      severity: 'info',
      headline: `${label}: re-run needed before any buy signal`,
      detail: reason ?? 'A cheap price was seen but the research case is stale. Re-run the case before any buy signal — stale cheapness is not a signal.',
      recorded_at: event.created_at,
      is_observation: true,
      is_draft: false,
      human_action: { label: 'Re-run research', href: '/watchlist' },
    }]
  }

  // Quarterly Shariah re-screen flag → info.
  if (getString(payload, 'alert_kind') === 'shariah_rescreen') {
    const verdict = getString(payload, 'shariah_verdict') ?? 'flagged'
    const proposeRemoval = getBoolean(payload, 'propose_removal')
    return [{
      id,
      kind: 'shariah_rescreen',
      subject,
      severity: 'info',
      headline: `${label}: Shariah re-screen ${verdict}`,
      detail: proposeRemoval
        ? `AAOIFI ratio re-screen returned ${verdict}. The agent proposes removing this from the watchlist — you author the removal. Not a ruling.`
        : `AAOIFI ratio re-screen returned ${verdict}. Re-screen / purification refresh suggested. Not a ruling.`,
      recorded_at: event.created_at,
      is_observation: true,
      is_draft: false,
      human_action: { label: 'Review on watchlist', href: '/watchlist' },
    }]
  }

  return []
}

function holdingMonitorAlerts(event: LedgerEventEnvelope<unknown>, payload: Record<string, unknown>): MonitorAlert[] {
  const holdingId = getString(payload, 'holding_id') ?? event.aggregate_id
  const ticker = getString(payload, 'ticker')
  const researchCaseId = getString(payload, 'research_case_id')
  const subject: MonitorAlertSubject = {
    ...(ticker === undefined ? {} : { ticker }),
    holding_id: holdingId,
    ...(researchCaseId === undefined ? {} : { research_case_id: researchCaseId }),
  }
  const label = ticker ?? holdingId
  const href = `/portfolio#${holdingId}`
  const baseId = getString(payload, 'alert_id') ?? event.event_id
  const alerts: MonitorAlert[] = []

  if (getBoolean(payload, 'tranche_review_alert')) {
    const tranches = getStringArray(payload, 'triggered_tranches')
    const note = getString(payload, 'thesis_gated_note') ?? 'thesis re-check FIRST, then deploy — never mechanical averaging-down.'
    alerts.push({
      id: `${baseId}:tranche`,
      kind: 'tranche',
      subject,
      severity: 'attention',
      headline: `${label}: tranche trigger ${tranches.join('/') || 'reached'}`,
      detail: `Price reached the ${tranches.join('/') || 'pullback'} tranche trigger. ${note} This is advisory — you deploy.`,
      recorded_at: event.created_at,
      is_observation: true,
      is_draft: false,
      human_action: { label: 'Review tranche', href },
    })
  }

  if (getBoolean(payload, 'trim_review_alert')) {
    const weight = getNumber(payload, 'weight_pct')
    alerts.push({
      id: `${baseId}:concentration`,
      kind: 'concentration',
      subject,
      severity: 'attention',
      headline: `${label}: concentration over cap`,
      detail: weight === undefined
        ? 'Position weight exceeds the 15% NAV cap. Winners run; this is a trim-review alert, never an auto-trim. You decide.'
        : `Position is ${fmtPct(weight)} of NAV, over the 15% cap. Winners run; this is a trim-review alert, never an auto-trim. You decide.`,
      recorded_at: event.created_at,
      is_observation: true,
      is_draft: false,
      human_action: { label: 'Review concentration', href },
    })
  }

  if (getBoolean(payload, 'rerun_needed')) {
    const age = getNumber(payload, 'case_age_months')
    alerts.push({
      id: `${baseId}:annual_rerun`,
      kind: 'annual_rerun',
      subject,
      severity: 'info',
      headline: `${label}: annual deep re-run needed`,
      detail: age === undefined
        ? 'The research case is over 12 months old. A full annual deep re-run is due (it supersedes the prior case).'
        : `The research case is ${age} months old. A full annual deep re-run is due (it supersedes the prior case).`,
      recorded_at: event.created_at,
      is_observation: true,
      is_draft: false,
      human_action: { label: 'Re-run research', href },
    })
  }

  return alerts
}

function shariahGraceAlert(
  event: LedgerEventEnvelope<unknown>,
  payload: Record<string, unknown>,
  now: Date,
): MonitorAlert[] {
  const holdingId = getString(payload, 'holding_id') ?? event.aggregate_id
  const ticker = getString(payload, 'ticker')
  const label = ticker ?? holdingId
  const deadline = getString(payload, 'deadline')
  const subject: MonitorAlertSubject = {
    ...(ticker === undefined ? {} : { ticker }),
    holding_id: holdingId,
  }

  let detail = 'A Shariah financial-ratio breach started a 90-day grace period. Resolve the breach or author a divest before the deadline. Not a ruling.'
  let severity: MonitorAlertSeverity = 'attention'
  if (deadline !== undefined) {
    const deadlineDate = new Date(`${deadline}T00:00:00Z`)
    const daysLeft = daysBetween(now, deadlineDate)
    if (daysLeft < 0) {
      severity = 'urgent'
      detail = `Shariah grace period expired ${Math.abs(daysLeft)} day(s) ago (deadline ${deadline}). Author a divest review. Not a ruling.`
    } else if (daysLeft <= 14) {
      severity = 'urgent'
      detail = `Shariah grace deadline ${deadline} is ${daysLeft} day(s) away. Resolve the breach or author a divest. Not a ruling.`
    } else {
      detail = `Shariah financial-ratio breach — 90-day grace open until ${deadline} (${daysLeft} day(s) left). Resolve or author a divest before the deadline. Not a ruling.`
    }
  }

  return [{
    id: getString(payload, 'grace_id') ?? event.event_id,
    kind: 'shariah_grace',
    subject,
    severity,
    headline: `${label}: Shariah grace clock running`,
    detail,
    recorded_at: event.created_at,
    is_observation: true,
    is_draft: false,
    human_action: { label: 'Review grace', href: `/portfolio#${holdingId}` },
  }]
}

function sellReviewAlert(event: LedgerEventEnvelope<unknown>, payload: Record<string, unknown>): MonitorAlert[] {
  const holdingId = getString(payload, 'holding_id') ?? event.aggregate_id
  const ticker = getString(payload, 'ticker')
  const researchCaseId = getString(payload, 'research_case_id')
  const label = ticker ?? holdingId
  const reasonCode = getString(payload, 'reason_code')
  const isDivest = reasonCode === 'unresolvable_shariah_breach'
  const detail = getString(payload, 'detail')
    ?? 'A sell-review draft was raised. Review the sell-discipline reasons and author the exit if warranted.'
  const subject: MonitorAlertSubject = {
    ...(ticker === undefined ? {} : { ticker }),
    holding_id: holdingId,
    ...(researchCaseId === undefined ? {} : { research_case_id: researchCaseId }),
  }

  return [{
    id: getString(payload, 'sell_review_id') ?? event.event_id,
    kind: isDivest ? 'divest_required' : 'sell_review',
    subject,
    severity: 'urgent',
    headline: isDivest ? `${label}: DIVEST-REQUIRED draft` : `${label}: sell-review draft`,
    detail: `${detail} This is a DRAFT exit proposal — never an execution. You author the exit.`,
    recorded_at: event.created_at,
    is_observation: false,
    is_draft: true,
    human_action: { label: 'Author sell-review', href: `/portfolio#${holdingId}` },
  }]
}

export type ProjectMonitorAlertsOptions = {
  now?: Date
}

export function projectMonitorAlerts(
  events: LedgerEventEnvelope<unknown>[],
  options: ProjectMonitorAlertsOptions = {},
): MonitorAlert[] {
  const now = options.now ?? new Date()

  // Resolution markers: which watchlist items were opened, and which holdings exited.
  const openedWatchlistItemIds = new Set<string>()
  const resolvedHoldingIds = new Set<string>()
  for (const event of events) {
    if (!isRecord(event.payload)) {
      continue
    }
    if (event.event_type === 'holding_opened') {
      const watchlistItemId = getString(event.payload, 'watchlist_item_id')
      if (watchlistItemId !== undefined) {
        openedWatchlistItemIds.add(watchlistItemId)
      }
    }
    if (
      event.event_type === 'position_post_mortem_recorded'
      || event.event_type === 'holding_exited'
      || event.event_type === 'holding_closed'
    ) {
      const holdingId = getString(event.payload, 'holding_id') ?? event.aggregate_id
      resolvedHoldingIds.add(holdingId)
    }
  }

  // Build raw alerts, keyed by (subject, kind); the latest recorded event wins.
  const latest = new Map<string, RawAlert>()
  for (const event of events) {
    if (!isRecord(event.payload)) {
      continue
    }
    let produced: MonitorAlert[] = []
    switch (event.event_type) {
      case 'watchlist_monitor_alert_recorded':
        produced = watchlistAlerts(event, event.payload)
        break
      case 'holding_monitor_alert_recorded':
        produced = holdingMonitorAlerts(event, event.payload)
        break
      case 'holding_shariah_grace_started':
        produced = shariahGraceAlert(event, event.payload, now)
        break
      case 'holding_sell_review_drafted':
        produced = sellReviewAlert(event, event.payload)
        break
      default:
        continue
    }

    for (const alert of produced) {
      const subjectKey = alert.subject.watchlist_item_id ?? alert.subject.holding_id ?? alert.subject.ticker ?? alert.id
      const key = `${subjectKey}:${alert.kind}`
      const existing = latest.get(key)
      if (existing === undefined || alert.recorded_at >= existing.recorded_at) {
        latest.set(key, { key, recorded_at: alert.recorded_at, alert })
      }
    }
  }

  const open = [...latest.values()]
    .map((raw) => raw.alert)
    .filter((alert) => {
      if (alert.subject.watchlist_item_id !== undefined && openedWatchlistItemIds.has(alert.subject.watchlist_item_id)) {
        return false
      }
      if (alert.subject.holding_id !== undefined && resolvedHoldingIds.has(alert.subject.holding_id)) {
        return false
      }
      return true
    })

  return open.sort((left, right) => {
    const bySeverity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    if (bySeverity !== 0) {
      return bySeverity
    }
    // Newest first within a severity band.
    return right.recorded_at.localeCompare(left.recorded_at)
  })
}
