import { createElement, Fragment, type ReactNode } from 'react'

import { OwlButtonLink, SourceChip } from './designSystem'
import { StatusBadge } from './StatusBadge'
import type { AppCommandCenter, CommandCenterDiscoverySignal, MonitorAlert } from '../lib/commandCenter'

export type CommandCenterProps = {
  dashboard: AppCommandCenter
}

type ActionCard = {
  category: string
  description: string
  href: string
  label: string
  title: string
  tone: 'critical' | 'warning' | 'info' | 'success'
}

type ActivitySummary = {
  actor?: string
  isZeroState: boolean
  title: string
}

/**
 * The Fiduciary Briefing.
 *
 * Owlfolio's home page reads as the steward's (the agent's) briefing to the
 * principal (the user): a private-ledger / editorial layout, not a trading
 * terminal. Returns a Fragment so each section is a direct child of the route
 * frame and inherits the app's staggered reveal.
 */
export function CommandCenter({ dashboard }: CommandCenterProps) {
  return createElement(
    Fragment,
    null,
    createMasthead(dashboard),
    createBriefingHero(dashboard),
    createLedgerLine(dashboard),
    createNeedsAttention(dashboard),
    createCommandPanel(dashboard),
    createAgentsDesk(dashboard),
    createHoldingsAndBooks(dashboard),
    createLedgerFeed(dashboard),
  )
}

// ── 1. Masthead / letterhead ──────────────────────────────────────────────────

function createMasthead(dashboard: AppCommandCenter) {
  return createElement(
    'header',
    { className: 'owl-cc-masthead' },
    createElement(
      'p',
      { className: 'owl-cc-eyebrow' },
      createElement('span', null, dashboard.product_name),
      createElement('span', { 'aria-hidden': 'true', className: 'owl-cc-eyebrow-sep' }, '·'),
      createElement('span', { className: 'owl-cc-eyebrow-section' }, 'Fiduciary briefing'),
    ),
    // Required, accessible heading — styled small/editorial as a running head.
    createElement('h1', { className: 'owl-cc-masthead-title' }, 'Command Center'),
    createElement('hr', { className: 'owl-cc-rule' }),
  )
}

// ── 2. The Briefing Hero ──────────────────────────────────────────────────────

function createBriefingHero(dashboard: AppCommandCenter) {
  const statement = buildHeroStatement(dashboard)
  const pulse = buildHeroPulse(dashboard)

  return createElement(
    'section',
    { 'aria-label': 'Briefing', className: 'owl-cc-briefing' },
    createElement('p', { className: 'owl-cc-hero-statement' }, ...statement),
    createElement('p', { className: 'owl-cc-hero-pulse' }, pulse),
    createElement(
      'div',
      { className: 'owl-cc-hero-actions' },
      createElement(OwlButtonLink, { href: dashboard.primary_action.href }, dashboard.primary_action.label),
      dashboard.secondary_action === undefined
        ? null
        : createElement(OwlButtonLink, { href: dashboard.secondary_action.href, variant: 'secondary' }, dashboard.secondary_action.label),
    ),
  )
}

/**
 * The single most important thing right now, as a private banker's opening
 * line. The key number/word is emphasised in gold.
 */
function buildHeroStatement(dashboard: AppCommandCenter): ReactNode[] {
  const pending = dashboard.pipeline_counts.pending_user_actions
  const cases = dashboard.pipeline_counts.research_cases

  if (pending > 0) {
    const noun = pending === 1 ? 'decision' : 'decisions'
    return [
      createElement('span', { className: 'owl-cc-hero-figure', key: 'fig' }, `${pending} ${noun}`),
      pending === 1 ? ' awaits your authorization.' : ' await your authorization.',
    ]
  }

  if (isProviderReadinessWarning(dashboard.provider_status)) {
    return [
      'Finish setup to put your ',
      createElement('span', { className: 'owl-cc-hero-figure', key: 'fig' }, 'agent'),
      ' to work.',
    ]
  }

  if (cases > 0) {
    const noun = cases === 1 ? 'research case' : 'research cases'
    return [
      'Your agent is tracking ',
      createElement('span', { className: 'owl-cc-hero-figure', key: 'fig' }, `${cases} ${noun}`),
      '.',
    ]
  }

  return [
    createElement('span', { className: 'owl-cc-hero-figure', key: 'fig' }, 'All quiet'),
    ' — your agent is on watch.',
  ]
}

