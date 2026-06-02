import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'

import { AuditActivityPanel } from '../../components/AuditActivityPanel'
import { getDemoEvents } from '../../lib/demo'
import { getOnboardingState, type OnboardingState } from '../../lib/onboarding'
import { getAuditActivityEventsFromStore, projectAuditActivityEvents, type AuditActivityFilters } from '../../lib/audit'

type AuditPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const state = await getOnboardingState()
  const events = await loadAuditActivity(state)
  const filters = parseAuditActivityFilters(await searchParams)

  return (
    <main style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)', color: '#0f172a', minHeight: '100vh', padding: '3rem clamp(1rem, 4vw, 4rem)' }}>
      <div style={{ margin: '0 auto', maxWidth: '1040px' }}>
        <p style={{ margin: '0 0 1rem' }}>
          <a href="/" style={{ color: '#047857', fontWeight: 800, textDecoration: 'none' }}>
            ← Back to command center
          </a>
        </p>
        <AuditActivityPanel events={events} filters={filters} mode={state.config.mode} />
      </div>
    </main>
  )
}

async function loadAuditActivity(state: OnboardingState) {
  if (state.config.mode === 'demo') {
    return projectAuditActivityEvents(await getDemoEvents())
  }

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
  const eventType = firstParam(params?.event_type)
  const actor = firstParam(params?.actor)
  const entity = firstParam(params?.entity)
  const query = firstParam(params?.q)
  const timeOrder = firstParam(params?.time_order) === 'desc' ? 'desc' : 'asc'

  const filters: AuditActivityFilters = { timeOrder }
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

  return filters
}

function firstParam(value: string | string[] | undefined): string | undefined {
  const rawValue = Array.isArray(value) ? value[0] : value
  const trimmed = rawValue?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}
