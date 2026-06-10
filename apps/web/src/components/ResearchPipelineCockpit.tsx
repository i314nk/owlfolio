import { createElement } from 'react'

import type { DiscoverySignal } from '@owlfolio/ledger/projections/discoveryCandidateProjection'

import type { WorkflowMode } from '../lib/workflow'

export type ResearchPipelineItem = {
  id: string
  label: string
  status: string
  next_action: string
  href?: string
  meta?: string
  summary?: string
  /** 13F discovery signal detail — tells the user WHY a name surfaced. */
  signal?: DiscoverySignal
}

const SIGNAL_LABEL: Record<DiscoverySignal['signal_type'], string> = {
  CLUSTER_BUY: 'CLUSTER BUY',
  NEW_POSITION: 'NEW POSITION',
  MEANINGFUL_ADD: 'MEANINGFUL ADD',
}

const signalBadgeStyle = {
  border: '1px solid rgba(22, 163, 74, 0.45)',
  borderRadius: '999px',
  color: '#86efac',
  display: 'inline-flex',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-xs)',
  fontWeight: 900,
  letterSpacing: '0.06em',
  padding: '0.2rem 0.5rem',
}

const unresolvedBadgeStyle = {
  ...signalBadgeStyle,
  border: '1px solid rgba(214, 178, 94, 0.5)',
  color: 'var(--owl-color-gold-bright)',
}

export type ResearchPipelineSection = {
  key: string
  title: string
  empty_message: string
  items: ResearchPipelineItem[]
}

export type ResearchPipelineCockpitProps = {
  mode: WorkflowMode
  selectedStrategyLabel: string
  sections: ResearchPipelineSection[]
}

const shellStyle = {
  display: 'grid',
  gap: '1rem',
}

const heroStyle = {
  background: 'linear-gradient(135deg, rgba(214, 178, 94, 0.10) 0%, rgba(22, 163, 74, 0.06) 100%)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '1.35rem',
  boxShadow: '0 22px 55px rgba(0, 0, 0, 0.2)',
  display: 'grid',
  gap: '0.75rem',
  padding: '1.4rem',
}

const cardStyle = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: '1rem',
  boxShadow: '0 18px 45px rgba(0, 0, 0, 0.16)',
  display: 'grid',
  gap: '0.85rem',
  padding: '1rem',
}

const eyebrowStyle = {
  color: 'var(--owl-color-gold)',
  fontSize: 'var(--owl-text-xs)',
  fontWeight: 900,
  letterSpacing: '0.08em',
  margin: 0,
  textTransform: 'uppercase' as const,
}

const mutedStyle = {
  color: '#9aa4b7',
  margin: 0,
}

const pillStyle = {
  border: '1px solid rgba(148, 163, 184, 0.22)',
  borderRadius: '999px',
  color: '#cbd5e1',
  display: 'inline-flex',
  fontSize: 'var(--owl-text-sm)',
  fontWeight: 800,
  padding: '0.32rem 0.55rem',
}

const actionLinkStyle = {
  color: 'var(--owl-color-gold-bright)',
  fontWeight: 900,
  textDecoration: 'none',
}

export function ResearchPipelineCockpit({
  mode,
  selectedStrategyLabel,
  sections,
}: ResearchPipelineCockpitProps) {
  return createElement(
    'section',
    { 'aria-labelledby': 'research-pipeline-cockpit-title', style: shellStyle },
    createElement(
      'header',
      { style: heroStyle },
      createElement('p', { style: eyebrowStyle }, 'Research workflow'),
      createElement(
        'h1',
        {
          id: 'research-pipeline-cockpit-title',
          className: 'owl-page-title',
          style: { color: '#f7f8ff', lineHeight: 1, margin: 0 },
        },
        'Strategy pipeline cockpit',
      ),
      createElement(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: '0.55rem' } },
        createElement('span', { style: pillStyle }, selectedStrategyLabel),
        createElement('span', { style: pillStyle }, `Mode: ${mode}`),
      ),
      createElement(
        'p',
        { style: { ...mutedStyle, maxWidth: '58rem' } },
        'Track the selected strategy from discovery through quick screen, deep dive, decision gate, watchlist, and terminal outcomes. Manual ticker intake stays available as a secondary path.',
      ),
      createElement(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem' } },
        createElement(
          'a',
          { className: 'owl-button owl-button-secondary owl-focusable', href: '/research/new' },
          'Manual ticker intake',
        ),
        createElement(
          'a',
          { className: 'owl-button owl-button-secondary owl-focusable', href: '/learn' },
          'Open Learn guide',
        ),
      ),
      createElement(
        'details',
        { style: { ...cardStyle, background: 'var(--owl-color-panel-deep)', boxShadow: 'none' } },
        createElement('summary', { style: { color: '#f7f8ff', cursor: 'pointer', fontWeight: 900 } }, 'How this pipeline works'),
        createElement(
          'p',
          { style: { color: '#cbd5e1', margin: '0.75rem 0 0' } },
          'Discovery candidates enter a strategy queue, quick screens decide whether to pass, reject, request more data, or send to deep dive, and provider drafts never become watchlist or holding state without a user-authored transition.',
        ),
        createElement(
          'p',
          { style: { margin: '0.55rem 0 0' } },
          createElement('a', { href: '/learn', style: actionLinkStyle }, 'Read the detailed workflow boundaries in Learn'),
        ),
      ),
    ),
    createElement(
      'div',
      {
        style: {
          display: 'grid',
          gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        },
      },
      ...sections.map((section) => createPipelineSection(section)),
    ),
  )
}

