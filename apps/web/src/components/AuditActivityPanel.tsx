import { createElement, type CSSProperties } from 'react'

import {
  deriveAuditActivityView,
  type ActorCategory,
  type AuditActivityEvent,
  type AuditActivityFilters,
  type AuditCaseGroup,
} from '../lib/audit'
import type { WorkflowMode } from '../lib/workflow'
import { RouteHeader } from './designSystem'

// ── Inline styles for surfaces that have no shared class yet ──────────────────
// The page leans on the shared editorial vocabulary (owl-section-card,
// owl-ledger-line, owl-row*, owl-source-chip, owl-rule). Only the structures
// without a class — the filter grid, the raw-evidence copy kit, and the actor
// badge tones — keep scoped inline styles here.

const filterFormStyle: CSSProperties = {
  display: 'grid',
  gap: '0.85rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
  margin: 0,
}

const filterLabelStyle: CSSProperties = {
  color: 'var(--owl-color-quiet)',
  display: 'grid',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  fontWeight: 'var(--owl-weight-label)',
  gap: '0.35rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
}

const controlStyle: CSSProperties = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-control)',
  color: 'var(--owl-color-text)',
  font: 'inherit',
  fontSize: 'var(--owl-text-base)',
  minWidth: 0,
  padding: '0.55rem 0.65rem',
  width: '100%',
}

const filterActionsStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.65rem',
  gridColumn: '1 / -1',
  marginTop: '0.2rem',
}

const activeFiltersStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  margin: 0,
}

const activeFilterChipStyle: CSSProperties = {
  background: 'rgba(214, 178, 94, 0.08)',
  border: '1px solid rgba(214, 178, 94, 0.22)',
  borderRadius: '999px',
  color: 'var(--owl-color-muted)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  letterSpacing: '0.02em',
  padding: '0.28rem 0.6rem',
}

const detailTermStyle: CSSProperties = {
  color: 'var(--owl-color-quiet)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  fontWeight: 'var(--owl-weight-label)',
  letterSpacing: '0.08em',
  margin: 0,
  textTransform: 'uppercase',
}

const detailValueStyle: CSSProperties = {
  color: 'var(--owl-color-text)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-sm)',
  margin: '0.15rem 0 0',
  overflowWrap: 'anywhere',
}

const detailListStyle: CSSProperties = {
  display: 'grid',
  gap: '0.55rem 1.1rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  margin: '0.85rem 0 0',
}

const lineageListStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.4rem',
  listStyle: 'none',
  margin: '0.3rem 0 0',
  padding: 0,
}

const traceLinkStyle: CSSProperties = {
  color: 'var(--owl-color-gold-bright)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-sm)',
  textDecoration: 'none',
}

const copyKitStyle: CSSProperties = {
  background: 'var(--owl-color-panel-deep)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-card)',
  display: 'grid',
  gap: '0.65rem',
  marginTop: '0.75rem',
  padding: '0.85rem',
}

const copyInputStyle: CSSProperties = {
  ...controlStyle,
  background: 'var(--owl-color-panel)',
  marginTop: '0.3rem',
}

const preStyle: CSSProperties = {
  background: 'var(--owl-color-canvas)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-card)',
  color: 'var(--owl-color-muted)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  lineHeight: 1.5,
  margin: '0.4rem 0 0',
  overflowX: 'auto',
  padding: '0.85rem',
  whiteSpace: 'pre-wrap',
}

const evidenceSummaryStyle: CSSProperties = {
  color: 'var(--owl-color-gold)',
  cursor: 'pointer',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-sm)',
  fontWeight: 700,
}

const advancedSummaryStyle: CSSProperties = {
  ...evidenceSummaryStyle,
  color: 'var(--owl-color-muted)',
}

