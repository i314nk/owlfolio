import { createElement } from 'react'

import type { InvestableCapitalSnapshot } from '@owlfolio/ledger/projections/investableCapitalProjection'

import { OwlButtonLink, OwlKpiStat, OwlRingGauge, OwlValuationChip, type OwlValuationKind } from './designSystem'
import type { AppHolding, WorkflowMode } from '../lib/workflow'
import { StatusBadge } from './StatusBadge'

export type PortfolioValuationRefreshSummary = {
  last_price_check_at?: string
  next_scheduled_check: string
  data_source: string
  confidence_caveat: string
  holdings_missing_data: string[]
}

/**
 * A holding enriched with its linked research-case buy-below price (value at the
 * moat-class hurdle). When `buyBelowPricePerShare` is present, the valuation chip
 * is a TRUE current-vs-buy-below verdict; otherwise the chip falls back to a
 * clearly-labeled entry-vs-market (cost-basis) comparison.
 */
export type PortfolioHolding = AppHolding & {
  buyBelowPricePerShare?: number
  moatClass?: string
  hurdleRate?: number
}

export type PortfolioPanelProps = {
  holdings: PortfolioHolding[]
  mode?: WorkflowMode
  valuationRefresh?: PortfolioValuationRefreshSummary
  investableCapital?: InvestableCapitalSnapshot
}

const cardStyle = {
  background: 'rgba(255, 255, 255, 0.035)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: '1rem',
  boxShadow: '0 18px 50px rgba(0, 0, 0, 0.18)',
  padding: '1.25rem',
}

const inputStyle = {
  background: 'rgba(148, 163, 184, 0.08)',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderRadius: '0.65rem',
  color: '#f7f8ff',
  font: 'inherit',
  padding: '0.6rem 0.75rem',
}

const decisionPanelStyle = {
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: '0.85rem',
  display: 'grid',
  gap: '0.75rem',
  padding: '1rem',
}

const reviewActionShellStyle = {
  border: '1px solid rgba(148, 163, 184, 0.2)',
  borderRadius: '0.85rem',
  display: 'grid',
  gap: '0.7rem',
  padding: '0.9rem 1rem',
}

const decisionQuickLinkStyle = {
  background: 'rgba(148, 163, 184, 0.08)',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderRadius: '0.75rem',
  color: '#cbd5e1',
  display: 'inline-flex',
  gap: '0.4rem',
  padding: '0.55rem 0.72rem',
  textDecoration: 'none',
}

export function PortfolioPanel({ holdings, mode = 'demo', valuationRefresh, investableCapital }: PortfolioPanelProps) {
  const totalCostBasis = holdings.reduce((sum, holding) => sum + holding.total_cost_basis, 0)
  const totalCurrentValue = holdings.reduce((sum, holding) => sum + (holding.latest_market_value ?? 0), 0)

  return createElement(
    'section',
    { style: { display: 'grid', gap: '1rem' } },
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
      createElement('p', { style: { color: '#4338ca', fontWeight: 800, letterSpacing: '0.08em', margin: 0 } }, 'OWLFOLIO'),
      createElement('h1', { style: { fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: 1, margin: '0.5rem 0' } }, 'Portfolio'),
      createElement(
        'p',
        { style: { color: '#9aa4b7', fontSize: '1rem', margin: 0 } },
        mode === 'personal-local'
          ? `Personal local ledger holdings. Total cost basis: ${formatMoney(totalCostBasis, 'USD')}. Current value: ${formatMoney(totalCurrentValue, 'USD')}`
          : `Projected demo holdings. Total cost basis: ${formatMoney(totalCostBasis, 'USD')}. Current value: ${formatMoney(totalCurrentValue, 'USD')}`,
      ),
    ),
    createPortfolioKpiRow(holdings, totalCurrentValue),
    ...(mode === 'personal-local' ? [createInvestableCapitalPanel(investableCapital)] : []),
    createPortfolioOperationsCockpit(holdings, totalCurrentValue, valuationRefresh),
    ...(valuationRefresh === undefined ? [] : [createScheduledValuationRefreshCard(valuationRefresh)]),
    ...(holdings.length === 0
      ? [createPortfolioEmptyState()]
      : holdings.map((holding) => createHoldingCard(holding, mode))),
  )
}