function buildHeroPulse(dashboard: AppCommandCenter): string {
  const counts = dashboard.pipeline_counts
  const engine = isProviderReadinessWarning(dashboard.provider_status)
    ? 'Research engine paused for setup'
    : 'Research engine active'
  const holdings = `${counts.open_holdings} ${counts.open_holdings === 1 ? 'holding' : 'holdings'} held`
  return `${engine} · ${holdings} · monitoring for buy-zone and thesis changes.`
}

// ── 3. The Ledger Line (vital signs) ──────────────────────────────────────────

function createLedgerLine(dashboard: AppCommandCenter) {
  const counts = dashboard.pipeline_counts
  const stats: { figureClass: string; label: string; value: string }[] = [
    { figureClass: '', label: 'Research cases', value: countsText(counts.research_cases) },
    { figureClass: '', label: 'Watchlist drafts', value: countsText(counts.watchlist_drafts) },
    { figureClass: 'owl-cc-ledger-figure-emerald', label: 'Confirmed watchlist', value: countsText(counts.confirmed_watchlist_items) },
    { figureClass: '', label: 'Open holdings', value: countsText(counts.open_holdings) },
    {
      figureClass: counts.pending_user_actions > 0 ? 'owl-cc-ledger-figure-risk' : 'owl-cc-ledger-figure-emerald',
      label: 'Pending user actions',
      value: countsText(counts.pending_user_actions),
    },
  ]

  return createElement(
    'section',
    { 'aria-label': 'Vital signs', className: 'owl-cc-ledger-line' },
    ...stats.map((stat) => createElement(
      'article',
      { className: 'owl-cc-ledger-stat', key: stat.label },
      createElement('p', { className: 'owl-cc-ledger-label' }, stat.label),
      createElement('p', { className: `owl-cc-ledger-figure ${stat.figureClass}`.trim() }, stat.value),
    )),
  )
}

// ── 3b. Needs your attention (agent observations & drafts) ────────────────────

const SEVERITY_TONE: Record<MonitorAlert['severity'], { badge: 'danger' | 'warning' | 'neutral'; label: string }> = {
  urgent: { badge: 'danger', label: 'Urgent' },
  attention: { badge: 'warning', label: 'Attention' },
  info: { badge: 'neutral', label: 'Watch' },
}

const SIGNAL_BADGE_LABEL: Record<CommandCenterDiscoverySignal['signal']['signal_type'], string> = {
  CLUSTER_BUY: 'CLUSTER BUY',
  NEW_POSITION: 'NEW POSITION',
  MEANINGFUL_ADD: 'MEANINGFUL ADD',
}

/**
 * The agent's "needs your attention" rail: open monitor observations (buy-windows, tranche/concentration,
 * Shariah grace) and human-decision drafts (sell-review / divest), plus the strongest 13F discovery
 * signals. EVERY row is an observation or a DRAFT — nothing is executed and nothing advances state; each
 * row is a LINK to where YOU author the decision.
 */
function createNeedsAttention(dashboard: AppCommandCenter) {
  const alerts = dashboard.monitor_alerts
  const signals = dashboard.discovery_signals

  return createElement(
    'section',
    { 'aria-label': 'Needs your attention', className: 'owl-section-card', style: { gap: 'var(--owl-space-4)' } },
    createElement('p', { className: 'owl-cc-section-accent' }, 'Needs your attention'),
    createElement('h2', { className: 'owl-section-title' }, 'Agent observations & drafts — you decide'),
    createElement(
      'p',
      { className: 'owl-cc-directive' },
      'These are what your agent is watching and the exits it has drafted. None are executed and none advance your portfolio — each links to where you author the decision.',
    ),
    alerts.length === 0 && signals.length === 0
      ? createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'No alerts — the agent is watching.')
      : createElement(
        'div',
        { className: 'owl-row-list' },
        ...alerts.map((alert) => createAttentionRow(alert)),
        ...signals.map((signal) => createDiscoverySignalRow(signal)),
      ),
  )
}

