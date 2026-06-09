import { createElement } from 'react'

import { OwlValuationChip, SourceChip } from './designSystem'
import { StatusBadge } from './StatusBadge'
import type { AppWatchlistItem, WorkflowMode } from '../lib/workflow'

export type WatchlistPanelProps = {
  items: AppWatchlistItem[]
  mode?: WorkflowMode
}

const cardStyle = {
  background: 'rgba(255, 255, 255, 0.035)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: '1rem',
  boxShadow: '0 18px 50px rgba(0, 0, 0, 0.18)',
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
          background: 'linear-gradient(135deg, rgba(214, 178, 94, 0.10) 0%, rgba(22, 163, 74, 0.06) 100%)',
          border: '1px solid rgba(148, 163, 184, 0.18)',
          borderRadius: '1.25rem',
          padding: '1.5rem',
        },
      },
      createElement('p', { style: { color: 'var(--owl-color-gold)', fontWeight: 800, letterSpacing: '0.08em', margin: 0 } }, 'OWLFOLIO'),
      createElement('h1', { style: { fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: 1, margin: '0.5rem 0' } }, 'Watchlist drafts'),
      createElement(
        'p',
        { style: { color: '#9aa4b7', fontSize: '1rem', margin: 0 } },
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
              { style: { color: '#9aa4b7', margin: 0 } },
              'No watchlist drafts yet. Create a research case first.',
            ),
          ),
        ]
      : items.map((item) => createWatchlistCard(item, mode))),
  )
}

function createWatchlistCard(item: AppWatchlistItem, mode: WorkflowMode) {
  return createElement(
    'article',
    { key: item.watchlist_item_id, className: 'owl-workflow-card', style: cardStyle },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between' } },
      createElement('h2', { style: { fontSize: '1.75rem', margin: 0 } }, item.ticker ?? item.company_id ?? item.watchlist_item_id),
      createElement(
        'div',
        { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.55rem' } },
        ...(shariahChip(item) === undefined ? [] : [shariahChip(item)]),
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
    ),
    createElement(
      'div',
      { className: 'owl-workflow-grid' },
      createElement(
        'section',
        { className: 'owl-workflow-panel owl-workflow-panel-draft' },
        createElement('h3', { style: { fontSize: '1rem', margin: 0 } }, 'Provider draft state'),
        createDetail('Strategy', item.strategy_id ?? 'Unknown'),
        createDetail('Thesis summary', item.thesis_summary ?? 'No thesis recorded'),
        createDetail('Buy-zone status', item.buy_zone_status ?? 'Not set'),
        createDetail('Created by actor', formatActor(item.created_by_actor_type, item.created_by_actor_id)),
        createDetail('Last updated', item.updated_at),
        createResearchCaseLink(item.research_case_id),
      ),
      createElement(
        'section',
        { className: 'owl-workflow-panel owl-workflow-panel-user' },
        createElement('h3', { style: { fontSize: '1rem', margin: 0 } }, 'User decision checkpoint'),
        createDetail('Confirmation status', item.user_approved ? 'User-confirmed watchlist decision' : 'Awaiting user confirmation'),
        createDetail('Confirmed by actor', item.user_approved ? formatActor(item.confirmed_by_actor_type, item.confirmed_by_actor_id) : 'Not user-confirmed yet'),
        item.holding_id === undefined ? createDetail('Position status', 'Not opened yet') : createDetail('Position status', item.holding_id),
      ),
    ),
    ...createShariahGateDetails(item),
    mode === 'personal-local' && !item.user_approved ? createWatchlistConfirmForm(item) : null,
    mode === 'personal-local' && item.user_approved && item.holding_id === undefined ? createOpenHoldingForm(item) : null,
  )
}

function shariahChip(item: AppWatchlistItem) {
  if (item.shariah_gate_decision_id === undefined) {
    return undefined
  }

  const status = (item.shariah_gate_status ?? '').toUpperCase()

  if (item.shariah_gate_allowed === true) {
    if (status === 'CONDITIONAL') {
      return createElement(OwlValuationChip, { kind: 'watch', label: 'CONDITIONAL' })
    }
    return createElement(OwlValuationChip, { kind: 'approved' })
  }

  if (item.shariah_gate_allowed === false) {
    return createElement(OwlValuationChip, { kind: 'overvalued', label: 'BLOCKED' })
  }

  return createElement(OwlValuationChip, { kind: 'watch', label: 'GATE PENDING' })
}

function createWatchlistConfirmForm(item: AppWatchlistItem) {
  return createElement(
    'form',
    {
      action: `/api/watchlist/${item.watchlist_item_id}/confirm`,
      method: 'post',
      className: 'owl-action-form owl-action-form-confirm',
      style: { marginTop: '1rem' },
    },
    createElement('h3', { style: { fontSize: '1rem', margin: 0 } }, 'Confirm user watchlist state'),
    createElement(
      'p',
      { style: { color: '#9aa4b7', margin: '0.35rem 0 0.8rem' } },
      'Review Shariah gate evidence, then confirm this watchlist draft as user-authored state.',
    ),
    createElement(
      'button',
      {
        type: 'submit',
        className: 'owl-form-button owl-form-button-primary',
      },
      'Confirm watchlist draft',
    ),
  )
}

function createOpenHoldingForm(item: AppWatchlistItem) {
  return createElement(
    'form',
    {
      action: `/api/watchlist/${item.watchlist_item_id}/open-holding`,
      method: 'post',
      className: 'owl-action-form',
      style: { display: 'grid', gap: '0.75rem', marginTop: '1rem' },
    },
    createElement('h3', { style: { fontSize: '1rem', margin: 0 } }, 'Open holding from confirmed watchlist state'),
    createLotInput('Shares', 'shares', 'number', '1', { step: '0.0001', min: '0.0001' }),
    createLotInput('Cost basis per share', 'cost_basis_per_share', 'number', '0', { step: '0.01', min: '0' }),
    createLotInput('Currency', 'currency', 'text', 'USD', { maxLength: 3 }),
    createLotInput('Opened date', 'opened_at', 'date', '', {}),
    createElement(
      'button',
      {
        type: 'submit',
        className: 'owl-form-button owl-form-button-primary',
      },
      'Record initial holding',
    ),
  )
}

function createResearchCaseLink(researchCaseId: string) {
  const href = `/research/${researchCaseId}`

  return createElement(
    'div',
    { style: { color: '#cbd5e1', display: 'grid', gap: '0.45rem', margin: '0.75rem 0 0' } },
    createElement('strong', null, 'Research case link'),
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.55rem' } },
      createElement('a', { className: 'owl-focusable', href, style: { color: 'var(--owl-color-gold-bright)', fontWeight: 900, textDecoration: 'none' } }, 'View research dossier'),
      createElement(SourceChip, { href, id: researchCaseId, label: 'Research case' }),
    ),
  )
}

