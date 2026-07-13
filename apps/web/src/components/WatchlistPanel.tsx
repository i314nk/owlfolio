import { createElement, Fragment } from 'react'

import { OwlValuationChip, RouteHeader, SourceChip } from './designSystem'
import { ReReviewButton } from './ReReviewButton'
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
  const sectionsForBand = (band: ZoneBand) => {
    const bandItems = items.filter((item) => bandFor(item) === band).sort(zoneSort)
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
        ...bandItems.map((item) => createWatchlistCard(item, mode, alerts.filter((alert) => alert.subject.watchlist_item_id === item.watchlist_item_id), band)),
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

function createWatchlistCard(item: AppWatchlistItem, mode: WorkflowMode, alerts: MonitorAlert[], band: ZoneBand) {
  const ticker = item.ticker ?? item.company_id ?? item.watchlist_item_id
  const v = item.verdict as { buy_price_per_share?: number; proposed_buy_below?: number; market_price_per_share?: number; distance_to_buy_pct?: number; load_up_below?: number } | undefined
  const buyBelow = v?.proposed_buy_below ?? v?.buy_price_per_share
  const dist = v?.distance_to_buy_pct

  // COMPACT ROW (owner-locked 2026-07-14): the summary is the zone board line — ticker (a LINK to
  // the dossier), the two zone thresholds, the live price + distance, and the state badge. The full
  // checkpoint + actions expand beneath. Only the necessary info shows closed.
  const zoneChip = band === 'LOAD_UP'
    ? createElement('span', { key: 'zone', style: { color: '#4ade80', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', fontWeight: 800, letterSpacing: '0.05em' } }, 'LOAD-UP ZONE')
    : band === 'BUY_ZONE'
      ? createElement('span', { key: 'zone', style: { color: '#4ade80', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', fontWeight: 800, letterSpacing: '0.05em' } }, 'BUY ZONE')
      : dist !== undefined
        ? createElement('span', { key: 'zone', style: { color: 'var(--owl-color-muted)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-2xs)', letterSpacing: '0.05em' } }, `${dist.toFixed(0)}% ABOVE THE ZONE`)
        : null
  const summaryLine = createElement(
    'summary',
    { className: 'owl-collapsible-card-summary', style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.7rem' } },
    createElement('a', {
      href: `/research/${item.research_case_id}`,
      className: 'owl-focusable',
      style: { color: 'var(--owl-color-text)', fontSize: 'var(--owl-text-md)', fontWeight: 800, textDecoration: 'none' },
    }, ticker),
    buyBelow !== undefined ? createElement('span', { key: 'buy', style: { color: 'var(--owl-color-muted)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-xs)' } }, `buy ≤ $${buyBelow.toFixed(2)}`) : null,
    v?.load_up_below !== undefined ? createElement('span', { key: 'load', style: { color: 'var(--owl-color-quiet)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-xs)' } }, `load ≤ $${v.load_up_below.toFixed(2)}`) : null,
    v?.market_price_per_share !== undefined ? createElement('span', { key: 'px', style: { color: 'var(--owl-color-text)', fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-xs)' } }, `now $${v.market_price_per_share.toFixed(2)}`) : null,
    createElement('span', { key: 'spacer', style: { flex: 1 } }),
    zoneChip,
    ...(shariahChip(item) === undefined ? [] : [shariahChip(item)]),
    createElement(
      StatusBadge,
      { tone: item.holding_id !== undefined || item.user_approved ? 'success' : 'warning' },
      item.holding_id !== undefined ? 'Held' : item.user_approved ? 'Confirmed' : 'Legacy draft',
    ),
  )

  return createElement(
    'details',
    { key: item.watchlist_item_id, id: item.watchlist_item_id, className: 'owl-collapsible-card', 'data-watchlist-row': ticker },
    summaryLine,
    createElement(
      'div',
      { className: 'owl-workflow-card', style: { display: 'grid', gap: '0.6rem', marginTop: '0.5rem' } },
      // Thesis line: the opening of the case, not the whole narrative — the dossier owns the full text.
      createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, clampThesis(item.thesis_summary)),
      // Gate evidence (the provider's draft).
      createElement(
        'div',
        { style: { display: 'grid', gap: '0.2rem' } },
        createElement('p', { className: 'owl-section-accent' }, 'Case state'),
        createDetail('Strategy', item.strategy_id ?? 'Unknown'),
        createDetail('Buy-zone status', item.buy_zone_status ?? 'Not set'),
        ...createLockedBuyBelowDetail(item),
        ...createShariahGateDetails(item),
      ),
      // Verdict band: distance-to-buy-price + staleness indicator.
      createVerdictBandDetails(item),
      // Agent observations on this candidate (buy-window / staleness / Shariah re-screen).
      createWatchlistAlerts(alerts),
      // The decision checkpoint: provenance + the user's authorization actions.
      createDecisionCheckpoint(item, mode),
    ),
  )
}

/**
 * Model-verdict figures for one candidate (R1): the model's valuation status, the MODEL-proposed buy-below,
 * the distance from that buy-below (no live quote → said so honestly, never a fake "in the window"), the
 * arithmetic in-buy-zone read, the market-implied growth richness read, the flag-only sanity-check (advisory,
 * never a block), and a staleness indicator (>12mo since the case was last run → re-run before any tranche
 * alert, per position-sizing §5). The retired band/gap framing is gone.
 */
function createVerdictBandDetails(item: AppWatchlistItem) {
  const verdict = item.verdict
  if (verdict === undefined) {
    return null
  }

  const fmtPct = (frac: number) => `${(frac * 100).toFixed(1)}%`
  const buyBelow = verdict.proposed_buy_below ?? verdict.buy_price_per_share

  const lines = []
  if (verdict.valuation_status !== undefined) {
    lines.push(createDetail('Model valuation', verdict.valuation_status))
  }
  if (buyBelow !== undefined) {
    lines.push(createDetail('Buy below (computed, rule 7)', `$${buyBelow.toFixed(2)}`))
  }
  if (verdict.distance_to_buy_pct !== undefined) {
    const pct = verdict.distance_to_buy_pct
    lines.push(createDetail(
      'Distance to buy price',
      pct <= 0 ? `${Math.abs(pct).toFixed(1)}% below the computed buy threshold — in the buy zone` : `${pct.toFixed(1)}% above the computed buy threshold`,
    ))
  } else {
    lines.push(createDetail('Distance to buy price', 'No live market quote — distance not available'))
  }
  // RULE 8 (owner-locked 2026-07-13): the load-up zone read — the watchlist IS the zone board.
  const v8 = verdict as { load_up_below?: number; in_load_up_zone?: boolean }
  if (v8.load_up_below !== undefined) {
    lines.push(createDetail(
      'Load-up below (rule 8)',
      v8.in_load_up_zone === true
        ? `$${v8.load_up_below.toFixed(2)} — IN THE LOAD-UP ZONE: "once you find a margin of safety, load up the truck"`
        : `$${v8.load_up_below.toFixed(2)}`,
    ))
  }
  if (verdict.market_price_per_share !== undefined) {
    const priceStr = `$${verdict.market_price_per_share.toFixed(2)}`
    const asOf = verdict.price_as_of !== undefined ? ` · as of ${verdict.price_as_of.slice(0, 10)}` : ''
    const distPct = verdict.distance_to_buy_pct !== undefined
      ? ` · ${verdict.distance_to_buy_pct > 0 ? '+' : ''}${verdict.distance_to_buy_pct.toFixed(0)}% to buy`
      : ''
    lines.push(createDetail('Current price', `${priceStr}${asOf}${distPct}`))
  }
  if (verdict.in_buy_zone !== undefined) {
    lines.push(createDetail(
      'Buy-zone',
      verdict.in_buy_zone ? 'In the buy zone (price ≤ model buy-below)' : 'Not in the buy zone yet',
    ))
  }
  // The richness read — what today's price implies the business must grow (reverse-DCF), the model's input.
  if (verdict.market_implied_growth !== undefined) {
    lines.push(createDetail('Market-implied growth', fmtPct(verdict.market_implied_growth)))
  }
  // forward-DCF removal: the dollar reference fair value (cross-check) line is gone — a dollar reference FV
  // below the model's buy-below read as a contradiction. The reverse-DCF market-implied growth above is the
  // kept valuation lens.

  const staleness = verdict.is_stale === undefined
    ? 'Case freshness unknown'
    : verdict.is_stale
      ? `Stale (>12 months since last run${verdict.case_updated_at === undefined ? '' : `, last ${verdict.case_updated_at.slice(0, 10)}`}) — re-run before any tranche alert`
      : `Fresh${verdict.case_updated_at === undefined ? '' : ` (last run ${verdict.case_updated_at.slice(0, 10)})`}`

  const sanityFlags = verdict.sanity_flags ?? []

  return createElement(
    'div',
    { 'data-testid': 'watchlist-verdict-band', style: { display: 'grid', gap: '0.2rem', marginTop: 'var(--owl-space-2)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Model verdict'),
    ...lines,
    // The deterministic flag-only sanity-check — advisory amber annotations, never a block.
    sanityFlags.length > 0 ? createElement(
      'div',
      { style: { marginTop: 'var(--owl-space-2)' } },
      createElement('p', { className: 'owl-body', style: { margin: 0 } },
        createElement('strong', { style: { color: 'var(--owl-color-gold-bright)', fontWeight: 700 } }, `Sanity-check (${sanityFlags.length}): `),
        'advisory only — does not block the verdict.',
      ),
      createElement(
        'ul',
        { className: 'owl-body', style: { color: 'var(--owl-color-gold-bright)', display: 'grid', gap: '0.2rem', margin: '0.2rem 0 0', paddingLeft: '1.1rem' } },
        ...sanityFlags.map((flag, index) => createElement('li', { key: `wl-sanity-${index}` }, `⚠ ${flag}`)),
      ),
    ) : null,
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
      // On-demand thesis re-review vs filings NEW since this case's decision — an observation launch;
      // a recorded diff surfaces as a monitor alert + the dossier card, never a state change here.
      item.research_case_id === undefined ? null : createElement(ReReviewButton, { caseId: item.research_case_id }),
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

/** The board shows only the opening of the thesis; the linked dossier carries the full narrative. */
function clampThesis(thesis: string | undefined): string {
  if (thesis === undefined || thesis.length === 0) return 'No thesis recorded'
  if (thesis.length <= 280) return thesis
  return `${thesis.slice(0, 280).trimEnd()}… (full analysis in the dossier)`
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
 * The frozen model-proposed buy-below (cited reasoning) at admit. There is no deterministic haircut or
 * required-gap engine here: the buy-below is the price the MODEL's reasoning judged cheap enough, frozen at
 * admit. The valuation version it was frozen under is surfaced in the label so a re-anchor is traceable.
 * Renders nothing when no locked buy-below was recorded.
 */
function createLockedBuyBelowDetail(item: AppWatchlistItem) {
  if (item.locked_buy_below === undefined) {
    return []
  }

  // The buy-below is the frozen model-proposed buy-below at admit, carrying the valuation version it was
  // frozen under — not a deterministic price-discount knob.
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
