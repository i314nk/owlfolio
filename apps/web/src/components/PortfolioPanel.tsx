import { createElement, Fragment, type ReactNode } from 'react'


import { OwlButtonLink, OwlValuationChip, RouteHeader, type OwlValuationKind } from './designSystem'
import { HoldingReviewChecklistConfirm } from './HoldingReviewChecklistConfirm'
import { createPriceLadderElement } from './PriceLadder'
import { ReReviewButton } from './ReReviewButton'
import { HoldingReviewOverrideForm } from './HoldingReviewOverrideForm'
import type { AppHolding, MonitorAlert, WorkflowMode } from '../lib/workflow'
import { StatusBadge } from './StatusBadge'

const HOLDING_ALERT_TONE: Record<MonitorAlert['severity'], 'danger' | 'warning' | 'neutral'> = {
  urgent: 'danger',
  attention: 'warning',
  info: 'neutral',
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
  /** DCF intrinsic value per share from the linked case — the ladder's top anchor. */
  intrinsicValuePerShare?: number
  /** The rule-8 load-up threshold from the linked case. */
  loadUpBelow?: number
  /** The registrant's name from the linked case (EDGAR companyfacts); absent on legacy cases. */
  entityName?: string
  /** The latest non-superseded case for the ticker — the display/link target (audit pointer stays). */
  displayResearchCaseId?: string
  latestAnalysisVerdict?: string
  latestAnalysisAt?: string
  /**
   * The harness-marshaled re-underwrite findings (business itemId -> finding), a PURE read of the HELD name's
   * research-case projection resolved by the loader. Passed to the review confirm/override forms so each
   * business item reads its read-only marshaled finding (audit-and-decide). Covers ALL 11 business items
   * (qualitative/absent fallbacks included); cognitive items are absent here.
   */
  reviewBusinessFindings?: Record<string, string>
}

