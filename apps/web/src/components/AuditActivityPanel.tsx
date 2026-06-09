import { createElement, type CSSProperties } from 'react'

import { deriveAuditActivityView, type AuditActivityEvent, type AuditActivityFilters } from '../lib/audit'
import type { WorkflowMode } from '../lib/workflow'
import { OwlKpiStat, RouteHeader } from './designSystem'

const shellStyle: CSSProperties = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-panel)',
  boxShadow: 'var(--owl-shadow-panel)',
  padding: 'clamp(1.15rem, 4vw, 1.9rem)',
}

const filterFormStyle: CSSProperties = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-card)',
  display: 'grid',
  gap: '0.85rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  margin: '0 0 1rem',
  padding: '1rem',
}

const filterLabelStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  display: 'grid',
  fontSize: '0.78rem',
  fontWeight: 900,
  gap: '0.35rem',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

const controlStyle: CSSProperties = {
  background: 'var(--owl-color-panel)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: '0.7rem',
  color: 'var(--owl-color-text)',
  font: 'inherit',
  fontSize: '0.92rem',
  fontWeight: 700,
  minWidth: 0,
  padding: '0.55rem 0.65rem',
  width: '100%',
}

const filterActionsStyle: CSSProperties = {
  alignItems: 'end',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.65rem',
}

const buttonStyle: CSSProperties = {
  background: 'var(--owl-color-accent)',
  border: '1px solid var(--owl-color-accent)',
  borderRadius: '0.7rem',
  color: '#ffffff',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '0.9rem',
  fontWeight: 900,
  padding: '0.58rem 0.8rem',
}

const clearLinkStyle: CSSProperties = {
  background: 'var(--owl-color-panel)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: '0.7rem',
  color: 'var(--owl-color-muted)',
  fontSize: '0.9rem',
  fontWeight: 900,
  padding: '0.58rem 0.8rem',
  textDecoration: 'none',
}

const activeFiltersStyle: CSSProperties = {
  background: 'rgba(214, 178, 94, 0.09)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: '0.9rem',
  display: 'grid',
  gap: '0.55rem',
  margin: '0 0 1rem',
  padding: '0.85rem',
}

const activeFilterListStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.45rem',
  listStyle: 'none',
  margin: 0,
  padding: 0,
}

const activeFilterChipStyle: CSSProperties = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: '999px',
  color: 'var(--owl-color-muted)',
  fontSize: '0.78rem',
  fontWeight: 800,
  padding: '0.28rem 0.55rem',
}

const resultCountStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
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
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-card)',
  padding: '1.15rem 1.3rem',
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
  color: 'var(--owl-color-gold-bright)',
  fontSize: '1.05rem',
  fontWeight: 800,
  margin: 0,
}

const timestampStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: '0.85rem',
  fontWeight: 700,
}

const contextStyle: CSSProperties = {
  background: 'var(--owl-color-panel)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: '0.8rem',
  color: 'var(--owl-color-muted)',
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
  color: 'var(--owl-color-quiet)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: '0.7rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const detailValueStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: '0.88rem',
  fontWeight: 700,
  margin: '0.1rem 0 0',
  overflowWrap: 'anywhere',
}

const lineageListStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.45rem',
  listStyle: 'none',
  margin: '0.35rem 0 0',
  padding: 0,
}

const evidenceStyle: CSSProperties = {
  borderTop: '1px solid var(--owl-color-border)',
  marginTop: '0.9rem',
  paddingTop: '0.9rem',
}

const evidenceSummaryStyle: CSSProperties = {
  color: 'var(--owl-color-gold)',
  cursor: 'pointer',
  fontSize: '0.9rem',
  fontWeight: 900,
}

const copyInputStyle: CSSProperties = {
  ...controlStyle,
  marginTop: '0.35rem',
  width: '100%',
}

const copyKitStyle: CSSProperties = {
  background: 'var(--owl-color-panel-deep)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: '0.8rem',
  display: 'grid',
  gap: '0.65rem',
  marginTop: '0.75rem',
  padding: '0.75rem',
}

const preStyle: CSSProperties = {
  background: 'var(--owl-color-canvas)',
  borderRadius: '0.8rem',
  color: 'var(--owl-color-muted)',
  fontSize: '0.78rem',
  lineHeight: 1.45,
  margin: '0.5rem 0 0',
  overflowX: 'auto',
  padding: '0.85rem',
  whiteSpace: 'pre-wrap',
}