function createAttentionRow(alert: MonitorAlert) {
  const tone = SEVERITY_TONE[alert.severity]
  const label = alert.subject.ticker ?? alert.subject.holding_id ?? alert.subject.watchlist_item_id ?? 'Subject'

  return createElement(
    'div',
    { key: alert.id, className: 'owl-row owl-row-top' },
    createElement(
      'div',
      { className: 'owl-row-main' },
      createElement(
        'div',
        { className: 'owl-activity-meta', style: { marginBottom: '0.2rem' } },
        createElement(StatusBadge, { tone: tone.badge }, tone.label),
        createElement(StatusBadge, { tone: 'neutral' }, alert.is_draft ? 'Draft — you author' : 'Observation'),
        createElement(SourceChip, { id: label, label: 'Subject' }),
      ),
      createElement('h3', { className: 'owl-row-title' }, alert.headline),
      createElement('p', { className: 'owl-row-helper' }, alert.detail),
    ),
    createElement(
      'div',
      { className: 'owl-row-aside' },
      createElement(OwlButtonLink, { href: alert.human_action.href, variant: alert.severity === 'urgent' ? 'danger' : 'secondary' }, `${alert.human_action.label} →`),
    ),
  )
}

function createDiscoverySignalRow(signal: CommandCenterDiscoverySignal) {
  const detail = signal.signal
  const managers = detail.contributing_managers.length === 0
    ? 'managers not recorded'
    : detail.contributing_managers.join(', ')
  const conviction = `${(detail.conviction_pct * 100).toFixed(1)}% conviction`

  return createElement(
    'div',
    { key: `signal:${signal.candidate_id}`, className: 'owl-row owl-row-top' },
    createElement(
      'div',
      { className: 'owl-row-main' },
      createElement(
        'div',
        { className: 'owl-activity-meta', style: { marginBottom: '0.2rem' } },
        createElement(StatusBadge, { tone: detail.signal_type === 'CLUSTER_BUY' ? 'success' : 'neutral' }, SIGNAL_BADGE_LABEL[detail.signal_type]),
        createElement(StatusBadge, { tone: 'neutral' }, 'Discovery signal'),
        ...(detail.ticker_unresolved ? [createElement(StatusBadge, { tone: 'warning', key: 'unresolved' }, 'Ticker unresolved')] : []),
      ),
      createElement('h3', { className: 'owl-row-title' }, `${signal.ticker} — ${signal.company_name}`),
      createElement(
        'p',
        { className: 'owl-row-helper' },
        createElement('strong', { style: { fontFamily: 'var(--owl-font-mono)' } }, conviction),
        ` · ${managers}. A 13F signal — your agent flags it; you decide whether to research it.`,
      ),
    ),
    createElement(
      'div',
      { className: 'owl-row-aside' },
      createElement(OwlButtonLink, { href: signal.href, variant: 'secondary' }, 'Review candidate →'),
    ),
  )
}

// ── 4. Awaiting your authorization (the command panel) ────────────────────────

function createCommandPanel(dashboard: AppCommandCenter) {
  return createElement(
    'section',
    { 'aria-label': 'Command cockpit overview', className: 'owl-section-card', style: { gap: 'var(--owl-space-4)' } },
    createElement('p', { className: 'owl-cc-section-accent' }, 'Awaiting your authorization'),
    createElement('h2', { className: 'owl-section-title' }, getPrimaryPriorityHeadline(dashboard)),
    // Plain text (not a heading) so it never collides with an approval item title heading;
    // the canonical heading for next_recommended_action lives in the next-action queue.
    createElement('p', { className: 'owl-cc-directive' }, dashboard.next_recommended_action),
    createNextActionQueue(dashboard),
    createApprovalQueue(dashboard),
    createStatusLine(dashboard),
  )
}

