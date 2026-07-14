import { createElement, Fragment } from 'react'

import { OwlButtonLink, OwlValuationChip, RouteHeader } from './designSystem'
import { createPriceLadderElement } from './PriceLadder'
import { ReReviewButton } from './ReReviewButton'
import { RerunAnalysisButton } from './RerunAnalysisButton'
import { StatusBadge } from './StatusBadge'
import type { AppWatchlistItem, MonitorAlert, WorkflowMode } from '../lib/workflow'
import { titleCaseEntityName } from '../lib/entityName'

export type WatchlistPanelProps = {
  items: AppWatchlistItem[]
  mode?: WorkflowMode
  /** Open agent observations per watchlist item (buy-window, staleness re-run, Shariah re-screen). */
  alerts?: MonitorAlert[]
}

const WATCHLIST_ALERT_TONE: Record<MonitorAlert['severity'], 'danger' | 'warning' | 'neutral'> = {
  urgent: 'danger',
  attention: 'warning',
  info: 'neutral',
}

/**
 * The Watchlist desk — candidates the agent is tracking, awaiting the user's
 * decision to monitor or buy. The agent proposes; the user authorizes what
 * enters the portfolio. Each candidate leads with ticker + Shariah gate verdict
 * + thesis, then the user's confirm / open-holding actions.
 *
 * Returns a Fragment so each section is a direct child of the route frame and
 * inherits the app's staggered reveal.
 */
// ── ZONE BOARD (owner-locked 2026-07-14): the watchlist is organized by the book's zones — the
// deepest opportunity first. LOAD_UP (≥50% margin) → BUY_ZONE (≥30%) → ABOVE_ZONE (waiting, sorted
// nearest-first) → UNCLASSIFIED (no verdict yet). Rows are COMPACT: one line each; the ticker links
// to the dossier; the row expands for the full checkpoint + actions.
type ZoneBand = 'LOAD_UP' | 'BUY_ZONE' | 'ABOVE_ZONE' | 'UNCLASSIFIED'

const BAND_ORDER: ZoneBand[] = ['LOAD_UP', 'BUY_ZONE', 'ABOVE_ZONE', 'UNCLASSIFIED']

const BAND_META: Record<ZoneBand, { title: string; note: string }> = {
  LOAD_UP: {
    title: 'In the load-up zone (rule 8)',
    note: '"Once you find a margin of safety, load up the truck." A ≥50% margin on a gate-clean case. Observation only — you author every buy.',
  },
  BUY_ZONE: {
    title: 'In the buy zone (rule 7)',
    note: 'Price at or below the computed buy threshold (a ≥30% margin of safety). Observation only — you author every buy.',
  },
  ABOVE_ZONE: {
    title: 'Above the zone — waiting',
    note: 'Tracked while the price sits above the computed buy threshold; nearest to the zone first. Patience is the position.',
  },
  UNCLASSIFIED: {
    title: 'Tracked (no verdict yet)',
    note: 'No computed thresholds yet — run or re-run the case to place it on the board.',
  },
}

function bandFor(item: AppWatchlistItem): ZoneBand {
  const v = item.verdict
  if (v?.in_load_up_zone === true) return 'LOAD_UP'
  if (v?.in_buy_zone === true) return 'BUY_ZONE'
  // A verdict object exists IFF the case computed a buy threshold (enrichWatchlistItemsWithVerdict
  // guards on it) — so any verdict outside the zones is priced-and-waiting, whatever the legacy
  // `state` vocabulary says. UNCLASSIFIED is reserved for genuinely unpriced cases.
  if (v !== undefined) return 'ABOVE_ZONE'
  return 'UNCLASSIFIED'
}

/** Sort inside a band: nearest to the buy zone first (unknown distances last). */
function zoneSort(a: AppWatchlistItem, b: AppWatchlistItem): number {
  const da = a.verdict?.distance_to_buy_pct ?? Number.POSITIVE_INFINITY
  const db = b.verdict?.distance_to_buy_pct ?? Number.POSITIVE_INFINITY
  return da - db
}

