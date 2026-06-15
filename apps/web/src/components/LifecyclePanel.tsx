import { createElement, Fragment, type ReactNode } from 'react'

import type {
  NameLifecycleExitProvenance,
  NameLifecycleProjection,
  NameLifecycleState,
} from '@owlfolio/ledger/projections/nameLifecycleProjection'

import { RouteHeader, SourceChip } from './designSystem'
import { StatusBadge } from './StatusBadge'

export type LifecyclePanelProps = {
  names: NameLifecycleProjection[]
}

// One list of names, ONE lifecycle, in the order a name travels it.
const GROUP_ORDER: NameLifecycleState[] = ['candidate', 'watched', 'held', 'exited']

const GROUP_META: Record<NameLifecycleState, { title: string; note: string }> = {
  candidate: {
    title: 'Candidate',
    note: 'In research, not yet confirmed to the watchlist. The agent proposes; you decide what advances.',
  },
  watched: {
    title: 'Watched',
    note: 'User-confirmed and tracked for a buy window. Position sizing on entry is a later phase.',
  },
  held: {
    title: 'Held',
    note: 'An open holding recorded by an explicit, user-authored ledger transition.',
  },
  exited: {
    title: 'Exited',
    note: 'No live entity remains — either sold or screened out. The two mean opposite things.',
  },
}

const EXIT_PROVENANCE_LABEL: Record<NameLifecycleExitProvenance, string> = {
  sold: 'Sold (closed holding)',
  screened_out: 'Screened out (research rejected / pass)',
  pruned: 'Pruned (removed from watchlist)',
}

const PRIOR_EXIT_LABEL: Record<NameLifecycleExitProvenance, string> = {
  sold: 'previously sold',
  screened_out: 'previously screened out',
  pruned: 'previously pruned',
}

/**
 * The unified name list — every name the harness has touched, in exactly one lifecycle state, moving
 * candidate → watched → held → exited. Read-only over `nameLifecycleProjection`: one detection cadence
 * (falsifier check + re-underwrite) runs state-independently; its ACTION branches on state. The Phase-3
 * honesty refinements are surfaced, not hidden — a deteriorating watched name is flagged (with no prune
 * action yet), exits show whether they were sold vs screened out, and a re-discovered live name keeps its
 * prior-exit history.
 *
 * Returns a Fragment so each section is a direct child of the route frame and inherits the staggered reveal.
 */
export function LifecyclePanel({ names }: LifecyclePanelProps): ReactNode {
  const sectionsForGroup = (state: NameLifecycleState): ReactNode[] => {
    const groupNames = names.filter((name) => name.state === state)
    if (groupNames.length === 0) {
      return []
    }
    const meta = GROUP_META[state]
    return [
      createElement(
        'section',
        {
          key: `group-${state}`,
          'aria-label': `${meta.title} names`,
          'data-lifecycle-group': state,
          className: 'owl-section-card',
          style: { gap: 'var(--owl-space-2)' },
        },
        createElement('p', { className: 'owl-section-accent' }, `${meta.title} · ${groupNames.length}`),
        createElement('p', { className: 'owl-row-helper', style: { margin: 0 } }, meta.note),
      ),
      ...groupNames.map((name) => createNameCard(name)),
    ]
  }

  return createElement(
    Fragment,
    null,
    createElement(RouteHeader, {
      kicker: 'Unified name lifecycle',
      title: 'Lifecycle',
      description:
        'One list of names, one lifecycle: every name moves candidate → watched → held → exited. A single cadence engine runs a falsifier check and re-underwrite — detection is the same in every state; only the action it takes branches on the state.',
    }),
    createElement('hr', { className: 'owl-rule' }),
    createVitalSigns(names),
    ...(names.length === 0
      ? [createEmptyState()]
      : GROUP_ORDER.flatMap((state) => sectionsForGroup(state))),
  )
}