function createNextActionQueue(dashboard: AppCommandCenter) {
  const cards = buildActionCards(dashboard)

  return createElement(
    'div',
    { 'aria-label': 'Next action queue', className: 'owl-row-list' },
    ...cards.map((card) => createActionRow(card)),
  )
}

function createActionRow(card: ActionCard) {
  return createElement(
    'div',
    { className: 'owl-row owl-row-top' },
    createElement(
      'div',
      { className: 'owl-row-main' },
      createElement('h3', { className: 'owl-row-title' }, card.title),
      createElement('p', { className: 'owl-row-helper' }, card.description),
    ),
    createElement(
      'div',
      { className: 'owl-row-aside' },
      createElement(OwlButtonLink, { href: card.href, variant: card.tone === 'critical' ? 'danger' : 'secondary' }, card.label),
    ),
  )
}

function createApprovalQueue(dashboard: AppCommandCenter) {
  if (dashboard.approval_queue.length === 0) {
    return null
  }

  const groups = groupApprovalQueue(dashboard.approval_queue)
  const count = dashboard.approval_queue.length

  return createElement(
    'div',
    {
      'aria-label': 'Approval queue',
      role: 'region',
      style: { borderTop: '1px solid rgba(214, 178, 94, 0.18)', display: 'grid', gap: 'var(--owl-space-4)', paddingTop: 'var(--owl-space-4)' },
    },
    createElement('p', { className: 'owl-cc-section-accent' }, 'Approval queue'),
    createElement(
      'p',
      { className: 'owl-body', style: { margin: 0 } },
      `${count} pending ${count === 1 ? 'proposal' : 'proposals'} grouped by decision type`,
    ),
    ...groups.map(([groupLabel, items]) => createElement(
      'div',
      { key: groupLabel, style: { display: 'grid', gap: 'var(--owl-space-2)' } },
      createElement('p', { className: 'owl-label' }, groupLabel),
      createElement(
        'div',
        { className: 'owl-row-list' },
        ...items.map((item) => createApprovalRow(item)),
      ),
    )),
  )
}

