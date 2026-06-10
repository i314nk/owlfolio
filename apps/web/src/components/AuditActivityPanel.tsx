import { createElement, type CSSProperties } from 'react'

import {
  deriveAuditActivityView,
  type ActorCategory,
  type AuditActivityEvent,
  type AuditActivityFilters,
  type AuditCaseGroup,
} from '../lib/audit'
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
  fontSize: 'var(--owl-text-sm)',
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
  fontSize: 'var(--owl-text-base)',
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
  fontSize: 'var(--owl-text-base)',
  fontWeight: 900,
  padding: '0.58rem 0.8rem',
}

const clearLinkStyle: CSSProperties = {
  background: 'var(--owl-color-panel)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: '0.7rem',
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-base)',
  fontWeight: 900,
  padding: '0.58rem 0.8rem',
  textDecoration: 'none',
}

const activeFiltersStyle: CSSProperties = {
  background: 'var(--owl-color-panel)',
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
  fontSize: 'var(--owl-text-sm)',
  fontWeight: 800,
  padding: '0.28rem 0.55rem',
}

const resultCountStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-base)',
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
  fontSize: 'var(--owl-text-md)',
  fontWeight: 800,
  margin: 0,
}

const timestampStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-base)',
  fontWeight: 700,
}

const contextStyle: CSSProperties = {
  background: 'var(--owl-color-panel)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: '0.8rem',
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-base)',
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
  fontSize: 'var(--owl-text-2xs)',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const detailValueStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-base)',
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
  fontSize: 'var(--owl-text-base)',
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
  fontSize: 'var(--owl-text-sm)',
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

const caseGroupStyle: CSSProperties = {
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-card)',
  marginBottom: '1rem',
  overflow: 'hidden',
}

const caseGroupHeaderStyle: CSSProperties = {
  alignItems: 'center',
  background: 'var(--owl-color-panel)',
  borderBottom: '1px solid var(--owl-color-border)',
  cursor: 'pointer',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.65rem',
  justifyContent: 'space-between',
  padding: '0.75rem 1rem',
}

const caseGroupTitleStyle: CSSProperties = {
  color: 'var(--owl-color-gold)',
  fontSize: 'var(--owl-text-base)',
  fontWeight: 900,
  margin: 0,
}

const caseGroupMetaStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-sm)',
  fontWeight: 700,
}

const caseGroupBodyStyle: CSSProperties = {
  display: 'grid',
  gap: '0.65rem',
  listStyle: 'none',
  margin: 0,
  padding: '0.75rem 1rem',
}

const otherGroupHeaderStyle: CSSProperties = {
  ...caseGroupHeaderStyle,
  background: 'var(--owl-color-panel)',
}

// Actor badge tones (gold-forward, no blue/purple)
const ACTOR_BADGE_STYLES: Record<ActorCategory, CSSProperties> = {
  user: {
    background: 'rgba(214, 178, 94, 0.18)',
    border: '1px solid rgba(214, 178, 94, 0.38)',
    borderRadius: '999px',
    color: 'var(--owl-color-gold)',
    fontSize: 'var(--owl-text-sm)',
    fontWeight: 900,
    padding: '0.18rem 0.5rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  provider: {
    background: 'rgba(214, 178, 94, 0.08)',
    border: '1px solid rgba(214, 178, 94, 0.22)',
    borderRadius: '999px',
    color: 'var(--owl-color-gold-bright)',
    fontSize: 'var(--owl-text-sm)',
    fontWeight: 900,
    padding: '0.18rem 0.5rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  worker: {
    background: 'rgba(120, 100, 60, 0.12)',
    border: '1px solid rgba(140, 120, 70, 0.28)',
    borderRadius: '999px',
    color: 'var(--owl-color-muted)',
    fontSize: 'var(--owl-text-sm)',
    fontWeight: 900,
    padding: '0.18rem 0.5rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  system: {
    background: 'rgba(80, 80, 80, 0.10)',
    border: '1px solid rgba(120, 120, 120, 0.22)',
    borderRadius: '999px',
    color: 'var(--owl-color-quiet)',
    fontSize: 'var(--owl-text-sm)',
    fontWeight: 900,
    padding: '0.18rem 0.5rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
}

const dossierLinkStyle: CSSProperties = {
  color: 'var(--owl-color-gold)',
  fontSize: 'var(--owl-text-sm)',
  fontWeight: 900,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

const advancedToggleStyle: CSSProperties = {
  borderTop: '1px solid var(--owl-color-border)',
  marginTop: '0.5rem',
  paddingTop: '0.5rem',
}

const advancedSummaryStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  cursor: 'pointer',
  fontSize: 'var(--owl-text-sm)',
  fontWeight: 800,
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
      : createElement(AuditGroupedView, { caseGroups: view.caseGroups, ungroupedEvents: view.ungroupedEvents }),
  )
}