function createPortfolioKpiRow(holdings: AppHolding[], totalCurrentValue: number) {
  const hasHoldings = holdings.length > 0
  const hasValuation = holdings.some((holding) => holding.latest_market_value !== undefined)
  const gated = holdings.filter((holding) => holding.shariah_gate_decision_id !== undefined)
  const allowed = gated.filter((holding) => holding.shariah_gate_allowed === true).length
  const compliancePct = gated.length === 0 ? 0 : Math.round((allowed / gated.length) * 100)

  return createElement(
    'section',
    { 'aria-label': 'Portfolio summary', className: 'owl-kpi-row' },
    createElement(
      'div',
      { className: 'owl-kpi-panel owl-kpi-panel-gold' },
      createElement(OwlKpiStat, {
        label: 'Total value',
        value: hasValuation ? formatMoney(totalCurrentValue, 'USD') : '—',
        tone: 'gold',
      }),
    ),
    createElement(
      'div',
      { className: 'owl-kpi-panel' },
      createElement(OwlKpiStat, {
        label: 'Open holdings',
        value: hasHoldings ? String(holdings.length) : '—',
        tone: 'gold',
      }),
    ),
    createElement(
      'div',
      { className: 'owl-kpi-panel' },
      createElement(OwlKpiStat, {
        label: 'Shariah-gated',
        value: gated.length === 0 ? '—' : `${allowed}/${gated.length}`,
        tone: 'emerald',
      }),
      createElement(OwlRingGauge, {
        value: compliancePct,
        label: 'Compliant',
        tone: gated.length === 0 ? 'amber' : compliancePct === 100 ? 'emerald' : 'amber',
        size: 64,
      }),
    ),
  )
}

function createScheduledValuationRefreshCard(summary: PortfolioValuationRefreshSummary) {
  return createElement(
    'section',
    { className: 'owl-workflow-card', style: cardStyle },
    createElement('h2', { style: { fontSize: '1.25rem', margin: 0 } }, 'Scheduled valuation refresh'),
    createElement('p', { style: { color: '#9aa4b7', margin: '0.5rem 0 0' } }, 'Factual price checks can update valuation snapshots automatically; investment actions remain approval-gated.'),
    createDetail('Last price check', summary.last_price_check_at ?? 'No scheduled price check recorded'),
    createDetail('Next scheduled check', summary.next_scheduled_check),
    createDetail('Data source', summary.data_source),
    createDetail('Confidence / caveat', summary.confidence_caveat),
    createDetail('Holdings missing data', summary.holdings_missing_data.length === 0 ? 'None' : summary.holdings_missing_data.join(', ')),
  )
}

function createPortfolioEmptyState() {
  return createElement(
    'article',
    { key: 'portfolio-empty-state', className: 'owl-workflow-card', style: cardStyle },
    createElement('h2', { style: { fontSize: '1.35rem', margin: 0 } }, 'No holdings are open yet'),
    createElement(
      'p',
      { style: { color: '#9aa4b7', margin: '0.6rem 0 0' } },
      'Follow the audit path: research decision → watchlist confirmation → holding lot entry.',
    ),
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1rem' } },
      createElement(OwlButtonLink, { href: '/watchlist', variant: 'primary' }, 'Go to watchlist'),
      createElement('span', { style: { color: '#cbd5e1', fontWeight: 800 } }, 'Record first lot after confirming a watchlist item'),
    ),
    createElement(
      'section',
      { 'aria-label': 'Empty holdings table', style: { ...decisionPanelStyle, background: 'rgba(148, 163, 184, 0.08)', marginTop: '1rem' } },
      createElement('h3', { style: { fontSize: '1rem', margin: 0 } }, 'Empty holdings table'),
      createDetail('Portfolio state', 'No portfolio events recorded'),
      createDetail('Provider sync', 'Provider sync not connected'),
      createDetail('Last updated', 'none'),
      createElement('p', { style: { color: '#9aa4b7', margin: '0.25rem 0 0' } }, 'Last updated: none'),
    ),
  )
}