export function WatchlistPanel({ items, mode = 'personal-local', alerts = [] }: WatchlistPanelProps) {
  // ONE HOME PER NAME (owner, 2026-07-14): a HELD name lives on the portfolio — it leaves the
  // watchlist board while its holding is open (the item itself survives in the ledger and returns
  // to plain watching when the holding closes).
  const watching = items.filter((item) => item.holding_id === undefined)
  const heldCount = items.length - watching.length
  const sectionsForBand = (band: ZoneBand) => {
    const bandItems = watching.filter((item) => bandFor(item) === band).sort(zoneSort)
    if (bandItems.length === 0) {
      return []
    }
    const meta = BAND_META[band]
    return [
      createElement(
        'section',
        { key: `band-${band}`, 'aria-label': `${meta.title} candidates`, 'data-verdict-band': band, className: 'owl-section-card', style: { gap: 'var(--owl-space-2)' } },
        createElement('p', { className: 'owl-section-accent' }, `${meta.title} · ${bandItems.length}`),
        createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, meta.note),
        ...bandItems.map((item) => createWatchlistCard(item, mode, alerts.filter((alert) => alertMatchesItem(alert, item)), band)),
      ),
    ]
  }

  return createElement(
    Fragment,
    null,
    createElement(RouteHeader, {
      kicker: 'Watchlist desk',
      title: 'Watchlist',
      description: 'Provider-proposed candidates — nothing enters your portfolio without your explicit confirmation.',
    }),
    createElement('hr', { className: 'owl-rule' }),
    createLedgerLine(watching, heldCount),
    ...(watching.length === 0
      ? [createEmptyState(heldCount)]
      : BAND_ORDER.flatMap((band) => sectionsForBand(band))),
  )
}

/**
 * An alert belongs on a row when it names the row's watchlist item — or, for case-scoped alerts
 * that carry no item id (annual-filing / thesis-re-review observations), when it names the row's
 * ticker or its displayed/admitted case.
 */
function alertMatchesItem(alert: MonitorAlert, item: AppWatchlistItem): boolean {
  if (alert.subject.watchlist_item_id !== undefined) return alert.subject.watchlist_item_id === item.watchlist_item_id
  if (alert.subject.holding_id !== undefined) return false
  if (alert.subject.research_case_id !== undefined) {
    return alert.subject.research_case_id === item.display_research_case_id || alert.subject.research_case_id === item.research_case_id
  }
  return alert.subject.ticker !== undefined && alert.subject.ticker === item.ticker
}

/**
 * Inline agent observations for one watchlist item — buy-window, re-run-needed staleness, Shariah
 * re-screen, annual-filing re-analysis prompts. Each is an observation, never a recommendation to
 * buy; opening a holding stays a user decision below. The annual-filing alert carries the ONE-CLICK
 * full re-analysis beside it (a confirm-gated user action — never automatic).
 */