const dossierLinkStyle: CSSProperties = {
  color: 'var(--owl-color-gold)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-sm)',
  fontWeight: 700,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

const timestampStyle: CSSProperties = {
  color: 'var(--owl-color-quiet)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-sm)',
}

// Actor badge tones — gold-forward / muted, no blue or purple.
const ACTOR_BADGE_BASE: CSSProperties = {
  borderRadius: '999px',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  fontWeight: 700,
  letterSpacing: '0.08em',
  padding: '0.16rem 0.5rem',
  textTransform: 'uppercase',
}

const ACTOR_BADGE_STYLES: Record<ActorCategory, CSSProperties> = {
  user: {
    ...ACTOR_BADGE_BASE,
    background: 'rgba(214, 178, 94, 0.18)',
    border: '1px solid rgba(214, 178, 94, 0.38)',
    color: 'var(--owl-color-gold-bright)',
  },
  provider: {
    ...ACTOR_BADGE_BASE,
    background: 'rgba(52, 211, 153, 0.10)',
    border: '1px solid rgba(52, 211, 153, 0.30)',
    color: 'var(--owl-color-accent-bright)',
  },
  worker: {
    ...ACTOR_BADGE_BASE,
    background: 'rgba(120, 100, 60, 0.12)',
    border: '1px solid rgba(140, 120, 70, 0.28)',
    color: 'var(--owl-color-muted)',
  },
  system: {
    ...ACTOR_BADGE_BASE,
    background: 'rgba(80, 80, 80, 0.10)',
    border: '1px solid rgba(120, 120, 120, 0.22)',
    color: 'var(--owl-color-quiet)',
  },
}

type AuditActivityPanelProps = {
  events: AuditActivityEvent[]
  filters?: AuditActivityFilters
  mode: WorkflowMode
}

/**
 * The Audit page — the immutable record.
 *
 * This is the full version of the Command Center's ledger feed: every decision
 * and the grounded evidence behind it, presented as an authoritative, searchable
 * fiduciary ledger. Leads with the summary, keeps the powerful filters but
 * presents them cleanly, then renders events grouped by research case.
 */
export function AuditActivityPanel({ events, filters = {}, mode }: AuditActivityPanelProps) {
  const ledger = mode === 'demo' ? 'Demo ledger event stream' : 'Personal local ledger event stream'
  const view = deriveAuditActivityView(events, filters)

  return createElement(
    'section',
    { 'aria-label': 'Audit activity', style: { display: 'grid', gap: 'var(--owl-space-4)' } },
    createElement(RouteHeader, {
      kicker: 'The immutable record',
      title: 'Audit activity',
      description: `${ledger}. Trace every decision and its grounded evidence — stable event IDs and raw ledger payloads, preserved exactly as written.`,
    }),
    createElement('hr', { className: 'owl-rule' }),
    createElement(AuditLedgerLine, { events, filterOptions: view.filterOptions, shownCount: view.events.length }),
    createElement(AuditActivityFiltersForm, { filters, filterOptions: view.filterOptions }),
    createElement(ActiveAuditFilters, { activeFilters: view.activeFilters }),
    view.events.length === 0
      ? createElement(
        'p',
        { className: 'owl-body' },
        events.length === 0 ? 'No ledger events recorded yet.' : 'No ledger events match the current filters.',
      )
      : createElement(AuditGroupedView, { caseGroups: view.caseGroups, ungroupedEvents: view.ungroupedEvents }),
  )
}

// ── The ledger line — vital signs of the record ───────────────────────────────

function AuditLedgerLine({ events, filterOptions, shownCount }: {
  events: AuditActivityEvent[]
  filterOptions: ReturnType<typeof deriveAuditActivityView>['filterOptions']
  shownCount: number
}) {
  const hasEvents = events.length > 0
  const caseCount = new Set(events.map((event) => event.correlation_id).filter((id): id is string => id !== undefined)).size

  const stats: { label: string; value: string }[] = [
    { label: 'Ledger events', value: hasEvents ? countsText(events.length) : '—' },
    { label: 'Shown', value: hasEvents ? countsText(shownCount) : '—' },
    { label: 'Research cases', value: hasEvents ? countsText(caseCount) : '—' },
    { label: 'Event types', value: hasEvents ? countsText(filterOptions.eventTypes.length) : '—' },
    { label: 'Actors', value: hasEvents ? countsText(filterOptions.actors.length) : '—' },
  ]

  return createElement(
    'section',
    { 'aria-label': 'Audit summary', className: 'owl-ledger-line' },
    ...stats.map((stat) => createElement(
      'article',
      { className: 'owl-ledger-stat', key: stat.label },
      createElement('p', { className: 'owl-ledger-label' }, stat.label),
      createElement('p', { className: 'owl-ledger-figure' }, stat.value),
    )),
  )
}

// ── The filters — present the power cleanly ───────────────────────────────────

function AuditActivityFiltersForm({ filters, filterOptions }: {
  filters: AuditActivityFilters
  filterOptions: ReturnType<typeof deriveAuditActivityView>['filterOptions']
}) {
  return createElement(
    'section',
    { className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Search the record'),
    createElement('h2', { className: 'owl-section-title' }, 'Filter the ledger trace'),
    createElement(
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
        { style: { gridColumn: '1 / -1' } },
        createElement('summary', { style: advancedSummaryStyle }, 'Advanced'),
        createElement(
          'div',
          { style: { marginTop: '0.6rem', maxWidth: '260px' } },
          filterSelect('Schema version', 'schema_version', filters.schemaVersion ?? '', filterOptions.schemaVersions, 'All schema versions'),
        ),
      ),
      createElement(
        'div',
        { style: filterActionsStyle },
        createElement('button', { className: 'owl-button owl-button-primary owl-focusable', type: 'submit' }, 'Apply filters'),
        createElement('a', { className: 'owl-button owl-button-secondary owl-focusable', href: '/audit' }, 'Clear'),
      ),
    ),
  )
}

function ActiveAuditFilters({ activeFilters }: { activeFilters: string[] }) {
  if (activeFilters.length === 0) {
    return null
  }

  return createElement(
    'section',
    { 'aria-label': 'Active audit filters', style: { display: 'grid', gap: '0.5rem' } },
    createElement('p', { style: detailTermStyle }, 'Active audit filters'),
    createElement(
      'div',
      { style: activeFiltersStyle },
      ...activeFilters.map((filterLabel) => createElement('span', { key: filterLabel, style: activeFilterChipStyle }, filterLabel)),
    ),
  )
}

// ── The record — events grouped by research case / correlation ────────────────

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
    { style: { display: 'grid', gap: 'var(--owl-space-3)' } },
    ...caseGroups.map((group) => createElement(AuditCaseGroupSection, { group, key: group.correlation_id })),
    hasUngrouped ? createElement(AuditOtherGroupSection, { events: ungroupedEvents }) : null,
  )
}