function createApprovalRow(item: AppCommandCenter['approval_queue'][number]) {
  return createElement(
    'div',
    { key: item.id, className: 'owl-row owl-row-top' },
    createElement(
      'div',
      { className: 'owl-row-main' },
      createElement('h3', { className: 'owl-row-title' }, item.title),
      createElement('p', { className: 'owl-row-helper' }, item.after_summary),
      createElement(
        'div',
        { className: 'owl-activity-meta' },
        createElement(SourceChip, { id: item.actor_label, label: 'Actor' }),
        createElement(SourceChip, { href: auditEventHref(item.audit_event_id), id: item.audit_event_id, label: 'Audit event' }),
      ),
      createElement(
        'details',
        { style: { marginTop: '0.2rem' } },
        createElement('summary', { style: { color: 'var(--owl-color-gold-bright)', cursor: 'pointer', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-sm)', fontWeight: 700 } }, 'Evidence & impact'),
        createElement(
          'div',
          { className: 'owl-activity-meta', style: { marginTop: '0.5rem' } },
          item.provider_report_id === undefined ? null : createElement(SourceChip, { id: item.provider_report_id, label: 'Provider report' }),
          ...(item.source_ids.length === 0 ? [] : item.source_ids.map((sourceId) => createElement(SourceChip, { id: sourceId, key: `source:${sourceId}`, label: 'Source' }))),
          ...((item.provider_run_ids ?? []).map((providerRunId) => createElement(SourceChip, { id: providerRunId, key: `provider-run:${providerRunId}`, label: 'Provider run' }))),
        ),
        createElement(
          'div',
          { style: { display: 'grid', gap: '0.3rem', marginTop: '0.5rem' } },
          createApprovalDetailLine('Before', item.before_summary),
          createApprovalDetailLine('Shariah impact', item.shariah_impact),
          createApprovalDetailLine('Accounting impact', item.accounting_impact),
        ),
      ),
    ),
    createApprovalActions(item),
  )
}

function createApprovalDetailLine(label: string, value: string) {
  return createElement(
    'p',
    { className: 'owl-row-helper', style: { margin: 0 } },
    createElement('strong', { style: { color: 'var(--owl-color-muted)', fontWeight: 700 } }, `${label}: `),
    value,
  )
}

function createApprovalActions(item: AppCommandCenter['approval_queue'][number]) {
  const actions = [
    item.approve_action_label === undefined ? undefined : { label: item.approve_action_label, variant: 'primary' as const },
    item.reject_action_label === undefined ? undefined : { label: item.reject_action_label, variant: 'secondary' as const },
    item.override_action_label === undefined ? undefined : { label: item.override_action_label, variant: 'secondary' as const },
  ].filter((action): action is { label: string; variant: 'primary' | 'secondary' } => action !== undefined)

  if (actions.length === 0) {
    return createElement('div', { className: 'owl-row-aside' }, createElement(OwlButtonLink, { href: item.href, variant: 'secondary' }, 'Open audit details'))
  }

  return createElement(
    'div',
    { className: 'owl-row-aside' },
    ...actions.map((action) => createElement(OwlButtonLink, { href: item.href, key: action.label, variant: action.variant }, action.label)),
  )
}

/** Quiet letterhead footnote: provider / strategy / shariah / ledger status. */
function createStatusLine(dashboard: AppCommandCenter) {
  const statuses = [
    dashboard.setup_status,
    dashboard.provider_status,
    dashboard.strategy_status,
    dashboard.shariah_status,
    dashboard.ledger_status,
  ]
  return createElement(
    'p',
    { 'aria-label': 'System status', className: 'owl-cc-status-line' },
    statuses.join('   ·   '),
  )
}

// ── 5. The agent's desk (research, live) ──────────────────────────────────────

function createAgentsDesk(dashboard: AppCommandCenter) {
  const cases = dashboard.pipeline_counts.research_cases
  const hasCases = cases > 0
  const stateLine = hasCases
    ? `Tracking ${cases} ${cases === 1 ? 'case' : 'cases'} through the swarm — front gates and deep-dive lanes running under your value discipline.`
    : 'No cases yet — point your agent at a ticker and the swarm runs the front gates and deep-dive lanes.'

  const links: ReactNode[] = [
    createElement(OwlButtonLink, { href: '/research', key: 'cockpit' }, 'Open research cockpit'),
    createElement('a', { className: 'owl-cc-desk-link owl-focusable', href: '/pipeline', key: 'pipeline' }, 'Watch live execution →'),
  ]
  if (!hasCases) {
    links.push(createElement('a', { className: 'owl-cc-desk-link owl-focusable', href: '/research/new', key: 'start' }, 'Start the first case →'))
  }

  return createElement(
    'section',
    { 'aria-label': 'Your research agent', className: 'owl-section-card owl-cc-desk', style: { gap: 'var(--owl-space-3)' } },
    createElement(
      'span',
      { className: 'owl-cc-live' },
      createElement('span', { 'aria-hidden': 'true', className: 'owl-cc-live-dot' }),
      hasCases ? 'Agent on watch' : 'Agent idle',
    ),
    createElement('p', { className: 'owl-cc-section-accent', style: { marginTop: 'var(--owl-space-1)' } }, 'The agent’s desk'),
    createElement('p', { className: 'owl-body', style: { margin: 0 } }, stateLine),
    createElement('div', { className: 'owl-cc-desk-links' }, ...links),
  )
}

// ── 6. Holdings & books ───────────────────────────────────────────────────────

function createHoldingsAndBooks(dashboard: AppCommandCenter) {
  const accounting = createAccountingRow(dashboard)
  const reviews = createHoldingReviewRows(dashboard)

  if (accounting === null && reviews === null) {
    return null
  }

  return createElement(
    'section',
    { 'aria-label': 'Portfolio and compliance', className: 'owl-section-card', style: { gap: 'var(--owl-space-4)' } },
    createElement('p', { className: 'owl-cc-section-accent' }, 'Holdings & books'),
    accounting,
    reviews,
  )
}

function createAccountingRow(dashboard: AppCommandCenter) {
  const alert = dashboard.accounting_alert
  if (alert === undefined) {
    return null
  }

  return createElement(
    'div',
    { className: 'owl-row owl-row-top' },
    createElement(
      'div',
      { className: 'owl-row-main' },
      createElement('p', { className: 'owl-row-title' }, alert.label),
      createElement('p', { className: 'owl-row-helper' }, alert.message),
    ),
    createElement(
      'div',
      { className: 'owl-row-aside' },
      createElement(OwlButtonLink, { href: alert.href, variant: 'secondary' }, `Open ${alert.label.toLowerCase()}`),
    ),
  )
}

function createHoldingReviewRows(dashboard: AppCommandCenter) {
  if (dashboard.holding_review_prompts.length === 0) {
    return null
  }

  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-2)' } },
    createElement('p', { className: 'owl-label' }, 'Holding review schedule'),
    createElement(
      'div',
      { className: 'owl-row-list' },
      ...dashboard.holding_review_prompts.map((prompt) => createElement(
        'div',
        { key: prompt.holding_id, className: 'owl-row owl-row-top' },
        createElement(
          'div',
          { className: 'owl-row-main' },
          createElement('h3', { className: 'owl-row-title' }, prompt.label),
          createElement('p', { className: 'owl-row-helper' }, `Next review: ${prompt.next_review_at} · ${formatReviewDistance(prompt.days_until_review)}`),
        ),
        createElement(
          'div',
          { className: 'owl-row-aside' },
          createElement(StatusBadge, { tone: prompt.status === 'due' ? 'warning' : 'neutral' }, prompt.status === 'due' ? 'Due now' : 'Upcoming'),
          createElement(OwlButtonLink, { href: `/portfolio#${prompt.holding_id}`, variant: prompt.status === 'due' ? 'danger' : 'secondary' }, `Review ${prompt.label}`),
        ),
      )),
    ),
  )
}

