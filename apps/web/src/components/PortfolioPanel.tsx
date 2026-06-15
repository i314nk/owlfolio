import { createElement, Fragment, type ReactNode } from 'react'

import type { InvestableCapitalSnapshot } from '@owlfolio/ledger/projections/investableCapitalProjection'

import { OwlButtonLink, OwlRingGauge, OwlValuationChip, RouteHeader, type OwlValuationKind } from './designSystem'
import { HoldingReviewChecklistConfirm } from './HoldingReviewChecklistConfirm'
import type { AppHolding, MonitorAlert, WorkflowMode } from '../lib/workflow'
import { StatusBadge } from './StatusBadge'

const HOLDING_ALERT_TONE: Record<MonitorAlert['severity'], 'danger' | 'warning' | 'neutral'> = {
  urgent: 'danger',
  attention: 'warning',
  info: 'neutral',
}

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
  /** Open agent observations + drafts per holding (tranche / concentration / Shariah grace / sell-review). */
  alerts?: MonitorAlert[]
}

const cardStyle = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-panel)',
  boxShadow: 'var(--owl-shadow-panel)',
  padding: '1.15rem 1.3rem',
}

const inputStyle = {
  background: 'var(--owl-color-panel-elevated)',
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
  background: 'var(--owl-color-panel)',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderRadius: '0.75rem',
  color: 'var(--owl-color-muted)',
  display: 'inline-flex',
  gap: '0.4rem',
  padding: '0.55rem 0.72rem',
  textDecoration: 'none',
}

/**
 * The Portfolio — where the user's capital stands. Leads with the vital signs
 * (total value, open holdings, Shariah-compliant gauge) as the editorial ledger
 * line, then each holding as a clear position: economics, valuation, thesis
 * health, and review. Your holdings, valued and monitored.
 *
 * Returns a Fragment so each section is a direct child of the route frame and
 * inherits the app's staggered reveal.
 */
export function PortfolioPanel({ holdings, mode = 'demo', valuationRefresh, investableCapital, alerts = [] }: PortfolioPanelProps) {
  const totalCostBasis = holdings.reduce((sum, holding) => sum + holding.total_cost_basis, 0)
  const totalCurrentValue = holdings.reduce((sum, holding) => sum + (holding.latest_market_value ?? 0), 0)

  return createElement(
    Fragment,
    null,
    createElement(RouteHeader, {
      kicker: 'Portfolio cockpit',
      title: 'Portfolio',
      description: mode === 'personal-local'
        ? `Personal local ledger holdings. Total cost basis: ${formatMoney(totalCostBasis, 'USD')}. Current value: ${formatMoney(totalCurrentValue, 'USD')}`
        : `Projected demo holdings. Total cost basis: ${formatMoney(totalCostBasis, 'USD')}. Current value: ${formatMoney(totalCurrentValue, 'USD')}`,
    }),
    createElement('hr', { className: 'owl-rule' }),
    createPortfolioLedgerLine(holdings, totalCurrentValue),
    ...(mode === 'personal-local' ? [createInvestableCapitalPanel(investableCapital)] : []),
    createPortfolioOperationsCockpit(holdings, totalCurrentValue, valuationRefresh),
    ...(valuationRefresh === undefined ? [] : [createScheduledValuationRefreshCard(valuationRefresh)]),
    ...(holdings.length === 0
      ? [createPortfolioEmptyState()]
      : holdings.map((holding) => createHoldingCard(holding, mode, alerts.filter((alert) => alert.subject.holding_id === holding.holding_id)))),
  )
}

/**
 * Inline agent observations + human-decision drafts for one holding: tranche review (thesis-gated),
 * concentration trim-review (winners run; not an auto-trim), Shariah grace (days-left; not a ruling),
 * DIVEST-REQUIRED / SELL-REVIEW drafts (proposals, never executed), and the annual re-run flag. Each
 * carries the spec's caveat in its detail; nothing here advances state.
 */
