import { createElement } from 'react'

import { FinancialNumber, OwlButtonLink, OwlCard, SourceChip } from './designSystem'
import { StatusBadge } from './StatusBadge'
import type { AppCommandCenter } from '../lib/demo'

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

type MetricCardProps = {
  actionLabel: string
  helper: string
  href: string
  label: string
  value: number
}

type OperationalSignal = {
  description: string
  label: string
  tone: 'blocked' | 'draft' | 'manual' | 'success'
}

export function CommandCenter({ dashboard }: CommandCenterProps) {
  const counts = dashboard.pipeline_counts

  return createElement(
    'main',
    {
      style: {
        color: '#f7f8ff',
        padding: '2rem 0 3rem',
      },
    },
    createElement(
      'section',
      {
        style: {
          margin: '0 auto',
          maxWidth: '1040px',
        },
      },
      createElement(
        'p',
        { style: { color: '#7c8cff', fontFamily: 'var(--owl-font-mono)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' } },
        dashboard.product_name,
      ),
      createElement(
        'h1',
        { style: { fontSize: 'clamp(2.25rem, 5vw, 4.5rem)', lineHeight: 1, margin: '0.5rem 0 1rem' } },
        'Command Center',
      ),
      createElement(
        'p',
        { style: { color: '#9aa4b7', fontSize: '1.15rem', maxWidth: '720px' } },
        'Daily local operating cockpit for autonomous research, user approvals, accounting reminders, purification follow-up, and audit review.',
      ),
      createStatusStrip(dashboard),
      createElement(
        'section',
        {
          'aria-label': 'Pipeline counts',
          style: {
            display: 'grid',
            gap: '1rem',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            marginBottom: '1.5rem',
          },
        },
        ...buildMetricCards(counts).map((metric) => createElement(MetricCard, { key: metric.label, ...metric })),
      ),
      createOperatingSurface(dashboard),
      createSecondaryReferenceModules(dashboard),
    ),
  )
}

function createOperatingSurface(dashboard: AppCommandCenter) {
  return createElement(
    'section',
    { 'aria-label': 'Operating action surface', className: 'owl-command-operating-surface' },
    createElement(
      OwlCard,
      { className: 'owl-command-action-card', eyebrow: 'Operating priority' },
      createElement(
        'p',
        { style: { color: '#f7f8ff', fontSize: '1.35rem', fontWeight: 700, letterSpacing: '-0.02em', margin: '0.45rem 0 0.35rem' } },
        dashboard.next_recommended_action,
      ),
      createElement(
        'p',
        { style: { color: '#9aa4b7', margin: '0 0 1rem' } },
        'Primary decisions stay on top; lower-priority accounting, review, and audit references are separated below.',
      ),
      createElement(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' } },
        createElement(OwlButtonLink, { href: dashboard.primary_action.href }, dashboard.primary_action.label),
        dashboard.secondary_action === undefined
          ? null
          : createElement(OwlButtonLink, { href: dashboard.secondary_action.href, variant: 'secondary' }, dashboard.secondary_action.label),
      ),
      createNextActionQueue(dashboard),
      createApprovalQueue(dashboard),
    ),
  )
}

