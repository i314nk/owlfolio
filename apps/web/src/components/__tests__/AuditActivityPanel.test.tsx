import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'

import { AuditActivityPanel } from '../AuditActivityPanel'
import { deriveAuditActivityView, getAuditActivityEventsFromStore } from '../../lib/audit'

function event(
  overrides: Partial<LedgerEventEnvelope<Record<string, unknown>>>,
  options: { withoutActorId?: boolean } = {},
): LedgerEventEnvelope<Record<string, unknown>> {
  const ledgerEvent: LedgerEventEnvelope<Record<string, unknown>> = {
    event_id: 'evt_default',
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: 'rc_default',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: {},
    source_ids: [],
    created_at: '2026-05-31T12:00:00.000Z',
    schema_version: 1,
    ...overrides,
  }

  if (options.withoutActorId === true) {
    delete ledgerEvent.actor_id
  }

  return ledgerEvent
}

function storeWith(events: LedgerEventEnvelope<unknown>[]): EventStore {
  return {
    append: async (eventToAppend) => eventToAppend,
    list: async () => events,
    listByAggregate: async () => [],
  }
}

describe('generic audit activity', () => {
  it('projects ledger events chronologically without depending on domain projections', async () => {
    const events = await getAuditActivityEventsFromStore(storeWith([
      event({
        event_id: 'evt_same_label_b',
        aggregate_id: 'rc_duplicate_b',
        created_at: '2026-05-31T12:00:00.000Z',
      }),
      event({
        event_id: 'evt_first',
        event_type: 'decision_drafted',
        aggregate_type: 'decision',
        aggregate_id: 'decision_001',
        actor_type: 'system',
        source_ids: ['src_10k'],
        created_at: '2026-05-30T08:00:00.000Z',
      }, { withoutActorId: true }),
      event({
        event_id: 'evt_same_label_a',
        aggregate_id: 'rc_duplicate_a',
        created_at: '2026-05-31T12:00:00.000Z',
      }),
    ]))

    expect(events.map((activityEvent) => activityEvent.event_id)).toEqual([
      'evt_first',
      'evt_same_label_a',
      'evt_same_label_b',
    ])
    expect(events[0]).toMatchObject({
      actor_label: 'system',
      aggregate_label: 'decision / decision_001',
      source_count: 1,
    })
  })

  it('projects human summaries, raw evidence, and causal relationships without inventing state', async () => {
    const events = await getAuditActivityEventsFromStore(storeWith([
      event({
        event_id: 'evt_gate_decision',
        event_type: 'shariah_gate_decision_recorded',
        aggregate_type: 'decision',
        aggregate_id: 'decision_msft_001',
        causation_id: 'evt_analysis_msft',
        correlation_id: 'corr_msft_research',
        payload: {
          ticker: 'MSFT',
          before: { status: 'draft' },
          after: { status: 'approved' },
          allowed: true,
        },
        source_ids: ['evt_analysis_msft'],
      }),
    ]))

    expect(events[0]).toMatchObject({
      event_summary: 'Shariah gate decision recorded for MSFT on decision / decision_msft_001',
      entity_label: 'MSFT',
      causation_id: 'evt_analysis_msft',
      correlation_id: 'corr_msft_research',
      source_ids: ['evt_analysis_msft'],
    })
    expect(events[0]?.raw_event_json).toContain('"event_type": "shariah_gate_decision_recorded"')
    expect(events[0]?.context_explanation).toContain('Before → after payload is present')
  })

  it('summarizes a live-run progress breadcrumb honestly (observability, not a decision)', async () => {
    const events = await getAuditActivityEventsFromStore(storeWith([
      event({
        event_id: 'evt_progress_1',
        event_type: 'research_run_progress_recorded',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_msft_001',
        payload: { research_case_id: 'rc_msft_001', lane: 'moat', message: 'read_source sec_10k §7 → verified', ticker: 'MSFT' },
      }),
    ]))
    expect(events[0]?.event_summary).toBe('Run progress — moat · read_source sec_10k §7 → verified')
  })

  it('defaults to the decision trail: user transitions + decision-grade milestones stay, machinery drops', async () => {
    const events = await getAuditActivityEventsFromStore(storeWith([
      event({ event_id: 'evt_user_open', event_type: 'holding_opened', actor_type: 'user' }),
      event({ event_id: 'evt_gate', event_type: 'shariah_gate_judged', actor_type: 'provider' }),
      event({ event_id: 'evt_fail', event_type: 'research_run_failed', actor_type: 'worker' }),
      event({ event_id: 'evt_progress', event_type: 'research_run_progress_recorded', actor_type: 'worker', payload: { lane: 'moat', message: 'x' } }),
      event({ event_id: 'evt_price', event_type: 'price_snapshot_recorded', actor_type: 'worker' }),
    ]))

    const view = deriveAuditActivityView(events)
    expect(view.effectiveView).toBe('decisions')
    expect(view.events.map((e) => e.event_id).sort()).toEqual(['evt_fail', 'evt_gate', 'evt_user_open'])
  })

  it('a targeted filter (event id / type / source / query) bypasses the curation so trace links always resolve', async () => {
    const events = await getAuditActivityEventsFromStore(storeWith([
      event({ event_id: 'evt_progress', event_type: 'research_run_progress_recorded', actor_type: 'worker', payload: { lane: 'moat', message: 'x' } }),
    ]))

    const byId = deriveAuditActivityView(events, { eventId: 'evt_progress' })
    expect(byId.effectiveView).toBe('full')
    expect(byId.events).toHaveLength(1)

    const byType = deriveAuditActivityView(events, { eventType: 'research_run_progress_recorded' })
    expect(byType.events).toHaveLength(1)
  })

  it('view=full shows every event, exactly as written', async () => {
    const events = await getAuditActivityEventsFromStore(storeWith([
      event({ event_id: 'evt_user_open', event_type: 'holding_opened', actor_type: 'user' }),
      event({ event_id: 'evt_progress', event_type: 'research_run_progress_recorded', actor_type: 'worker', payload: { lane: 'moat', message: 'x' } }),
    ]))

    const view = deriveAuditActivityView(events, { view: 'full' })
    expect(view.effectiveView).toBe('full')
    expect(view.events).toHaveLength(2)
  })

  it('renders the view toggle: decision-trail note with a full-record link by default, and the way back in full mode', async () => {
    const events = await getAuditActivityEventsFromStore(storeWith([
      event({ event_id: 'evt_user_open', event_type: 'holding_opened', actor_type: 'user' }),
    ]))

    const decisionsHtml = renderToStaticMarkup(createElement(AuditActivityPanel, { events }))
    expect(decisionsHtml).toContain('Decision trail')
    expect(decisionsHtml).toContain('href="/audit?view=full"')

    const fullHtml = renderToStaticMarkup(createElement(AuditActivityPanel, { events, filters: { view: 'full' } }))
    expect(fullHtml).toContain('Full record')
    expect(fullHtml).toContain('href="/audit"')
  })

  it('presents a compact sticky search bar: search fields up front, technical filters behind Advanced, chips inside', async () => {
    const events = await getAuditActivityEventsFromStore(storeWith([
      event({ event_id: 'evt_user_open', event_type: 'holding_opened', actor_type: 'user' }),
    ]))
    const html = renderToStaticMarkup(createElement(AuditActivityPanel, { events, filters: { entity: 'MSFT' } }))

    // The bar follows the scroll…
    expect(html).toContain('position:sticky')
    // …the two search fields and actions stay up front (outside any details)…
    expect(html).toMatch(/name="q"[\s\S]*?<details/)
    // …while the technical filters live behind the Advanced toggle.
    expect(html).toMatch(/<details[^>]*>(?:(?!<\/details>)[\s\S])*name="actor"/)
    expect(html).toMatch(/<details[^>]*>(?:(?!<\/details>)[\s\S])*name="event_id"/)
    expect(html).toMatch(/<details[^>]*>(?:(?!<\/details>)[\s\S])*name="schema_version"/)
    // Active-filter chips ride inside the sticky bar (visible while scrolled deep).
    expect(html).toMatch(/position:sticky(?:(?!<\/section>)[\s\S])*Active audit filters/)
  })

  it('filters by event type, actor, entity search, and reverses time ordering', async () => {
    const events = await getAuditActivityEventsFromStore(storeWith([
      event({ event_id: 'evt_early_msft', aggregate_id: 'rc_msft_001', payload: { ticker: 'MSFT' }, created_at: '2026-05-30T08:00:00.000Z' }),
      event({ event_id: 'evt_late_aapl', aggregate_id: 'rc_aapl_001', payload: { ticker: 'AAPL' }, actor_type: 'worker', created_at: '2026-05-31T08:00:00.000Z' }, { withoutActorId: true }),
      event({ event_id: 'evt_later_msft', event_type: 'decision_drafted', aggregate_type: 'decision', aggregate_id: 'decision_msft_001', payload: { ticker: 'MSFT' }, created_at: '2026-06-01T08:00:00.000Z' }),
    ]))

    const view = deriveAuditActivityView(events, {
      actor: 'user:user_local',
      entity: 'msft',
      eventType: 'decision_drafted',
      timeOrder: 'desc',
    })

    expect(view.events.map((activityEvent) => activityEvent.event_id)).toEqual(['evt_later_msft'])
    expect(view.filterOptions.eventTypes).toEqual(['decision_drafted', 'research_case_created'])
    expect(view.filterOptions.actors).toContain('user:user_local')
    expect(view.filterOptions.entities).toContain('MSFT')
  })

  it('filters by trace IDs, schema version, and date range while explaining active filters', async () => {
    const events = await getAuditActivityEventsFromStore(storeWith([
      event({
        event_id: 'evt_old_msft_source',
        correlation_id: 'corr_msft_research',
        payload: { ticker: 'MSFT' },
        source_ids: ['src_msft_10k'],
        created_at: '2026-05-29T08:00:00.000Z',
      }),
      event({
        event_id: 'evt_target_msft_decision',
        event_type: 'decision_drafted',
        aggregate_type: 'decision',
        aggregate_id: 'decision_msft_001',
        correlation_id: 'corr_msft_research',
        causation_id: 'evt_old_msft_source',
        payload: { ticker: 'MSFT' },
        source_ids: ['src_msft_10k'],
        created_at: '2026-06-01T08:00:00.000Z',
        schema_version: 2,
      }),
      event({
        event_id: 'evt_other_corr',
        event_type: 'decision_drafted',
        aggregate_type: 'decision',
        aggregate_id: 'decision_aapl_001',
        correlation_id: 'corr_aapl_research',
        payload: { ticker: 'AAPL' },
        source_ids: ['src_aapl_10k'],
        created_at: '2026-06-02T08:00:00.000Z',
        schema_version: 2,
      }),
    ]))

    const view = deriveAuditActivityView(events, {
      correlationId: 'corr_msft',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-01',
      eventId: 'target',
      schemaVersion: '2',
      sourceId: 'src_msft_10k',
      timeOrder: 'desc',
    })

    expect(view.events.map((activityEvent) => activityEvent.event_id)).toEqual(['evt_target_msft_decision'])
    expect(view.filterOptions.schemaVersions).toEqual(['1', '2'])
    expect(view.activeFilters).toEqual([
      'Event ID contains target',
      'Correlation ID contains corr_msft',
      'Source ID contains src_msft_10k',
      'Schema v2',
      'From 2026-06-01',
      'To 2026-06-01',
      'Newest first',
    ])
  })

  it('renders search controls and expandable evidence with stable event identity', async () => {
    const events = await getAuditActivityEventsFromStore(storeWith([
      event({
        event_id: 'evt_same_label_a',
        aggregate_id: 'rc_duplicate_a',
        causation_id: 'evt_parent',
        source_ids: ['evt_source'],
        payload: { ticker: 'MSFT' },
      }),
      event({ event_id: 'evt_same_label_b', aggregate_id: 'rc_duplicate_b' }),
    ]))

    const html = renderToStaticMarkup(createElement(AuditActivityPanel, {
      events,
      filters: {
        dateFrom: '2026-05-31',
        entity: 'MSFT',
        eventId: 'same_label_a',
        schemaVersion: '1',
        sourceId: 'evt_source',
        timeOrder: 'desc',
      },
    }))

    expect(html).toContain('Audit activity')
    expect(html).toContain('Personal local ledger event stream')
    expect(html).toContain('name="event_type"')
    expect(html).toContain('name="actor"')
    expect(html).toContain('name="entity"')
    expect(html).toContain('name="q"')
    expect(html).toContain('name="event_id"')
    expect(html).toContain('name="correlation_id"')
    expect(html).toContain('name="source_id"')
    expect(html).toContain('name="schema_version"')
    expect(html).toContain('name="date_from"')
    expect(html).toContain('name="date_to"')
    expect(html).toContain('name="time_order"')
    expect(html).toContain('Active audit filters')
    expect(html).toContain('Event ID contains same_label_a')
    expect(html).toContain('Source ID contains evt_source')
    expect(html).toContain('Newest first')
    expect(html).toContain('data-event-id="evt_same_label_a"')
    expect(html).not.toContain('data-event-id="evt_same_label_b"')
    expect(html).toContain('Research case created for MSFT')
    expect(html).toContain('Event ID')
    expect(html).toContain('evt_same_label_a')
    expect(html).toContain('Raw event type')
    expect(html).toContain('research_case_created')
    expect(html).toContain('Aggregate ID')
    expect(html).toContain('rc_duplicate_a')
    expect(html).toContain('Causation / parent event')
    expect(html).toContain('Source / parent links')
    expect(html).toContain('Schema version')
    expect(html).toContain('<details')
    expect(html).toContain('aria-label="Copyable event ID evt_same_label_a"')
    expect(html).toContain('aria-label="Copyable source ID evt_source"')
    expect(html).toContain('href="/audit?source_id=evt_source"')
    expect(html).toContain('href="/audit?event_id=evt_parent#evt_parent"')
    expect(html).not.toContain('href="#evt_source"')
    expect(html).not.toContain('href="#evt_parent"')
    expect(html).toContain('Raw ledger event JSON')
    expect(html).toContain('Audit copy kit')
    expect(html).not.toContain('payload value, source ID, schema')
    expect(html).not.toContain('#047857')
    expect(html).not.toContain('#ecfdf5')
    expect(html).not.toContain('#f0fdf4')
  })

  it('defaults the page chrome to English when no locale is given', async () => {
    const html = renderToStaticMarkup(createElement(AuditActivityPanel, { events: [] }))
    expect(html).toContain('Audit activity')
    expect(html).toContain('No ledger events recorded yet.')
    expect(html).not.toContain('نشاط التدقيق')
  })
})
