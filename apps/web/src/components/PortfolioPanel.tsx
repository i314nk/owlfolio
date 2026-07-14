import { createElement, Fragment, type ReactNode } from 'react'


import { OwlButtonLink, OwlValuationChip, RouteHeader, type OwlValuationKind } from './designSystem'
import { createPriceLadderElement } from './PriceLadder'
import { ReReviewButton } from './ReReviewButton'
import { RerunAnalysisButton } from './RerunAnalysisButton'
import type { AppHolding, MonitorAlert, WorkflowMode } from '../lib/workflow'
import { titleCaseEntityName } from '../lib/entityName'
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
  latestAnalysisThesis?: string
  /**
   * The harness-marshaled re-underwrite findings (business itemId -> finding), a PURE read of the HELD name's
   * research-case projection resolved by the loader. Passed to the review confirm/override forms so each
   * business item reads its read-only marshaled finding (audit-and-decide). Covers ALL 11 business items
   * (qualitative/absent fallbacks included); cognitive items are absent here.
   */
}

export type PortfolioPanelProps = {
  holdings: PortfolioHolding[]
  mode?: WorkflowMode
  /** Open agent observations + drafts per holding (tranche / concentration / Shariah grace / sell-review). */
  alerts?: MonitorAlert[]
}


const decisionPanelStyle = {
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: '0.85rem',
  display: 'grid',
  gap: '0.75rem',
  padding: '1rem',
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
      : holdings.map((holding) => createHoldingCard(holding, mode, alerts.filter((alert) => alertMatchesHolding(alert, holding))))),
  )
}

/**
 * Inline agent observations + human-decision drafts for one holding: tranche review (thesis-gated),
 * concentration trim-review (winners run; not an auto-trim), Shariah grace (days-left; not a ruling),
 * DIVEST-REQUIRED / SELL-REVIEW drafts (proposals, never executed), and the annual re-run flag. Each
 * carries the spec's caveat in its detail; nothing here advances state.
 */
/**
 * An alert belongs on a holding row when it names the holding — or, for case-scoped alerts with no
 * holding id (annual-filing / thesis-re-review observations), when it names the held ticker or the
 * holding's displayed/admitted case.
 */
