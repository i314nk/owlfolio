import { createElement } from 'react'

import type { AppHolding, WorkflowMode } from '../lib/workflow'
import { StatusBadge } from './StatusBadge'

export type PortfolioPanelProps = {
  holdings: AppHolding[]
  mode?: WorkflowMode
}

const cardStyle = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '1rem',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
  padding: '1.25rem',
}

const inputStyle = {
  border: '1px solid #cbd5e1',
  borderRadius: '0.65rem',
  font: 'inherit',
  padding: '0.6rem 0.75rem',
}

const decisionPanelStyle = {
  border: '1px solid #e2e8f0',
  borderRadius: '0.85rem',
  display: 'grid',
  gap: '0.75rem',
  padding: '1rem',
}

export function PortfolioPanel({ holdings, mode = 'demo' }: PortfolioPanelProps) {
  const totalCostBasis = holdings.reduce((sum, holding) => sum + holding.total_cost_basis, 0)
  const totalCurrentValue = holdings.reduce((sum, holding) => sum + (holding.latest_market_value ?? 0), 0)

  return createElement(
    'section',
    { style: { display: 'grid', gap: '1rem' } },
    createElement(
      'header',
      {
        style: {
          background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)',
          border: '1px solid #dbeafe',
          borderRadius: '1.25rem',
          padding: '1.5rem',
        },
      },
      createElement('p', { style: { color: '#4338ca', fontWeight: 800, letterSpacing: '0.08em', margin: 0 } }, 'OWLFOLIO'),
      createElement('h1', { style: { fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: 1, margin: '0.5rem 0' } }, 'Portfolio'),
      createElement(
        'p',
        { style: { color: '#475569', fontSize: '1rem', margin: 0 } },
        mode === 'personal-local'
          ? `Personal local ledger holdings. Total cost basis: ${formatMoney(totalCostBasis, 'USD')}. Current value: ${formatMoney(totalCurrentValue, 'USD')}`
          : `Projected demo holdings. Total cost basis: ${formatMoney(totalCostBasis, 'USD')}. Current value: ${formatMoney(totalCurrentValue, 'USD')}`,
      ),
    ),
    ...(holdings.length === 0
      ? [
          createElement(
            'article',
            { key: 'portfolio-empty-state', style: cardStyle },
            createElement(
              'p',
              { style: { color: '#475569', margin: 0 } },
              'No holdings recorded yet. Confirm a watchlist item and record an initial holding lot first.',
            ),
          ),
        ]
      : holdings.map((holding) => createHoldingCard(holding, mode))),
  )
}

function createHoldingCard(holding: AppHolding, mode: WorkflowMode) {
  const ticker = holding.ticker ?? holding.company_id ?? holding.holding_id

  return createElement(
    'article',
    { key: holding.holding_id, id: holding.holding_id, style: cardStyle },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between' } },
      createElement('h2', { style: { fontSize: '1.75rem', margin: 0 } }, ticker),
      createElement(StatusBadge, { tone: holding.pending_review_id !== undefined ? 'warning' : holding.thesis_health === undefined ? 'neutral' : 'success' }, holding.pending_review_id !== undefined ? 'Strategy review drafted' : holding.thesis_health ?? 'Thesis review pending'),
    ),
    createPositionEconomicsTable(holding),
    createConfirmedPortfolioState(holding),
    ...createShariahGateDetails(holding),
    ...(holding.pending_review_id === undefined
      ? []
      : [
          createDetail('Pending thesis health', holding.pending_review_thesis_health ?? 'Unknown'),
          createDetail('Pending action stance', holding.pending_review_action_stance ?? 'Unknown'),
          createDetail('Pending review rationale', holding.pending_review_rationale ?? 'No rationale recorded'),
          createDetail('Pending next review', holding.pending_review_next_review_at ?? 'Unknown'),
        ]),
    createDetail('Thesis summary', holding.thesis_summary ?? 'No thesis recorded'),
    ...(mode === 'personal-local' ? [createValuationForm(holding), createReviewForm(holding)] : []),
  )
}