function createDetail(label: string, value: string) {
  return createElement(
    'p',
    { style: { color: '#cbd5e1', margin: '0.75rem 0 0' } },
    createElement('strong', null, `${label}: `),
    value,
  )
}

function createShariahGateDetails(item: AppWatchlistItem) {
  if (item.shariah_gate_decision_id === undefined) {
    return []
  }

  return [
    createDetail('Gate decision', item.shariah_gate_decision_id),
    createDetail('Shariah gate', `${item.shariah_gate_status ?? 'UNKNOWN'} — ${describeGateAllowance(item.shariah_gate_allowed)}`),
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

function formatActor(actorType: string | undefined, actorId: string | undefined): string {
  if (actorType === undefined || actorId === undefined) {
    return 'Not recorded'
  }

  return `${actorType}:${actorId}`
}

function describeGateAllowance(allowed: boolean | undefined): string {
  if (allowed === true) {
    return 'allowed'
  }
  if (allowed === false) {
    return 'blocked'
  }

  return 'gate decision pending'
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
    { style: { color: '#cbd5e1', display: 'grid', fontSize: '0.85rem', fontWeight: 700, gap: '0.25rem' } },
    label,
    createElement('input', {
      ...extraProps,
      defaultValue,
      name,
      required: true,
      type,
      style: {
        background: 'rgba(148, 163, 184, 0.08)',
        border: '1px solid rgba(148, 163, 184, 0.24)',
        borderRadius: '0.75rem',
        color: '#f7f8ff',
        padding: '0.55rem 0.7rem',
      },
    }),
  )
}
