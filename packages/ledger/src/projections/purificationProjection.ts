import type { LedgerEventEnvelope } from '../eventEnvelope'

export type PurificationObligationStatus = 'unpaid' | 'partially_paid' | 'paid' | 'overpaid'

export type PurificationObligationInput = {
  obligation_id: string
  holding_id: string
  amount: number
  currency: string
  period_start: string
  period_end: string
  reason?: string
  shariah_evaluation_id?: string
  accounting_snapshot_id?: string
}

export type PurificationPaymentInput = {
  payment_id: string
  obligation_id: string
  amount: number
  currency: string
  paid_at: string
  recipient: string
  note?: string
}

export type PurificationObligationProjection = PurificationObligationInput & {
  recorded_at: string
  shariah_status?: string
  shariah_policy_basis?: string
  shariah_source_ids: string[]
  accounting_nav?: number
  accounting_period_end?: string
  accounting_holding_value?: number
  audit_source_ids: string[]
  paid_amount: number
  remaining_amount: number
  status: PurificationObligationStatus
}

export type PurificationPaymentProjection = PurificationPaymentInput & {
  recorded_at: string
  audit_source_ids: string[]
}

export type PurificationCurrencySummary = {
  owed: number
  paid: number
  remaining: number
}

export type PurificationLedgerProjection = {
  obligations: PurificationObligationProjection[]
  payments: PurificationPaymentProjection[]
  summary_by_currency: Record<string, PurificationCurrencySummary>
}

type ShariahEvaluationReference = {
  evaluation_id: string
  holding_id: string
  status?: string
  policy_basis?: string
  source_ids: string[]
}

type AccountingSnapshotReference = {
  snapshot_id: string
  nav?: number
  period_end?: string
  holdings: Record<string, { current_value?: number }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function getNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2))
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function statusFor(amount: number, paid: number): PurificationObligationStatus {
  if (paid <= 0) {
    return 'unpaid'
  }
  if (paid < amount) {
    return 'partially_paid'
  }
  if (paid === amount) {
    return 'paid'
  }
  return 'overpaid'
}

function shariahReferences(events: LedgerEventEnvelope<unknown>[]): Map<string, ShariahEvaluationReference> {
  const references = new Map<string, ShariahEvaluationReference>()

  for (const event of events) {
    if (event.event_type !== 'shariah_evaluation_recorded' || !isRecord(event.payload)) {
      continue
    }
    const evaluationId = getString(event.payload, 'evaluation_id') ?? event.aggregate_id
    const holdingId = getString(event.payload, 'holding_id') ?? event.aggregate_id
    const reference: ShariahEvaluationReference = {
      evaluation_id: evaluationId,
      holding_id: holdingId,
      source_ids: unique([...event.source_ids, ...getStringArray(event.payload.source_ids)]),
    }
    const status = getString(event.payload, 'status')
    if (status !== undefined) {
      reference.status = status
    }
    const policyBasis = getString(event.payload, 'policy_basis')
    if (policyBasis !== undefined) {
      reference.policy_basis = policyBasis
    }
    references.set(evaluationId, reference)
  }

  return references
}

function accountingReferences(events: LedgerEventEnvelope<unknown>[]): Map<string, AccountingSnapshotReference> {
  const references = new Map<string, AccountingSnapshotReference>()

  for (const event of events) {
    if (event.event_type !== 'accounting_snapshot_recorded' || !isRecord(event.payload)) {
      continue
    }
    const snapshotId = getString(event.payload, 'snapshot_id') ?? event.aggregate_id
    const holdings: AccountingSnapshotReference['holdings'] = {}
    const rawHoldings = event.payload.holdings
    if (Array.isArray(rawHoldings)) {
      for (const rawHolding of rawHoldings) {
        if (!isRecord(rawHolding)) {
          continue
        }
        const holdingId = getString(rawHolding, 'holding_id')
        if (holdingId === undefined) {
          continue
        }
        const currentValue = getNumber(rawHolding, 'current_value')
        holdings[holdingId] = currentValue === undefined ? {} : { current_value: currentValue }
      }
    }
    const reference: AccountingSnapshotReference = {
      snapshot_id: snapshotId,
      holdings,
    }
    const nav = getNumber(event.payload, 'nav')
    if (nav !== undefined) {
      reference.nav = nav
    }
    const periodEnd = getString(event.payload, 'period_end')
    if (periodEnd !== undefined) {
      reference.period_end = periodEnd
    }
    references.set(snapshotId, reference)
  }

  return references
}

function projectPayment(event: LedgerEventEnvelope<unknown>): PurificationPaymentProjection | undefined {
  if (event.event_type !== 'purification_payment_recorded' || !isRecord(event.payload)) {
    return undefined
  }
  const paymentId = getString(event.payload, 'payment_id') ?? event.aggregate_id
  const obligationId = getString(event.payload, 'obligation_id') ?? event.aggregate_id
  const amount = getNumber(event.payload, 'amount')
  const currency = getString(event.payload, 'currency')
  const paidAt = getString(event.payload, 'paid_at')
  const recipient = getString(event.payload, 'recipient')
  if (amount === undefined || currency === undefined || paidAt === undefined || recipient === undefined) {
    return undefined
  }
  const note = getString(event.payload, 'note')
  return {
    payment_id: paymentId,
    obligation_id: obligationId,
    amount,
    currency,
    paid_at: paidAt,
    recipient,
    ...(note === undefined ? {} : { note }),
    recorded_at: event.created_at,
    audit_source_ids: [...event.source_ids],
  }
}