function createPositionEconomicsTable(holding: AppHolding) {
  return createElement(
    'section',
    { className: 'owl-financial-table', style: { ...cardStyle, boxShadow: 'none', marginTop: '1rem' } },
    createElement('h3', { style: { fontSize: '1rem', margin: '0 0 0.75rem' } }, 'Position economics'),
    createDetail('Shares', formatNumber(holding.shares)),
    createDetail('Cost basis / share', formatMoney(holding.cost_basis_per_share, holding.currency)),
    createDetail('Total cost basis', formatMoney(holding.total_cost_basis, holding.currency)),
    createDetail('Current value', holding.latest_market_value === undefined ? 'No valuation snapshot recorded' : formatMoney(holding.latest_market_value, holding.currency)),
    ...(holding.latest_price_per_share === undefined ? [] : [createDetail('Current price / share', formatMoney(holding.latest_price_per_share, holding.currency))]),
    ...(holding.unrealized_gain_loss === undefined ? [] : [createDetail('Unrealized P&L', `${formatMoney(holding.unrealized_gain_loss, holding.currency)} (${formatPercent(holding.unrealized_gain_loss_percent ?? 0)})`)]),
    ...(holding.portfolio_weight === undefined ? [] : [createDetail('Concentration', formatPercent(holding.portfolio_weight))]),
    ...(holding.latest_valuation_at === undefined ? [] : [createDetail('Valuation date', holding.latest_valuation_at)]),
    createDetail('Opened', holding.opened_at),
  )
}

function createConfirmedPortfolioState(holding: AppHolding) {
  return createElement(
    'section',
    { className: 'owl-workflow-card', style: { ...cardStyle, boxShadow: 'none', marginTop: '1rem' } },
    createElement('h3', { style: { fontSize: '1rem', margin: '0 0 0.75rem' } }, 'Confirmed portfolio state'),
    createDetail('Strategy', holding.strategy_id ?? 'Strategy not recorded'),
    createDetail('Research case', holding.research_case_id),
    createDetail('Watchlist item', holding.watchlist_item_id),
    ...(holding.thesis_health === undefined ? [] : [createDetail('Thesis health', holding.thesis_health)]),
    ...(holding.action_stance === undefined ? [] : [createDetail('Action stance', holding.action_stance)]),
    ...(holding.latest_review_rationale === undefined ? [] : [createDetail('Review rationale', holding.latest_review_rationale)]),
    ...(holding.latest_review_evidence_summary === undefined ? [] : [createDetail('Review evidence', holding.latest_review_evidence_summary)]),
    ...(holding.latest_review_uncertainty === undefined ? [] : [createDetail('Review uncertainty', holding.latest_review_uncertainty)]),
    ...(holding.next_review_at === undefined ? [] : [createDetail('Next review', holding.next_review_at)]),
  )
}