// ── 7. The ledger (recent activity) ───────────────────────────────────────────

function createLedgerFeed(dashboard: AppCommandCenter) {
  const activities = dashboard.recent_activity

  return createElement(
    'section',
    { 'aria-label': 'Ledger activity reference module', className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-cc-section-accent' }, 'The ledger'),
    activities.length === 0
      ? createEmptyActivity('No recent events', 'The ledger has no recent activity to show in this view yet.')
      : createElement(
        'div',
        { className: 'owl-cc-feed' },
        ...activities.map((activity) => createActivityLine(activity)),
      ),
  )
}

function createActivityLine(activity: AppCommandCenter['recent_activity'][number]) {
  const summary = summarizeActivity(activity.label)

  if (summary.isZeroState) {
    return createEmptyActivity('Operating ledger is empty', 'No research, watchlist, holding, accounting, or purification activity has been recorded yet.')
  }

  return createElement(
    'div',
    { key: activity.event_id, className: 'owl-cc-feed-line' },
    createElement('p', { className: 'owl-cc-feed-title' }, summary.title),
    createElement(
      'div',
      { className: 'owl-activity-meta' },
      summary.actor === undefined ? null : createElement(SourceChip, { id: summary.actor, label: 'Actor' }),
      createElement(SourceChip, { id: activity.event_id, label: 'Audit event' }),
    ),
  )
}

function createEmptyActivity(title: string, description: string) {
  return createElement(
    'div',
    { className: 'owl-row-main' },
    createElement('p', { className: 'owl-row-title' }, title),
    createElement('p', { className: 'owl-row-helper' }, description),
  )
}

// ── Data helpers (unchanged behaviour) ────────────────────────────────────────

function describeTopQueueItem(item: AppCommandCenter['approval_queue'][number]): string {
  switch (item.decision_type) {
    case 'watchlist_confirmation': {
      const shariah = item.shariah_impact.toLowerCase()
      if (shariah.includes('blocked') || shariah.includes('pending')) {
        return `${item.target_label ?? item.title}: clear the Shariah gate`
      }
      return `Confirm ${item.target_label ?? item.title}`
    }
    case 'holding_review':
      return `Review ${item.target_label ?? item.title}`
    default:
      return item.title
  }
}

function getPrimaryPriorityHeadline(dashboard: AppCommandCenter): string {
  const pendingActions = dashboard.pipeline_counts.pending_user_actions
  const topItem = dashboard.approval_queue[0]

  if (pendingActions > 0) {
    const waiting = `${pendingActions} ${pendingActions === 1 ? 'user decision is' : 'user decisions are'} waiting`
    return topItem === undefined ? waiting : `${describeTopQueueItem(topItem)} — ${waiting}`
  }

  if (isProviderReadinessWarning(dashboard.provider_status)) {
    return 'Provider readiness needs attention'
  }

  if (dashboard.pipeline_counts.research_cases === 0) {
    return 'Start the first research workflow'
  }

  return 'Continue the highest-priority workflow'
}

function groupApprovalQueue(items: AppCommandCenter['approval_queue']): [string, AppCommandCenter['approval_queue']][] {
  const groups = new Map<string, AppCommandCenter['approval_queue']>()
  for (const item of items) {
    const groupItems = groups.get(item.group_label) ?? []
    groupItems.push(item)
    groups.set(item.group_label, groupItems)
  }
  return [...groups.entries()]
}

function auditEventHref(eventId: string): string {
  return `/audit?event_id=${eventId}#${eventId}`
}

function countsText(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function buildActionCards(dashboard: AppCommandCenter): ActionCard[] {
  const cards: ActionCard[] = []
  const counts = dashboard.pipeline_counts
  const firstDueReview = dashboard.holding_review_prompts.find((prompt) => prompt.status === 'due')
  const firstUpcomingReview = dashboard.holding_review_prompts.find((prompt) => prompt.status === 'upcoming')

  if (counts.watchlist_drafts > 0) {
    cards.push({
      category: 'Pending draft confirmation',
      description: `${counts.watchlist_drafts} ${counts.watchlist_drafts === 1 ? 'draft needs' : 'drafts need'} explicit user confirmation before monitoring or portfolio actions.`,
      href: '/watchlist',
      label: 'Open watchlist drafts',
      title: 'Review pending watchlist drafts',
      tone: 'warning',
    })
  }

  if (isProviderReadinessWarning(dashboard.provider_status)) {
    cards.push({
      category: 'Local assistant setup needed',
      description: 'Owlfolio cannot use the selected local assistant yet. Open provider details for the technical checks to finish setup.',
      href: '/settings/providers',
      label: 'Open setup details',
      title: 'Finish local assistant setup',
      tone: 'warning',
    })
  }

  if (hasPendingHoldingReviewDraft(dashboard)) {
    cards.push({
      category: 'Pending holding review draft',
      description: 'Confirm, override, or reject the provider-authored draft before changing confirmed portfolio state.',
      href: '/portfolio',
      label: 'Open holding review draft',
      title: 'Review pending strategy review draft',
      tone: 'warning',
    })
  }

  if (firstDueReview !== undefined) {
    cards.push({
      category: 'Review schedule',
      description: `${firstDueReview.label} is ${formatReviewDistance(firstDueReview.days_until_review)}. Run the strategy review draft before changing confirmed portfolio state.`,
      href: `/portfolio#${firstDueReview.holding_id}`,
      label: `Review ${firstDueReview.label}`,
      title: 'Run due holding review',
      tone: 'critical',
    })
  }

  if (dashboard.accounting_alert !== undefined) {
    cards.push({
      category: 'Accounting reminder',
      description: dashboard.accounting_alert.message,
      href: dashboard.accounting_alert.href,
      label: 'Open accounting report',
      title: 'Review monthly accounting',
      tone: 'info',
    })
  }

  if (counts.open_holdings > 0) {
    cards.push({
      category: 'Purification reminder',
      description: 'Review dividend, fee, and non-compliant income inputs before month-end purification close.',
      href: '/purification',
      label: 'Open purification ledger',
      title: 'Check purification obligations',
      tone: 'info',
    })
  }

  if (cards.length === 0 && firstUpcomingReview !== undefined) {
    cards.push({
      category: 'Upcoming review schedule',
      description: `${firstUpcomingReview.label} is scheduled for ${firstUpcomingReview.next_review_at} (${formatReviewDistance(firstUpcomingReview.days_until_review)}).`,
      href: `/portfolio#${firstUpcomingReview.holding_id}`,
      label: `Open ${firstUpcomingReview.label} holding`,
      title: 'Prepare next holding review',
      tone: 'info',
    })
  }

  if (cards.length === 0) {
    // This card's title carries next_recommended_action as a heading (the
    // directive above is plain text, so this is the single heading for it).
    cards.push({
      category: counts.research_cases === 0 ? 'Zero state' : 'Workflow continuation',
      description: counts.research_cases === 0
        ? 'No durable research workflow exists yet. Open the selected-strategy research cockpit, then use manual intake only when needed.'
        : 'No urgent blockers are open. Continue from the latest research, watchlist, or portfolio workflow.',
      href: dashboard.primary_action.href,
      label: dashboard.primary_action.label,
      title: dashboard.next_recommended_action,
      tone: counts.research_cases === 0 ? 'warning' : 'success',
    })
  }

  return cards
}

function hasPendingHoldingReviewDraft(dashboard: AppCommandCenter): boolean {
  const pendingReviewDraftCount = dashboard.pipeline_counts.pending_user_actions - dashboard.pipeline_counts.watchlist_drafts
  return pendingReviewDraftCount > 0
    || dashboard.next_recommended_action.toLowerCase().includes('drafted strategy review')
}

function isProviderReadinessWarning(providerStatus: string): boolean {
  const status = providerStatus.toLowerCase()

  if (
    status.includes('ready for deterministic demo mode')
    || status.includes('locally runnable through built-in deterministic demo mode')
    || status.includes('mock provider personal local mode')
  ) {
    return false
  }

  return status.includes('not ready')
    || status.includes('not configured')
    || status.includes('unsupported')
    || status.includes('experimental')
    || status.includes('missing')
}

function summarizeActivity(label: string): ActivitySummary {
  const normalized = label.trim()
  if (normalized.toLowerCase() === 'no ledger events yet' || normalized.toLowerCase() === 'no durable ledger events yet') {
    return { isZeroState: true, title: 'Operating ledger is empty' }
  }

  const [eventName = '', actor] = normalized.split(' by ')
  return {
    ...(actor === undefined ? {} : { actor }),
    isZeroState: false,
    title: humanizeEventName(eventName),
  }
}

function humanizeEventName(eventName: string): string {
  const words = eventName.replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  if (words.length === 0) {
    return 'Ledger event recorded'
  }

  return `${words[0]?.toUpperCase() ?? ''}${words.slice(1)}`
}

function formatReviewDistance(daysUntilReview: number): string {
  if (daysUntilReview < 0) {
    const daysOverdue = Math.abs(daysUntilReview)
    return `${daysOverdue} ${daysOverdue === 1 ? 'day' : 'days'} overdue`
  }

  if (daysUntilReview === 0) {
    return '0 days'
  }

  return `${daysUntilReview} ${daysUntilReview === 1 ? 'day' : 'days'}`
}
