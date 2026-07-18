import { createElement, type CSSProperties } from 'react'

import type { OwlLocale } from '@owlfolio/shared/appConfig'

import {
  deriveAuditActivityView,
  type ActorCategory,
  type AuditActivityEvent,
  type AuditActivityFilters,
  type AuditCaseGroup,
} from '../lib/audit'
import { t, type MessageKey } from '../lib/i18n'
import { RouteHeader } from './designSystem'

// i18n: render-scoped locale — the panel's helpers run synchronously inside its render call. Page
// chrome follows the locale; ledger data and the row internals (technical vocabulary, ids, raw
// payloads) stay as recorded.
let panelLocale: OwlLocale = 'en'
const dt = (key: MessageKey): string => t(panelLocale, key)

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
    background: 'rgba(var(--owl-rgb-accent-bright), 0.10)',
    border: '1px solid rgba(var(--owl-rgb-accent-bright), 0.30)',
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
  /** i18n: the page chrome language (ledger data stays as recorded). */
  locale?: OwlLocale
}

/**
 * The Audit page — the immutable record.
 *
 * This is the full version of the Command Center's ledger feed: every decision
 * and the grounded evidence behind it, presented as an authoritative, searchable
 * fiduciary ledger. Leads with the summary, keeps the powerful filters but
 * presents them cleanly, then renders events grouped by research case.
 */
