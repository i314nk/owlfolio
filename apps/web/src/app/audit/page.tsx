import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { AuditActivityPanel } from '../../components/AuditActivityPanel'
import { AuditSearchFocusBridge } from '../../components/AuditSearchFocusBridge'
import { UnconfiguredNotice } from '../../components/UnconfiguredNotice'
import { isUnconfiguredForUser } from '../../lib/modeView'
import { getOnboardingState, type OnboardingState } from '../../lib/onboarding'
import { getAuditActivityEventsFromStore, type AuditActivityFilters } from '../../lib/audit'

type AuditPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const state = await getOnboardingState()
  if (isUnconfiguredForUser(state.config)) {
    return <UnconfiguredNotice feature="Audit" />
  }
  const events = await loadAuditActivity(state)
  const params = await searchParams
  const filters = parseAuditActivityFilters(params)
  const focusSearchInput = isFocusSearchParam(params?.focus)

  return (
    <main className="owl-route-frame owl-route-frame-wide">
      <p className="owl-route-back-row">
        <a className="owl-back-link owl-focusable" href="/">
          ← Back to command center
        </a>
      </p>
      <AuditSearchFocusBridge focusSearchInput={focusSearchInput} />
      <AuditActivityPanel events={events} filters={filters} />
    </main>
  )
}

async function loadAuditActivity(state: OnboardingState) {
  if (state.config.ledger_path === undefined) {
    return []
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    return await getAuditActivityEventsFromStore(store)
  } finally {
    store.close()
  }
}

function parseAuditActivityFilters(params: Record<string, string | string[] | undefined> | undefined): AuditActivityFilters {
  const correlationId = firstParam(params?.correlation_id)
  const dateFrom = firstParam(params?.date_from)
  const dateTo = firstParam(params?.date_to)
  const eventId = firstParam(params?.event_id)
  const eventType = firstParam(params?.event_type)
  const actor = firstParam(params?.actor)
  const entity = firstParam(params?.entity)
  const query = firstParam(params?.q)
  const schemaVersion = firstParam(params?.schema_version)
  const sourceId = firstParam(params?.source_id)
  const timeOrder = firstParam(params?.time_order) === 'desc' ? 'desc' : 'asc'

  const filters: AuditActivityFilters = { timeOrder }
  if (correlationId !== undefined) {
    filters.correlationId = correlationId
  }
  if (dateFrom !== undefined) {
    filters.dateFrom = dateFrom
  }
  if (dateTo !== undefined) {
    filters.dateTo = dateTo
  }
  if (eventId !== undefined) {
    filters.eventId = eventId
  }
  if (eventType !== undefined) {
    filters.eventType = eventType
  }
  if (actor !== undefined) {
    filters.actor = actor
  }
  if (entity !== undefined) {
    filters.entity = entity
  }
  if (query !== undefined) {
    filters.query = query
  }
  if (schemaVersion !== undefined) {
    filters.schemaVersion = schemaVersion
  }
  if (sourceId !== undefined) {
    filters.sourceId = sourceId
  }

  return filters
}

function firstParam(value: string | string[] | undefined): string | undefined {
  const rawValue = Array.isArray(value) ? value[0] : value
  const trimmed = rawValue?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

function isFocusSearchParam(value: string | string[] | undefined): boolean {
  const rawValue = firstParam(value)
  const normalized = rawValue?.toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}