const emptyStateStyle: CSSProperties = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px dashed var(--owl-color-border)',
  borderRadius: '1rem',
  color: 'var(--owl-color-muted)',
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
    createElement(RouteHeader, {
      kicker: 'Traceability',
      title: 'Audit activity',
      description: `${subtitle}. Search and filter the ledger trace while retaining stable event IDs and raw event evidence.`,
    }),
    createElement(AuditActivityKpiRow, { events, filterOptions: view.filterOptions }),
    createElement(AuditActivityFiltersForm, { filters, filterOptions: view.filterOptions }),
    createElement(ActiveAuditFilters, { activeFilters: view.activeFilters }),
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

function AuditActivityKpiRow({ events, filterOptions }: {
  events: AuditActivityEvent[]
  filterOptions: ReturnType<typeof deriveAuditActivityView>['filterOptions']
}) {
  const hasEvents = events.length > 0
  const sourcedCount = events.filter((event) => event.source_count > 0).length

  return createElement(
    'section',
    { 'aria-label': 'Audit summary', className: 'owl-kpi-row', style: { margin: '0 0 1rem' } },
    createElement(
      'div',
      { className: 'owl-kpi-panel owl-kpi-panel-gold' },
      createElement(OwlKpiStat, {
        label: 'Ledger events',
        value: hasEvents ? String(events.length) : '—',
        tone: 'gold',
      }),
    ),
    createElement(
      'div',
      { className: 'owl-kpi-panel' },
      createElement(OwlKpiStat, {
        label: 'Event types',
        value: hasEvents ? String(filterOptions.eventTypes.length) : '—',
        tone: 'gold',
      }),
    ),
    createElement(
      'div',
      { className: 'owl-kpi-panel' },
      createElement(OwlKpiStat, {
        label: 'Actors',
        value: hasEvents ? String(filterOptions.actors.length) : '—',
        tone: 'gold',
      }),
    ),
    createElement(
      'div',
      { className: 'owl-kpi-panel' },
      createElement(OwlKpiStat, {
        label: 'Sourced events',
        value: hasEvents ? `${sourcedCount}/${events.length}` : '—',
        tone: 'emerald',
      }),
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
    filterInput('Search raw ledger evidence', 'q', filters.query ?? '', 'event JSON, ticker, report ID, payload field'),
    filterInput('Event ID', 'event_id', filters.eventId ?? '', 'evt_...'),
    filterInput('Correlation ID', 'correlation_id', filters.correlationId ?? '', 'corr_...'),
    filterInput('Source ID', 'source_id', filters.sourceId ?? '', 'src_ or evt_...'),
    filterSelect('Raw event type', 'event_type', filters.eventType ?? '', filterOptions.eventTypes, 'All event types'),
    filterSelect('Actor', 'actor', filters.actor ?? '', filterOptions.actors, 'All actors'),
    filterSelect('Schema version', 'schema_version', filters.schemaVersion ?? '', filterOptions.schemaVersions, 'All schema versions'),
    filterInput('Date from', 'date_from', filters.dateFrom ?? '', 'YYYY-MM-DD', 'date'),
    filterInput('Date to', 'date_to', filters.dateTo ?? '', 'YYYY-MM-DD', 'date'),
    filterSelect('Time ordering', 'time_order', filters.timeOrder ?? 'asc', ['asc', 'desc'], 'Ascending'),
    createElement(
      'div',
      { style: filterActionsStyle },
      createElement('button', { style: buttonStyle, type: 'submit' }, 'Apply filters'),
      createElement('a', { href: '/audit', style: clearLinkStyle }, 'Clear'),
    ),
  )
}

function ActiveAuditFilters({ activeFilters }: { activeFilters: string[] }) {
  if (activeFilters.length === 0) {
    return null
  }

  return createElement(
    'section',
    { 'aria-label': 'Active audit filters', style: activeFiltersStyle },
    createElement('p', { style: { ...detailTermStyle, margin: 0 } }, 'Active audit filters'),
    createElement(
      'ul',
      { style: activeFilterListStyle },
      ...activeFilters.map((filterLabel) => createElement('li', { key: filterLabel, style: activeFilterChipStyle }, filterLabel)),
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
      detail('Event ID', event.event_id),
      detail('Raw event type', event.event_type),
      detail('Aggregate type', event.aggregate_type),
      detail('Aggregate ID', event.aggregate_id),
      detail('Actor', event.actor_label),
      detail('Entity / ticker', event.entity_label),
      detail('Sources', String(event.source_count)),
      detail('Schema version', `v${event.schema_version}`),
      detail('Correlation ID', event.correlation_id ?? 'Not recorded'),
      relationshipDetail('Causation / parent event', event.causation_id),
      sourceLinksDetail('Source / parent links', event.source_ids),
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
      'section',
      { 'aria-label': 'Audit copy kit', style: copyKitStyle },
      createElement('p', { style: { ...detailTermStyle, margin: 0 } }, 'Audit copy kit'),
      copyableValue('Copyable event ID', `Copyable event ID ${event.event_id}`, event.event_id),
      event.correlation_id === undefined ? null : copyableValue('Copyable correlation ID', `Copyable correlation ID ${event.correlation_id}`, event.correlation_id),
      ...event.source_ids.map((sourceId) => copyableValue('Copyable source ID', `Copyable source ID ${sourceId}`, sourceId)),
    ),
    event.causation_id === undefined ? null : createElement(RelationshipLine, { label: 'Caused by', relationshipId: event.causation_id }),
    event.correlation_id === undefined ? null : detail('Correlation ID', event.correlation_id),
    event.source_ids.length === 0 ? null : createElement(
      'div',
      null,
      createElement('p', { style: detailTermStyle }, 'Source event links'),
      createElement(
        'ul',
        { style: lineageListStyle },
        ...event.source_ids.map((sourceId) => createElement(
          'li',
          { key: sourceId },
          createElement('a', { href: auditFilterHref('source_id', sourceId), style: clearLinkStyle }, sourceId),
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

function copyableValue(label: string, ariaLabel: string, value: string) {
  return createElement(
    'label',
    { style: { ...filterLabelStyle, textTransform: 'none' } },
    label,
    createElement('input', {
      'aria-label': ariaLabel,
      readOnly: true,
      style: copyInputStyle,
      value,
    }),
  )
}

function RelationshipLine({ label, relationshipId }: { label: string; relationshipId: string }) {
  return createElement(
    'p',
    { style: detailValueStyle },
    `${label}: `,
    createElement('a', { href: auditFilterHref('event_id', relationshipId, relationshipId), style: clearLinkStyle }, relationshipId),
  )
}

function auditFilterHref(param: 'event_id' | 'source_id', value: string, fragment?: string) {
  const href = `/audit?${param}=${encodeURIComponent(value)}`
  return fragment === undefined ? href : `${href}#${encodeURIComponent(fragment)}`
}

function relationshipDetail(term: string, relationshipId: string | undefined) {
  return createElement(
    'div',
    null,
    createElement('dt', { style: detailTermStyle }, term),
    relationshipId === undefined
      ? createElement('dd', { style: detailValueStyle }, 'Root event')
      : createElement('dd', { style: detailValueStyle }, createElement('a', { href: auditFilterHref('event_id', relationshipId, relationshipId), style: clearLinkStyle }, relationshipId)),
  )
}

function sourceLinksDetail(term: string, sourceIds: string[]) {
  return createElement(
    'div',
    null,
    createElement('dt', { style: detailTermStyle }, term),
    createElement(
      'dd',
      { style: detailValueStyle },
      sourceIds.length === 0 ? 'No source IDs recorded' : createElement(
        'ul',
        { style: lineageListStyle },
        ...sourceIds.map((sourceId) => createElement(
          'li',
          { key: sourceId },
          createElement('a', { href: auditFilterHref('source_id', sourceId), style: clearLinkStyle }, sourceId),
        )),
      ),
    ),
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

function filterInput(label: string, name: string, value: string, placeholder: string, type?: string) {
  return createElement(
    'label',
    { style: filterLabelStyle },
    label,
    createElement('input', {
      defaultValue: value,
      id: name === 'q' ? 'audit-search-query' : undefined,
      name,
      placeholder,
      style: controlStyle,
      type: type ?? (name === 'q' || name === 'entity' || name.endsWith('_id') ? 'search' : 'text'),
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