function createHoldingAlerts(alerts: MonitorAlert[]) {
  if (alerts.length === 0) {
    return null
  }

  return createElement(
    'section',
    { className: 'owl-section-card', style: { boxShadow: 'none', display: 'grid', gap: 'var(--owl-space-2)', marginTop: '1rem' } },
    createElement('p', { className: 'owl-section-accent' }, 'Agent observations & drafts — you decide'),
    ...alerts.map((alert) => createElement(
      'div',
      { key: alert.id, className: 'owl-row owl-row-top', 'data-alert-kind': alert.kind },
      createElement(
        'div',
        { className: 'owl-row-main' },
        createElement(
          'div',
          { className: 'owl-activity-meta', style: { marginBottom: '0.2rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' } },
          createElement(StatusBadge, { tone: HOLDING_ALERT_TONE[alert.severity] }, alert.severity === 'urgent' ? 'Urgent' : alert.severity === 'attention' ? 'Attention' : 'Watch'),
          createElement(StatusBadge, { tone: 'neutral' }, alert.is_draft ? 'Draft — you author' : 'Observation'),
          ...alertKindTag(alert),
        ),
        createElement('p', { className: 'owl-row-title' }, alert.headline),
        createElement('p', { className: 'owl-row-helper' }, alert.detail),
      ),
    )),
  )
}

/**
 * A kind tag for a holding alert, so per-lot tranche fills, deployment, thesis-break, and Shariah grace
 * read as distinct labels (UI-continuity Rule 2: per-lot tranche tags, deployed % vs target, thesis-trigger
 * status, Shariah grace countdown). The figures themselves (tranche_id, deployed_pct, days-left, buy_price_
 * version) are carried in the alert headline/detail from the monitor projection.
 */
function alertKindTag(alert: MonitorAlert): ReactNode[] {
  const labelByKind: Partial<Record<MonitorAlert['kind'], string>> = {
    tranche: 'Tranche / lot',
    concentration: 'Deployed vs target',
    shariah_grace: 'Shariah grace countdown',
    shariah_rescreen: 'Shariah re-screen',
    divest_required: 'Thesis trigger',
    sell_review: 'Thesis trigger',
    annual_rerun: 'Thesis re-check',
  }
  const label = labelByKind[alert.kind]
  if (label === undefined) {
    return []
  }
  return [createElement(StatusBadge, { key: 'kind', tone: alert.kind === 'shariah_grace' || alert.kind === 'divest_required' ? 'warning' : 'neutral' }, label)]
}

function createPortfolioLedgerLine(holdings: AppHolding[], totalCurrentValue: number) {
  const hasHoldings = holdings.length > 0
  const hasValuation = holdings.some((holding) => holding.latest_market_value !== undefined)
  const gated = holdings.filter((holding) => holding.shariah_gate_decision_id !== undefined)
  const allowed = gated.filter((holding) => holding.shariah_gate_allowed === true).length
  const compliancePct = gated.length === 0 ? 0 : Math.round((allowed / gated.length) * 100)

  const stats: { figureClass: string; label: string; value: string }[] = [
    {
      figureClass: 'owl-ledger-figure-money',
      label: 'Total value',
      value: hasValuation ? formatMoney(totalCurrentValue, 'USD') : '—',
    },
    { figureClass: '', label: 'Open holdings', value: hasHoldings ? String(holdings.length) : '—' },
    {
      figureClass: gated.length > 0 && compliancePct === 100 ? 'owl-ledger-figure-emerald' : '',
      label: 'Shariah-gated',
      value: gated.length === 0 ? '—' : `${allowed}/${gated.length}`,
    },
  ]

  return createElement(
    'section',
    { 'aria-label': 'Portfolio summary', className: 'owl-ledger-line' },
    ...stats.map((stat) => createElement(
      'article',
      { className: 'owl-ledger-stat', key: stat.label },
      createElement('p', { className: 'owl-ledger-label' }, stat.label),
      createElement('p', { className: `owl-ledger-figure ${stat.figureClass}`.trim() }, stat.value),
    )),
    createElement(
      'article',
      { className: 'owl-ledger-stat', key: 'Shariah compliant', style: { alignItems: 'center', display: 'flex', gap: 'var(--owl-space-3)' } },
      createElement(
        'div',
        { style: { display: 'grid', gap: '0.3rem' } },
        createElement('p', { className: 'owl-ledger-label' }, 'Shariah compliant'),
        createElement('p', { className: 'owl-ledger-figure owl-ledger-figure-emerald' }, gated.length === 0 ? '—' : `${compliancePct}%`),
      ),
      createElement(OwlRingGauge, {
        value: compliancePct,
        label: 'Compliant',
        tone: gated.length === 0 ? 'amber' : compliancePct === 100 ? 'emerald' : 'amber',
        size: 56,
      }),
    ),
  )
}

