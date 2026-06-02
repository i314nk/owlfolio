import { createElement, type CSSProperties } from 'react'

import { deriveAuditActivityView, type AuditActivityEvent, type AuditActivityFilters } from '../lib/audit'
import type { WorkflowMode } from '../lib/workflow'

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

const filterFormStyle: CSSProperties = {
  background: '#ffffff',
  border: '1px solid #dbeafe',
  borderRadius: '1rem',
  display: 'grid',
  gap: '0.85rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  margin: '0 0 1rem',
  padding: '1rem',
}

const filterLabelStyle: CSSProperties = {
  color: '#334155',
  display: 'grid',
  fontSize: '0.78rem',
  fontWeight: 900,
  gap: '0.35rem',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

const controlStyle: CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #cbd5e1',
  borderRadius: '0.7rem',
  color: '#0f172a',
  font: 'inherit',
  fontSize: '0.92rem',
  fontWeight: 700,
  padding: '0.55rem 0.65rem',
}

const filterActionsStyle: CSSProperties = {
  alignItems: 'end',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.65rem',
}

const buttonStyle: CSSProperties = {
  background: '#047857',
  border: '1px solid #047857',
  borderRadius: '0.7rem',
  color: '#ffffff',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '0.9rem',
  fontWeight: 900,
  padding: '0.58rem 0.8rem',
}

const clearLinkStyle: CSSProperties = {
  color: '#047857',
  fontSize: '0.9rem',
  fontWeight: 900,
  textDecoration: 'none',
}

