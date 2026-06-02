import { createElement, type CSSProperties } from 'react'

import type { WorkflowMode } from '../lib/workflow'
import type { AuditActivityEvent } from '../lib/audit'

const shellStyle: CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #dbeafe',
  borderRadius: '1.25rem',
  boxShadow: '0 24px 80px rgba(15, 23, 42, 0.08)',
  padding: 'clamp(1.25rem, 4vw, 2rem)',
}

const eyebrowStyle: CSSProperties = {
  color: '#047857',
  fontSize: '0.78rem',
  fontWeight: 900,
  letterSpacing: '0.1em',
  margin: 0,
  textTransform: 'uppercase',
}

const headingStyle: CSSProperties = {
  color: '#0f172a',
  fontSize: 'clamp(2rem, 4vw, 3rem)',
  lineHeight: 1,
  margin: '0.35rem 0 0.75rem',
}

const subheadingStyle: CSSProperties = {
  color: '#475569',
  fontSize: '1rem',
  lineHeight: 1.6,
  margin: '0 0 1.5rem',
}

const listStyle: CSSProperties = {
  display: 'grid',
  gap: '0.85rem',
  listStyle: 'none',
  margin: 0,
  padding: 0,
}

const rowStyle: CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '1rem',
  padding: '1rem',
}

const rowHeaderStyle: CSSProperties = {
  alignItems: 'baseline',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  justifyContent: 'space-between',
  marginBottom: '0.6rem',
}

const eventTypeStyle: CSSProperties = {
  color: '#0f172a',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: '0.98rem',
  fontWeight: 900,
  margin: 0,
}

const timestampStyle: CSSProperties = {
  color: '#64748b',
  fontSize: '0.85rem',
  fontWeight: 700,
}

const detailListStyle: CSSProperties = {
  display: 'grid',
  gap: '0.35rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  margin: 0,
}

const detailTermStyle: CSSProperties = {
  color: '#64748b',
  fontSize: '0.72rem',
  fontWeight: 900,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const detailValueStyle: CSSProperties = {
  color: '#1e293b',
  fontSize: '0.92rem',
  fontWeight: 700,
  margin: '0.1rem 0 0',
  overflowWrap: 'anywhere',
}

const emptyStateStyle: CSSProperties = {
  background: '#ffffff',
  border: '1px dashed #cbd5e1',
  borderRadius: '1rem',
  color: '#475569',
  fontWeight: 700,
  margin: 0,
  padding: '1rem',
}

type AuditActivityPanelProps = {
  events: AuditActivityEvent[]
  mode: WorkflowMode
}

export function AuditActivityPanel({ events, mode }: AuditActivityPanelProps) {
  const subtitle = mode === 'demo'
    ? 'Demo ledger event stream'
    : 'Personal local ledger event stream'

  return createElement(
    'section',
    { style: shellStyle },
    createElement('p', { style: eyebrowStyle }, 'Traceability'),
    createElement('h1', { style: headingStyle }, 'Audit activity'),
    createElement(
      'p',
      { style: subheadingStyle },
      `${subtitle}. Events are listed in chronological order using stable ledger event IDs for row identity.`,
    ),
    events.length === 0
      ? createElement('p', { style: emptyStateStyle }, 'No ledger events recorded yet.')
      : createElement(
        'ol',
        { style: listStyle },
        ...events.map((event) => createElement(AuditActivityRow, { event, key: event.event_id })),
      ),
  )
}

function AuditActivityRow({ event }: { event: AuditActivityEvent }) {
  return createElement(
    'li',
    {
      'data-event-id': event.event_id,
      style: rowStyle,
    },
    createElement(
      'div',
      { style: rowHeaderStyle },
      createElement('h2', { style: eventTypeStyle }, event.event_type),
      createElement('time', { dateTime: event.created_at, style: timestampStyle }, event.created_at),
    ),
    createElement(
      'dl',
      { style: detailListStyle },
      detail('Event ID', event.event_id),
      detail('Aggregate', event.aggregate_label),
      detail('Actor', event.actor_label),
      detail('Sources', String(event.source_count)),
      detail('Schema', `v${event.schema_version}`),
    ),
  )
}

function detail(term: string, value: string) {
  return createElement(
    'div',
    null,
    createElement('dt', { style: detailTermStyle }, term),
    createElement('dd', { style: detailValueStyle }, value),
  )
}