function alertMatchesHolding(alert: MonitorAlert, holding: PortfolioHolding): boolean {
  if (alert.subject.holding_id !== undefined) return alert.subject.holding_id === holding.holding_id
  if (alert.subject.watchlist_item_id !== undefined) return false
  if (alert.subject.research_case_id !== undefined) {
    return alert.subject.research_case_id === holding.displayResearchCaseId || alert.subject.research_case_id === holding.research_case_id
  }
  return alert.subject.ticker !== undefined && alert.subject.ticker === holding.ticker
}

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
        // The annual-filing alert carries the ONE-CLICK full re-analysis (confirm-gated, never automatic).
        alert.kind === 'annual_rerun' && alert.subject.research_case_id !== undefined && alert.subject.ticker !== undefined
          ? createElement(RerunAnalysisButton, { caseId: alert.subject.research_case_id, ticker: alert.subject.ticker })
          : null,
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
  const needsAttention = alerts.some((alert) => alert.severity === 'urgent')
  const displayCaseId = holding.displayResearchCaseId ?? holding.research_case_id
  const tickerEl = displayCaseId !== undefined
    ? createElement('a', {
        href: `/research/${displayCaseId}`,
        className: 'owl-focusable',
        style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-md)', fontWeight: 800, letterSpacing: '0.02em', textDecoration: 'none', whiteSpace: 'nowrap' },
      }, ticker)
    : createElement('span', { style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-md)', fontWeight: 800, letterSpacing: '0.02em', whiteSpace: 'nowrap' } }, ticker)
  // "TICKER — Company Name · figures" (see WatchlistPanel): the NAME shrinks behind an ellipsis, never the figures.
  const figures = [
    `entry ${formatMoney(holding.cost_basis_per_share, holding.currency)}`,
    ...(holding.latest_price_per_share === undefined
      ? []
      : [`now ${formatMoney(holding.latest_price_per_share, holding.currency)}${priceMove !== undefined ? ` (${priceMove >= 0 ? '+' : ''}${priceMove.toFixed(1)}%)` : ''}`]),
  ].join(' · ')
  const summaryLine = createElement(
    'summary',
    { className: 'owl-collapsible-card-summary', style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
    tickerEl,
    holding.entityName !== undefined
      ? createElement('span', { key: 'name', style: { color: 'var(--owl-color-muted)', flex: '0 1 auto', fontSize: 'var(--owl-text-base)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `— ${titleCaseEntityName(holding.entityName)}`)
      : null,
    createElement('span', { key: 'figures', style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-sm)', whiteSpace: 'nowrap' } }, figures),
    createElement('span', { key: 'spacer', style: { flex: '1 0 0.5rem' } }),
    ...(chip === undefined ? [] : [createElement(OwlValuationChip, { kind: chip.kind, label: chip.label })]),
    // REVIEW RETIRED (owner, 2026-07-14): no review badge — the valuation chip + alerts carry the
    // signal. A legacy recorded thesis-health still shows (readable forever), just never "pending".
    ...(holding.thesis_health === undefined ? [] : [createElement(StatusBadge, { tone: 'success' }, holding.thesis_health)]),
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
      createElement('p', { style: { color: '#dbe3ef', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } }, clampThesis(holding.latestAnalysisThesis ?? holding.thesis_summary)),
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
      // The thesis anchor — the figures a sell advisory hangs on. REVIEW RETIRED (owner, 2026-07-14):
      // the drafted review + attestation ceremony are gone; the check-in (quarterly), the 10-K
      // full-re-run prompt (annual), and the zone board (price) carry the duty. Legacy review
      // events remain readable in the audit timeline.
      createElement(
        'div',
        { style: { display: 'grid', gap: '0.2rem' } },
        createDetail('Your entry price', formatMoney(holding.cost_basis_per_share, holding.currency)),
        createDetail('Opened', holding.opened_at),
      ),
      createHoldingAlerts(alerts),
      createCloseForm(holding),
    ),
  )
}

/**
 * Close the holding — the human-authored, irreversible exit (holding_closed). Collapsed behind its
 * own <details>: the position leaves the portfolio, its watchlist item returns to plain watching,
 * and the raw events (+ any post-mortem) remain the audit record. Machine actors cannot author this.
 */
function createCloseForm(holding: PortfolioHolding) {
  const inputStyle = { background: 'var(--owl-color-panel-elevated)', border: '1px solid rgba(148, 163, 184, 0.24)', borderRadius: '0.75rem', color: '#f7f8ff', padding: '0.55rem 0.7rem' }
  const labelStyle = { color: 'var(--owl-color-muted)', display: 'grid', fontSize: 'var(--owl-text-sm)', fontWeight: 700, gap: '0.25rem' }
  const REASONS: { value: string; label: string }[] = [
    { value: 'valuation_inverted', label: 'Valuation inverted (price far above value)' },
    { value: 'thesis_broken', label: 'Thesis broken' },
    { value: 'better_opportunity_under_constraint', label: 'Better opportunity (under the cash constraint)' },
    { value: 'original_mistake', label: 'Original mistake' },
    { value: 'minimum_hold_released', label: 'Minimum-hold guard released' },
    { value: 'unresolvable_shariah_breach', label: 'Unresolvable Shariah breach' },
  ]
  return createElement(
    'details',
    { style: { borderTop: '1px solid rgba(148, 163, 184, 0.16)', marginTop: '0.4rem', paddingTop: '0.6rem' } },
    createElement('summary', { style: { color: 'var(--owl-color-risk-bright, #fca5a5)', cursor: 'pointer', fontSize: 'var(--owl-text-sm)', fontWeight: 700 } }, 'Close holding (record the exit)'),
    createElement(
      'form',
      { action: `/api/portfolio/${holding.holding_id}/close`, method: 'post', className: 'owl-action-form', style: { display: 'grid', gap: '0.6rem', marginTop: '0.6rem' } },
      createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'Records the exit you already executed at your broker — Owlfolio never trades. The position leaves the portfolio; the name returns to the watchlist board.'),
      createElement(
        'label',
        { style: labelStyle },
        'Exit price per share',
        createElement('input', { type: 'number', name: 'exit_price_per_share', step: '0.01', min: '0', required: true, style: inputStyle }),
      ),
      createElement(
        'label',
        { style: labelStyle },
        'Closed date',
        createElement('input', { type: 'date', name: 'closed_at', style: inputStyle }),
      ),
      createElement(
        'label',
        { style: labelStyle },
        'Sell-discipline reason',
        createElement(
          'select',
          { name: 'reason_code', required: true, defaultValue: '', style: inputStyle },
          createElement('option', { value: '', disabled: true }, 'Pick the reason for the exit'),
          ...REASONS.map((reason) => createElement('option', { key: reason.value, value: reason.value }, reason.label)),
        ),
      ),
      createElement(
        'label',
        { style: labelStyle },
        'Note (optional)',
        createElement('input', { type: 'text', name: 'message', placeholder: 'Recorded in the ledger beside the exit', style: inputStyle }),
      ),
      createElement('button', { type: 'submit', className: 'owl-form-button', style: { background: '#b91c1c', border: 0, borderRadius: '0.75rem', color: '#ffffff', cursor: 'pointer', fontWeight: 800, justifySelf: 'start', padding: '0.6rem 0.9rem' } }, 'Record the exit'),
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