// ── Vital signs ─────────────────────────────────────────────────────────────
function createVitalSigns(names: NameLifecycleProjection[]): ReactNode {
  const count = (state: NameLifecycleState) => names.filter((name) => name.state === state).length
  const deteriorating = names.filter((name) => name.falsifier_tripped === true).length

  const stats: { figureClass: string; label: string; value: string }[] = [
    { figureClass: '', label: 'Names tracked', value: String(names.length) },
    { figureClass: 'owl-ledger-figure-emerald', label: 'Watched', value: String(count('watched')) },
    { figureClass: 'owl-ledger-figure-emerald', label: 'Held', value: String(count('held')) },
    {
      figureClass: deteriorating > 0 ? 'owl-ledger-figure-risk' : 'owl-ledger-figure-emerald',
      label: 'Deteriorating',
      value: String(deteriorating),
    },
  ]

  return createElement(
    'section',
    { 'aria-label': 'Lifecycle vital signs', className: 'owl-ledger-line' },
    ...stats.map((stat) =>
      createElement(
        'article',
        { className: 'owl-ledger-stat', key: stat.label },
        createElement('p', { className: 'owl-ledger-label' }, stat.label),
        createElement('p', { className: `owl-ledger-figure ${stat.figureClass}`.trim() }, stat.value),
      ),
    ),
  )
}

function createEmptyState(): ReactNode {
  return createElement(
    'section',
    { 'aria-label': 'Empty lifecycle', className: 'owl-section-card' },
    createElement('p', { className: 'owl-section-accent' }, 'Unified name lifecycle'),
    createElement('h2', { className: 'owl-section-title' }, 'No names yet'),
    createElement(
      'p',
      { className: 'owl-body', style: { margin: 0 } },
      'No names have entered the lifecycle yet. Create a research case to discover a candidate.',
    ),
  )
}

// ── Name card ───────────────────────────────────────────────────────────────
function createNameCard(name: NameLifecycleProjection): ReactNode {
  const ticker = name.ticker
  const deteriorating = name.falsifier_tripped === true

  return createElement(
    'section',
    {
      key: ticker,
      id: ticker,
      'data-state': name.state,
      ...(deteriorating ? { 'data-falsifier-tripped': 'true' } : {}),
      className: 'owl-section-card owl-workflow-card',
    },
    // Heading row: ticker + company + state badge.
    createElement(
      'div',
      { className: 'owl-row owl-row-top' },
      createElement(
        'div',
        { className: 'owl-row-main' },
        createElement('p', { className: 'owl-section-accent' }, `${GROUP_META[name.state].title} name`),
        createElement('h2', { className: 'owl-section-title', style: { fontSize: 'var(--owl-text-lg)' } }, ticker),
        name.company === undefined
          ? null
          : createElement('p', { className: 'owl-row-helper' }, name.company),
      ),
      createElement(
        'div',
        { className: 'owl-row-aside' },
        createElement(
          StatusBadge,
          { tone: stateTone(name.state, deteriorating) },
          GROUP_META[name.state].title,
        ),
      ),
    ),
    // Deteriorating flag — must NOT look healthy; the prune gap is kept visible.
    createDeterioratingFlag(name),
    // Valuation anchors where present.
    createValuationDetails(name),
    // Exit provenance (sold vs screened out) / re-discovery history.
    createExitDetails(name),
    // Research case link, when present.
    name.research_case_id === undefined ? null : createResearchCaseLink(name.research_case_id),
  )
}

function stateTone(state: NameLifecycleState, deteriorating: boolean): 'success' | 'warning' | 'danger' | 'neutral' {
  if (deteriorating) {
    return 'danger'
  }
  if (state === 'held') {
    return 'success'
  }
  if (state === 'watched') {
    return 'warning'
  }
  if (state === 'exited') {
    return 'neutral'
  }
  return 'neutral'
}