function AuditCaseGroupSection({ group }: { group: AuditCaseGroup }) {
  const dateStr = group.earliest_date.slice(0, 10)
  return createElement(
    'details',
    { className: 'owl-section-card', open: true, style: { gap: 'var(--owl-space-3)' } },
    createElement(
      'summary',
      { style: { cursor: 'pointer', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'baseline', justifyContent: 'space-between' } },
      createElement(
        'span',
        { style: { display: 'flex', gap: '0.6rem', alignItems: 'baseline', flexWrap: 'wrap' as const } },
        createElement('span', { className: 'owl-section-accent' }, 'Research case'),
        createElement('span', { className: 'owl-section-title' }, group.ticker),
        createElement('span', { style: timestampStyle }, `${group.event_count} ${group.event_count === 1 ? 'event' : 'events'} · ${dateStr}`),
      ),
      createElement('span', { style: { ...timestampStyle, fontSize: 'var(--owl-text-2xs)' } }, group.correlation_id),
    ),
    createElement(
      'ol',
      { style: { display: 'grid', gap: 'var(--owl-space-3)', listStyle: 'none', margin: 0, padding: 0 } },
      ...group.events.map((event) => createElement(AuditActivityRow, { event, key: event.event_id })),
    ),
  )
}

function AuditOtherGroupSection({ events }: { events: AuditActivityEvent[] }) {
  return createElement(
    'details',
    { className: 'owl-section-card', open: true, style: { gap: 'var(--owl-space-3)' } },
    createElement(
      'summary',
      { style: { cursor: 'pointer', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'baseline', justifyContent: 'space-between' } },
      createElement(
        'span',
        { style: { display: 'flex', gap: '0.6rem', alignItems: 'baseline' } },
        createElement('span', { className: 'owl-section-accent' }, 'Other'),
        createElement('span', { className: 'owl-section-title', style: { color: 'var(--owl-color-muted)' } }, 'System & uncorrelated'),
      ),
      createElement('span', { style: timestampStyle }, `${events.length} ${events.length === 1 ? 'event' : 'events'}`),
    ),
    createElement(
      'ol',
      { style: { display: 'grid', gap: 'var(--owl-space-3)', listStyle: 'none', margin: 0, padding: 0 } },
      ...events.map((event) => createElement(AuditActivityRow, { event, key: event.event_id })),
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
      style: {
        background: 'var(--owl-color-panel)',
        border: '1px solid var(--owl-color-border)',
        borderRadius: 'var(--owl-radius-card)',
        padding: '1rem 1.15rem',
      },
    },
    createElement(
      'div',
      { style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', justifyContent: 'space-between' } },
      createElement(
        'div',
        { style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap' as const, gap: '0.5rem' } },
        createElement('h3', { style: { color: 'var(--owl-color-gold-bright)', fontFamily: 'var(--owl-font-sans)', fontSize: 'var(--owl-text-md)', fontWeight: 700, margin: 0 } }, event.event_summary),
        createElement(ActorBadge, { category: event.actor_category, label: event.actor_label }),
      ),
      createElement(
        'div',
        { style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap' as const, gap: '0.75rem' } },
        event.research_case_id !== undefined
          ? createElement('a', { className: 'owl-focusable', href: `/research/${event.research_case_id}`, style: dossierLinkStyle }, 'Open dossier →')
          : null,
        createElement('time', { dateTime: event.created_at, style: timestampStyle }, event.created_at_display),
      ),
    ),
    event.context_explanation.length > 0
      ? createElement('p', { className: 'owl-row-helper', style: { marginTop: '0.55rem' } }, event.context_explanation)
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
    { style: { borderTop: '1px solid var(--owl-color-border)', marginTop: '0.9rem', paddingTop: '0.9rem' } },
    createElement('summary', { style: evidenceSummaryStyle }, 'Ledger evidence details'),
    createElement(
      'section',
      { 'aria-label': 'Audit copy kit', style: copyKitStyle },
      createElement('p', { style: detailTermStyle }, 'Audit copy kit'),
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
    { style: filterLabelStyle },
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
    { style: { ...detailValueStyle, marginTop: '0.75rem' } },
    `${label}: `,
    createElement('a', { className: 'owl-focusable', href: auditFilterHref('event_id', relationshipId, relationshipId), style: traceLinkStyle }, relationshipId),
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
      : createElement('dd', { style: detailValueStyle }, createElement('a', { className: 'owl-focusable', href: auditFilterHref('event_id', relationshipId, relationshipId), style: traceLinkStyle }, relationshipId)),
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
          createElement('a', { className: 'owl-focusable', href: auditFilterHref('source_id', sourceId), style: traceLinkStyle }, sourceId),
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

function countsText(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}