function createWatchlistAlerts(alerts: MonitorAlert[]) {
  if (alerts.length === 0) {
    return null
  }

  return createElement(
    'div',
    { style: { display: 'grid', gap: 'var(--owl-space-2)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Agent observations — you decide'),
    ...alerts.map((alert) => createElement(
      'div',
      { key: alert.id, className: 'owl-row owl-row-top' },
      createElement(
        'div',
        { className: 'owl-row-main' },
        createElement(
          'div',
          { className: 'owl-activity-meta', style: { marginBottom: '0.2rem' } },
          createElement(StatusBadge, { tone: WATCHLIST_ALERT_TONE[alert.severity] }, alert.severity === 'urgent' ? 'Urgent' : alert.severity === 'attention' ? 'Attention' : 'Watch'),
          createElement(StatusBadge, { tone: 'neutral' }, 'Observation'),
        ),
        createElement('p', { className: 'owl-row-title' }, alert.headline),
        createElement('p', { className: 'owl-row-helper' }, alert.detail),
        alert.kind === 'annual_rerun' && alert.subject.research_case_id !== undefined && alert.subject.ticker !== undefined
          ? createElement(RerunAnalysisButton, { caseId: alert.subject.research_case_id, ticker: alert.subject.ticker })
          : null,
      ),
    )),
  )
}

// ── Vital signs ───────────────────────────────────────────────────────────────

function createLedgerLine(items: AppWatchlistItem[], heldCount: number) {
  const awaiting = items.filter((item) => !item.user_approved).length
  const confirmed = items.filter((item) => item.user_approved).length
  const gateClear = items.filter((item) => item.shariah_gate_allowed === true).length

  const stats: { figureClass: string; label: string; value: string }[] = [
    { figureClass: '', label: 'Candidates tracked', value: String(items.length) },
    {
      figureClass: awaiting > 0 ? 'owl-ledger-figure-risk' : 'owl-ledger-figure-emerald',
      label: 'Awaiting your decision',
      value: String(awaiting),
    },
    { figureClass: 'owl-ledger-figure-emerald', label: 'Confirmed by you', value: String(confirmed) },
    { figureClass: 'owl-ledger-figure-emerald', label: 'Shariah gate clear', value: String(gateClear) },
    // Held names live on the PORTFOLIO — one home per name.
    { figureClass: 'owl-ledger-figure-emerald', label: 'Held — see portfolio', value: String(heldCount) },
  ]

  return createElement(
    'section',
    { 'aria-label': 'Watchlist vital signs', className: 'owl-ledger-line' },
    ...stats.map((stat) => createElement(
      'article',
      { className: 'owl-ledger-stat', key: stat.label },
      createElement('p', { className: 'owl-ledger-label' }, stat.label),
      createElement('p', { className: `owl-ledger-figure ${stat.figureClass}`.trim() }, stat.value),
    )),
  )
}

function createEmptyState(heldCount = 0) {
  return createElement(
    'section',
    { 'aria-label': 'Empty watchlist', className: 'owl-section-card' },
    createElement('p', { className: 'owl-section-accent' }, 'Watchlist desk'),
    createElement('h2', { className: 'owl-section-title' }, 'No candidates tracked yet'),
    createElement(
      'p',
      { className: 'owl-body', style: { margin: 0 } },
      heldCount > 0
        ? `No names in the watching state — ${heldCount} held ${heldCount === 1 ? 'name lives' : 'names live'} on the portfolio.`
        : 'No watchlist items yet. Create a research case first.',
    ),
  )
}

// ── Candidate card ────────────────────────────────────────────────────────────

function createWatchlistCard(item: AppWatchlistItem, mode: WorkflowMode, alerts: MonitorAlert[], band: ZoneBand) {
  const ticker = item.ticker ?? item.company_id ?? item.watchlist_item_id
  const v = item.verdict
  const buyBelow = v?.proposed_buy_below ?? v?.buy_price_per_share
  const dist = v?.distance_to_buy_pct
  // The board displays (and links to) the LATEST non-superseded analysis for the ticker; the item's
  // own research_case_id stays as the frozen audit pointer.
  const displayCaseId = item.display_research_case_id ?? item.research_case_id

  // COMPACT ROW (owner-locked 2026-07-14): the summary is the zone board line — ticker + company name
  // (the ticker LINKS to the dossier), the buy threshold, the live price + distance, and the state
  // badge. Expanding shows the small decision card: verdict summary + the valuation ladder + the
  // "open the full analysis" action. Specifics live in the dossier, not here.
  const zoneChip = band === 'LOAD_UP'
    ? createElement('span', { key: 'zone', style: { color: '#4ade80', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', fontWeight: 800, letterSpacing: '0.05em' } }, 'LOAD-UP ZONE')
    : band === 'BUY_ZONE'
      ? createElement('span', { key: 'zone', style: { color: '#4ade80', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', fontWeight: 800, letterSpacing: '0.05em' } }, 'BUY ZONE')
      : dist !== undefined
        ? createElement('span', { key: 'zone', style: { color: 'var(--owl-color-muted)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', letterSpacing: '0.05em' } }, `${dist.toFixed(0)}% ABOVE THE ZONE`)
        : null
  // "TICKER — Company Name · figures": one identity run that shrinks (the NAME shrinks behind an
  // ellipsis, never the figures), so the line always fits the row box.
  const figures = [
    ...(buyBelow === undefined ? [] : [`buy ≤ $${buyBelow.toFixed(2)}`]),
    ...(v?.market_price_per_share === undefined ? [] : [`now $${v.market_price_per_share.toFixed(2)}`]),
  ].join(' · ')
  const summaryLine = createElement(
    'summary',
    { className: 'owl-collapsible-card-summary', style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
    createElement('a', {
      href: `/research/${displayCaseId}`,
      className: 'owl-focusable',
      style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-md)', fontWeight: 800, letterSpacing: '0.02em', textDecoration: 'none', whiteSpace: 'nowrap' },
    }, ticker),
    v?.entity_name !== undefined
      ? createElement('span', { key: 'name', style: { color: 'var(--owl-color-muted)', flex: '0 1 auto', fontSize: 'var(--owl-text-base)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `— ${titleCaseEntityName(v.entity_name)}`)
      : null,
    figures.length > 0
      ? createElement('span', { key: 'figures', style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-sm)', whiteSpace: 'nowrap' } }, figures)
      : null,
    createElement('span', { key: 'spacer', style: { flex: '1 0 0.5rem' } }),
    zoneChip,
    ...(shariahChip(item) === undefined ? [] : [shariahChip(item)]),
    createElement(
      StatusBadge,
      { tone: item.user_approved ? 'success' : 'warning' },
      item.user_approved ? 'Confirmed' : 'Legacy draft',
    ),
  )

  // The expanded body — the SMALL decision card, mirroring the dossier's decision card: the verdict
  // summary + the price ladder, then the route to the full analysis. Provenance, gate evidence, and
  // audit IDs live in the dossier.
  const openHoldingForm = mode === 'personal-local' && item.user_approved && item.holding_id === undefined ? createOpenHoldingForm(item) : null
  return createElement(
    'details',
    { key: item.watchlist_item_id, id: item.watchlist_item_id, className: 'owl-collapsible-card', 'data-watchlist-row': ticker, suppressHydrationWarning: true },
    summaryLine,
    createElement(
      'div',
      { className: 'owl-workflow-card', style: { display: 'grid', gap: '0.75rem', marginTop: '0.5rem' } },
      createElement('p', { style: { color: '#dbe3ef', fontSize: 'var(--owl-text-base)', lineHeight: 1.55, margin: 0 } }, clampThesis(item.latest_analysis_thesis ?? item.thesis_summary)),
      createPriceLadderElement({
        ...(v?.intrinsic_value_per_share === undefined ? {} : { iv: v.intrinsic_value_per_share }),
        ...(v?.load_up_below === undefined ? {} : { load: v.load_up_below }),
        ...(buyBelow === undefined ? {} : { buy: buyBelow }),
        ...(v?.market_price_per_share === undefined ? {} : { livePrice: v.market_price_per_share }),
      }),
      // Provenance: WHICH analysis these figures come from — and, when the latest run produced no
      // thresholds, say so instead of silently keeping old numbers.
      v === undefined && item.latest_analysis_verdict !== undefined
        ? createElement('p', { style: { color: 'var(--owl-color-gold-bright)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', margin: 0 } }, `LATEST ANALYSIS: ${item.latest_analysis_verdict} — no buy thresholds produced. Open the full analysis for the reason.`)
        : null,
      item.latest_analysis_at !== undefined
        ? createElement('p', { style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', margin: 0 } }, `From the analysis of ${item.latest_analysis_at.slice(0, 10)}`)
        : null,
      // Staleness is decision-relevant on a waiting board — surface it only when it bites.
      v?.is_stale === true
        ? createElement('p', { style: { color: 'var(--owl-color-risk-bright, #fca5a5)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', margin: 0 } }, 'STALE — last run >12 months ago; re-run before acting on these thresholds.')
        : null,
      createElement(
        'div',
        { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'var(--owl-space-2)' } },
        createElement(OwlButtonLink, { href: `/research/${displayCaseId}`, variant: 'primary' }, 'Open the full analysis'),
        createElement(ReReviewButton, { caseId: displayCaseId }),
      ),
      // Agent observations on this candidate (buy-window / staleness / Shariah re-screen).
      createWatchlistAlerts(alerts),
      openHoldingForm,
      createRemoveForm(item),
    ),
  )
}

/**
 * Remove from the watchlist — the human-authored prune (watchlist_item_pruned). Collapsed behind
 * its own <details> so the destructive action never sits one accidental click away.
 */
function createRemoveForm(item: AppWatchlistItem) {
  return createElement(
    'details',
    { style: { borderTop: '1px solid rgba(148, 163, 184, 0.16)', marginTop: '0.4rem', paddingTop: '0.6rem' } },
    createElement('summary', { style: { color: 'var(--owl-color-risk-bright, #fca5a5)', cursor: 'pointer', fontSize: 'var(--owl-text-sm)', fontWeight: 700 } }, 'Remove from watchlist'),
    createElement(
      'form',
      { action: `/api/watchlist/${item.watchlist_item_id}/remove`, method: 'post', className: 'owl-action-form', style: { display: 'grid', gap: '0.6rem', marginTop: '0.6rem' } },
      createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, 'Stops tracking this name (the research case and the audit trail stay). Re-admit it from the dossier any time.'),
      createElement(
        'label',
        { style: { color: 'var(--owl-color-muted)', display: 'grid', fontSize: 'var(--owl-text-sm)', fontWeight: 700, gap: '0.25rem' } },
        'Reason',
        createElement('input', {
          type: 'text',
          name: 'reason',
          defaultValue: '',
          placeholder: 'Why this name leaves the board (recorded in the ledger)',
          style: { background: 'var(--owl-color-panel-elevated)', border: '1px solid rgba(148, 163, 184, 0.24)', borderRadius: '0.75rem', color: '#f7f8ff', padding: '0.55rem 0.7rem' },
        }),
      ),
      createElement('button', { type: 'submit', className: 'owl-form-button', style: { background: '#b91c1c', border: 0, borderRadius: '0.75rem', color: '#ffffff', cursor: 'pointer', fontWeight: 800, justifySelf: 'start', padding: '0.6rem 0.9rem' } }, 'Remove from watchlist'),
    ),
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

function createOpenHoldingForm(item: AppWatchlistItem) {
  return createElement(
    'form',
    {
      action: `/api/watchlist/${item.watchlist_item_id}/open-holding`,
      method: 'post',
      className: 'owl-action-form',
      style: { display: 'grid', gap: '0.75rem' },
    },
    createElement('h3', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-base)' } }, 'Open holding from confirmed watchlist state'),
    // SCALE-DOWN S5: share counts are retired (the money layer) — the entry PRICE is the anchor.
    createLotInput('Cost basis per share', 'cost_basis_per_share', 'number', '0', { step: '0.01', min: '0' }),
    createLotInput('Currency', 'currency', 'text', 'USD', { maxLength: 3 }),
    createLotInput('Opened date', 'opened_at', 'date', '', {}),
    createElement(
      'button',
      {
        type: 'submit',
        className: 'owl-form-button owl-form-button-primary',
        style: { justifySelf: 'start' },
      },
      'Record initial holding',
    ),
  )
}


/** The board shows only the opening of the thesis; the linked dossier carries the full narrative. */
function clampThesis(thesis: string | undefined): string {
  if (thesis === undefined || thesis.length === 0) return 'No thesis recorded'
  if (thesis.length <= 280) return thesis
  return `${thesis.slice(0, 280).trimEnd()}… (full analysis in the dossier)`
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
    { style: { color: 'var(--owl-color-muted)', display: 'grid', fontSize: 'var(--owl-text-base)', fontWeight: 700, gap: '0.25rem' } },
    label,
    createElement('input', {
      ...extraProps,
      defaultValue,
      name,
      required: true,
      type,
      style: {
        background: 'var(--owl-color-panel-elevated)',
        border: '1px solid rgba(148, 163, 184, 0.24)',
        borderRadius: '0.75rem',
        color: '#f7f8ff',
        padding: '0.55rem 0.7rem',
      },
    }),
  )
}