function createDeterioratingFlag(name: NameLifecycleProjection): ReactNode {
  if (name.falsifier_tripped !== true) {
    return null
  }

  return createElement(
    'div',
    {
      'data-testid': 'lifecycle-deteriorating',
      style: {
        display: 'grid',
        gap: '0.3rem',
        border: '1px solid var(--owl-color-border)',
        borderLeft: '3px solid var(--owl-color-risk-bright, #fca5a5)',
        borderRadius: 'var(--owl-radius-card)',
        padding: '0.7rem 0.85rem',
        marginTop: 'var(--owl-space-2)',
      },
    },
    createElement(
      'div',
      { className: 'owl-activity-meta', style: { marginBottom: '0.1rem' } },
      createElement(StatusBadge, { tone: 'danger' }, 'Deteriorating'),
      createElement(StatusBadge, { tone: 'neutral' }, 'Falsifier tripped'),
    ),
    createElement(
      'p',
      { className: 'owl-row-helper', style: { margin: 0 } },
      name.falsifier_reason ?? 'A falsifier has tripped on this watched name — re-underwrite before any buy signal.',
    ),
    // The prune action does not exist yet (later phase) — show the gap rather than hide it.
    createElement(
      'p',
      { className: 'owl-row-helper', style: { color: 'var(--owl-color-quiet)', margin: 0 } },
      'No prune action available yet — removal is a later phase, so the deteriorating name stays visible here instead of being silently dropped.',
    ),
  )
}

function createValuationDetails(name: NameLifecycleProjection): ReactNode {
  const lines: ReactNode[] = []
  if (name.buy_price_per_share !== undefined) {
    lines.push(createDetail('Buy below', `$${formatMoney(name.buy_price_per_share)}`))
  }
  if (name.fair_value_per_share !== undefined) {
    lines.push(createDetail('Fair value', `$${formatMoney(name.fair_value_per_share)}`))
  }
  if (name.shariah_gate_status !== undefined) {
    lines.push(createDetail('Shariah gate', name.shariah_gate_status))
  }
  if (lines.length === 0) {
    return null
  }
  return createElement(
    'div',
    { style: { display: 'grid', gap: '0.2rem', marginTop: 'var(--owl-space-2)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Valuation anchors'),
    ...lines,
  )
}

function createExitDetails(name: NameLifecycleProjection): ReactNode {
  if (name.state === 'exited' && name.exit_provenance !== undefined) {
    return createElement(
      'div',
      {
        'data-exit-provenance': name.exit_provenance,
        style: { display: 'grid', gap: '0.2rem', marginTop: 'var(--owl-space-2)' },
      },
      createElement('p', { className: 'owl-section-accent' }, 'Exit provenance'),
      createDetail('How it exited', EXIT_PROVENANCE_LABEL[name.exit_provenance]),
    )
  }

  if (name.prior_exit_provenance !== undefined) {
    return createElement(
      'div',
      {
        'data-prior-exit-provenance': name.prior_exit_provenance,
        style: { display: 'grid', gap: '0.2rem', marginTop: 'var(--owl-space-2)' },
      },
      createElement('p', { className: 'owl-section-accent' }, 'Re-discovery history'),
      createDetail(
        'This name was here before',
        `Live again — ${PRIOR_EXIT_LABEL[name.prior_exit_provenance]}.`,
      ),
    )
  }

  return null
}

function createResearchCaseLink(researchCaseId: string): ReactNode {
  const href = `/research/${researchCaseId}`
  return createElement(
    'p',
    {
      className: 'owl-body',
      style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.55rem', margin: '0.55rem 0 0' },
    },
    createElement('strong', { style: { color: 'var(--owl-color-text)', fontWeight: 700 } }, 'Research case:'),
    createElement(SourceChip, { href, id: researchCaseId, label: 'Research case' }),
  )
}

function createDetail(label: string, value: string): ReactNode {
  return createElement(
    'p',
    { className: 'owl-body', style: { margin: '0.4rem 0 0' } },
    createElement('strong', { style: { color: 'var(--owl-color-text)', fontWeight: 700 } }, `${label}: `),
    value,
  )
}

function formatMoney(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
