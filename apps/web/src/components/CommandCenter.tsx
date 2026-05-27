import { createElement } from 'react'

import { StatusBadge } from './StatusBadge'
import type { DemoCommandCenter } from '../lib/demo'

export type CommandCenterProps = {
  dashboard: DemoCommandCenter
}

export function CommandCenter({ dashboard }: CommandCenterProps) {
  const counts = dashboard.pipeline_counts

  return createElement(
    'main',
    {
      style: {
        background: 'linear-gradient(135deg, #f8fafc 0%, #ecfdf5 100%)',
        color: '#0f172a',
        minHeight: '100vh',
        padding: '3rem clamp(1rem, 4vw, 4rem)',
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
        { style: { color: '#047857', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' } },
        dashboard.product_name,
      ),
      createElement(
        'h1',
        { style: { fontSize: 'clamp(2.25rem, 5vw, 4.5rem)', lineHeight: 1, margin: '0.5rem 0 1rem' } },
        'Command Center',
      ),
      createElement(
        'p',
        { style: { color: '#475569', fontSize: '1.15rem', maxWidth: '720px' } },
        'Local, Shariah-by-design investment workflow dashboard for a deterministic v0.2 demo slice.',
      ),
      createElement(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', margin: '1.5rem 0 2rem' } },
        createElement(StatusBadge, { tone: 'success' }, dashboard.setup_status),
        createElement(StatusBadge, null, dashboard.provider_status),
        createElement(StatusBadge, { tone: 'success' }, dashboard.strategy_status),
        createElement(StatusBadge, { tone: 'warning' }, dashboard.shariah_status),
      ),
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
        createElement(MetricCard, { label: 'Pending user actions', value: counts.pending_user_actions }),
      ),
      createElement(
        'section',
        {
          style: {
            background: '#ffffff',
            border: '1px solid #dbeafe',
            borderRadius: '1.25rem',
            boxShadow: '0 20px 45px rgba(15, 23, 42, 0.08)',
            padding: '1.5rem',
          },
        },
        createElement(
          'p',
          { style: { color: '#64748b', fontSize: '0.85rem', fontWeight: 800, margin: 0, textTransform: 'uppercase' } },
          'Next recommended action',
        ),
        createElement(
          'p',
          { style: { fontSize: '1.35rem', fontWeight: 800, margin: '0.45rem 0 0' } },
          dashboard.next_recommended_action,
        ),
      ),
    ),
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return createElement(
    'article',
    {
      style: {
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '1rem',
        boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
        padding: '1.25rem',
      },
    },
    createElement(
      'p',
      { style: { color: '#64748b', fontSize: '0.8rem', fontWeight: 800, margin: 0, textTransform: 'uppercase' } },
      label,
    ),
    createElement('p', { style: { fontSize: '2.5rem', fontWeight: 900, lineHeight: 1, margin: '0.5rem 0 0' } }, value),
  )
}
