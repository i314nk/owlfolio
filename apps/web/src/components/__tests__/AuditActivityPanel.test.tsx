import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'

import { AuditActivityPanel } from '../AuditActivityPanel'
import { getAuditActivityEventsFromStore } from '../../lib/audit'

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

  it('renders each row with stable event identity even when human-readable labels repeat', async () => {
    const events = await getAuditActivityEventsFromStore(storeWith([
      event({ event_id: 'evt_same_label_a', aggregate_id: 'rc_duplicate_a' }),
      event({ event_id: 'evt_same_label_b', aggregate_id: 'rc_duplicate_b' }),
    ]))

    const html = renderToStaticMarkup(createElement(AuditActivityPanel, { events, mode: 'personal-local' }))

    expect(html).toContain('Audit activity')
    expect(html).toContain('Personal local ledger event stream')
    expect(html).toContain('data-event-id="evt_same_label_a"')
    expect(html).toContain('data-event-id="evt_same_label_b"')
    expect(html).toContain('research_case_created')
    expect(html).toContain('research_case / rc_duplicate_a')
    expect(html).toContain('research_case / rc_duplicate_b')
    expect(html).toContain('user:user_local')
  })
})