function createPipelineSection(section: ResearchPipelineSection) {
  return createElement(
    'article',
    { key: section.key, style: cardStyle },
    createElement(
      'header',
      { style: { alignItems: 'baseline', display: 'flex', gap: '0.75rem', justifyContent: 'space-between' } },
      createElement('h2', { style: { color: '#f7f8ff', fontSize: 'var(--owl-text-md)', margin: 0 } }, section.title),
      createElement('span', { style: pillStyle }, `${section.items.length}`),
    ),
    section.items.length === 0
      ? createElement('p', { style: mutedStyle }, section.empty_message)
      : createElement(
        'ol',
        { style: { display: 'grid', gap: '0.75rem', listStyle: 'none', margin: 0, padding: 0 } },
        ...section.items.map((item) => createPipelineItem(item)),
      ),
  )
}

function createPipelineItem(item: ResearchPipelineItem) {
  const label = item.href === undefined
    ? createElement('span', { style: { color: '#f7f8ff', fontWeight: 900 } }, item.label)
    : createElement('a', { href: item.href, style: actionLinkStyle }, item.label)

  return createElement(
    'li',
    {
      key: item.id,
      style: {
        borderTop: '1px solid rgba(148, 163, 184, 0.14)',
        display: 'grid',
        gap: '0.35rem',
        paddingTop: '0.75rem',
      },
    },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.45rem', justifyContent: 'space-between' } },
      label,
      createElement('span', { style: pillStyle }, item.status),
    ),
    item.signal === undefined ? null : createSignalDetail(item.signal),
    item.meta === undefined ? null : createElement('p', { style: { ...mutedStyle, fontSize: 'var(--owl-text-base)' } }, item.meta),
    item.summary === undefined
      ? null
      : createElement(
        'p',
        { style: { color: '#e2e8f0', fontSize: 'var(--owl-text-base)', lineHeight: 1.45, margin: 0 } },
        createElement('strong', null, 'Investment brief: '),
        item.summary,
      ),
    createElement('p', { style: { color: '#cbd5e1', fontSize: 'var(--owl-text-base)', fontWeight: 700, margin: 0 } }, `Next action: ${item.next_action}`),
  )
}

/**
 * The 13F discovery signal: a signal badge (CLUSTER_BUY > NEW_POSITION > MEANINGFUL_ADD), the
 * contributing managers, the conviction weight, and an unresolved-ticker flag. This tells the user WHY a
 * name surfaced — it is a discovery observation, not a recommendation to buy.
 */
function createSignalDetail(signal: DiscoverySignal) {
  const managers = signal.contributing_managers.length === 0
    ? 'managers not recorded'
    : signal.contributing_managers.join(', ')

  return createElement(
    'div',
    { style: { display: 'grid', gap: '0.35rem' } },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' } },
      createElement('span', { style: signalBadgeStyle }, SIGNAL_LABEL[signal.signal_type]),
      createElement('span', { style: pillStyle }, `${(signal.conviction_pct * 100).toFixed(1)}% conviction`),
      ...(signal.ticker_unresolved ? [createElement('span', { key: 'unresolved', style: unresolvedBadgeStyle }, 'TICKER UNRESOLVED')] : []),
    ),
    createElement('p', { style: { ...mutedStyle, fontSize: 'var(--owl-text-base)' } }, `13F signal · ${managers}`),
  )
}