function createHoldingCard(holding: PortfolioHolding, mode: WorkflowMode) {
  const ticker = holding.ticker ?? holding.company_id ?? holding.holding_id
  const chip = holdingValuationChip(holding)

  return createElement(
    'article',
    { key: holding.holding_id, id: holding.holding_id, style: cardStyle },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'space-between' } },
      createElement('h2', { style: { fontSize: '1.75rem', margin: 0 } }, ticker),
      createElement(
        'div',
        { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.55rem' } },
        ...(chip === undefined ? [] : [createElement(OwlValuationChip, { kind: chip.kind, label: chip.label })]),
        createElement(StatusBadge, { tone: holding.pending_review_id !== undefined ? 'warning' : holding.thesis_health === undefined ? 'neutral' : 'success' }, holding.pending_review_id !== undefined ? 'Strategy review drafted' : holding.thesis_health ?? 'Thesis review pending'),
      ),
    ),
    ...(chip === undefined
      ? []
      : [createElement('p', { style: { color: '#9aa4b7', fontSize: '0.85rem', margin: '0.45rem 0 0' } }, chip.reference)]),
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
    ...(mode === 'personal-local'
      ? [
          ...(holding.pending_review_id === undefined ? [] : [createReviewForm(holding)]),
          createManualFallbackActions(holding),
        ]
      : []),
  )
}

function createPortfolioOperationsCockpit(holdings: AppHolding[], totalCurrentValue: number, valuationRefresh: PortfolioValuationRefreshSummary | undefined) {
  const missingData = valuationRefresh?.holdings_missing_data ?? holdings
    .filter((holding) => holding.latest_price_checked_at === undefined)
    .map((holding) => holding.ticker ?? holding.company_id ?? holding.holding_id)
  const pendingReviews = holdings
    .filter((holding) => holding.pending_review_id !== undefined)
    .map((holding) => holding.ticker ?? holding.company_id ?? holding.holding_id)
  const currentState = `${holdings.length} ${holdings.length === 1 ? 'open holding' : 'open holdings'} · ${formatMoney(totalCurrentValue, 'USD')} current value`
  const userActionRequired = missingData.length > 0
    ? `Resolve ${missingData.length} ${missingData.length === 1 ? 'holding' : 'holdings'} with missing valuation data: ${missingData.join(', ')}`
    : pendingReviews.length > 0
      ? `Review provider draft for ${pendingReviews.join(', ')}`
      : 'No user action required — valuation automation is current'

  return createElement(
    'section',
    { 'aria-label': 'Portfolio operations cockpit', className: 'owl-workflow-card', style: { ...cardStyle, background: 'var(--owl-color-panel-deep)', borderColor: 'var(--owl-color-border-strong)' } },
    createElement('h2', { style: { fontSize: '1.25rem', margin: 0 } }, 'Portfolio operations cockpit'),
    createElement('p', { style: { color: '#9aa4b7', margin: '0.45rem 0 0' } }, 'Automatically maintained valuation state stays above manual fallbacks; buys, sells, and thesis changes remain user-approved audit events.'),
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', marginTop: '1rem' } },
      operationMetric('Current state', currentState),
      operationMetric('Last automation check', valuationRefresh?.last_price_check_at ?? 'No scheduled price check recorded'),
      operationMetric('Next scheduled check', valuationRefresh?.next_scheduled_check ?? '0 7 * * 1-5'),
      operationMetric('Price source', aggregatePriceSource(holdings)),
      operationMetric('User action required', userActionRequired),
    ),
  )
}

