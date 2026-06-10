import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import {
  projectAccountingSnapshot,
  projectRecordedAccountingSnapshots,
  type AccountingSnapshotProjection,
} from '@owlfolio/ledger/projections/accountingProjection'
import type { EventStore } from '@owlfolio/ledger/eventStore'

import { humanizeCronProse } from './schedule'

export type AppAccountingReport = {
  current_period_snapshot: AccountingSnapshotProjection
  snapshot_history: AccountingSnapshotProjection[]
  limitations: string[]
  next_scheduled_update?: string
}

export type AccountingPeriodClock = {
  now?: Date
  currency?: string
}

const defaultLimitations = [
  'Accounting is rebuilt from valuation, cash-flow, dividend, fee, and realized gain/loss ledger events; manual snapshots are fallback/override audit records only.',
  'Cash, deposit, withdrawal, dividend, and fee totals appear only when matching ledger events exist for the period.',
  'Broker sync is not connected for this local alpha; values remain local ledger accounting aids, not broker statements or tax reports.',
]

const nextScheduledUpdate = humanizeCronProse('valuation refresh cadence 0 7 * * 1-5; accounting recalculates from ledger events on load')

const derivedAccountingEventTypes = new Set([
  'holding_opened',
  'holding_valuation_recorded',
  'holding_realized_gain_loss_recorded',
  'cash_deposited',
  'cash_withdrawn',
  'dividend_income_recorded',
  'fee_charged',
])

export async function getAccountingReportFromStore(store: EventStore, options: AccountingPeriodClock = {}): Promise<AppAccountingReport> {
  return buildMonthlyAccountingReport(await store.list(), options)
}

export function buildMonthlyAccountingReport(
  events: LedgerEventEnvelope<unknown>[],
  { now = new Date(), currency = 'USD' }: AccountingPeriodClock = {},
): AppAccountingReport {
  const period = monthPeriodFor(now)
  const recordedSnapshots = projectRecordedAccountingSnapshots(events)
    .filter((snapshot) => snapshot.currency === currency)
    .sort((left, right) => right.period_end.localeCompare(left.period_end) || right.updated_at.localeCompare(left.updated_at))
  const recordedCurrentPeriodSnapshot = recordedSnapshots.find((snapshot) => (
    snapshot.period_start === period.period_start && snapshot.period_end === period.period_end
  ))
  const currentPeriodRawEvents = events.filter((event) => (
    isDerivedAccountingEventForCurrency(event, currency)
    && accountingEventDate(event) <= period.period_end
  ))
  const shouldRebuildFromLedger = currentPeriodRawEvents.length > 0
  const currentPeriodSnapshot = shouldRebuildFromLedger
    ? projectAccountingSnapshot(events, {
        snapshot_id: `acct_${period.year}_${period.month}`,
        period_start: period.period_start,
        period_end: period.period_end,
        currency,
        recorded_at: latestEventTimestamp(currentPeriodRawEvents) ?? now.toISOString(),
      })
    : (recordedCurrentPeriodSnapshot ?? projectAccountingSnapshot(events, {
        snapshot_id: `acct_${period.year}_${period.month}`,
        period_start: period.period_start,
        period_end: period.period_end,
        currency,
        recorded_at: now.toISOString(),
      }))

  const snapshotHistory = shouldRebuildFromLedger
    ? [
        currentPeriodSnapshot,
        ...recordedSnapshots.filter((snapshot) => snapshot.snapshot_id !== currentPeriodSnapshot.snapshot_id),
      ]
    : (recordedCurrentPeriodSnapshot === undefined
        ? [
            currentPeriodSnapshot,
            ...recordedSnapshots.filter((snapshot) => snapshot.snapshot_id !== currentPeriodSnapshot.snapshot_id),
          ]
        : recordedSnapshots)

  return {
    current_period_snapshot: currentPeriodSnapshot,
    snapshot_history: snapshotHistory,
    limitations: defaultLimitations,
    next_scheduled_update: nextScheduledUpdate,
  }
}

function isDerivedAccountingEventForCurrency(event: LedgerEventEnvelope<unknown>, currency: string): boolean {
  if (!derivedAccountingEventTypes.has(event.event_type)) {
    return false
  }
  if (event.payload === null || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    return false
  }
  const eventCurrency = (event.payload as Record<string, unknown>).currency
  return eventCurrency === currency
}

function accountingEventDate(event: LedgerEventEnvelope<unknown>): string {
  if (event.payload === null || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    return event.created_at.slice(0, 10)
  }
  const payload = event.payload as Record<string, unknown>
  const dateKeyByType: Record<string, string> = {
    cash_deposited: 'deposited_at',
    cash_withdrawn: 'withdrawn_at',
    dividend_income_recorded: 'received_at',
    fee_charged: 'charged_at',
    holding_opened: 'opened_at',
    holding_realized_gain_loss_recorded: 'realized_at',
    holding_valuation_recorded: 'valued_at',
  }
  const dateKey = dateKeyByType[event.event_type]
  const eventDate = dateKey === undefined ? undefined : payload[dateKey]
  return typeof eventDate === 'string' && eventDate.length > 0 ? eventDate : event.created_at.slice(0, 10)
}

function latestEventTimestamp(events: LedgerEventEnvelope<unknown>[]): string | undefined {
  return events.reduce<string | undefined>((latest, event) => (
    latest === undefined || event.created_at > latest ? event.created_at : latest
  ), undefined)
}

export function monthPeriodFor(date: Date): { year: string; month: string; period_start: string; period_end: string } {
  const yearNumber = date.getUTCFullYear()
  const monthNumber = date.getUTCMonth()
  const periodStart = new Date(Date.UTC(yearNumber, monthNumber, 1))
  const periodEnd = new Date(Date.UTC(yearNumber, monthNumber + 1, 0))

  return {
    year: String(yearNumber),
    month: String(monthNumber + 1).padStart(2, '0'),
    period_start: periodStart.toISOString().slice(0, 10),
    period_end: periodEnd.toISOString().slice(0, 10),
  }
}