function createScheduledValuationRefreshCard(summary: PortfolioValuationRefreshSummary) {
  return createElement(
    'section',
    { 'aria-label': 'Scheduled valuation refresh', className: 'owl-section-card owl-workflow-card' },
    createElement('p', { className: 'owl-section-accent' }, 'Valuation'),
    createElement('h2', { className: 'owl-section-title' }, 'Scheduled valuation refresh'),
    createElement('p', { className: 'owl-row-helper', style: { margin: '0.2rem 0 0.3rem' } }, 'Factual price checks can update valuation snapshots automatically; investment actions remain approval-gated.'),
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.2rem' } },
      createDetail('Last price check', summary.last_price_check_at ?? 'No scheduled price check recorded'),
      createDetail('Next scheduled check', summary.next_scheduled_check),
      createDetail('Data source', summary.data_source),
      createDetail('Confidence / caveat', summary.confidence_caveat),
      createDetail('Holdings missing data', summary.holdings_missing_data.length === 0 ? 'None' : summary.holdings_missing_data.join(', ')),
    ),
  )
}

function createPortfolioEmptyState() {
  return createElement(
    'section',
    { key: 'portfolio-empty-state', 'aria-label': 'Empty portfolio', className: 'owl-section-card owl-workflow-card' },
    createElement('p', { className: 'owl-section-accent' }, 'Portfolio cockpit'),
    createElement('h2', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-lg)' } }, 'No holdings are open yet'),
    createElement(
      'p',
      { className: 'owl-body', style: { margin: '0.3rem 0 0' } },
      'Follow the audit path: research decision → watchlist confirmation → holding lot entry.',
    ),
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1rem' } },
      createElement(OwlButtonLink, { href: '/watchlist', variant: 'primary' }, 'Go to watchlist'),
      createElement('span', { style: { color: 'var(--owl-color-muted)', fontWeight: 800 } }, 'Record first lot after confirming a watchlist item'),
    ),
    createElement(
      'section',
      { 'aria-label': 'Empty holdings table', style: { ...decisionPanelStyle, background: 'var(--owl-color-panel)', marginTop: '1rem' } },
      createElement('h3', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)' } }, 'Empty holdings table'),
      createDetail('Portfolio state', 'No portfolio events recorded'),
      createDetail('Provider sync', 'Provider sync not connected'),
      createDetail('Last updated', 'none'),
      createElement('p', { className: 'owl-body', style: { margin: '0.25rem 0 0' } }, 'Last updated: none'),
    ),
  )
}

function createHoldingCard(holding: PortfolioHolding, mode: WorkflowMode, alerts: MonitorAlert[]) {
  const ticker = holding.ticker ?? holding.company_id ?? holding.holding_id
  const chip = holdingValuationChip(holding)

  return createElement(
    'section',
    { key: holding.holding_id, id: holding.holding_id, className: 'owl-section-card owl-workflow-card' },
    createElement(
      'div',
      { className: 'owl-row owl-row-top' },
      createElement(
        'div',
        { className: 'owl-row-main' },
        createElement('p', { className: 'owl-section-accent' }, 'Open position'),
        createElement('h2', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-lg)' } }, ticker),
        ...(chip === undefined
          ? []
          : [createElement('p', { className: 'owl-row-helper', style: { margin: '0.2rem 0 0' } }, chip.reference)]),
      ),
      createElement(
        'div',
        { className: 'owl-row-aside' },
        ...(chip === undefined ? [] : [createElement(OwlValuationChip, { kind: chip.kind, label: chip.label })]),
        createElement(StatusBadge, { tone: holding.pending_review_id !== undefined ? 'warning' : holding.thesis_health === undefined ? 'neutral' : 'success' }, holding.pending_review_id !== undefined ? 'Strategy review drafted' : holding.thesis_health ?? 'Thesis review pending'),
      ),
    ),
    createPositionEconomicsTable(holding),
    createHoldingAlerts(alerts),
    createConfirmedPortfolioState(holding),
    ...createShariahGateDetails(holding),
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
    { 'aria-label': 'Portfolio operations cockpit', className: 'owl-section-card owl-workflow-card' },
    createElement('p', { className: 'owl-section-accent' }, 'Operations'),
    createElement('h2', { className: 'owl-section-title' }, 'Portfolio operations cockpit'),
    createElement('p', { className: 'owl-row-helper', style: { margin: '0.2rem 0 0.3rem' } }, 'Automatically maintained valuation state stays above manual fallbacks; buys, sells, and thesis changes remain user-approved audit events.'),
    createElement(
      'div',
      { className: 'owl-row-list' },
      operationMetric('Current state', currentState),
      operationMetric('Last automation check', valuationRefresh?.last_price_check_at ?? 'No scheduled price check recorded'),
      operationMetric('User action required', userActionRequired),
    ),
  )
}