function operationMetric(label: string, value: string) {
  return createElement(
    'article',
    { style: { background: 'rgba(148, 163, 184, 0.08)', border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: '0.85rem', padding: '0.9rem' } },
    createElement('p', { style: { color: '#9aa4b7', fontSize: '0.76rem', fontWeight: 900, letterSpacing: '0.06em', margin: 0, textTransform: 'uppercase' } }, label),
    createElement('p', { style: { color: '#f8fafc', fontWeight: 850, lineHeight: 1.4, margin: '0.35rem 0 0' } }, value),
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
    createDetail('Price source', priceSourceLabel(holding)),
    ...(holding.latest_price_per_share === undefined ? [] : [createDetail('Current price / share', formatMoney(holding.latest_price_per_share, holding.currency))]),
    ...(holding.unrealized_gain_loss === undefined ? [] : [createDetail('Unrealized P&L', `${formatMoney(holding.unrealized_gain_loss, holding.currency)} (${formatPercent(holding.unrealized_gain_loss_percent ?? 0)})`)]),
    ...(holding.portfolio_weight === undefined ? [] : [createDetail('Concentration', formatPercent(holding.portfolio_weight))]),
    ...(holding.latest_valuation_at === undefined ? [] : [createDetail('Valuation date', holding.latest_valuation_at)]),
    ...(holding.latest_valuation_source === undefined ? [] : [createDetail('Valuation source', holding.latest_valuation_source)]),
    ...(holding.latest_price_checked_at === undefined ? [] : [createDetail('Latest price check', holding.latest_price_checked_at)]),
    ...(holding.latest_valuation_confidence === undefined ? [] : [createDetail('Valuation confidence', holding.latest_valuation_confidence)]),
    ...(holding.latest_valuation_caveat === undefined ? [] : [createDetail('Valuation caveat', holding.latest_valuation_caveat)]),
    ...(holding.latest_valuation_source_ids === undefined || holding.latest_valuation_source_ids.length === 0 ? [] : [createDetail('Valuation source IDs', holding.latest_valuation_source_ids.join(', '))]),
    ...(holding.latest_valuation_missing_data === undefined || holding.latest_valuation_missing_data.length === 0 ? [] : [createDetail('Valuation missing data', holding.latest_valuation_missing_data.join(', '))]),
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
    createDetail('Opened by actor', formatActor(holding.opened_by_actor_type, holding.opened_by_actor_id)),
    ...(holding.latest_reviewed_at === undefined ? [] : [createDetail('Last reviewed', holding.latest_reviewed_at)]),
    createDetail('Last updated', holding.updated_at),
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

    const normalizedPendingReviewDate = normalizeDateForInput(holding.pending_review_next_review_at)
    const normalizedLatestReviewedAt = holding.latest_reviewed_at === undefined ? 'Not reviewed' : normalizeDateForDisplay(holding.latest_reviewed_at)

    return createElement(
      'div',
      {
        style: {
          borderTop: '1px solid rgba(148, 163, 184, 0.16)',
          display: 'grid',
          gap: '0.9rem',
          marginTop: '1rem',
          paddingTop: '1rem',
        },
      },
      createElement('h3', { style: { fontSize: '1rem', margin: 0 } }, 'Strategy review drafted'),
      createElement('p', { style: { color: '#9aa4b7', margin: 0 } }, 'Choose one auditable decision path for this provider-authored Buffett-Munger review before it becomes portfolio state.'),
      createElement(
        'div',
        {
          style: {
            ...reviewActionShellStyle,
            background: 'rgba(148, 163, 184, 0.06)',
            position: 'sticky',
            top: '0.85rem',
            zIndex: 10,
          },
        },
        createElement('h4', { style: { fontSize: '0.95rem', margin: 0 } }, 'Pending review decision summary'),
        createElement(
          'p',
          {
            style: {
              color: '#9aa4b7',
              margin: '0.15rem 0 0',
              maxWidth: '82ch',
            },
          },
          'Compare these paths quickly: provider draft keeps the AI recommendation, override captures your own thesis values, and reject keeps existing confirmed state. Sticky quick-links jump to each form.',
        ),
        createElement(
          'div',
          {
            style: {
              display: 'grid',
              gap: '0.55rem',
              gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
              marginTop: '0.4rem',
            },
          },
          createElement(
            'a',
            {
              href: '#holding-review-path-confirm',
              style: decisionQuickLinkStyle,
            },
            'Apply provider draft',
          ),
          createElement(
            'a',
            {
              href: '#holding-review-path-override',
              style: decisionQuickLinkStyle,
            },
            'Apply user override',
          ),
          createElement(
            'a',
            {
              href: '#holding-review-path-reject',
              style: decisionQuickLinkStyle,
            },
            'Reject provider draft',
          ),
        ),
      ),
      createElement(
        'div',
        {
          style: {
            alignItems: 'start',
            display: 'grid',
            gap: '0.75rem',
            gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))',
          },
        },
        createElement(
          'section',
          { id: 'review-comparison-confirmed', style: { ...decisionPanelStyle, background: 'rgba(148, 163, 184, 0.08)' } },
          createElement('h4', { style: { fontSize: '0.95rem', margin: 0 } }, 'Current confirmed thesis'),
          createElement('p', { style: { color: '#9aa4b7', margin: 0 } }, currentThesisCopy),
        ),
        createElement(
          'section',
          { id: 'review-comparison-draft', style: { ...decisionPanelStyle, background: 'rgba(251, 191, 36, 0.1)' } },
          createElement('h4', { style: { fontSize: '0.95rem', margin: 0 } }, 'Provider-authored review draft'),
          createDetail('Pending thesis health', holding.pending_review_thesis_health ?? 'Unknown'),
          createDetail('Pending action stance', holding.pending_review_action_stance ?? 'Unknown'),
          createDetail('Pending review rationale', holding.pending_review_rationale ?? 'No rationale recorded'),
          createDetail('Pending next review', holding.pending_review_next_review_at ?? 'Unknown'),
          createElement('p', { style: { color: '#9aa4b7', margin: '0.2rem 0 0' } }, `Last reviewed stamp: ${normalizedLatestReviewedAt}`),
        ),
        createElement(
          'section',
          { id: 'review-comparison-bounds', style: { ...decisionPanelStyle, background: 'rgba(214, 178, 94, 0.08)' } },
          createElement('h4', { style: { fontSize: '0.95rem', margin: 0 } }, 'Audit boundary rules'),
          createElement('p', { style: { color: '#9aa4b7', margin: 0 } }, 'Overrides require all four required fields below and produce an explicit user-authored audit event; reject keeps current confirmed thesis and clears the pending draft.'),
          createElement('p', { style: { color: '#9aa4b7', margin: '0.35rem 0 0', fontSize: '0.82rem' } }, 'Date fields expect YYYY-MM-DD format for consistency with ledger-aware display.'),
        ),
      ),
      createElement(
        'form',
        {
          id: 'holding-review-path-confirm',
          action: `/api/portfolio/${holding.holding_id}/review/${holding.pending_review_id}/confirm`,
          method: 'post',
          style: { ...decisionPanelStyle, background: 'rgba(22, 163, 74, 0.10)' },
        },
        createElement('h4', { style: { fontSize: '0.95rem', margin: 0 } }, 'Apply provider draft'),
        createElement('p', { style: { color: '#9aa4b7', margin: 0 } }, 'Applies the provider-authored thesis health, action stance, and next review date to portfolio state.'),
        createSubmitButton('Apply provider draft', 'var(--owl-color-accent)'),
      ),
      createElement(
        'form',
        {
          id: 'holding-review-path-override',
          action: `/api/portfolio/${holding.holding_id}/review/${holding.pending_review_id}/override`,
          method: 'post',
          style: { ...decisionPanelStyle, background: 'rgba(214, 178, 94, 0.12)' },
        },
        createElement('h4', { style: { fontSize: '0.95rem', margin: 0 } }, 'Apply user override'),
        createElement('p', { style: { color: '#9aa4b7', margin: 0 } }, 'Applies your edited values instead of the provider draft and records a user-authored audit event.'),
        createReviewSelect('Override thesis health', 'thesis_health', ['HEALTHY', 'WATCH', 'IMPAIRED', 'EXIT_CANDIDATE'], holding.pending_review_thesis_health ?? 'WATCH'),
        createReviewSelect('Override action stance', 'action_stance', ['HOLD', 'ADD_ON_PULLBACK', 'REDUCE', 'EXIT_REVIEW_NEEDED', 'RESEARCH_MORE'], holding.pending_review_action_stance ?? 'RESEARCH_MORE'),
        createReviewTextarea('Override rationale (required)', 'rationale', holding.pending_review_rationale ?? ''),
        createReviewTextarea('Override evidence summary (required)', 'evidence_summary', 'User reviewed provider draft against the local ledger and available evidence.'),
        createReviewTextarea('Override uncertainty (required)', 'uncertainty', 'User override records uncertainty before the next scheduled review.'),
        createReviewInput('Override next review date (required)', 'next_review_at', normalizedPendingReviewDate),
        createElement('p', { style: { color: '#9aa4b7', margin: 0, fontSize: '0.82rem' } }, 'Date fields use YYYY-MM-DD format (ISO date without time).'),
        createSubmitButton('Apply user override', 'var(--owl-color-gold)'),
      ),
      createElement(
        'form',
        {
          id: 'holding-review-path-reject',
          action: `/api/portfolio/${holding.holding_id}/review/${holding.pending_review_id}/reject`,
          method: 'post',
          style: { ...decisionPanelStyle, background: 'rgba(239, 68, 68, 0.1)' },
        },
        createElement('h4', { style: { fontSize: '0.95rem', margin: 0 } }, 'Reject provider draft'),
        createElement('p', { style: { color: '#9aa4b7', margin: 0 } }, 'Leaves the current confirmed portfolio thesis unchanged and clears this pending draft.'),
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
        borderTop: '1px solid rgba(148, 163, 184, 0.16)',
        display: 'grid',
        gap: '0.75rem',
        marginTop: '1rem',
        paddingTop: '1rem',
      },
    },
    createElement('h3', { style: { fontSize: '1rem', margin: 0 } }, 'Strategy-driven holding review'),
    createElement('p', { style: { color: '#9aa4b7', margin: 0 } }, 'Ask Owlfolio to draft a Buffett-Munger thesis-health review for this holding.'),
    createSubmitButton('Run Buffett-Munger review', 'var(--owl-color-accent)'),
  )
}

