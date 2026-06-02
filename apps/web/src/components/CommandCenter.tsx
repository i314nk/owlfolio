import { createElement } from 'react'

import { FinancialNumber, OwlButtonLink, OwlCard } from './designSystem'
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

export function CommandCenter({ dashboard }: CommandCenterProps) {
  const counts = dashboard.pipeline_counts

  return createElement(
    'main',
    {
      style: {
        color: '#f7f8ff',
        minHeight: '100vh',
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
        'Local, Shariah-by-design investment workflow dashboard for the current Owlfolio v0.2 slice.',
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
        createElement(MetricCard, { label: 'Research cases', value: counts.research_cases }),
        createElement(MetricCard, { label: 'Watchlist drafts', value: counts.watchlist_drafts }),
        createElement(MetricCard, { label: 'Confirmed watchlist', value: counts.confirmed_watchlist_items }),
        createElement(MetricCard, { label: 'Open holdings', value: counts.open_holdings }),
        createElement(MetricCard, { label: 'Pending user actions', value: counts.pending_user_actions }),
      ),
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
          'Every item below is an explicit workflow action with an audit or setup destination.',
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
        createAccountingAlert(dashboard),
        createHoldingReviewSchedule(dashboard),
        createRecentActivity(dashboard),
      ),
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
      category: 'Provider readiness warning',
      description: `${dashboard.provider_status}. Resolve credentials or certification evidence before relying on provider-authored workflow runs.`,
      href: '/providers',
      label: 'Open provider readiness',
      title: 'Resolve provider readiness',
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
        ? '#22c55e'
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
      'aria-label': 'Accounting alert',
      style: {
        background: 'rgba(10, 132, 255, 0.09)',
        border: '1px solid rgba(125, 211, 252, 0.22)',
        borderRadius: '0.9rem',
        display: 'grid',
        gap: '0.5rem',
        marginTop: '1.25rem',
        padding: '1rem',
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
      'aria-label': 'Holding review schedule',
      style: {
        borderTop: '1px solid rgba(148, 163, 184, 0.18)',
        display: 'grid',
        gap: '0.75rem',
        marginTop: '1.25rem',
        paddingTop: '1.25rem',
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

function createRecentActivity(dashboard: AppCommandCenter) {
  const activities = dashboard.recent_activity

  return createElement(
    'section',
    { style: { marginTop: '1.25rem' } },
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
      'p',
      { style: { color: '#9aa4b7', fontFamily: 'var(--owl-font-mono)', fontSize: '0.72rem', letterSpacing: '0.02em', margin: '0.3rem 0 0' } },
      summary.actor === undefined ? `Audit event ${activity.event_id}` : `${summary.actor} · Audit event ${activity.event_id}`,
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

function MetricCard({ label, value }: { label: string; value: number }) {
  return createElement(
    OwlCard,
    { className: 'owl-metric-card' },
    createElement(
      'p',
      { className: 'owl-metric-label' },
      label,
    ),
    createElement('p', { className: 'owl-metric-value' }, createElement(FinancialNumber, { value })),
  )
}