function createApprovalQueue(dashboard: AppCommandCenter) {
  if (dashboard.approval_queue.length === 0) {
    return null
  }

  const groups = groupApprovalQueue(dashboard.approval_queue)

  return createElement(
    'section',
    {
      'aria-label': 'Approval queue',
      style: {
        borderTop: '1px solid rgba(148, 163, 184, 0.18)',
        display: 'grid',
        gap: '1rem',
        marginTop: '1.2rem',
        paddingTop: '1.2rem',
      },
    },
    createElement(
      'div',
      null,
      createElement('p', { style: { color: '#7c8cff', fontFamily: 'var(--owl-font-mono)', fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.08em', margin: 0, textTransform: 'uppercase' } }, 'Approval queue'),
      createElement(
        'p',
        { style: { color: '#9aa4b7', margin: '0.35rem 0 0' } },
        `${dashboard.approval_queue.length} pending ${dashboard.approval_queue.length === 1 ? 'proposal' : 'proposals'} grouped by decision type`,
      ),
    ),
    ...groups.map(([groupLabel, items]) => createApprovalGroup(groupLabel, items)),
  )
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

function createApprovalGroup(groupLabel: string, items: AppCommandCenter['approval_queue']) {
  return createElement(
    'section',
    {
      key: groupLabel,
      style: {
        background: 'rgba(255, 255, 255, 0.026)',
        border: '1px solid rgba(148, 163, 184, 0.14)',
        borderRadius: '0.9rem',
        display: 'grid',
        gap: '0.75rem',
        padding: '0.9rem',
      },
    },
    createElement('h2', { style: { color: '#f7f8ff', fontSize: '1rem', margin: 0 } }, groupLabel),
    ...items.map((item) => createApprovalQueueCard(item)),
  )
}

function createApprovalQueueCard(item: AppCommandCenter['approval_queue'][number]) {
  return createElement(
    'article',
    {
      key: item.id,
      style: {
        background: 'rgba(5, 8, 15, 0.52)',
        border: '1px solid rgba(124, 140, 255, 0.18)',
        borderRadius: '0.85rem',
        display: 'grid',
        gap: '0.75rem',
        padding: '0.9rem',
      },
    },
    createElement('h3', { style: { color: '#f7f8ff', fontSize: '1.02rem', margin: 0 } }, item.title),
    createElement(
      'div',
      { className: 'owl-activity-meta' },
      createElement(SourceChip, { id: item.actor_label, label: 'Actor' }),
      item.provider_report_id === undefined ? null : createElement(SourceChip, { id: item.provider_report_id, label: 'Provider report' }),
      createElement(SourceChip, { href: auditEventHref(item.audit_event_id), id: item.audit_event_id, label: 'Audit event' }),
      ...(item.source_ids.length === 0 ? [] : item.source_ids.map((sourceId) => createElement(SourceChip, { id: sourceId, key: `source:${sourceId}`, label: 'Source' }))),
      ...((item.provider_run_ids ?? []).map((providerRunId) => createElement(SourceChip, { id: providerRunId, key: `provider-run:${providerRunId}`, label: 'Provider run' }))),
    ),
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.55rem', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' } },
      createApprovalDetail('Before', item.before_summary),
      createApprovalDetail('After', item.after_summary),
      createApprovalDetail('Shariah impact', item.shariah_impact),
      createApprovalDetail('Accounting impact', item.accounting_impact),
    ),
    createApprovalActions(item),
  )
}

function createApprovalDetail(label: string, value: string) {
  return createElement(
    'div',
    {
      style: {
        background: 'rgba(255, 255, 255, 0.028)',
        border: '1px solid rgba(148, 163, 184, 0.12)',
        borderRadius: '0.7rem',
        padding: '0.7rem',
      },
    },
    createElement('p', { style: { color: '#9aa4b7', fontFamily: 'var(--owl-font-mono)', fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.08em', margin: '0 0 0.25rem', textTransform: 'uppercase' } }, label),
    createElement('p', { style: { color: '#cbd5e1', margin: 0 } }, value),
  )
}

function createApprovalActions(item: AppCommandCenter['approval_queue'][number]) {
  const actions = [
    item.approve_action_label === undefined ? undefined : { label: item.approve_action_label, variant: 'primary' as const },
    item.reject_action_label === undefined ? undefined : { label: item.reject_action_label, variant: 'secondary' as const },
    item.override_action_label === undefined ? undefined : { label: item.override_action_label, variant: 'secondary' as const },
  ].filter((action): action is { label: string; variant: 'primary' | 'secondary' } => action !== undefined)

  if (actions.length === 0) {
    return createElement('div', { style: { display: 'flex', justifyContent: 'flex-start' } }, createElement(OwlButtonLink, { href: item.href, variant: 'secondary' }, 'Open audit details'))
  }

  return createElement(
    'div',
    { style: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
    ...actions.map((action) => createElement(OwlButtonLink, { href: item.href, key: action.label, variant: action.variant }, action.label)),
  )
}

function auditEventHref(eventId: string): string {
  return `/audit?event_id=${eventId}#${eventId}`
}

function createSecondaryReferenceModules(dashboard: AppCommandCenter) {
  return createElement(
    'section',
    { 'aria-label': 'Secondary reference modules', className: 'owl-command-reference-grid' },
    createAccountingAlert(dashboard),
    createDataSafetyCaveat(dashboard),
    createHoldingReviewSchedule(dashboard),
    createOperationalAwareness(dashboard),
    createRecentActivity(dashboard),
  )
}

function createDataSafetyCaveat(dashboard: AppCommandCenter) {
  return createElement(
    'section',
    {
      'aria-label': 'Data safety caveat module',
      className: 'owl-command-reference-module',
      style: {
        background: 'rgba(251, 146, 60, 0.08)',
        borderColor: 'rgba(251, 146, 60, 0.32)',
        display: 'grid',
        gap: '0.5rem',
      },
    },
    createElement('p', { style: { color: '#f97316', fontFamily: 'var(--owl-font-mono)', fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.08em', margin: 0, textTransform: 'uppercase' } }, 'Data safety caveat'),
    createElement('p', { style: { color: '#f7f8ff', fontWeight: 900, margin: 0 } }, 'Ledger backup and restore for this flow is operator-first and CLI-assisted today.'),
    createElement(
      'p',
      { style: { color: '#f1f5f9', margin: 0 } },
      'There is no in-app backup/restore wizard yet. Keep your own offline export/restore workflow and runbook for the local runtime files that power this workspace.',
    ),
    createElement(
      'p',
      { style: { color: '#9aa4b7', margin: 0, fontSize: '0.92rem' } },
      `${dashboard.product_name} surfaces local-only operational state and does not replace explicit backup/restore drill commands.`,
    ),
    createElement(
      'p',
      { style: { color: '#eab308', fontFamily: 'var(--owl-font-mono)', fontSize: '0.8rem', fontWeight: 700, margin: '0.2rem 0 0' } },
      'Use `corepack pnpm ops:backup:manifest` and `corepack pnpm ops:restore:dry-run` for operator-safe backup verification before rotating environments.',
    ),
  )
}

function createStatusStrip(dashboard: AppCommandCenter) {
  return createElement(
    'div',
    { style: { display: 'grid', gap: '0.75rem', margin: '1.5rem 0 2rem' } },
    createElement(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem' } },
      createElement(StatusBadge, { tone: dashboard.setup_status.toLowerCase().includes('ready') || dashboard.setup_status.toLowerCase().includes('initialized') ? 'success' : 'warning' }, dashboard.setup_status),
      createElement(StatusBadge, { tone: isProviderReadinessWarning(dashboard.provider_status) ? 'warning' : 'neutral' }, dashboard.provider_status),
      createElement(StatusBadge, { tone: 'success' }, dashboard.strategy_status),
      createElement(StatusBadge, { tone: dashboard.shariah_status.toLowerCase().includes('disabled') ? 'warning' : 'success' }, dashboard.shariah_status),
      createElement(StatusBadge, { tone: dashboard.ledger_status.toLowerCase().includes('not initialized') ? 'warning' : 'success' }, dashboard.ledger_status),
    ),
    createElement(
      'div',
      {
        'aria-label': 'Workflow ticker strip',
        style: {
          alignItems: 'center',
          background: 'rgba(5, 8, 15, 0.72)',
          border: '1px solid rgba(132, 145, 255, 0.18)',
          borderRadius: '999px',
          color: '#9aa4b7',
          display: 'flex',
          flexWrap: 'wrap',
          fontFamily: 'var(--owl-font-mono)',
          fontSize: '0.72rem',
          gap: '0.45rem 0.9rem',
          letterSpacing: '0.04em',
          padding: '0.55rem 0.8rem',
          textTransform: 'uppercase',
        },
      },
      createTickerItem('DRAFTS', countsText(dashboard.pipeline_counts.watchlist_drafts)),
      createTickerItem('CONFIRMED', countsText(dashboard.pipeline_counts.confirmed_watchlist_items)),
      createTickerItem('HOLDINGS', countsText(dashboard.pipeline_counts.open_holdings)),
      createTickerItem('USER-ACTIONS', countsText(dashboard.pipeline_counts.pending_user_actions)),
    ),
  )
}

function createTickerItem(label: string, value: string) {
  return createElement(
    'span',
    { key: label },
    createElement('strong', { style: { color: '#f7f8ff' } }, label),
    ` ${value}`,
  )
}

function countsText(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function buildMetricCards(counts: AppCommandCenter['pipeline_counts']): MetricCardProps[] {
  return [
    {
      actionLabel: counts.research_cases === 0 ? 'Start research' : 'Open research intake',
      helper: counts.research_cases === 0
        ? 'Start a research case to seed the durable workflow ledger.'
        : 'Research dossiers with auditable provider/source evidence.',
      href: '/research/new',
      label: 'Research cases',
      value: counts.research_cases,
    },
    {
      actionLabel: 'Open watchlist',
      helper: counts.watchlist_drafts === 0
        ? 'No provider drafts waiting for user confirmation.'
        : 'Provider-authored drafts waiting for explicit user confirmation.',
      href: '/watchlist',
      label: 'Watchlist drafts',
      value: counts.watchlist_drafts,
    },
    {
      actionLabel: 'Review monitoring',
      helper: counts.confirmed_watchlist_items === 0
        ? 'No confirmed monitoring yet — confirm a watchlist draft before automation treats a company as actively monitored.'
        : 'User-confirmed monitoring items are eligible for scheduled review observations.',
      href: '/watchlist',
      label: 'Confirmed watchlist',
      value: counts.confirmed_watchlist_items,
    },
    {
      actionLabel: 'Open portfolio',
      helper: counts.open_holdings === 0
        ? 'No open holdings yet — open a holding from a confirmed watchlist item before portfolio accounting starts.'
        : 'Open holdings feed valuation, review schedule, accounting, and purification prompts.',
      href: '/portfolio',
      label: 'Open holdings',
      value: counts.open_holdings,
    },
    {
      actionLabel: 'Resolve actions',
      helper: counts.pending_user_actions === 0
        ? 'No pending approvals; automation is waiting for new provider drafts or due reviews.'
        : `${counts.pending_user_actions} approval ${counts.pending_user_actions === 1 ? 'task needs' : 'tasks need'} user confirmation before state changes.`,
      href: counts.watchlist_drafts > 0 ? '/watchlist' : '/portfolio',
      label: 'Pending user actions',
      value: counts.pending_user_actions,
    },
  ]
}

function createNextActionQueue(dashboard: AppCommandCenter) {
  const cards = buildActionCards(dashboard)

  return createElement(
    'section',
    {
      'aria-label': 'Next action queue',
      style: {
        borderTop: '1px solid rgba(148, 163, 184, 0.18)',
        display: 'grid',
        gap: '0.85rem',
        marginTop: '1.2rem',
        paddingTop: '1.2rem',
      },
    },
    createElement(
      'div',
      null,
      createElement('p', { style: { color: '#7c8cff', fontFamily: 'var(--owl-font-mono)', fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.08em', margin: 0, textTransform: 'uppercase' } }, 'Next action queue'),
      createElement('p', { style: { color: '#9aa4b7', margin: '0.35rem 0 0' } }, 'Prioritized by user confirmation, readiness blockers, due reviews, then operating hygiene.'),
    ),
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.75rem' } },
      ...cards.map((card, index) => createActionCard(card, index + 1)),
    ),
  )
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
      category: 'Production/live provider readiness incomplete',
      description: `${dashboard.provider_status}. Review credentials, support level, and certification evidence before relying on live provider-authored workflow runs.`,
      href: '/providers',
      label: 'Open provider setup evidence',
      title: 'Resolve production/live provider readiness',
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
    cards.push({
      category: counts.research_cases === 0 ? 'Zero state' : 'Workflow continuation',
      description: counts.research_cases === 0
        ? 'No durable research workflow exists yet. Start with a provider-scoped research case.'
        : 'No urgent blockers are open. Continue from the latest research, watchlist, or portfolio workflow.',
      href: dashboard.primary_action.href,
      label: dashboard.primary_action.label,
      title: dashboard.next_recommended_action,
      tone: counts.research_cases === 0 ? 'warning' : 'success',
    })
  }

  return cards
}

function createActionCard(card: ActionCard, priority: number) {
  const toneColor = card.tone === 'critical'
    ? '#ef4444'
    : card.tone === 'warning'
      ? '#fbbf24'
      : card.tone === 'success'
        ? 'var(--owl-color-shariah)'
        : '#0a84ff'

  return createElement(
    'article',
    {
      style: {
        background: 'rgba(255, 255, 255, 0.035)',
        border: `1px solid ${card.tone === 'critical' ? 'rgba(239, 68, 68, 0.38)' : 'rgba(148, 163, 184, 0.18)'}`,
        borderLeft: `3px solid ${toneColor}`,
        borderRadius: '0.85rem',
        display: 'grid',
        gap: '0.65rem',
        padding: '0.9rem',
      },
    },
    createElement('p', { style: { color: toneColor, fontFamily: 'var(--owl-font-mono)', fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.08em', margin: 0, textTransform: 'uppercase' } }, `Priority ${priority} · ${card.category}`),
    createElement('h2', { style: { color: '#f7f8ff', fontSize: '1.05rem', margin: 0 } }, card.title),
    createElement('p', { style: { color: '#cbd5e1', margin: 0 } }, card.description),
    createElement('div', { style: { display: 'flex', justifyContent: 'flex-start' } }, createElement(OwlButtonLink, { href: card.href, variant: card.tone === 'critical' ? 'danger' : 'secondary' }, card.label)),
  )
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

function createAccountingAlert(dashboard: AppCommandCenter) {
  if (dashboard.accounting_alert === undefined) {
    return null
  }

  return createElement(
    'section',
    {
      'aria-label': 'Accounting reference module',
      className: 'owl-command-reference-module owl-command-reference-module-accent',
      style: {
        display: 'grid',
        gap: '0.5rem',
      },
    },
    createElement(
      'p',
      { style: { color: '#7dd3fc', fontSize: '0.85rem', fontWeight: 900, margin: 0, textTransform: 'uppercase' } },
      'Accounting',
    ),
    createElement('p', { style: { color: '#f7f8ff', fontWeight: 900, margin: 0 } }, dashboard.accounting_alert.label),
    createElement('p', { style: { color: '#cbd5e1', margin: 0 } }, dashboard.accounting_alert.message),
    createElement('div', { style: { display: 'flex', justifyContent: 'flex-start' } }, createElement(OwlButtonLink, { href: dashboard.accounting_alert.href, variant: 'secondary' }, `Open ${dashboard.accounting_alert.label.toLowerCase()}`)),
  )
}

function createHoldingReviewSchedule(dashboard: AppCommandCenter) {
  if (dashboard.holding_review_prompts.length === 0) {
    return null
  }

  return createElement(
    'section',
    {
      'aria-label': 'Review schedule reference module',
      className: 'owl-command-reference-module',
      style: {
        display: 'grid',
        gap: '0.75rem',
      },
    },
    createElement(
      'p',
      { style: { color: '#9aa4b7', fontSize: '0.85rem', fontWeight: 800, margin: 0, textTransform: 'uppercase' } },
      'Holding review schedule',
    ),
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' } },
      ...dashboard.holding_review_prompts.map((prompt) => createElement(
        'article',
        {
          key: prompt.holding_id,
          style: {
            background: prompt.status === 'due' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(255, 255, 255, 0.035)',
            border: prompt.status === 'due' ? '1px solid rgba(239, 68, 68, 0.34)' : '1px solid rgba(148, 163, 184, 0.18)',
            borderRadius: '0.85rem',
            padding: '1rem',
          },
        },
        createElement('p', { style: { color: '#f7f8ff', fontWeight: 900, margin: 0 } }, prompt.label),
        createElement(
          'p',
          { style: { color: prompt.status === 'due' ? '#fecaca' : '#cbd5e1', fontSize: '0.85rem', fontWeight: 800, margin: '0.35rem 0' } },
          prompt.status === 'due' ? 'Due now' : 'Upcoming',
        ),
        createElement('p', { style: { color: '#cbd5e1', margin: 0 } }, `Next review: ${prompt.next_review_at}`),
        createElement('p', { style: { color: '#9aa4b7', fontSize: '0.9rem', margin: '0.25rem 0 0.75rem' } }, formatReviewDistance(prompt.days_until_review)),
        createElement(OwlButtonLink, { href: `/portfolio#${prompt.holding_id}`, variant: prompt.status === 'due' ? 'danger' : 'secondary' }, `Review ${prompt.label} in portfolio`),
      )),
    ),
  )
}

function createOperationalAwareness(dashboard: AppCommandCenter) {
  const signals = buildOperationalSignals(dashboard)

  return createElement(
    'section',
    {
      'aria-label': 'Operational awareness module',
      className: 'owl-command-reference-module owl-command-awareness-module',
    },
    createElement('p', { className: 'owl-command-module-eyebrow' }, 'Operational awareness'),
    createElement(
      'div',
      { className: 'owl-command-awareness-list' },
      ...signals.map((signal) => createElement(
        'article',
        { className: 'owl-command-awareness-item', key: signal.label },
        createElement(StatusBadge, { tone: signal.tone }, signal.label),
        createElement('p', { className: 'owl-command-awareness-copy' }, signal.description),
      )),
    ),
  )
}

function buildOperationalSignals(dashboard: AppCommandCenter): OperationalSignal[] {
  const providerBlocked = isProviderReadinessWarning(dashboard.provider_status)
  const pendingApprovals = dashboard.pipeline_counts.pending_user_actions
  const watchlistDrafts = dashboard.pipeline_counts.watchlist_drafts
  const pendingHoldingReviewDraft = hasPendingHoldingReviewDraft(dashboard)

  return [
    {
      description: providerBlocked
        ? 'Live/provider-backed workflows fail closed until setup, support level, and certification evidence are ready.'
        : 'Provider evidence is acceptable for the current local workflow mode.',
      label: providerBlocked ? 'Provider readiness blocked' : 'Provider readiness clear',
      tone: providerBlocked ? 'blocked' : 'success',
    },
    {
      description: 'Dry-run worker observations stay local and require user confirmation before portfolio-impacting state changes.',
      label: 'Automated monitoring',
      tone: 'manual',
    },
    {
      description: pendingApprovals === 0
        ? 'No provider draft is currently waiting for a user-authored confirmation, override, or rejection.'
        : `${pendingApprovals} pending ${pendingApprovals === 1 ? 'approval is' : 'approvals are'} waiting; ${watchlistDrafts} ${watchlistDrafts === 1 ? 'watchlist draft is' : 'watchlist drafts are'} separate from ${pendingHoldingReviewDraft ? 'holding review drafts' : 'confirmed portfolio state'}.`,
      label: 'User approval boundary',
      tone: pendingApprovals === 0 ? 'success' : 'draft',
    },
    {
      description: dashboard.ledger_status,
      label: 'Audit ledger traceability',
      tone: dashboard.ledger_status.toLowerCase().includes('not initialized') ? 'blocked' : 'success',
    },
  ]
}

function createRecentActivity(dashboard: AppCommandCenter) {
  const activities = dashboard.recent_activity

  return createElement(
    'section',
    { 'aria-label': 'Ledger activity reference module', className: 'owl-command-reference-module' },
    createElement(
      'p',
      { style: { color: '#9aa4b7', fontSize: '0.82rem', fontWeight: 700, margin: '0 0 0.5rem', textTransform: 'uppercase' } },
      'Recent ledger activity',
    ),
    activities.length === 0
      ? createEmptyActivityCard('No recent events', 'The ledger has no recent activity to show in this view yet.')
      : createElement(
        'ul',
        { style: { display: 'grid', gap: '0.6rem', listStyle: 'none', margin: 0, padding: 0 } },
        ...activities.map((activity) => createElement('li', { key: activity.event_id }, createActivityCard(activity))),
      ),
  )
}

function createActivityCard(activity: AppCommandCenter['recent_activity'][number]) {
  const summary = summarizeActivity(activity.label)

  if (summary.isZeroState) {
    return createEmptyActivityCard('Operating ledger is empty', 'No research, watchlist, holding, accounting, or purification activity has been recorded yet.')
  }

  return createElement(
    'article',
    {
      style: {
        background: 'rgba(255, 255, 255, 0.026)',
        border: '1px solid rgba(148, 163, 184, 0.14)',
        borderRadius: '0.75rem',
        padding: '0.7rem 0.8rem',
      },
    },
    createElement('p', { style: { color: '#f7f8ff', fontWeight: 750, margin: 0 } }, summary.title),
    createElement(
      'div',
      { className: 'owl-activity-meta' },
      summary.actor === undefined ? null : createElement(SourceChip, { id: summary.actor, label: 'Actor' }),
      createElement(SourceChip, { id: activity.event_id, label: 'Audit event' }),
    ),
  )
}

function createEmptyActivityCard(title: string, description: string) {
  return createElement(
    'article',
    {
      style: {
        background: 'rgba(124, 140, 255, 0.08)',
        border: '1px dashed rgba(124, 140, 255, 0.26)',
        borderRadius: '0.75rem',
        padding: '0.9rem',
      },
    },
    createElement('h2', { style: { color: '#f7f8ff', fontSize: '1rem', margin: 0 } }, title),
    createElement('p', { style: { color: '#cbd5e1', margin: '0.35rem 0 0' } }, description),
  )
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

function MetricCard({ actionLabel, helper, href, label, value }: MetricCardProps) {
  return createElement(
    OwlCard,
    { className: 'owl-metric-card' },
    createElement(
      'p',
      { className: 'owl-metric-label' },
      label,
    ),
    createElement('p', { className: 'owl-metric-value' }, createElement(FinancialNumber, { value })),
    createElement('p', { className: 'owl-metric-helper' }, helper),
    createElement('a', { className: 'owl-metric-link owl-focusable', href }, actionLabel, createElement('span', { 'aria-hidden': true }, ' →')),
  )
}