function createReviewForm(holding: AppHolding) {
  if (holding.pending_review_id !== undefined) {
    const currentThesisCopy = holding.thesis_health === undefined
      ? 'No confirmed review yet — rejecting this draft leaves thesis review pending.'
      : `Current thesis health: ${holding.thesis_health}. Current action stance: ${holding.action_stance ?? 'Not set'}. Rejecting this draft leaves these values unchanged.`

    return createElement(
      'div',
      {
        style: {
          borderTop: '1px solid #e2e8f0',
          display: 'grid',
          gap: '0.9rem',
          marginTop: '1rem',
          paddingTop: '1rem',
        },
      },
      createElement('h3', { style: { fontSize: '1rem', margin: 0 } }, 'Strategy review drafted'),
      createElement('p', { style: { color: '#475569', margin: 0 } }, 'Choose one auditable decision path for this provider-authored Buffett-Munger review before it becomes portfolio state.'),
      createElement(
        'div',
        { style: { display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' } },
        createElement(
          'section',
          { style: { ...decisionPanelStyle, background: '#f8fafc' } },
          createElement('h4', { style: { fontSize: '0.95rem', margin: 0 } }, 'Current confirmed thesis'),
          createElement('p', { style: { color: '#475569', margin: 0 } }, currentThesisCopy),
        ),
        createElement(
          'section',
          { style: { ...decisionPanelStyle, background: '#fffbeb' } },
          createElement('h4', { style: { fontSize: '0.95rem', margin: 0 } }, 'Provider-authored review draft'),
          createDetail('Pending thesis health', holding.pending_review_thesis_health ?? 'Unknown'),
          createDetail('Pending action stance', holding.pending_review_action_stance ?? 'Unknown'),
          createDetail('Pending review rationale', holding.pending_review_rationale ?? 'No rationale recorded'),
          createDetail('Pending next review', holding.pending_review_next_review_at ?? 'Unknown'),
        ),
      ),
      createElement('p', { style: { color: '#475569', fontWeight: 800, margin: 0 } }, 'User decision path'),
      createElement(
        'form',
        {
          action: `/api/portfolio/${holding.holding_id}/review/${holding.pending_review_id}/confirm`,
          method: 'post',
          style: { ...decisionPanelStyle, background: '#ecfdf5' },
        },
        createElement('h4', { style: { fontSize: '0.95rem', margin: 0 } }, 'Apply provider draft'),
        createElement('p', { style: { color: '#475569', margin: 0 } }, 'Applies the provider-authored thesis health, action stance, and next review date to portfolio state.'),
        createSubmitButton('Apply provider draft', '#047857'),
      ),
      createElement(
        'form',
        {
          action: `/api/portfolio/${holding.holding_id}/review/${holding.pending_review_id}/override`,
          method: 'post',
          style: { ...decisionPanelStyle, background: '#f5f3ff' },
        },
        createElement('h4', { style: { fontSize: '0.95rem', margin: 0 } }, 'Apply user override'),
        createElement('p', { style: { color: '#475569', margin: 0 } }, 'Applies your edited values instead of the provider draft and records a user-authored audit event.'),
        createReviewSelect('Override thesis health', 'thesis_health', ['HEALTHY', 'WATCH', 'IMPAIRED', 'EXIT_CANDIDATE'], holding.pending_review_thesis_health ?? 'WATCH'),
        createReviewSelect('Override action stance', 'action_stance', ['HOLD', 'ADD_ON_PULLBACK', 'REDUCE', 'EXIT_REVIEW_NEEDED', 'RESEARCH_MORE'], holding.pending_review_action_stance ?? 'RESEARCH_MORE'),
        createReviewTextarea('Override rationale (required)', 'rationale', holding.pending_review_rationale ?? ''),
        createReviewTextarea('Override evidence summary (required)', 'evidence_summary', 'User reviewed provider draft against the local ledger and available evidence.'),
        createReviewTextarea('Override uncertainty (required)', 'uncertainty', 'User override records uncertainty before the next scheduled review.'),
        createReviewInput('Override next review date (required)', 'next_review_at', holding.pending_review_next_review_at ?? new Date().toISOString().slice(0, 10)),
        createSubmitButton('Apply user override', '#7c3aed'),
      ),
      createElement(
        'form',
        {
          action: `/api/portfolio/${holding.holding_id}/review/${holding.pending_review_id}/reject`,
          method: 'post',
          style: { ...decisionPanelStyle, background: '#fef2f2' },
        },
        createElement('h4', { style: { fontSize: '0.95rem', margin: 0 } }, 'Reject provider draft'),
        createElement('p', { style: { color: '#475569', margin: 0 } }, 'Leaves the current confirmed portfolio thesis unchanged and clears this pending draft.'),
        createReviewTextarea('Rejection reason (required)', 'rejection_reason', 'Reject this draft and wait for fresher evidence.'),
        createSubmitButton('Reject strategy review', '#b91c1c'),
      ),
    )
  }

  return createElement(
    'form',
    {
      action: `/api/portfolio/${holding.holding_id}/review`,
      method: 'post',
      style: {
        borderTop: '1px solid #e2e8f0',
        display: 'grid',
        gap: '0.75rem',
        marginTop: '1rem',
        paddingTop: '1rem',
      },
    },
    createElement('h3', { style: { fontSize: '1rem', margin: 0 } }, 'Strategy-driven holding review'),
    createElement('p', { style: { color: '#475569', margin: 0 } }, 'Ask Owlfolio to draft a Buffett-Munger thesis-health review for this holding.'),
    createSubmitButton('Run Buffett-Munger review', '#1d4ed8'),
  )
}

function createSubmitButton(label: string, background: string) {
  return createElement(
    'button',
    {
      type: 'submit',
      style: {
        background,
        border: 0,
        borderRadius: '0.75rem',
        color: '#ffffff',
        cursor: 'pointer',
        fontWeight: 800,
        padding: '0.75rem 1rem',
      },
    },
    label,
  )
}

function createReviewSelect(label: string, name: string, values: string[], selectedValue: string) {
  return createElement(
    'label',
    { style: { color: '#334155', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
    label,
    createElement(
      'select',
      { name, defaultValue: selectedValue, style: inputStyle },
      ...values.map((value) => createElement('option', { key: value, value }, value)),
    ),
  )
}

function createReviewTextarea(label: string, name: string, defaultValue: string) {
  return createElement(
    'label',
    { style: { color: '#334155', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
    label,
    createElement('textarea', {
      name,
      required: true,
      defaultValue,
      style: { ...inputStyle, minHeight: '5rem' },
    }),
  )
}

function createReviewInput(label: string, name: string, defaultValue: string) {
  return createElement(
    'label',
    { style: { color: '#334155', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
    label,
    createElement('input', {
      name,
      required: true,
      type: 'date',
      defaultValue,
      style: inputStyle,
    }),
  )
}

function createValuationForm(holding: AppHolding) {
  return createElement(
    'form',
    {
      action: `/api/portfolio/${holding.holding_id}/valuation`,
      method: 'post',
      style: {
        borderTop: '1px solid #e2e8f0',
        display: 'grid',
        gap: '0.75rem',
        marginTop: '1rem',
        paddingTop: '1rem',
      },
    },
    createElement('h3', { style: { fontSize: '1rem', margin: 0 } }, 'Manual valuation checkpoint'),
    createElement(
      'label',
      { style: { color: '#334155', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
      'Current price per share',
      createElement('input', {
        name: 'price_per_share',
        required: true,
        step: '0.01',
        min: '0',
        type: 'number',
        defaultValue: holding.latest_price_per_share?.toString() ?? '',
        style: inputStyle,
      }),
    ),
    createElement(
      'label',
      { style: { color: '#334155', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
      'Valuation date',
      createElement('input', {
        name: 'valued_at',
        required: true,
        type: 'date',
        defaultValue: holding.latest_valuation_at ?? new Date().toISOString().slice(0, 10),
        style: inputStyle,
      }),
    ),
    createElement('input', { name: 'currency', type: 'hidden', value: holding.currency }),
    createElement(
      'button',
      {
        type: 'submit',
        style: {
          background: '#047857',
          border: 0,
          borderRadius: '0.75rem',
          color: '#ffffff',
          cursor: 'pointer',
          fontWeight: 800,
          padding: '0.75rem 1rem',
        },
      },
      'Record valuation snapshot',
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

function createShariahGateDetails(holding: AppHolding) {
  if (holding.shariah_gate_decision_id === undefined) {
    return []
  }

  return [
    createDetail('Shariah gate', `${holding.shariah_gate_status ?? 'UNKNOWN'} — ${holding.shariah_gate_allowed === false ? 'blocked' : 'allowed'}`),
    ...(holding.shariah_gate_reasons === undefined || holding.shariah_gate_reasons.length === 0
      ? []
      : [createDetail('Shariah gate reasons', holding.shariah_gate_reasons.join(' '))]),
    ...(holding.shariah_required_source_ids === undefined || holding.shariah_required_source_ids.length === 0
      ? []
      : [createDetail('Required Shariah sources', holding.shariah_required_source_ids.join(', '))]),
    ...(holding.shariah_missing_evidence === undefined || holding.shariah_missing_evidence.length === 0
      ? []
      : [createDetail('Missing Shariah evidence', holding.shariah_missing_evidence.join(', '))]),
  ]
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    currency,
    style: 'currency',
  }).format(value)
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value)
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`
}