export type PortfolioPanelProps = {
  holdings: PortfolioHolding[]
  mode?: WorkflowMode
  /** Open agent observations + drafts per holding (tranche / concentration / Shariah grace / sell-review). */
  alerts?: MonitorAlert[]
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
// SCALE-DOWN S5 (owner-locked 2026-07-13): the portfolio is the THESIS VIEW — held names as theses
// (ticker, YOUR entry price as the anchor, the dossier link, check-ins, sell advisories). The money
// layer (cost basis, values, weights, returns, capital, manual valuations) is removed; the entry
// price survives as the one manual field so sell advisories and pullback reviews have their anchor.
export function PortfolioPanel({ holdings, mode = 'personal-local', alerts = [] }: PortfolioPanelProps) {
  return createElement(
    Fragment,
    null,
    createElement(RouteHeader, {
      kicker: 'Held theses',
      title: 'Portfolio',
      description: `${holdings.length} held ${holdings.length === 1 ? 'thesis' : 'theses'} — tracked against new filings (check-ins) and the computed zones. Owlfolio records your entry price as the anchor; it keeps no books.`,
    }),
    createElement('hr', { className: 'owl-rule' }),
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

  // COMPACT ROW (owner-locked 2026-07-14): the summary is one line — ticker (a LINK to the dossier
  // when the case id survives), entry vs latest price, the valuation chip, and the review badge.
  // Everything else (review state, forms, Shariah, alerts) expands beneath. A pending review or an
  // urgent alert opens the row by default so an action waiting on the user is never hidden.
  const priceMove = holding.latest_price_per_share !== undefined && holding.cost_basis_per_share > 0
    ? ((holding.latest_price_per_share - holding.cost_basis_per_share) / holding.cost_basis_per_share) * 100
    : undefined
  const needsAttention = holding.pending_review_id !== undefined || alerts.some((alert) => alert.severity === 'urgent')
  const displayCaseId = holding.displayResearchCaseId ?? holding.research_case_id
  const tickerEl = displayCaseId !== undefined
    ? createElement('a', {
        href: `/research/${displayCaseId}`,
        className: 'owl-focusable',
        style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-md)', fontWeight: 800, textDecoration: 'none' },
      }, ticker)
    : createElement('span', { style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-md)', fontWeight: 800 } }, ticker)
  const summaryLine = createElement(
    'summary',
    { className: 'owl-collapsible-card-summary', style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.7rem' } },
    tickerEl,
    holding.entityName !== undefined ? createElement('span', { key: 'name', style: { color: 'var(--owl-color-muted)', fontSize: 'var(--owl-text-sm)' } }, holding.entityName) : null,
    createElement('span', { key: 'entry', style: { color: 'var(--owl-color-muted)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-xs)' } }, `entry ${formatMoney(holding.cost_basis_per_share, holding.currency)}`),
    holding.latest_price_per_share !== undefined
      ? createElement('span', { key: 'px', style: { color: 'var(--owl-color-text)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-xs)' } }, `now ${formatMoney(holding.latest_price_per_share, holding.currency)}${priceMove !== undefined ? ` (${priceMove >= 0 ? '+' : ''}${priceMove.toFixed(1)}%)` : ''}`)
      : null,
    createElement('span', { key: 'spacer', style: { flex: 1 } }),
    ...(chip === undefined ? [] : [createElement(OwlValuationChip, { kind: chip.kind, label: chip.label })]),
    createElement(StatusBadge, { tone: holding.pending_review_id !== undefined ? 'warning' : holding.thesis_health === undefined ? 'neutral' : 'success' }, holding.pending_review_id !== undefined ? 'Review drafted' : holding.thesis_health ?? 'Review pending'),
  )

  return createElement(
    'details',
    { key: holding.holding_id, id: holding.holding_id, className: 'owl-collapsible-card', 'data-holding-row': ticker, suppressHydrationWarning: true, ...(needsAttention ? { open: true } : {}) },
    summaryLine,
    createElement(
      'div',
      { className: 'owl-workflow-card', style: { display: 'grid', gap: '0.75rem', marginTop: '0.5rem' } },
      // The SMALL decision card, mirroring the dossier's decision card: the thesis summary + the
      // price ladder against the frozen zones, then the route to the full analysis. Provenance,
      // gate evidence, and audit IDs live in the dossier.
      createElement('p', { style: { color: '#dbe3ef', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } }, clampThesis(holding.thesis_summary)),
      createPriceLadderElement({
        ...(holding.intrinsicValuePerShare === undefined ? {} : { iv: holding.intrinsicValuePerShare }),
        ...(holding.loadUpBelow === undefined ? {} : { load: holding.loadUpBelow }),
        ...(holding.buyBelowPricePerShare === undefined ? {} : { buy: holding.buyBelowPricePerShare }),
        ...(holding.latest_price_per_share === undefined ? {} : { livePrice: holding.latest_price_per_share }),
      }),
      ...(chip === undefined
        ? []
        : [createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, chip.reference)]),
      // The latest analysis's verdict — decision-relevant on a HELD name (a fresh PASS is a signal).
      ...(holding.latestAnalysisVerdict !== undefined && holding.buyBelowPricePerShare === undefined
        ? [createElement('p', { style: { color: 'var(--owl-color-gold-bright)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', margin: 0 } }, `LATEST ANALYSIS: ${holding.latestAnalysisVerdict} — no buy thresholds produced. Open the full analysis for the reason.`)]
        : []),
      ...(holding.latestAnalysisAt !== undefined
        ? [createElement('p', { style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', margin: 0 } }, `From the analysis of ${holding.latestAnalysisAt.slice(0, 10)}`)]
        : []),
      ...(displayCaseId === undefined
        ? []
        : [createElement(
            'div',
            { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
            createElement(OwlButtonLink, { href: `/research/${displayCaseId}`, variant: 'primary' }, 'Open the full analysis'),
            createElement(ReReviewButton, { caseId: displayCaseId }),
          )]),
      // The thesis anchor + the user's own review record — the figures a sell advisory hangs on.
      createElement(
        'div',
        { style: { display: 'grid', gap: '0.2rem' } },
        createDetail('Your entry price', formatMoney(holding.cost_basis_per_share, holding.currency)),
        createDetail('Opened', holding.opened_at),
        ...(holding.thesis_health === undefined ? [] : [createDetail('Thesis health', holding.thesis_health)]),
        ...(holding.action_stance === undefined ? [] : [createDetail('Action stance', holding.action_stance)]),
        ...(holding.next_review_at === undefined ? [] : [createDetail('Next review', holding.next_review_at)]),
        ...(holding.latest_review_rationale === undefined ? [] : [createDetail('Review rationale', holding.latest_review_rationale)]),
      ),
      createHoldingAlerts(alerts),
      ...(mode === 'personal-local'
        ? [
            ...(holding.pending_review_id === undefined ? [] : [createReviewForm(holding)]),
            createManualFallbackActions(holding),
          ]
        : []),
    ),
  )
}





function createReviewForm(holding: PortfolioHolding) {
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
        businessFindings: holding.reviewBusinessFindings ?? {},
      }),
      createElement(HoldingReviewOverrideForm, {
        holdingId: holding.holding_id,
        reviewId: holding.pending_review_id,
        defaultThesisHealth: holding.pending_review_thesis_health ?? 'WATCH',
        defaultActionStance: holding.pending_review_action_stance ?? 'RESEARCH_MORE',
        defaultNextReviewAt: normalizedPendingReviewDate,
        businessFindings: holding.reviewBusinessFindings ?? {},
      }),
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

function createManualFallbackActions(holding: PortfolioHolding) {
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
    createElement('p', { style: { color: 'var(--owl-color-muted)', margin: '0.65rem 0 0' } }, 'Use these only when the provider review automation cannot supply a sourced draft. Submitted reviews still create auditable ledger events.'),
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



function createDetail(label: string, value: string) {
  return createElement(
    'p',
    { className: 'owl-body', style: { margin: '0.55rem 0 0' } },
    createElement('strong', { style: { color: 'var(--owl-color-text)', fontWeight: 700 } }, `${label}: `),
    value,
  )
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

/** The board shows only the opening of the thesis; the linked dossier carries the full narrative. */
function clampThesis(thesis: string | undefined): string {
  if (thesis === undefined || thesis.length === 0) return 'No thesis recorded'
  if (thesis.length <= 280) return thesis
  return `${thesis.slice(0, 280).trimEnd()}… (full analysis in the dossier)`
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    currency,
    style: 'currency',
  }).format(value)
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
