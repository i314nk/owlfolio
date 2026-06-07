import { createElement } from 'react'

import type { WorkflowMode } from '../lib/workflow'

export type ResearchPipelineItem = {
  id: string
  label: string
  status: string
  next_action: string
  href?: string
  meta?: string
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
  background: 'linear-gradient(135deg, rgba(124, 140, 255, 0.14) 0%, rgba(10, 132, 255, 0.08) 100%)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '1.35rem',
  boxShadow: '0 22px 55px rgba(0, 0, 0, 0.2)',
  display: 'grid',
  gap: '0.75rem',
  padding: '1.4rem',
}

const cardStyle = {
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: '1rem',
  boxShadow: '0 18px 45px rgba(0, 0, 0, 0.16)',
  display: 'grid',
  gap: '0.85rem',
  padding: '1rem',
}

const eyebrowStyle = {
  color: '#7c8cff',
  fontSize: '0.75rem',
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
  fontSize: '0.82rem',
  fontWeight: 800,
  padding: '0.32rem 0.55rem',
}

const actionLinkStyle = {
  color: '#c7d2fe',
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
          style: { color: '#f7f8ff', fontSize: 'clamp(2rem, 5vw, 3.4rem)', lineHeight: 1, margin: 0 },
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
        { style: { ...cardStyle, background: 'rgba(15, 23, 42, 0.46)', boxShadow: 'none' } },
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
      createElement('h2', { style: { color: '#f7f8ff', fontSize: '1.05rem', margin: 0 } }, section.title),
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
    item.meta === undefined ? null : createElement('p', { style: { ...mutedStyle, fontSize: '0.86rem' } }, item.meta),
    createElement('p', { style: { color: '#cbd5e1', fontSize: '0.9rem', fontWeight: 700, margin: 0 } }, `Next action: ${item.next_action}`),
  )
}
