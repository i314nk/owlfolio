import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import {
  projectPurificationLedger,
  type PurificationLedgerProjection,
  type PurificationObligationProjection,
  type PurificationPaymentProjection,
} from '@owlfolio/ledger/projections/purificationProjection'
import {
  projectQuarterlyPurificationStatement,
  projectExitPurificationFinalizations,
  type QuarterlyPurificationStatement,
  type ExitPurificationFinalization,
} from '@owlfolio/ledger/projections/purificationStatement'
import {
  projectZakatStatement,
  type ZakatStatement,
  type ZakatStatementOptions,
} from '@owlfolio/ledger/projections/zakatModule'

export type PurificationSummaryCard = {
  currency: string
  owed: number
  paid: number
  remaining: number
}

export type BuildPurificationReportOptions = {
  /** Quarter window for the quarterly purification statement. Defaults to the current calendar quarter. */
  statement_period_start?: string
  statement_period_end?: string
  /** Optional user-authored zakat methodology setting; when present a zakat statement is computed. */
  zakat?: ZakatStatementOptions
}

export type AppPurificationReport = {
  summary_cards: PurificationSummaryCard[]
  obligations: PurificationObligationProjection[]
  payments: PurificationPaymentProjection[]
  quarterly_statement?: QuarterlyPurificationStatement
  exit_finalizations?: ExitPurificationFinalization[]
  zakat_statement?: ZakatStatement
  limitations: string[]
}

const defaultLimitations = [
  'Payments are recorded only from explicit user-entered purification_payment_recorded ledger events; Owlfolio never marks an obligation paid automatically.',
  'Purification inputs are manual/accounting-derived placeholders until full dividend and non-compliant revenue modeling is implemented.',
  'Obligation amounts depend on the Shariah source evidence and accounting snapshots linked on each ledger event.',
]

export async function getPurificationReportFromStore(
  store: EventStore,
  options?: BuildPurificationReportOptions,
): Promise<AppPurificationReport> {
  return buildPurificationReport(await store.list(), options)
}

function currentQuarterWindow(): { period_start: string; period_end: string } {
  const now = new Date()
  const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3
  const start = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth + 3, 0))
  return { period_start: start.toISOString().slice(0, 10), period_end: end.toISOString().slice(0, 10) }
}

export function buildPurificationReport(
  events: LedgerEventEnvelope<unknown>[],
  options?: BuildPurificationReportOptions,
): AppPurificationReport {
  const ledger = projectPurificationLedger(events)
  const quarter = currentQuarterWindow()
  const periodStart = options?.statement_period_start ?? quarter.period_start
  const periodEnd = options?.statement_period_end ?? quarter.period_end
  const quarterly_statement = projectQuarterlyPurificationStatement(events, {
    period_start: periodStart,
    period_end: periodEnd,
  })
  const exit_finalizations = projectExitPurificationFinalizations(events)
  const zakat_statement = options?.zakat === undefined ? undefined : projectZakatStatement(events, options.zakat)

  return {
    summary_cards: summaryCards(ledger),
    obligations: [...ledger.obligations].sort((left, right) => right.period_end.localeCompare(left.period_end) || left.obligation_id.localeCompare(right.obligation_id)),
    payments: [...ledger.payments].sort((left, right) => right.paid_at.localeCompare(left.paid_at) || left.payment_id.localeCompare(right.payment_id)),
    quarterly_statement,
    exit_finalizations,
    ...(zakat_statement === undefined ? {} : { zakat_statement }),
    limitations: defaultLimitations,
  }
}

function summaryCards(ledger: PurificationLedgerProjection): PurificationSummaryCard[] {
  return Object.entries(ledger.summary_by_currency)
    .map(([currency, summary]) => ({ currency, ...summary }))
    .sort((left, right) => left.currency.localeCompare(right.currency))
}