function operationMetric(label: string, value: string) {
  return createElement(
    'div',
    { className: 'owl-row owl-row-top' },
    createElement(
      'div',
      { className: 'owl-row-main' },
      createElement('p', { className: 'owl-row-title' }, label),
      createElement('p', { className: 'owl-row-helper' }, value),
    ),
  )
}

function createPositionEconomicsTable(holding: AppHolding) {
  return createElement(
    'section',
    { className: 'owl-financial-table', style: { ...cardStyle, boxShadow: 'none', marginTop: '1rem' } },
    createElement('h3', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)', margin: '0 0 0.6rem' } }, 'Position economics'),
    createDetail('Shares', formatNumber(holding.shares)),
    createDetail('Cost basis / share', formatMoney(holding.cost_basis_per_share, holding.currency)),
    createDetail('Total cost basis', formatMoney(holding.total_cost_basis, holding.currency)),
    createDetail('Current value', holding.latest_market_value === undefined ? 'No valuation snapshot recorded' : formatMoney(holding.latest_market_value, holding.currency)),
    createDetail('Price source', priceSourceLabel(holding)),
    ...(holding.latest_price_per_share === undefined ? [] : [createDetail('Current price / share', formatMoney(holding.latest_price_per_share, holding.currency))]),
    ...(holding.unrealized_gain_loss === undefined ? [] : [createDetail('Unrealized P&L', `${formatMoney(holding.unrealized_gain_loss, holding.currency)} (${formatPercent(holding.unrealized_gain_loss_percent ?? 0)})`)]),
    ...(holding.portfolio_weight === undefined ? [] : [createDetail('Concentration', formatPercent(holding.portfolio_weight))]),
    createDetail('Opened', holding.opened_at),
    ...(holding.latest_valuation_at === undefined ? [] : [createDetail('Valuation date', holding.latest_valuation_at)]),
    createElement(
      'details',
      { style: { marginTop: '0.75rem' } },
      createElement('summary', { style: { color: 'var(--owl-color-gold-bright)', cursor: 'pointer', fontWeight: 700, fontSize: 'var(--owl-text-sm)' } }, 'Valuation provenance'),
      ...(holding.latest_valuation_source === undefined ? [] : [createDetail('Valuation source', holding.latest_valuation_source)]),
      ...(holding.latest_price_checked_at === undefined ? [] : [createDetail('Latest price check', holding.latest_price_checked_at)]),
      ...(holding.latest_valuation_confidence === undefined ? [] : [createDetail('Valuation confidence', holding.latest_valuation_confidence)]),
      ...(holding.latest_valuation_caveat === undefined ? [] : [createDetail('Valuation caveat', holding.latest_valuation_caveat)]),
      ...(holding.latest_valuation_source_ids === undefined || holding.latest_valuation_source_ids.length === 0 ? [] : [createDetail('Valuation source IDs', holding.latest_valuation_source_ids.join(', '))]),
      ...(holding.latest_valuation_missing_data === undefined || holding.latest_valuation_missing_data.length === 0 ? [] : [createDetail('Valuation missing data', holding.latest_valuation_missing_data.join(', '))]),
    ),
  )
}