function createManualFallbackActions(holding: AppHolding) {
  return createElement(
    'details',
    {
      style: {
        borderTop: '1px solid rgba(148, 163, 184, 0.16)',
        marginTop: '1rem',
        paddingTop: '1rem',
      },
    },
    createElement('summary', { style: { color: 'var(--owl-color-gold-bright)', cursor: 'pointer', fontWeight: 900 } }, 'Manual fallback actions'),
    createElement('p', { style: { color: '#9aa4b7', margin: '0.65rem 0 0' } }, 'Use these only when scheduled valuation or provider review automation cannot supply a sourced draft. Submitted values still create auditable ledger events.'),
    createValuationForm(holding),
    ...(holding.pending_review_id === undefined ? [createReviewForm(holding)] : []),
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
    { style: { color: '#cbd5e1', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
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
    { style: { color: '#cbd5e1', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
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
    { style: { color: '#cbd5e1', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
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

function createInvestableCapitalPanel(investableCapital?: InvestableCapitalSnapshot) {
  const currentLabel = investableCapital === undefined
    ? 'Not set yet'
    : formatMoney(investableCapital.amount, investableCapital.currency)

  return createElement(
    'section',
    { style: { ...cardStyle, display: 'grid', gap: '0.85rem' } },
    createElement('h2', { style: { fontSize: '1.15rem', margin: 0 } }, 'Investable capital'),
    createElement(
      'p',
      { style: { color: '#9aa4b7', fontSize: '0.92rem', margin: 0 } },
      'Used to size positions; advisory only. You author the actual buys.',
    ),
    createElement(
      'p',
      { style: { color: '#cbd5e1', fontSize: '1rem', margin: 0 } },
      createElement('strong', null, 'Current investable capital: '),
      createElement('span', { style: { color: 'var(--owl-color-gold-bright)', fontWeight: 800 } }, currentLabel),
    ),
    createElement(
      'form',
      {
        action: '/api/portfolio/investable-capital',
        method: 'post',
        style: { display: 'grid', gap: '0.75rem' },
      },
      createElement(
        'label',
        { style: { color: '#cbd5e1', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
        'Investable capital',
        createElement('input', {
          name: 'amount',
          required: true,
          step: '0.01',
          min: '0',
          type: 'number',
          defaultValue: investableCapital?.amount.toString() ?? '',
          style: inputStyle,
        }),
      ),
      createElement('input', { name: 'currency', type: 'hidden', value: investableCapital?.currency ?? 'USD' }),
      createElement(
        'button',
        {
          type: 'submit',
          style: {
            background: 'var(--owl-color-gold)',
            border: 0,
            borderRadius: '0.75rem',
            color: '#ffffff',
            cursor: 'pointer',
            fontWeight: 800,
            padding: '0.75rem 1rem',
          },
        },
        'Save investable capital',
      ),
    ),
  )
}

function createValuationForm(holding: AppHolding) {
  return createElement(
    'form',
    {
      action: `/api/portfolio/${holding.holding_id}/valuation`,
      method: 'post',
      style: {
        borderTop: '1px solid rgba(148, 163, 184, 0.16)',
        display: 'grid',
        gap: '0.75rem',
        marginTop: '1rem',
        paddingTop: '1rem',
      },
    },
    createElement('h3', { style: { fontSize: '1rem', margin: 0 } }, 'Manual valuation checkpoint'),
    createElement(
      'label',
      { style: { color: '#cbd5e1', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
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
      { style: { color: '#cbd5e1', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
      'Valuation date',
      createElement('input', {
        name: 'valued_at',
        required: true,
        type: 'date',
        defaultValue: normalizeDateForInput(holding.latest_valuation_at),
        style: inputStyle,
      }),
    ),
    createElement('input', { name: 'currency', type: 'hidden', value: holding.currency }),
    createElement(
      'button',
      {
        type: 'submit',
        style: {
          background: 'var(--owl-color-gold)',
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
    { style: { color: '#cbd5e1', margin: '0.75rem 0 0' } },
    createElement('strong', null, `${label}: `),
    value,
  )
}

function createShariahGateDetails(holding: AppHolding) {
  if (holding.shariah_gate_decision_id === undefined) {
    return []
  }

  return [
    createDetail('Gate decision', holding.shariah_gate_decision_id),
    createDetail('Shariah gate', `${holding.shariah_gate_status ?? 'UNKNOWN'} — ${describeGateAllowance(holding.shariah_gate_allowed)}`),
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

function aggregatePriceSource(holdings: AppHolding[]): string {
  const sources = new Set(
    holdings
      .filter((holding) => holding.latest_market_value !== undefined)
      .map((holding) => priceSourceLabel(holding)),
  )
  if (sources.size === 0) {
    return '—'
  }
  return [...sources].join(', ')
}

function priceSourceLabel(holding: AppHolding): string {
  if (holding.latest_market_value === undefined) {
    return '—'
  }

  const raw = holding.latest_valuation_source?.toLowerCase()
  if (raw === 'yahoo') {
    return 'Yahoo Finance'
  }
  if (raw === 'manual' || raw === undefined) {
    return 'Manual'
  }
  return holding.latest_valuation_source ?? 'Manual'
}

type HoldingValuationChip = {
  kind: OwlValuationKind
  label: string
  reference: string
}

/**
 * The valuation chip is TRUTHFUL: when the holding's linked research case supplies
 * a buy-below price (value at the moat-class hurdle), it compares the current price
 * to that buy-below threshold and renders an undervalued/fair/overvalued verdict
 * plus a "Buy below $X · <moat> <hurdle>%" reference line.
 *
 * When there is NO research buy-below (older/gated cases), it falls back to the
 * legacy current-vs-cost-basis gap, clearly labeled as an entry-vs-market move —
 * NOT a valuation verdict. It never fabricates a verdict.
 */
function holdingValuationChip(holding: PortfolioHolding): HoldingValuationChip | undefined {
  const currentPrice = holding.latest_price_per_share
  if (currentPrice === undefined) {
    return undefined
  }

  const buyBelow = holding.buyBelowPricePerShare
  if (buyBelow !== undefined && buyBelow > 0) {
    // TRUE valuation verdict: current price vs research buy-below (value at hurdle).
    const reference = buyBelowReferenceLine(holding, buyBelow)
    // Within ±3% of the buy-below is the honest "fair" band.
    const gap = (currentPrice - buyBelow) / buyBelow
    if (gap <= -0.03) {
      const discount = Math.round(-gap * 100)
      return { kind: 'undervalued', label: discount <= 0 ? 'IN BUY ZONE' : `UNDERVALUED ${discount}%`, reference }
    }
    if (gap >= 0.03) {
      const premium = Math.round(gap * 100)
      return { kind: 'overvalued', label: `OVERVALUED ${premium}%`, reference }
    }
    return { kind: 'fair', label: 'IN BUY ZONE', reference }
  }

  // Fallback: no research buy-below recorded. Compare current price to the recorded
  // cost basis (the price the lot was opened at) and label it as entry-vs-market,
  // NOT a valuation verdict.
  if (holding.cost_basis_per_share <= 0) {
    return undefined
  }
  const reference = 'Entry-vs-market move (no research buy-below recorded) — not a valuation verdict.'
  const gap = (currentPrice - holding.cost_basis_per_share) / holding.cost_basis_per_share
  if (gap <= -0.03) {
    return { kind: 'undervalued', label: `DOWN ${Math.round(-gap * 100)}% VS ENTRY`, reference }
  }
  if (gap >= 0.03) {
    return { kind: 'overvalued', label: `UP ${Math.round(gap * 100)}% VS ENTRY`, reference }
  }
  return { kind: 'fair', label: 'NEAR ENTRY', reference }
}

function buyBelowReferenceLine(holding: PortfolioHolding, buyBelow: number): string {
  const parts = [`Buy below ${formatMoney(buyBelow, holding.currency)}`]
  const moat = holding.moatClass?.trim()
  if (moat !== undefined && moat.length > 0) {
    parts.push(moat)
  }
  if (holding.hurdleRate !== undefined && Number.isFinite(holding.hurdleRate)) {
    parts.push(`${Math.round(holding.hurdleRate * 100)}% hurdle`)
  }
  return parts.join(' · ')
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

function normalizeDateForInput(value: string | undefined): string {
  if (value === undefined) {
    return new Date().toISOString().slice(0, 10)
  }

  const trimmed = value.trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    return trimmed.slice(0, 10)
  }

  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10)
  }

  return new Date().toISOString().slice(0, 10)
}

function normalizeDateForDisplay(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value.slice(0, 10)
  }

  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10)
  }

  return value
}
