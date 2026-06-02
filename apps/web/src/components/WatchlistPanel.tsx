import { createElement } from 'react'

import { StatusBadge } from './StatusBadge'
import type { AppWatchlistItem, WorkflowMode } from '../lib/workflow'

export type WatchlistPanelProps = {
  items: AppWatchlistItem[]
  mode?: WorkflowMode
}

const cardStyle = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '1rem',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
  padding: '1.25rem',
}

export function WatchlistPanel({ items, mode = 'demo' }: WatchlistPanelProps) {
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
        'Personal local ledger watchlist state.',
      ),
    ),
    ...(items.length === 0
      ? [
          createElement(
            'article',
            { key: 'watchlist-empty-state', style: cardStyle },
            createElement(
              'p',
              { style: { color: '#475569', margin: 0 } },
              'No watchlist drafts yet. Create a research case first.',
            ),
          ),
        ]
      : items.map((item) =>
          createElement(
            'article',
            { key: item.watchlist_item_id, style: cardStyle },
            createElement(
              'div',
              { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between' } },
              createElement('h2', { style: { fontSize: '1.75rem', margin: 0 } }, item.ticker ?? item.company_id ?? item.watchlist_item_id),
              createElement(
                StatusBadge,
                { tone: item.holding_id !== undefined || item.user_approved ? 'success' : 'warning' },
                item.holding_id !== undefined
                  ? 'Holding recorded'
                  : item.user_approved
                    ? 'User confirmed'
                    : 'Draft — awaiting user confirmation',
              ),
            ),
            createDetail('Strategy', item.strategy_id ?? 'Unknown'),
            createDetail('Thesis summary', item.thesis_summary ?? 'No thesis recorded'),
            createDetail('Buy-zone status', item.buy_zone_status ?? 'Not set'),
            createDetail('Research case', item.research_case_id),
            ...createShariahGateDetails(item),
            item.holding_id === undefined ? null : createDetail('Holding', item.holding_id),
            mode === 'personal-local' && !item.user_approved
              ? createElement(
                  'form',
                  {
                    action: `/api/watchlist/${item.watchlist_item_id}/confirm`,
                    method: 'post',
                    style: { marginTop: '1rem' },
                  },
                  createElement(
                    'button',
                    {
                      type: 'submit',
                      style: {
                        background: '#047857',
                        border: 0,
                        borderRadius: '999px',
                        color: '#ffffff',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: 800,
                        padding: '0.65rem 0.9rem',
                      },
                    },
                    'Confirm watchlist draft',
                  ),
                )
              : null,
            mode === 'personal-local' && item.user_approved && item.holding_id === undefined
              ? createElement(
                  'form',
                  {
                    action: `/api/watchlist/${item.watchlist_item_id}/open-holding`,
                    method: 'post',
                    style: { display: 'grid', gap: '0.75rem', marginTop: '1rem' },
                  },
                  createLotInput('Shares', 'shares', 'number', '1', { step: '0.0001', min: '0.0001' }),
                  createLotInput('Cost basis per share', 'cost_basis_per_share', 'number', '0', { step: '0.01', min: '0' }),
                  createLotInput('Currency', 'currency', 'text', 'USD', { maxLength: 3 }),
                  createLotInput('Opened date', 'opened_at', 'date', '', {}),
                  createElement(
                    'button',
                    {
                      type: 'submit',
                      style: {
                        background: '#0f172a',
                        border: 0,
                        borderRadius: '999px',
                        color: '#ffffff',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: 800,
                        padding: '0.65rem 0.9rem',
                      },
                    },
                    'Record initial holding',
                  ),
                )
              : null,
          ),
        )),
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

function createShariahGateDetails(item: AppWatchlistItem) {
  if (item.shariah_gate_decision_id === undefined) {
    return []
  }

  return [
    createDetail('Shariah gate', `${item.shariah_gate_status ?? 'UNKNOWN'} — ${item.shariah_gate_allowed === false ? 'blocked' : 'allowed'}`),
    ...(item.shariah_gate_reasons === undefined || item.shariah_gate_reasons.length === 0
      ? []
      : [createDetail('Shariah gate reasons', item.shariah_gate_reasons.join(' '))]),
    ...(item.shariah_required_source_ids === undefined || item.shariah_required_source_ids.length === 0
      ? []
      : [createDetail('Required Shariah sources', item.shariah_required_source_ids.join(', '))]),
    ...(item.shariah_missing_evidence === undefined || item.shariah_missing_evidence.length === 0
      ? []
      : [createDetail('Missing Shariah evidence', item.shariah_missing_evidence.join(', '))]),
  ]
}

function createLotInput(
  label: string,
  name: string,
  type: string,
  defaultValue: string,
  extraProps: Record<string, string | number>,
) {
  return createElement(
    'label',
    { style: { color: '#334155', display: 'grid', fontSize: '0.85rem', fontWeight: 700, gap: '0.25rem' } },
    label,
    createElement('input', {
      ...extraProps,
      defaultValue,
      name,
      required: true,
      type,
      style: {
        border: '1px solid #cbd5e1',
        borderRadius: '0.75rem',
        color: '#0f172a',
        padding: '0.55rem 0.7rem',
      },
    }),
  )
}
