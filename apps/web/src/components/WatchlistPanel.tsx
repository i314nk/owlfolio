import { createElement } from 'react'

import { StatusBadge } from './StatusBadge'
import type { DemoWatchlistItem } from '../lib/demo'

export type WatchlistPanelProps = {
  items: DemoWatchlistItem[]
}

const cardStyle = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '1rem',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
  padding: '1.25rem',
}

export function WatchlistPanel({ items }: WatchlistPanelProps) {
  return createElement(
    'section',
    {
      style: {
        display: 'grid',
        gap: '1rem',
      },
    },
    createElement(
      'header',
      {
        style: {
          background: 'linear-gradient(135deg, #f8fafc 0%, #ecfdf5 100%)',
          border: '1px solid #dbeafe',
          borderRadius: '1.25rem',
          padding: '1.5rem',
        },
      },
      createElement('p', { style: { color: '#047857', fontWeight: 800, letterSpacing: '0.08em', margin: 0 } }, 'OWLFOLIO'),
      createElement('h1', { style: { fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: 1, margin: '0.5rem 0' } }, 'Watchlist drafts'),
      createElement(
        'p',
        { style: { color: '#475569', fontSize: '1rem', margin: 0 } },
        'User-confirmed watchlist workflow state from the deterministic demo ledger.',
      ),
    ),
    ...items.map((item) =>
      createElement(
        'article',
        { key: item.watchlist_item_id, style: cardStyle },
        createElement(
          'div',
          { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between' } },
          createElement('h2', { style: { fontSize: '1.75rem', margin: 0 } }, item.ticker ?? item.company_id ?? item.watchlist_item_id),
          createElement(StatusBadge, { tone: item.user_approved ? 'success' : 'warning' }, item.user_approved ? 'User confirmed' : 'Draft — awaiting user confirmation'),
        ),
        createDetail('Strategy', item.strategy_id ?? 'Unknown'),
        createDetail('Thesis summary', item.thesis_summary ?? 'No thesis recorded'),
        createDetail('Buy-zone status', item.buy_zone_status ?? 'Not set'),
        createDetail('Research case', item.research_case_id),
      ),
    ),
  )
}

function createDetail(label: string, value: string) {
  return createElement(
    'p',
    { style: { color: '#334155', margin: '0.75rem 0 0' } },
    createElement('strong', null, `${label}: `),
    value,
  )
}
