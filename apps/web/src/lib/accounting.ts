import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import {
  projectAccountingSnapshot,
  projectRecordedAccountingSnapshots,
  type AccountingSnapshotProjection,
} from '@owlfolio/ledger/projections/accountingProjection'
import type { EventStore } from '@owlfolio/ledger/eventStore'

export type AppAccountingReport = {
  current_period_snapshot: AccountingSnapshotProjection
  snapshot_history: AccountingSnapshotProjection[]
  limitations: string[]
}

export type AccountingPeriodClock = {
  now?: Date
  currency?: string
}

const defaultLimitations = [
  'Cash, deposits, and withdrawals are placeholders until cash ledger events are modeled.',
  'Fees and dividends are not modeled yet; they remain untracked manual placeholders in this alpha.',
  'NAV currently equals valued holdings plus placeholder cash balance; deposits and withdrawals remain $0.00 until cash flows are added to the ledger.',
]

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
  const currentPeriodSnapshot = recordedCurrentPeriodSnapshot ?? projectAccountingSnapshot(events, {
    snapshot_id: `acct_${period.year}_${period.month}`,
    period_start: period.period_start,
    period_end: period.period_end,
    currency,
    recorded_at: now.toISOString(),
  })

  const snapshotHistory = recordedCurrentPeriodSnapshot === undefined
    ? [
        currentPeriodSnapshot,
        ...recordedSnapshots.filter((snapshot) => snapshot.snapshot_id !== currentPeriodSnapshot.snapshot_id),
      ]
    : recordedSnapshots

  return {
    current_period_snapshot: currentPeriodSnapshot,
    snapshot_history: snapshotHistory,
    limitations: defaultLimitations,
  }
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