function AuditGroupedView({ caseGroups, ungroupedEvents }: {
  caseGroups: AuditCaseGroup[]
  ungroupedEvents: AuditActivityEvent[]
}) {
  const hasCaseGroups = caseGroups.length > 0
  const hasUngrouped = ungroupedEvents.length > 0

  if (!hasCaseGroups && !hasUngrouped) {
    return null
  }

  return createElement(
    'div',
    null,
    ...caseGroups.map((group) => createElement(AuditCaseGroupSection, { group, key: group.correlation_id })),
    hasUngrouped ? createElement(AuditOtherGroupSection, { events: ungroupedEvents }) : null,
  )
}

function AuditCaseGroupSection({ group }: { group: AuditCaseGroup }) {
  const dateStr = group.earliest_date.slice(0, 10)
  return createElement(
    'details',
    { open: true, style: caseGroupStyle },
    createElement(
      'summary',
      { style: caseGroupHeaderStyle },
      createElement(
        'div',
        { style: { display: 'flex', gap: '0.55rem', alignItems: 'baseline', flexWrap: 'wrap' as const } },
        createElement('h3', { style: caseGroupTitleStyle }, group.ticker),
        createElement('span', { style: caseGroupMetaStyle }, `${group.event_count} events · ${dateStr}`),
      ),
      createElement('span', { style: { ...caseGroupMetaStyle, fontSize: 'var(--owl-text-2xs)', fontFamily: 'var(--owl-font-mono)' } }, group.correlation_id),
    ),
    createElement(
      'ol',
      { style: caseGroupBodyStyle },
      ...group.events.map((event) => createElement(AuditActivityRow, { event, key: event.event_id })),
    ),
  )
}

function AuditOtherGroupSection({ events }: { events: AuditActivityEvent[] }) {
  return createElement(
    'details',
    { open: true, style: caseGroupStyle },
    createElement(
      'summary',
      { style: otherGroupHeaderStyle },
      createElement('h3', { style: { ...caseGroupTitleStyle, color: 'var(--owl-color-muted)' } }, 'Other / system'),
      createElement('span', { style: caseGroupMetaStyle }, `${events.length} events`),
    ),
    createElement(
      'ol',
      { style: caseGroupBodyStyle },
      ...events.map((event) => createElement(AuditActivityRow, { event, key: event.event_id })),
    ),
  )
}

function AuditActivityKpiRow({ events, filterOptions }: {
  events: AuditActivityEvent[]
  filterOptions: ReturnType<typeof deriveAuditActivityView>['filterOptions']
}) {
  const hasEvents = events.length > 0

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
    filterInput('Date from', 'date_from', filters.dateFrom ?? '', 'YYYY-MM-DD', 'date'),
    filterInput('Date to', 'date_to', filters.dateTo ?? '', 'YYYY-MM-DD', 'date'),
    filterSelect('Time ordering', 'time_order', filters.timeOrder ?? 'asc', ['asc', 'desc'], 'Ascending'),
    createElement(
      'details',
      { style: advancedToggleStyle },
      createElement('summary', { style: advancedSummaryStyle }, 'Advanced'),
      filterSelect('Schema version', 'schema_version', filters.schemaVersion ?? '', filterOptions.schemaVersions, 'All schema versions'),
    ),
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

function ActorBadge({ category, label }: { category: ActorCategory; label: string }) {
  const badgeStyle = ACTOR_BADGE_STYLES[category] ?? ACTOR_BADGE_STYLES.system
  return createElement('span', { style: badgeStyle, title: label }, category)
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
      createElement(
        'div',
        { style: { display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' as const } },
        createElement('h2', { style: eventSummaryStyle }, event.event_summary),
        createElement(ActorBadge, { category: event.actor_category, label: event.actor_label }),
      ),
      createElement(
        'div',
        { style: { display: 'flex', gap: '0.65rem', alignItems: 'baseline', flexWrap: 'wrap' as const } },
        event.research_case_id !== undefined
          ? createElement('a', { href: `/research/${event.research_case_id}`, style: dossierLinkStyle }, 'Open dossier →')
          : null,
        createElement('time', { dateTime: event.created_at, style: timestampStyle }, event.created_at_display),
      ),
    ),
    event.context_explanation.length > 0
      ? createElement('p', { style: contextStyle }, event.context_explanation)
      : null,
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
      event.causation_id !== undefined ? copyableValue('Copyable causation ID', `Copyable causation ID ${event.causation_id}`, event.causation_id) : null,
      ...event.source_ids.map((sourceId) => copyableValue('Copyable source ID', `Copyable source ID ${sourceId}`, sourceId)),
    ),
    event.causation_id === undefined ? null : createElement(RelationshipLine, { label: 'Caused by', relationshipId: event.causation_id }),
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
