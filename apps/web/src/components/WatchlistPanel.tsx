import { createElement, Fragment } from 'react'

import { OwlValuationChip, RouteHeader, SourceChip } from './designSystem'
import { StatusBadge } from './StatusBadge'
import type { AppWatchlistItem, MonitorAlert, WorkflowMode } from '../lib/workflow'

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
// ── Verdict-band sections (valuation-recalibration §2): BUY-WINDOW / WATCH-FAIR / WATCH ──
type VerdictBand = 'BUY-WINDOW' | 'WATCH-FAIR' | 'WATCH' | 'UNCLASSIFIED'

const BAND_ORDER: VerdictBand[] = ['BUY-WINDOW', 'WATCH-FAIR', 'WATCH', 'UNCLASSIFIED']

const BAND_META: Record<VerdictBand, { title: string; note: string }> = {
  'BUY-WINDOW': {
    title: 'Buy-window',
    note: 'Price is at or below the case buy price on a gate-clean case. Observation only — you author every buy.',
  },
  'WATCH-FAIR': {
    title: 'Watch-fair',
    note: 'Wonderful at fair — quality at fair value, the human-discretion zone. Never a harness buy signal.',
  },
  WATCH: {
    title: 'Watch',
    note: 'Tracked above fair value; waiting for a margin of safety to open.',
  },
  UNCLASSIFIED: {
    title: 'Tracked (no verdict band yet)',
    note: 'No valuation/verdict band computed yet — run or re-run the case to classify it.',
  },
}

function bandFor(item: AppWatchlistItem): VerdictBand {
  const state = item.verdict?.state
  if (state === 'BUY-WINDOW' || state === 'WATCH-FAIR' || state === 'WATCH') {
    return state
  }
  return 'UNCLASSIFIED'
}

export function WatchlistPanel({ items, mode = 'demo', alerts = [] }: WatchlistPanelProps) {
  const sectionsForBand = (band: VerdictBand) => {
    const bandItems = items.filter((item) => bandFor(item) === band)
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
      ),
      ...bandItems.map((item) => createWatchlistCard(item, mode, alerts.filter((alert) => alert.subject.watchlist_item_id === item.watchlist_item_id))),
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
    createLedgerLine(items),
    ...(items.length === 0
      ? [createEmptyState()]
      : BAND_ORDER.flatMap((band) => sectionsForBand(band))),
  )
}

/**
 * Inline agent observations for one watchlist item — buy-window, re-run-needed staleness, Shariah
 * re-screen. Each is an observation, never a recommendation to buy; opening a holding stays a user
 * decision below.
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
      ),
    )),
  )
}

// ── Vital signs ───────────────────────────────────────────────────────────────

function createLedgerLine(items: AppWatchlistItem[]) {
  const awaiting = items.filter((item) => !item.user_approved && item.holding_id === undefined).length
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

function createEmptyState() {
  return createElement(
    'section',
    { 'aria-label': 'Empty watchlist', className: 'owl-section-card' },
    createElement('p', { className: 'owl-section-accent' }, 'Watchlist desk'),
    createElement('h2', { className: 'owl-section-title' }, 'No candidates tracked yet'),
    createElement(
      'p',
      { className: 'owl-body', style: { margin: 0 } },
      'No watchlist items yet. Create a research case first.',
    ),
  )
}

// ── Candidate card ────────────────────────────────────────────────────────────

function createWatchlistCard(item: AppWatchlistItem, mode: WorkflowMode, alerts: MonitorAlert[]) {
  const ticker = item.ticker ?? item.company_id ?? item.watchlist_item_id

  return createElement(
    'section',
    { key: item.watchlist_item_id, id: item.watchlist_item_id, className: 'owl-section-card owl-workflow-card' },
    // Heading row: ticker + gate chip + status badge.
    createElement(
      'div',
      { className: 'owl-row owl-row-top' },
      createElement(
        'div',
        { className: 'owl-row-main' },
        createElement('p', { className: 'owl-section-accent' }, 'Watchlist candidate'),
        createElement('h2', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-lg)' } }, ticker),
        createElement('p', { className: 'owl-row-helper' }, item.thesis_summary ?? 'No thesis recorded'),
      ),
      createElement(
        'div',
        { className: 'owl-row-aside' },
        ...(shariahChip(item) === undefined ? [] : [shariahChip(item)]),
        createElement(
          StatusBadge,
          { tone: item.holding_id !== undefined || item.user_approved ? 'success' : 'warning' },
          item.holding_id !== undefined
            ? 'Holding recorded'
            : item.user_approved
              ? 'User confirmed'
              // Phase 8 S4: admission is a single gated step, so new items land confirmed. A bare
              // unconfirmed item is now only a legacy ledger artifact (no confirm action remains).
              : 'Legacy unconfirmed draft',
        ),
      ),
    ),
    // Thesis & gate evidence (the provider's draft).
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.2rem' } },
      createElement('p', { className: 'owl-section-accent' }, 'Provider draft state'),
      createDetail('Strategy', item.strategy_id ?? 'Unknown'),
      createDetail('Thesis summary', item.thesis_summary ?? 'No thesis recorded'),
      createDetail('Buy-zone status', item.buy_zone_status ?? 'Not set'),
      ...createLockedBuyBelowDetail(item),
      ...createShariahGateDetails(item),
    ),
    // Verdict band: distance-to-buy-price + staleness indicator (position-sizing §5).
    createVerdictBandDetails(item),
    // Agent observations on this candidate (buy-window / staleness / Shariah re-screen).
    createWatchlistAlerts(alerts),
    // The decision checkpoint: provenance + the user's authorization actions.
    createDecisionCheckpoint(item, mode),
  )
}

/**
 * Verdict-band figures for one candidate: buy price, the distance from the case buy price (no live quote
 * → said so honestly, never a fake "in the window"), and a staleness indicator (>12mo since the case
 * was last run → must re-run before any tranche alert, per position-sizing §5).
 */