const resultCountStyle: CSSProperties = {
  color: '#475569',
  fontSize: '0.9rem',
  fontWeight: 800,
  margin: '0 0 1rem',
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

const eventSummaryStyle: CSSProperties = {
  color: '#0f172a',
  fontSize: '1.05rem',
  fontWeight: 900,
  margin: 0,
}

const timestampStyle: CSSProperties = {
  color: '#64748b',
  fontSize: '0.85rem',
  fontWeight: 700,
}

const contextStyle: CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '0.8rem',
  color: '#334155',
  fontSize: '0.9rem',
  fontWeight: 700,
  lineHeight: 1.45,
  margin: '0 0 0.85rem',
  padding: '0.75rem',
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

const evidenceStyle: CSSProperties = {
  borderTop: '1px solid #e2e8f0',
  marginTop: '0.9rem',
  paddingTop: '0.9rem',
}

const evidenceSummaryStyle: CSSProperties = {
  color: '#047857',
  cursor: 'pointer',
  fontSize: '0.9rem',
  fontWeight: 900,
}

const copyInputStyle: CSSProperties = {
  ...controlStyle,
  marginTop: '0.35rem',
  width: '100%',
}

const preStyle: CSSProperties = {
  background: '#0f172a',
  borderRadius: '0.8rem',
  color: '#e2e8f0',
  fontSize: '0.78rem',
  lineHeight: 1.45,
  margin: '0.5rem 0 0',
  overflowX: 'auto',
  padding: '0.85rem',
  whiteSpace: 'pre-wrap',
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
  filters?: AuditActivityFilters
  mode: WorkflowMode
}

export function AuditActivityPanel({ events, filters = {}, mode }: AuditActivityPanelProps) {
  const subtitle = mode === 'demo'
    ? 'Demo ledger event stream'
    : 'Personal local ledger event stream'
  const view = deriveAuditActivityView(events, filters)

  return createElement(
    'section',
    { style: shellStyle },
    createElement('p', { style: eyebrowStyle }, 'Traceability'),
    createElement('h1', { style: headingStyle }, 'Audit activity'),
    createElement(
      'p',
      { style: subheadingStyle },
      `${subtitle}. Search and filter the ledger trace while retaining stable event IDs and raw event evidence.`,
    ),
    createElement(AuditActivityFiltersForm, { filters, filterOptions: view.filterOptions }),
    createElement('p', { style: resultCountStyle }, `${view.events.length} of ${events.length} ledger events shown`),
    view.events.length === 0
      ? createElement('p', { style: emptyStateStyle }, events.length === 0 ? 'No ledger events recorded yet.' : 'No ledger events match the current filters.')
      : createElement(
        'ol',
        { style: listStyle },
        ...view.events.map((event) => createElement(AuditActivityRow, { event, key: event.event_id })),
      ),
  )
}

function AuditActivityFiltersForm({ filters, filterOptions }: {
  filters: AuditActivityFilters
  filterOptions: ReturnType<typeof deriveAuditActivityView>['filterOptions']
}) {
  return createElement(
    'form',
    { action: '/audit', method: 'get', style: filterFormStyle },
    filterInput('Entity / ticker / text', 'entity', filters.entity ?? '', 'MSFT, holding ID, event ID'),
    filterInput('Search raw ledger evidence', 'q', filters.query ?? '', 'payload value, source ID, schema'),
    filterSelect('Raw event type', 'event_type', filters.eventType ?? '', filterOptions.eventTypes, 'All event types'),
    filterSelect('Actor', 'actor', filters.actor ?? '', filterOptions.actors, 'All actors'),
    filterSelect('Time ordering', 'time_order', filters.timeOrder ?? 'asc', ['asc', 'desc'], 'Ascending'),
    createElement(
      'div',
      { style: filterActionsStyle },
      createElement('button', { style: buttonStyle, type: 'submit' }, 'Apply filters'),
      createElement('a', { href: '/audit', style: clearLinkStyle }, 'Clear'),
    ),
  )
}

function AuditActivityRow({ event }: { event: AuditActivityEvent }) {
  return createElement(
    'li',
    {
      'data-event-id': event.event_id,
      id: event.event_id,
      style: rowStyle,
    },
    createElement(
      'div',
      { style: rowHeaderStyle },
      createElement('h2', { style: eventSummaryStyle }, event.event_summary),
      createElement('time', { dateTime: event.created_at, style: timestampStyle }, event.created_at),
    ),
    createElement('p', { style: contextStyle }, event.context_explanation),
    createElement(
      'dl',
      { style: detailListStyle },
      detail('Raw event type', event.event_type),
      detail('Aggregate', event.aggregate_label),
      detail('Actor', event.actor_label),
      detail('Entity / ticker', event.entity_label),
      detail('Sources', String(event.source_count)),
      detail('Schema', `v${event.schema_version}`),
    ),
    createElement(AuditEventEvidence, { event }),
  )
}

function AuditEventEvidence({ event }: { event: AuditActivityEvent }) {
  return createElement(
    'details',
    { style: evidenceStyle },
    createElement('summary', { style: evidenceSummaryStyle }, 'Ledger evidence details'),
    createElement(
      'label',
      { style: { ...filterLabelStyle, marginTop: '0.75rem', textTransform: 'none' } },
      'Copyable event ID',
      createElement('input', {
        'aria-label': `Copyable event ID ${event.event_id}`,
        readOnly: true,
        style: copyInputStyle,
        value: event.event_id,
      }),
    ),
    event.causation_id === undefined ? null : createElement(RelationshipLine, { label: 'Caused by', relationshipId: event.causation_id }),
    event.correlation_id === undefined ? null : detail('Correlation ID', event.correlation_id),
    event.source_ids.length === 0 ? null : createElement(
      'div',
      null,
      createElement('p', { style: detailTermStyle }, 'Source event links'),
      createElement(
        'ul',
        { style: { margin: '0.35rem 0 0', paddingLeft: '1.25rem' } },
        ...event.source_ids.map((sourceId) => createElement(
          'li',
          { key: sourceId },
          createElement('a', { href: `#${sourceId}`, style: clearLinkStyle }, sourceId),
        )),
      ),
    ),
    event.before_json === undefined || event.after_json === undefined ? null : createElement(
      'div',
      { style: { display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', marginTop: '0.75rem' } },
      rawJsonBlock('Before payload', event.before_json),
      rawJsonBlock('After payload', event.after_json),
    ),
    rawJsonBlock('Raw ledger event JSON', event.raw_event_json),
  )
}

function RelationshipLine({ label, relationshipId }: { label: string; relationshipId: string }) {
  return createElement(
    'p',
    { style: detailValueStyle },
    `${label}: `,
    createElement('a', { href: `#${relationshipId}`, style: clearLinkStyle }, relationshipId),
  )
}

function rawJsonBlock(label: string, value: string) {
  return createElement(
    'div',
    { style: { marginTop: '0.75rem' } },
    createElement('p', { style: detailTermStyle }, label),
    createElement('pre', { style: preStyle }, value),
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

function filterInput(label: string, name: string, value: string, placeholder: string) {
  return createElement(
    'label',
    { style: filterLabelStyle },
    label,
    createElement('input', {
      defaultValue: value,
      name,
      placeholder,
      style: controlStyle,
      type: name === 'q' || name === 'entity' ? 'search' : 'text',
    }),
  )
}

function filterSelect(label: string, name: string, value: string, options: string[], allLabel: string) {
  return createElement(
    'label',
    { style: filterLabelStyle },
    label,
    createElement(
      'select',
      { defaultValue: value, name, style: controlStyle },
      createElement('option', { value: '' }, allLabel),
      ...options.map((option) => createElement('option', { key: option, value: option }, option)),
    ),
  )
}