export function AuditActivityPanel({ events, filters = {}, locale = 'en' }: AuditActivityPanelProps) {
  panelLocale = locale
  const view = deriveAuditActivityView(events, filters)

  return createElement(
    'section',
    { 'aria-label': dt('au_title'), style: { display: 'grid', gap: 'var(--owl-space-4)' } },
    createElement(RouteHeader, {
      kicker: dt('au_kicker'),
      title: dt('au_title'),
      description: dt('au_desc'),
    }),
    createElement('hr', { className: 'owl-rule' }),
    createElement(AuditLedgerLine, { events, filterOptions: view.filterOptions, shownCount: view.events.length }),
    // The view toggle: the curated decision trail is the default; the full record is one click away
    // (a curated VIEW, never a curated ledger).
    createElement(
      'p',
      { className: 'owl-row-helper', style: { alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', margin: 0 } },
      view.effectiveView === 'decisions' ? dt('au_view_decisions_note') : dt('au_view_full_note'),
      view.effectiveView === 'decisions'
        ? createElement('a', { className: 'owl-focusable', href: '/audit?view=full', style: traceLinkStyle }, dt('au_view_full_link'))
        : createElement('a', { className: 'owl-focusable', href: '/audit', style: traceLinkStyle }, dt('au_view_decisions_link')),
    ),
    createElement(AuditActivityFiltersForm, { filters, filterOptions: view.filterOptions, activeFilters: view.activeFilters }),
    view.events.length === 0
      ? createElement(
        'p',
        { className: 'owl-body' },
        events.length === 0 ? dt('au_empty_none') : dt('au_empty_filtered'),
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
    { label: dt('au_stat_events'), value: hasEvents ? countsText(events.length) : '—' },
    { label: dt('au_stat_shown'), value: hasEvents ? countsText(shownCount) : '—' },
    { label: dt('au_stat_cases'), value: hasEvents ? countsText(caseCount) : '—' },
    { label: dt('au_stat_types'), value: hasEvents ? countsText(filterOptions.eventTypes.length) : '—' },
    { label: dt('au_stat_actors'), value: hasEvents ? countsText(filterOptions.actors.length) : '—' },
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

/**
 * The filter bar (polish, owner-requested 2026-07-18): a COMPACT sticky card that follows the
 * scroll — the two search fields + actions always at hand, the technical filters (ids, type,
 * actor, dates, schema) behind one Advanced toggle, and the active-filter chips riding along so
 * the reader always knows what the trail is filtered on. Pure CSS sticky, no client JS.
 */
function AuditActivityFiltersForm({ filters, filterOptions, activeFilters }: {
  filters: AuditActivityFilters
  filterOptions: ReturnType<typeof deriveAuditActivityView>['filterOptions']
  activeFilters: string[]
}) {
  // Open the technical filters when any of them is active — a filtered view must show its controls.
  const advancedActive = [filters.eventId, filters.correlationId, filters.sourceId, filters.eventType, filters.actor, filters.dateFrom, filters.dateTo, filters.schemaVersion]
    .some((value) => value !== undefined && value !== '')

  return createElement(
    'section',
    {
      className: 'owl-section-card',
      style: { gap: 'var(--owl-space-2)', position: 'sticky', top: '0.6rem', zIndex: 20 },
    },
    createElement('p', { className: 'owl-section-accent' }, dt('au_filter_accent')),
    createElement(
      'form',
      { action: '/audit', method: 'get', style: { display: 'grid', gap: '0.7rem', margin: 0 } },
      // Primary row: the two searches + actions, always visible.
      createElement(
        'div',
        { style: { alignItems: 'flex-end', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
        filterInput(dt('au_f_query'), 'q', filters.query ?? '', 'event JSON, ticker, report ID, payload field', undefined, { flex: '2 1 240px' }),
        filterInput(dt('au_f_entity'), 'entity', filters.entity ?? '', 'MSFT, holding ID, event ID', undefined, { flex: '1 1 180px' }),
        createElement('button', { className: 'owl-button owl-button-primary owl-focusable', type: 'submit' }, dt('au_apply')),
        createElement('a', { className: 'owl-button owl-button-secondary owl-focusable', href: '/audit' }, dt('au_clear')),
      ),
      // The technical filters, one toggle away (open whenever one is active).
      createElement(
        'details',
        advancedActive ? { open: true } : {},
        createElement('summary', { style: advancedSummaryStyle }, dt('au_advanced')),
        createElement(
          'div',
          { style: { ...filterFormStyle, marginTop: '0.6rem' } },
          filterInput(dt('au_f_event_id'), 'event_id', filters.eventId ?? '', 'evt_...'),
          filterInput(dt('au_f_correlation'), 'correlation_id', filters.correlationId ?? '', 'corr_...'),
          filterInput(dt('au_f_source'), 'source_id', filters.sourceId ?? '', 'src_ or evt_...'),
          filterSelect(dt('au_f_type'), 'event_type', filters.eventType ?? '', filterOptions.eventTypes, dt('au_all_types')),
          filterSelect(dt('au_f_actor'), 'actor', filters.actor ?? '', filterOptions.actors, dt('au_all_actors')),
          filterInput(dt('au_f_from'), 'date_from', filters.dateFrom ?? '', 'YYYY-MM-DD', 'date'),
          filterInput(dt('au_f_to'), 'date_to', filters.dateTo ?? '', 'YYYY-MM-DD', 'date'),
          filterSelect(dt('au_f_order'), 'time_order', filters.timeOrder ?? 'asc', ['asc', 'desc'], dt('au_order_asc')),
          filterSelect(dt('au_f_schema'), 'schema_version', filters.schemaVersion ?? '', filterOptions.schemaVersions, dt('au_all_schema')),
        ),
      ),
    ),
    createElement(ActiveAuditFilters, { activeFilters }),
  )
}

function ActiveAuditFilters({ activeFilters }: { activeFilters: string[] }) {
  if (activeFilters.length === 0) {
    return null
  }

  return createElement(
    'section',
    { 'aria-label': 'Active audit filters', style: { display: 'grid', gap: '0.5rem' } },
    createElement('p', { style: detailTermStyle }, dt('au_active')),
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
        createElement('span', { className: 'owl-section-accent' }, dt('au_group_case')),
        createElement('span', { className: 'owl-section-title' }, group.ticker),
        createElement('span', { style: timestampStyle }, `${group.event_count} ${group.event_count === 1 ? dt('au_ev_one') : dt('au_ev_many')} · ${dateStr}`),
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
        createElement('span', { className: 'owl-section-accent' }, dt('au_group_other')),
        createElement('span', { className: 'owl-section-title', style: { color: 'var(--owl-color-muted)' } }, dt('au_group_other_title')),
      ),
      createElement('span', { style: timestampStyle }, `${events.length} ${events.length === 1 ? dt('au_ev_one') : dt('au_ev_many')}`),
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

/**
 * Irreversibility flag (UI-continuity Rule 2: irreversibility flags rendered). User-authored events are
 * human-authored irreversible transitions; provider/worker/system events are drafts or observations that
 * never advance state on their own. Read straight from the actor category — the ledger's authorship.
 */
function IrreversibilityBadge({ category }: { category: ActorCategory }) {
  const irreversible = category === 'user'
  const style: CSSProperties = {
    ...ACTOR_BADGE_BASE,
    background: irreversible ? 'rgba(214, 178, 94, 0.16)' : 'rgba(148, 163, 184, 0.08)',
    border: `1px solid ${irreversible ? 'rgba(214, 178, 94, 0.36)' : 'rgba(148, 163, 184, 0.2)'}`,
    color: irreversible ? 'var(--owl-color-gold-bright)' : 'var(--owl-color-quiet)',
  }
  return createElement(
    'span',
    { 'data-irreversible': irreversible ? 'true' : 'false', style, title: irreversible ? 'Human-authored irreversible transition' : 'Draft or observation — never advances state on its own' },
    irreversible ? 'human-authored' : 'draft / observation',
  )
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
        createElement(IrreversibilityBadge, { category: event.actor_category }),
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

function filterInput(label: string, name: string, value: string, placeholder: string, type?: string, layout?: CSSProperties) {
  return createElement(
    'label',
    { style: layout === undefined ? filterLabelStyle : { ...filterLabelStyle, ...layout } },
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