function createVerdictBandDetails(item: AppWatchlistItem) {
  const verdict = item.verdict
  if (verdict === undefined) {
    return null
  }

  const lines = []
  if (verdict.buy_price_per_share !== undefined) {
    lines.push(createDetail('Case buy price', `$${verdict.buy_price_per_share.toFixed(2)}`))
  }
  if (verdict.distance_to_buy_pct !== undefined) {
    const pct = verdict.distance_to_buy_pct
    lines.push(createDetail(
      'Distance to buy price',
      pct <= 0 ? `${Math.abs(pct).toFixed(1)}% below buy price — in the buy window` : `${pct.toFixed(1)}% above buy price`,
    ))
  } else {
    lines.push(createDetail('Distance to buy price', 'No live market quote — distance not available'))
  }
  if (verdict.discount_to_fv_pct !== undefined) {
    lines.push(createDetail('Discount to fair value', `${verdict.discount_to_fv_pct.toFixed(1)}%`))
  }

  const staleness = verdict.is_stale === undefined
    ? 'Case freshness unknown'
    : verdict.is_stale
      ? `Stale (>12 months since last run${verdict.case_updated_at === undefined ? '' : `, last ${verdict.case_updated_at.slice(0, 10)}`}) — re-run before any tranche alert`
      : `Fresh${verdict.case_updated_at === undefined ? '' : ` (last run ${verdict.case_updated_at.slice(0, 10)})`}`

  return createElement(
    'div',
    { 'data-testid': 'watchlist-verdict-band', style: { display: 'grid', gap: '0.2rem', marginTop: 'var(--owl-space-2)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Verdict band'),
    ...lines,
    createElement(
      'p',
      { className: 'owl-body', style: { margin: '0.55rem 0 0' } },
      createElement('strong', { style: { color: 'var(--owl-color-text)', fontWeight: 700 } }, 'Staleness: '),
      createElement(
        'span',
        { style: { color: verdict.is_stale ? 'var(--owl-color-risk-bright, #fca5a5)' : 'var(--owl-color-muted)' } },
        staleness,
      ),
    ),
  )
}

function createDecisionCheckpoint(item: AppWatchlistItem, mode: WorkflowMode) {
  // Phase 8 S4: admission is one gated step (signed thesis + checklist + Shariah gate), so an admitted
  // item is already user-confirmed — there is no separate "confirm watchlist draft" affordance anymore.
  const openHoldingForm = mode === 'personal-local' && item.user_approved && item.holding_id === undefined ? createOpenHoldingForm(item) : null

  return createElement(
    'div',
    {
      style: {
        borderTop: '1px solid rgba(214, 178, 94, 0.18)',
        display: 'grid',
        gap: 'var(--owl-space-3)',
        marginTop: 'var(--owl-space-2)',
        paddingTop: 'var(--owl-space-4)',
      },
    },
    createElement('p', { className: 'owl-section-accent' }, 'User decision checkpoint'),
    createElement(
      'div',
      { style: { display: 'grid', gap: '0.2rem' } },
      createDetail('Created by actor', formatActor(item.created_by_actor_type, item.created_by_actor_id, 'created')),
      createDetail('Last updated', item.updated_at),
      createDetail('Confirmation status', item.user_approved ? 'User-confirmed watchlist decision' : 'Awaiting user confirmation'),
      createDetail('Confirmed by actor', item.user_approved ? formatActor(item.confirmed_by_actor_type, item.confirmed_by_actor_id, 'confirmed', item.updated_at) : 'Not user-confirmed yet'),
      item.holding_id === undefined ? createDetail('Position status', 'Not opened yet') : createDetail('Position status', 'Holding open'),
      createResearchCaseLink(item.research_case_id),
    ),
    openHoldingForm,
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
    createLotInput('Shares', 'shares', 'number', '1', { step: '0.0001', min: '0.0001' }),
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

function createResearchCaseLink(researchCaseId: string) {
  const href = `/research/${researchCaseId}`

  return createElement(
    'p',
    { className: 'owl-body', style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.55rem', margin: '0.55rem 0 0' } },
    createElement('strong', { style: { color: 'var(--owl-color-text)', fontWeight: 700 } }, 'Research case link:'),
    createElement('a', { className: 'owl-focusable', href, style: { color: 'var(--owl-color-gold-bright)', fontWeight: 800, textDecoration: 'none' } }, 'View research dossier'),
    createElement(SourceChip, { href, id: researchCaseId, label: 'Research case' }),
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

/**
 * The buy-below frozen at admit, LABELLED as provisional-MoS-derived (Task 4.3). The margin of safety
 * behind it is still PROVISIONAL (#124): a future MoS freeze will visibly, logged-ly re-price this — it
 * is NOT a settled number. The valuation version it was frozen under is surfaced in the label so the
 * re-price is traceable. Renders nothing when no locked buy-below was recorded.
 */
function createLockedBuyBelowDetail(item: AppWatchlistItem) {
  if (item.locked_buy_below === undefined) {
    return []
  }

  // The provisional-MoS flag is retired (conservatism now lives in the required_growth_gap); the buy-below
  // is the frozen price at the buy-threshold growth, no longer an MoS-discounted haircut.
  const version = item.buy_below_valuation_version === undefined ? '' : ` · ${item.buy_below_valuation_version}`
  return [createDetail(`Buy-below${version}`, `$${item.locked_buy_below.toFixed(2)}`)]
}

function createShariahGateDetails(item: AppWatchlistItem) {
  if (item.shariah_gate_decision_id === undefined) {
    return []
  }

  return [
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
    createElement(
      'details',
      { key: 'gate-audit-trail', style: { marginTop: '0.55rem' } },
      createElement(
        'summary',
        { style: { color: 'var(--owl-color-quiet)', cursor: 'pointer', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-sm)', fontWeight: 700 } },
        'Audit IDs',
      ),
      createElement(
        'p',
        { style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-xs)', margin: '0.35rem 0 0' } },
        `Gate decision: ${item.shariah_gate_decision_id}`,
      ),
    ),
  ]
}

function formatActor(actorType: string | undefined, actorId: string | undefined, role: 'created' | 'confirmed' = 'created', updatedAt?: string): string {
  if (actorType === undefined || actorId === undefined) {
    return 'Not recorded'
  }

  if (actorType === 'provider') {
    return 'Proposed by the research harness'
  }
  if (role === 'confirmed' && (actorType === 'user' || actorId === 'user_local' || actorId === 'local')) {
    if (updatedAt !== undefined) {
      const dateLabel = new Date(updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      return `You confirmed on ${dateLabel}`
    }
    return 'You confirmed'
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