function createConfirmedPortfolioState(holding: AppHolding) {
  const hasAuditIds = holding.research_case_id !== undefined || holding.watchlist_item_id !== undefined

  return createElement(
    'section',
    { className: 'owl-workflow-card', style: { ...cardStyle, boxShadow: 'none', marginTop: '1rem' } },
    createElement('h3', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)', margin: '0 0 0.6rem' } }, 'Confirmed portfolio state'),
    createDetail('Strategy', holding.strategy_id ?? 'Strategy not recorded'),
    createDetail('Opened by actor', formatActor(holding.opened_by_actor_type, holding.opened_by_actor_id)),
    ...(holding.latest_reviewed_at === undefined ? [] : [createDetail('Last reviewed', holding.latest_reviewed_at)]),
    createDetail('Last updated', holding.updated_at),
    ...(holding.thesis_health === undefined ? [] : [createDetail('Thesis health', holding.thesis_health)]),
    ...(holding.action_stance === undefined ? [] : [createDetail('Action stance', holding.action_stance)]),
    ...(holding.latest_review_rationale === undefined ? [] : [createDetail('Review rationale', holding.latest_review_rationale)]),
    ...(holding.latest_review_evidence_summary === undefined ? [] : [createDetail('Review evidence', holding.latest_review_evidence_summary)]),
    ...(holding.latest_review_uncertainty === undefined ? [] : [createDetail('Review uncertainty', holding.latest_review_uncertainty)]),
    ...(holding.next_review_at === undefined ? [] : [createDetail('Next review', holding.next_review_at)]),
    ...(hasAuditIds
      ? [createElement(
        'details',
        { style: { marginTop: '0.75rem' } },
        createElement('summary', { style: { color: 'var(--owl-color-gold-bright)', cursor: 'pointer', fontWeight: 700, fontSize: 'var(--owl-text-sm)' } }, 'Audit / provenance'),
        ...(holding.research_case_id === undefined ? [] : [createDetail('Research case', holding.research_case_id)]),
        ...(holding.watchlist_item_id === undefined ? [] : [createDetail('Watchlist item', holding.watchlist_item_id)]),
      )]
      : []),
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
      createElement('h3', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)' } }, 'Strategy review drafted'),
      createElement('p', { className: 'owl-body', style: { margin: 0 } }, 'Choose one auditable decision path for this provider-authored Buffett-Munger review before it becomes portfolio state.'),
      createElement(
        'div',
        {
          style: {
            ...reviewActionShellStyle,
            background: 'var(--owl-color-panel)',
            position: 'sticky',
            top: '0.85rem',
            zIndex: 10,
          },
        },
        createElement('h4', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)' } }, 'Pending review decision summary'),
        createElement(
          'p',
          {
            style: {
              color: 'var(--owl-color-muted)',
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
          { id: 'review-comparison-confirmed', style: { ...decisionPanelStyle, background: 'var(--owl-color-panel)' } },
          createElement('h4', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)' } }, 'Current confirmed thesis'),
          createElement('p', { className: 'owl-body', style: { margin: 0 } }, currentThesisCopy),
        ),
        createElement(
          'section',
          { id: 'review-comparison-draft', style: { ...decisionPanelStyle, background: 'rgba(251, 191, 36, 0.1)' } },
          createElement('h4', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)' } }, 'Provider-authored review draft'),
          createDetail('Pending thesis health', holding.pending_review_thesis_health ?? 'Unknown'),
          createDetail('Pending action stance', holding.pending_review_action_stance ?? 'Unknown'),
          createDetail('Pending review rationale', holding.pending_review_rationale ?? 'No rationale recorded'),
          createDetail('Pending next review', holding.pending_review_next_review_at ?? 'Unknown'),
          createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.2rem 0 0' } }, `Last reviewed stamp: ${normalizedLatestReviewedAt}`),
        ),
        createElement(
          'section',
          { id: 'review-comparison-bounds', style: { ...decisionPanelStyle, background: 'rgba(214, 178, 94, 0.08)' } },
          createElement('h4', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)' } }, 'Audit boundary rules'),
          createElement('p', { className: 'owl-body', style: { margin: 0 } }, 'Overrides require all four required fields below and produce an explicit user-authored audit event; reject keeps current confirmed thesis and clears the pending draft.'),
          createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.35rem 0 0', fontSize: 'var(--owl-text-sm)' } }, 'Date fields expect YYYY-MM-DD format for consistency with ledger-aware display.'),
        ),
      ),
      createElement(HoldingReviewChecklistConfirm, {
        holdingId: holding.holding_id,
        reviewId: holding.pending_review_id,
      }),
      createElement(
        'form',
        {
          id: 'holding-review-path-override',
          action: `/api/portfolio/${holding.holding_id}/review/${holding.pending_review_id}/override`,
          method: 'post',
          style: { ...decisionPanelStyle, background: 'rgba(214, 178, 94, 0.12)' },
        },
        createElement('h4', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)' } }, 'Apply user override'),
        createElement('p', { className: 'owl-body', style: { margin: 0 } }, 'Applies your edited values instead of the provider draft and records a user-authored audit event.'),
        createReviewSelect('Override thesis health', 'thesis_health', ['HEALTHY', 'WATCH', 'IMPAIRED', 'EXIT_CANDIDATE'], holding.pending_review_thesis_health ?? 'WATCH'),
        createReviewSelect('Override action stance', 'action_stance', ['HOLD', 'ADD_ON_PULLBACK', 'REDUCE', 'EXIT_REVIEW_NEEDED', 'RESEARCH_MORE'], holding.pending_review_action_stance ?? 'RESEARCH_MORE'),
        createReviewTextarea('Override rationale (required)', 'rationale', holding.pending_review_rationale ?? ''),
        createReviewTextarea('Override evidence summary (required)', 'evidence_summary', 'User reviewed provider draft against the local ledger and available evidence.'),
        createReviewTextarea('Override uncertainty (required)', 'uncertainty', 'User override records uncertainty before the next scheduled review.'),
        createReviewInput('Override next review date (required)', 'next_review_at', normalizedPendingReviewDate),
        createElement('p', { style: { color: 'var(--owl-color-muted)', margin: 0, fontSize: 'var(--owl-text-sm)' } }, 'Date fields use YYYY-MM-DD format (ISO date without time).'),
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
        createElement('h4', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)' } }, 'Reject provider draft'),
        createElement('p', { className: 'owl-body', style: { margin: 0 } }, 'Leaves the current confirmed portfolio thesis unchanged and clears this pending draft.'),
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
    createElement('h3', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)' } }, 'Strategy-driven holding review'),
    createElement('p', { className: 'owl-body', style: { margin: 0 } }, 'Ask Owlfolio to draft a Buffett-Munger thesis-health review for this holding.'),
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
    createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.65rem 0 0' } }, 'Use these only when scheduled valuation or provider review automation cannot supply a sourced draft. Submitted values still create auditable ledger events.'),
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
    { style: { color: 'var(--owl-color-muted)', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
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
    { style: { color: 'var(--owl-color-muted)', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
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
    { style: { color: 'var(--owl-color-muted)', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
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
    { 'aria-label': 'Investable capital', className: 'owl-section-card owl-workflow-card', style: { gap: '0.85rem' } },
    createElement('p', { className: 'owl-section-accent' }, 'Sizing'),
    createElement('h2', { className: 'owl-section-title' }, 'Investable capital'),
    createElement(
      'p',
      { className: 'owl-body', style: { margin: 0 } },
      'Used to size positions; advisory only. You author the actual buys.',
    ),
    createElement(
      'p',
      { className: 'owl-body', style: { margin: 0 } },
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
        { style: { color: 'var(--owl-color-muted)', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
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
    createElement('h3', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)' } }, 'Manual valuation checkpoint'),
    createElement(
      'label',
      { style: { color: 'var(--owl-color-muted)', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
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
      { style: { color: 'var(--owl-color-muted)', display: 'grid', fontWeight: 700, gap: '0.35rem' } },
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
    { className: 'owl-body', style: { margin: '0.55rem 0 0' } },
    createElement('strong', { style: { color: 'var(--owl-color-text)', fontWeight: 700 } }, `${label}: `),
    value,
  )
}

function createShariahGateDetails(holding: AppHolding) {
  if (holding.shariah_gate_decision_id === undefined) {
    return []
  }

  return [
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
    createElement(
      'details',
      { style: { marginTop: '0.5rem' } },
      createElement('summary', { style: { color: 'var(--owl-color-gold-bright)', cursor: 'pointer', fontWeight: 700, fontSize: 'var(--owl-text-sm)' } }, 'Gate decision (audit)'),
      createDetail('Gate decision', holding.shariah_gate_decision_id),
    ),
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
