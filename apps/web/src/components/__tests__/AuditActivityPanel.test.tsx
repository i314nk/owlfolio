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

    const html = renderToStaticMarkup(createElement(AuditActivityPanel, { events, filters: { entity: 'MSFT' }, mode: 'personal-local' }))

    expect(html).toContain('Audit activity')
    expect(html).toContain('Personal local ledger event stream')
    expect(html).toContain('name="event_type"')
    expect(html).toContain('name="actor"')
    expect(html).toContain('name="entity"')
    expect(html).toContain('name="time_order"')
    expect(html).toContain('data-event-id="evt_same_label_a"')
    expect(html).not.toContain('data-event-id="evt_same_label_b"')
    expect(html).toContain('Research case created for MSFT')
    expect(html).toContain('Raw event type')
    expect(html).toContain('research_case_created')
    expect(html).toContain('<details')
    expect(html).toContain('aria-label="Copyable event ID evt_same_label_a"')
    expect(html).toContain('href="#evt_source"')
    expect(html).toContain('href="#evt_parent"')
    expect(html).toContain('Raw ledger event JSON')
  })
})
