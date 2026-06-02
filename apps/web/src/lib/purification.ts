import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import {
  projectPurificationLedger,
  type PurificationLedgerProjection,
  type PurificationObligationProjection,
  type PurificationPaymentProjection,
} from '@owlfolio/ledger/projections/purificationProjection'

export type PurificationSummaryCard = {
  currency: string
  owed: number
  paid: number
  remaining: number
}

export type AppPurificationReport = {
  summary_cards: PurificationSummaryCard[]
  obligations: PurificationObligationProjection[]
  payments: PurificationPaymentProjection[]
  limitations: string[]
}

const defaultLimitations = [
  'Payments are recorded only from explicit user-entered purification_payment_recorded ledger events; Owlfolio never marks an obligation paid automatically.',
  'Purification inputs are manual/accounting-derived placeholders until full dividend and non-compliant revenue modeling is implemented.',
  'Obligation amounts depend on the Shariah source evidence and accounting snapshots linked on each ledger event.',
]

export async function getPurificationReportFromStore(store: EventStore): Promise<AppPurificationReport> {
  return buildPurificationReport(await store.list())
}

export function buildPurificationReport(events: LedgerEventEnvelope<unknown>[]): AppPurificationReport {
  const ledger = projectPurificationLedger(events)
  return {
    summary_cards: summaryCards(ledger),
    obligations: [...ledger.obligations].sort((left, right) => right.period_end.localeCompare(left.period_end) || left.obligation_id.localeCompare(right.obligation_id)),
    payments: [...ledger.payments].sort((left, right) => right.paid_at.localeCompare(left.paid_at) || left.payment_id.localeCompare(right.payment_id)),
    limitations: defaultLimitations,
  }
}

function summaryCards(ledger: PurificationLedgerProjection): PurificationSummaryCard[] {
  return Object.entries(ledger.summary_by_currency)
    .map(([currency, summary]) => ({ currency, ...summary }))
    .sort((left, right) => left.currency.localeCompare(right.currency))
}