export function projectPurificationLedger(events: LedgerEventEnvelope<unknown>[]): PurificationLedgerProjection {
  const shariahByEvaluationId = shariahReferences(events)
  const accountingBySnapshotId = accountingReferences(events)
  const payments = events.flatMap((event) => {
    const payment = projectPayment(event)
    return payment === undefined ? [] : [payment]
  })
  const paymentsByObligation = new Map<string, PurificationPaymentProjection[]>()
  for (const payment of payments) {
    const current = paymentsByObligation.get(payment.obligation_id) ?? []
    current.push(payment)
    paymentsByObligation.set(payment.obligation_id, current)
  }

  const obligations = events.flatMap((event): PurificationObligationProjection[] => {
    if (event.event_type !== 'purification_obligation_recorded' || !isRecord(event.payload)) {
      return []
    }
    const obligationId = getString(event.payload, 'obligation_id') ?? event.aggregate_id
    const holdingId = getString(event.payload, 'holding_id')
    const amount = getNumber(event.payload, 'amount')
    const currency = getString(event.payload, 'currency')
    const periodStart = getString(event.payload, 'period_start')
    const periodEnd = getString(event.payload, 'period_end')
    if (holdingId === undefined || amount === undefined || currency === undefined || periodStart === undefined || periodEnd === undefined) {
      return []
    }

    const shariahEvaluationId = getString(event.payload, 'shariah_evaluation_id')
    const accountingSnapshotId = getString(event.payload, 'accounting_snapshot_id')
    const shariahReference = shariahEvaluationId === undefined ? undefined : shariahByEvaluationId.get(shariahEvaluationId)
    const accountingReference = accountingSnapshotId === undefined ? undefined : accountingBySnapshotId.get(accountingSnapshotId)
    const paidAmount = roundMoney((paymentsByObligation.get(obligationId) ?? [])
      .filter((payment) => payment.currency === currency)
      .reduce((sum, payment) => sum + payment.amount, 0))
    const remainingAmount = Math.max(0, roundMoney(amount - paidAmount))
    const reason = getString(event.payload, 'reason')

    return [{
      obligation_id: obligationId,
      holding_id: holdingId,
      amount,
      currency,
      period_start: periodStart,
      period_end: periodEnd,
      ...(reason === undefined ? {} : { reason }),
      ...(shariahEvaluationId === undefined ? {} : { shariah_evaluation_id: shariahEvaluationId }),
      ...(accountingSnapshotId === undefined ? {} : { accounting_snapshot_id: accountingSnapshotId }),
      recorded_at: event.created_at,
      ...(shariahReference?.status === undefined ? {} : { shariah_status: shariahReference.status }),
      ...(shariahReference?.policy_basis === undefined ? {} : { shariah_policy_basis: shariahReference.policy_basis }),
      shariah_source_ids: shariahReference?.source_ids ?? [],
      ...(accountingReference?.nav === undefined ? {} : { accounting_nav: accountingReference.nav }),
      ...(accountingReference?.period_end === undefined ? {} : { accounting_period_end: accountingReference.period_end }),
      ...(accountingReference?.holdings[holdingId]?.current_value === undefined ? {} : { accounting_holding_value: accountingReference.holdings[holdingId].current_value }),
      audit_source_ids: unique([...event.source_ids, ...(shariahReference?.source_ids ?? [])]),
      paid_amount: paidAmount,
      remaining_amount: remainingAmount,
      status: statusFor(amount, paidAmount),
    }]
  })

  const summary_by_currency: Record<string, PurificationCurrencySummary> = {}
  for (const obligation of obligations) {
    const current = summary_by_currency[obligation.currency] ?? { owed: 0, paid: 0, remaining: 0 }
    current.owed = roundMoney(current.owed + obligation.amount)
    current.paid = roundMoney(current.paid + obligation.paid_amount)
    current.remaining = roundMoney(current.remaining + obligation.remaining_amount)
    summary_by_currency[obligation.currency] = current
  }

  return { obligations, payments, summary_by_currency }
}

export function buildPurificationObligationRecordedEvent(
  input: PurificationObligationInput,
  options: {
    event_id: string
    actor_id: string
    created_at: string
    source_ids?: string[]
  },
): LedgerEventEnvelope<PurificationObligationInput> {
  return {
    event_id: options.event_id,
    event_type: 'purification_obligation_recorded',
    aggregate_type: 'purification_entry',
    aggregate_id: input.obligation_id,
    actor_type: 'worker',
    actor_id: options.actor_id,
    payload: structuredClone(input),
    source_ids: options.source_ids ?? [],
    created_at: options.created_at,
    schema_version: 1,
  }
}

export function buildPurificationPaymentRecordedEvent(
  input: PurificationPaymentInput,
  options: {
    event_id: string
    actor_id: string
    created_at: string
    source_ids?: string[]
  },
): LedgerEventEnvelope<PurificationPaymentInput> {
  return {
    event_id: options.event_id,
    event_type: 'purification_payment_recorded',
    aggregate_type: 'purification_entry',
    aggregate_id: input.obligation_id,
    actor_type: 'user',
    actor_id: options.actor_id,
    payload: structuredClone(input),
    source_ids: options.source_ids ?? [],
    created_at: options.created_at,
    schema_version: 1,
  }
}
