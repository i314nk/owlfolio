import type { LedgerEventEnvelope } from '../eventEnvelope'

export type PurificationObligationStatus = 'unpaid' | 'partially_paid' | 'paid' | 'overpaid'
export type PurificationCalculationMethod = 'dividend_ratio' | 'per_share_impure_income' | 'manual_override'

export type AaoifiDividendPurificationCalculation = {
  calculation_id: string
  holding_id: string
  company_id?: string
  ticker?: string
  company_name?: string
  period_start: string
  period_end: string
  policy_basis: string
  policy_version: string
  standard_reference?: string
  calculation_method: 'dividend_ratio'
  dividend_event_id: string
  dividend_id: string
  dividend_income_amount: number
  non_compliant_income_ratio: number
  purification_ratio: number
  holding_period_basis: string
  purification_amount: number
  currency: string
  shariah_evaluation_id: string
  source_filing_period_start: string
  source_filing_period_end: string
  source_filing_type?: string
  source_filing_date?: string
  evidence_summary?: string
  policy_source_ids: string[]
  source_ids: string[]
  caveats: string[]
  calculated_at: string
  next_calculation_at: string
  requires_user_confirmation: true
  requires_scholar_review: boolean
}

export type PendingPurificationCalculation = {
  status: 'pending'
  holding_id?: string
  dividend_event_id?: string
  dividend_id?: string
  missing_evidence: string[]
  caveats: string[]
}

export type AaoifiDividendPurificationProjection = {
  calculations: AaoifiDividendPurificationCalculation[]
  pending: PendingPurificationCalculation[]
}

export type AaoifiDividendPurificationOptions = {
  as_of: string
  calculated_at: string
}

export type PurificationObligationInput = {
  obligation_id: string
  calculation_id?: string
  holding_id: string
  company_id?: string
  ticker?: string
  company_name?: string
  amount: number
  purification_amount?: number
  currency: string
  period_start: string
  period_end: string
  policy_basis?: string
  policy_version?: string
  standard_reference?: string
  calculation_method?: PurificationCalculationMethod
  reason?: string
  shariah_evaluation_id?: string
  accounting_snapshot_id?: string
  dividend_event_id?: string
  dividend_id?: string
  dividend_income_amount?: number
  non_compliant_income_ratio?: number
  impurity_rate?: number
  purification_ratio?: number
  holding_period_basis?: string
  source_filing_period_start?: string
  source_filing_period_end?: string
  source_filing_type?: string
  source_filing_date?: string
  evidence_summary?: string
  policy_source_ids?: string[]
  source_ids?: string[]
  caveats?: string[]
  calculated_at?: string
  next_calculation_at?: string
  requires_user_confirmation?: boolean
  requires_scholar_review?: boolean
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
  dividend_income_amount?: number
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
  policy_version?: string
  standard_reference?: string
  non_compliant_income_ratio?: number
  source_filing_period_start?: string
  source_filing_period_end?: string
  source_filing_type?: string
  source_filing_date?: string
  evidence_summary?: string
  policy_source_ids: string[]
  source_ids: string[]
  created_at: string
}

type HoldingReference = {
  holding_id: string
  company_id?: string
  ticker?: string
  company_name?: string
  opened_at?: string
  closed_at?: string
}

type AccountingSnapshotReference = {
  snapshot_id: string
  nav?: number
  period_end?: string
  holdings: Record<string, { current_value?: number }>
}

type DividendIncomeReference = {
  event_id: string
  dividend_id: string
  holding_id?: string
  amount?: number
  currency?: string
  received_at?: string
  source_ids: string[]
  created_at: string
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

function getBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key]
  return typeof value === 'boolean' ? value : undefined
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

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function stableIdSuffix(values: string[]): string {
  let hash = 2166136261
  for (const value of values) {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    hash ^= 0xff
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function nextQuarterCalculationAt(asOf: string, calculatedAt: string): string {
  const asOfDate = new Date(`${asOf}T00:00:00.000Z`)
  const calculatedDate = new Date(calculatedAt)
  const asOfMonth = asOfDate.getUTCMonth()
  const nextRunMonth = Math.floor(asOfMonth / 3) * 3 + 6
  const nextRunYear = asOfDate.getUTCFullYear() + Math.floor(nextRunMonth / 12)
  const normalizedMonth = nextRunMonth % 12
  const nextRun = new Date(Date.UTC(nextRunYear, normalizedMonth, 1))
  nextRun.setUTCHours(
    calculatedDate.getUTCHours(),
    calculatedDate.getUTCMinutes(),
    calculatedDate.getUTCSeconds(),
    calculatedDate.getUTCMilliseconds(),
  )
  return nextRun.toISOString()
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
      policy_source_ids: getStringArray(event.payload.policy_source_ids),
      source_ids: unique([...event.source_ids, ...getStringArray(event.payload.source_ids)]),
      created_at: event.created_at,
    }
    const status = getString(event.payload, 'status')
    if (status !== undefined) {
      reference.status = status
    }
    const policyBasis = getString(event.payload, 'policy_basis')
    if (policyBasis !== undefined) {
      reference.policy_basis = policyBasis
    }
    const policyVersion = getString(event.payload, 'policy_version')
    if (policyVersion !== undefined) {
      reference.policy_version = policyVersion
    }
    const standardReference = getString(event.payload, 'standard_reference')
    if (standardReference !== undefined) {
      reference.standard_reference = standardReference
    }
    const nonCompliantIncomeRatio = getNumber(event.payload, 'non_compliant_income_ratio')
    if (nonCompliantIncomeRatio !== undefined) {
      reference.non_compliant_income_ratio = nonCompliantIncomeRatio
    }
    const sourceFilingPeriodStart = getString(event.payload, 'source_filing_period_start')
    if (sourceFilingPeriodStart !== undefined) {
      reference.source_filing_period_start = sourceFilingPeriodStart
    }
    const sourceFilingPeriodEnd = getString(event.payload, 'source_filing_period_end')
    if (sourceFilingPeriodEnd !== undefined) {
      reference.source_filing_period_end = sourceFilingPeriodEnd
    }
    const sourceFilingType = getString(event.payload, 'source_filing_type')
    if (sourceFilingType !== undefined) {
      reference.source_filing_type = sourceFilingType
    }
    const sourceFilingDate = getString(event.payload, 'source_filing_date')
    if (sourceFilingDate !== undefined) {
      reference.source_filing_date = sourceFilingDate
    }
    const evidenceSummary = getString(event.payload, 'evidence_summary')
    if (evidenceSummary !== undefined) {
      reference.evidence_summary = evidenceSummary
    }
    references.set(evaluationId, reference)
  }

  return references
}

function holdingReferences(events: LedgerEventEnvelope<unknown>[]): Map<string, HoldingReference> {
  const references = new Map<string, HoldingReference>()

  for (const event of events) {
    if (!isRecord(event.payload)) {
      continue
    }

    if (event.event_type === 'holding_opened') {
      const holdingId = getString(event.payload, 'holding_id') ?? event.aggregate_id
      const reference: HoldingReference = { holding_id: holdingId }
      const companyId = getString(event.payload, 'company_id')
      if (companyId !== undefined) {
        reference.company_id = companyId
      }
      const ticker = getString(event.payload, 'ticker')
      if (ticker !== undefined) {
        reference.ticker = ticker
      }
      const companyName = getString(event.payload, 'company_name')
      if (companyName !== undefined) {
        reference.company_name = companyName
      }
      const openedAt = getString(event.payload, 'opened_at')
      if (openedAt !== undefined) {
        reference.opened_at = openedAt
      }
      const closedAt = getString(event.payload, 'closed_at')
      if (closedAt !== undefined) {
        reference.closed_at = closedAt
      }
      references.set(holdingId, reference)
      continue
    }

    if (event.event_type === 'holding_closed') {
      const holdingId = getString(event.payload, 'holding_id') ?? event.aggregate_id
      const reference = references.get(holdingId) ?? { holding_id: holdingId }
      const closedAt = getString(event.payload, 'closed_at') ?? getString(event.payload, 'closed_on') ?? event.created_at.slice(0, 10)
      reference.closed_at = closedAt
      references.set(holdingId, reference)
    }
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

function dividendReferences(events: LedgerEventEnvelope<unknown>[]): Map<string, DividendIncomeReference> {
  const references = new Map<string, DividendIncomeReference>()

  for (const event of events) {
    if (event.event_type !== 'dividend_income_recorded' || !isRecord(event.payload)) {
      continue
    }
    const reference = dividendReference(event)
    references.set(reference.event_id, reference)
    const current = references.get(reference.dividend_id)
    if (current === undefined || reference.created_at >= current.created_at) {
      references.set(reference.dividend_id, reference)
    }
  }

  return references
}

function dividendReferenceList(events: LedgerEventEnvelope<unknown>[]): DividendIncomeReference[] {
  const referencesByDividendId = new Map<string, DividendIncomeReference>()

  for (const event of events) {
    if (event.event_type !== 'dividend_income_recorded' || !isRecord(event.payload)) {
      continue
    }
    const reference = dividendReference(event)
    const current = referencesByDividendId.get(reference.dividend_id)
    if (current === undefined || reference.created_at >= current.created_at) {
      referencesByDividendId.set(reference.dividend_id, reference)
    }
  }

  return [...referencesByDividendId.values()]
}

function dividendReference(event: LedgerEventEnvelope<unknown>): DividendIncomeReference {
  const dividendId = isRecord(event.payload) ? getString(event.payload, 'dividend_id') ?? event.aggregate_id : event.aggregate_id
  const reference: DividendIncomeReference = {
    event_id: event.event_id,
    dividend_id: dividendId,
    source_ids: [...event.source_ids],
    created_at: event.created_at,
  }
  if (!isRecord(event.payload)) {
    return reference
  }
  const holdingId = getString(event.payload, 'holding_id')
  if (holdingId !== undefined) {
    reference.holding_id = holdingId
  }
  const amount = getNumber(event.payload, 'amount')
  if (amount !== undefined) {
    reference.amount = amount
  }
  const currency = getString(event.payload, 'currency')
  if (currency !== undefined) {
    reference.currency = currency
  }
  const receivedAt = getString(event.payload, 'received_at')
  if (receivedAt !== undefined) {
    reference.received_at = receivedAt
  }
  return reference
}

function shariahReferencesByHolding(events: LedgerEventEnvelope<unknown>[]): Map<string, ShariahEvaluationReference[]> {
  const references = new Map<string, ShariahEvaluationReference[]>()
  for (const reference of shariahReferences(events).values()) {
    references.set(reference.holding_id, [...(references.get(reference.holding_id) ?? []), reference])
  }
  for (const entries of references.values()) {
    entries.sort((left, right) => {
      const leftPeriod = left.source_filing_period_end ?? ''
      const rightPeriod = right.source_filing_period_end ?? ''
      if (leftPeriod !== rightPeriod) {
        return leftPeriod.localeCompare(rightPeriod)
      }
      return left.created_at.localeCompare(right.created_at)
    })
  }
  return references
}

function hasApplicableSourcePeriod(reference: ShariahEvaluationReference, dividend: DividendIncomeReference): boolean {
  if (reference.source_filing_period_start === undefined || reference.source_filing_period_end === undefined || dividend.received_at === undefined) {
    return false
  }
  if (reference.source_filing_period_start > reference.source_filing_period_end) {
    return false
  }
  return reference.source_filing_period_end <= dividend.received_at
}

function latestApplicableShariahReference(
  references: ShariahEvaluationReference[],
  dividend: DividendIncomeReference,
): ShariahEvaluationReference | undefined {
  return references.filter((reference) => hasApplicableSourcePeriod(reference, dividend)).at(-1)
}

function holdingPeriodBasis(holding: HoldingReference, dividend: DividendIncomeReference): string {
  if (hasValidHoldingPeriod(holding, dividend)) {
    return 'dividend_received_during_open_holding_period'
  }
  return 'dividend_income_recorded_holding_reference'
}

function hasValidHoldingPeriod(holding: HoldingReference | undefined, dividend: DividendIncomeReference): boolean {
  return holding?.opened_at !== undefined
    && dividend.received_at !== undefined
    && holding.opened_at <= dividend.received_at
    && (holding.closed_at === undefined || dividend.received_at <= holding.closed_at)
}

export function projectAaoifiDividendPurificationCalculations(
  events: LedgerEventEnvelope<unknown>[],
  options: AaoifiDividendPurificationOptions,
): AaoifiDividendPurificationProjection {
  const asOfCutoff = new Date(`${options.as_of}T23:59:59.999Z`).getTime()
  const visibleEvents = events.filter((event) => new Date(event.created_at).getTime() <= asOfCutoff)
  const holdingsById = holdingReferences(visibleEvents)
  const shariahByHoldingId = shariahReferencesByHolding(visibleEvents)
  const calculations: AaoifiDividendPurificationCalculation[] = []
  const pending: PendingPurificationCalculation[] = []
  const nextCalculationAt = nextQuarterCalculationAt(options.as_of, options.calculated_at)

  for (const dividend of dividendReferenceList(visibleEvents)) {
    if (dividend.received_at !== undefined && dividend.received_at > options.as_of) {
      continue
    }

    const missing: string[] = []
    if (dividend.holding_id === undefined) missing.push('holding_id')
    if (dividend.amount === undefined) {
      missing.push('dividend_income_amount')
    } else if (dividend.amount <= 0) {
      missing.push('positive_dividend_income_amount')
    }
    if (dividend.currency === undefined) missing.push('currency')
    if (dividend.received_at === undefined) missing.push('dividend_received_at')
    if (dividend.source_ids.length === 0) missing.push('source_ids')
    const holding = dividend.holding_id === undefined ? undefined : holdingsById.get(dividend.holding_id)
    if (!hasValidHoldingPeriod(holding, dividend)) {
      missing.push('holding_period')
    }
    const shariahReferences = dividend.holding_id === undefined ? [] : shariahByHoldingId.get(dividend.holding_id) ?? []
    const shariahReference = latestApplicableShariahReference(shariahReferences, dividend)
    if (shariahReference === undefined) {
      missing.push('shariah_evaluation_id', 'policy_basis', 'policy_version', 'non_compliant_income_ratio', 'policy_source_ids', 'applicable_source_filing_period', 'source_ids')
    } else {
      if (shariahReference.policy_basis === undefined) {
        missing.push('policy_basis')
      } else if (shariahReference.policy_basis !== 'AAOIFI') {
        missing.push('AAOIFI_policy_basis')
      }
      if (shariahReference.policy_version === undefined) missing.push('policy_version')
      if (shariahReference.non_compliant_income_ratio === undefined || shariahReference.non_compliant_income_ratio < 0 || shariahReference.non_compliant_income_ratio > 1) missing.push('non_compliant_income_ratio')
      if (shariahReference.policy_source_ids.length === 0) missing.push('policy_source_ids')
      if (shariahReference.source_ids.length === 0) missing.push('source_ids')
      if (!hasApplicableSourcePeriod(shariahReference, dividend)) missing.push('applicable_source_filing_period')
    }

    if (missing.length > 0 || dividend.holding_id === undefined || dividend.amount === undefined || dividend.amount <= 0 || dividend.currency === undefined || dividend.received_at === undefined || dividend.source_ids.length === 0 || holding === undefined || shariahReference === undefined || shariahReference.policy_basis !== 'AAOIFI' || shariahReference.policy_version === undefined || shariahReference.non_compliant_income_ratio === undefined || shariahReference.source_ids.length === 0 || !hasApplicableSourcePeriod(shariahReference, dividend)) {
      pending.push({
        status: 'pending',
        ...(dividend.holding_id === undefined ? {} : { holding_id: dividend.holding_id }),
        dividend_event_id: dividend.event_id,
        dividend_id: dividend.dividend_id,
        missing_evidence: unique(missing),
        caveats: ['Evidence missing — calculation pending. Owlfolio did not create a purification obligation.'],
      })
      continue
    }

    const policyVersion = shariahReference.policy_version
    const sourceFilingPeriodStart = shariahReference.source_filing_period_start!
    const sourceFilingPeriodEnd = shariahReference.source_filing_period_end!
    const calculationEvidenceSuffix = stableIdSuffix([
      dividend.holding_id,
      dividend.dividend_id,
      String(dividend.amount),
      dividend.currency,
      dividend.received_at,
      policyVersion,
      shariahReference.evaluation_id,
      String(shariahReference.non_compliant_income_ratio),
      sourceFilingPeriodStart,
      sourceFilingPeriodEnd,
      ...unique([...dividend.source_ids, ...shariahReference.source_ids, ...shariahReference.policy_source_ids]).sort(),
    ])
    const calculationId = `calc_${sanitizeId(dividend.holding_id)}_${sanitizeId(dividend.dividend_id)}_${sanitizeId(policyVersion)}_${calculationEvidenceSuffix}`
    const purificationAmount = roundMoney(dividend.amount * shariahReference.non_compliant_income_ratio)
    const sourceIds = unique([...dividend.source_ids, ...shariahReference.source_ids, ...shariahReference.policy_source_ids])

    calculations.push({
      calculation_id: calculationId,
      holding_id: dividend.holding_id,
      ...(holding?.company_id === undefined ? {} : { company_id: holding.company_id }),
      ...(holding?.ticker === undefined ? {} : { ticker: holding.ticker }),
      ...(holding?.company_name === undefined ? {} : { company_name: holding.company_name }),
      period_start: dividend.received_at,
      period_end: dividend.received_at,
      policy_basis: shariahReference.policy_basis,
      policy_version: policyVersion,
      ...(shariahReference.standard_reference === undefined ? {} : { standard_reference: shariahReference.standard_reference }),
      calculation_method: 'dividend_ratio',
      dividend_event_id: dividend.event_id,
      dividend_id: dividend.dividend_id,
      dividend_income_amount: dividend.amount,
      non_compliant_income_ratio: shariahReference.non_compliant_income_ratio,
      purification_ratio: shariahReference.non_compliant_income_ratio,
      holding_period_basis: holdingPeriodBasis(holding as HoldingReference, dividend),
      purification_amount: purificationAmount,
      currency: dividend.currency,
      shariah_evaluation_id: shariahReference.evaluation_id,
      source_filing_period_start: sourceFilingPeriodStart,
      source_filing_period_end: sourceFilingPeriodEnd,
      ...(shariahReference.source_filing_type === undefined ? {} : { source_filing_type: shariahReference.source_filing_type }),
      ...(shariahReference.source_filing_date === undefined ? {} : { source_filing_date: shariahReference.source_filing_date }),
      ...(shariahReference.evidence_summary === undefined ? {} : { evidence_summary: shariahReference.evidence_summary }),
      policy_source_ids: [...shariahReference.policy_source_ids],
      source_ids: sourceIds,
      caveats: [
        'Estimated purification amount; Owlfolio is not a religious, legal, tax, or financial adviser.',
        'Payment/resolution must be recorded by explicit user confirmation after an external payment.',
      ],
      calculated_at: options.calculated_at,
      next_calculation_at: nextCalculationAt,
      requires_user_confirmation: true,
      requires_scholar_review: shariahReference.standard_reference?.includes('secondary-source') ?? true,
    })
  }

  return { calculations, pending }
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

function purificationObligationCorrectionKey(obligation: PurificationObligationProjection): string {
  if (
    obligation.dividend_id === undefined
    && obligation.dividend_event_id === undefined
  ) {
    return `obligation:${obligation.obligation_id}`
  }
  if (
    obligation.policy_basis === undefined
    || obligation.policy_version === undefined
    || obligation.calculation_method === undefined
  ) {
    return `obligation:${obligation.obligation_id}`
  }

  return [
    'dividend',
    obligation.holding_id,
    obligation.dividend_id ?? obligation.dividend_event_id,
    obligation.currency,
    obligation.policy_basis,
    obligation.policy_version,
    obligation.calculation_method,
    obligation.source_filing_period_start ?? '',
    obligation.source_filing_period_end ?? '',
  ].map((part) => JSON.stringify(part)).join(':')
}

export function projectPurificationLedger(events: LedgerEventEnvelope<unknown>[]): PurificationLedgerProjection {
  const shariahByEvaluationId = shariahReferences(events)
  const accountingBySnapshotId = accountingReferences(events)
  const dividendById = dividendReferences(events)
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

  const rawObligations = events.flatMap((event): PurificationObligationProjection[] => {
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
    const dividendEventId = getString(event.payload, 'dividend_event_id')
    const dividendId = getString(event.payload, 'dividend_id')
    const impurityRate = getNumber(event.payload, 'impurity_rate')
    const calculationId = getString(event.payload, 'calculation_id')
    const companyId = getString(event.payload, 'company_id')
    const ticker = getString(event.payload, 'ticker')
    const companyName = getString(event.payload, 'company_name')
    const purificationAmount = getNumber(event.payload, 'purification_amount')
    const policyBasis = getString(event.payload, 'policy_basis')
    const policyVersion = getString(event.payload, 'policy_version')
    const standardReference = getString(event.payload, 'standard_reference')
    const calculationMethod = getString(event.payload, 'calculation_method') as PurificationCalculationMethod | undefined
    const directDividendIncomeAmount = getNumber(event.payload, 'dividend_income_amount')
    const nonCompliantIncomeRatio = getNumber(event.payload, 'non_compliant_income_ratio')
    const purificationRatio = getNumber(event.payload, 'purification_ratio')
    const holdingPeriodBasis = getString(event.payload, 'holding_period_basis')
    const sourceFilingPeriodStart = getString(event.payload, 'source_filing_period_start')
    const sourceFilingPeriodEnd = getString(event.payload, 'source_filing_period_end')
    const sourceFilingType = getString(event.payload, 'source_filing_type')
    const sourceFilingDate = getString(event.payload, 'source_filing_date')
    const evidenceSummary = getString(event.payload, 'evidence_summary')
    const policySourceIds = getStringArray(event.payload.policy_source_ids)
    const payloadSourceIds = getStringArray(event.payload.source_ids)
    const caveats = getStringArray(event.payload.caveats)
    const calculatedAt = getString(event.payload, 'calculated_at')
    const nextCalculationAt = getString(event.payload, 'next_calculation_at')
    const requiresUserConfirmation = getBoolean(event.payload, 'requires_user_confirmation')
    const requiresScholarReview = getBoolean(event.payload, 'requires_scholar_review')
    const shariahReference = shariahEvaluationId === undefined ? undefined : shariahByEvaluationId.get(shariahEvaluationId)
    const accountingReference = accountingSnapshotId === undefined ? undefined : accountingBySnapshotId.get(accountingSnapshotId)
    const dividendReference = dividendEventId === undefined ? undefined : dividendById.get(dividendEventId)
    const dividendIncomeAmount = directDividendIncomeAmount ?? dividendReference?.amount
    const paidAmount = roundMoney((paymentsByObligation.get(obligationId) ?? [])
      .filter((payment) => payment.currency === currency)
      .reduce((sum, payment) => sum + payment.amount, 0))
    const remainingAmount = Math.max(0, roundMoney(amount - paidAmount))
    const reason = getString(event.payload, 'reason')

    return [{
      obligation_id: obligationId,
      ...(calculationId === undefined ? {} : { calculation_id: calculationId }),
      holding_id: holdingId,
      ...(companyId === undefined ? {} : { company_id: companyId }),
      ...(ticker === undefined ? {} : { ticker }),
      ...(companyName === undefined ? {} : { company_name: companyName }),
      amount,
      ...(purificationAmount === undefined ? {} : { purification_amount: purificationAmount }),
      currency,
      period_start: periodStart,
      period_end: periodEnd,
      ...(policyBasis === undefined ? {} : { policy_basis: policyBasis }),
      ...(policyVersion === undefined ? {} : { policy_version: policyVersion }),
      ...(standardReference === undefined ? {} : { standard_reference: standardReference }),
      ...(calculationMethod === undefined ? {} : { calculation_method: calculationMethod }),
      ...(reason === undefined ? {} : { reason }),
      ...(shariahEvaluationId === undefined ? {} : { shariah_evaluation_id: shariahEvaluationId }),
      ...(accountingSnapshotId === undefined ? {} : { accounting_snapshot_id: accountingSnapshotId }),
      ...(dividendEventId === undefined ? {} : { dividend_event_id: dividendEventId }),
      ...(dividendId === undefined ? {} : { dividend_id: dividendId }),
      ...(dividendIncomeAmount === undefined ? {} : { dividend_income_amount: dividendIncomeAmount }),
      ...(nonCompliantIncomeRatio === undefined ? {} : { non_compliant_income_ratio: nonCompliantIncomeRatio }),
      ...(impurityRate === undefined ? {} : { impurity_rate: impurityRate }),
      ...(purificationRatio === undefined ? {} : { purification_ratio: purificationRatio }),
      ...(holdingPeriodBasis === undefined ? {} : { holding_period_basis: holdingPeriodBasis }),
      ...(sourceFilingPeriodStart === undefined ? {} : { source_filing_period_start: sourceFilingPeriodStart }),
      ...(sourceFilingPeriodEnd === undefined ? {} : { source_filing_period_end: sourceFilingPeriodEnd }),
      ...(sourceFilingType === undefined ? {} : { source_filing_type: sourceFilingType }),
      ...(sourceFilingDate === undefined ? {} : { source_filing_date: sourceFilingDate }),
      ...(evidenceSummary === undefined ? {} : { evidence_summary: evidenceSummary }),
      ...(policySourceIds.length === 0 ? {} : { policy_source_ids: policySourceIds }),
      ...(payloadSourceIds.length === 0 ? {} : { source_ids: payloadSourceIds }),
      ...(caveats.length === 0 ? {} : { caveats }),
      ...(calculatedAt === undefined ? {} : { calculated_at: calculatedAt }),
      ...(nextCalculationAt === undefined ? {} : { next_calculation_at: nextCalculationAt }),
      ...(requiresUserConfirmation === undefined ? {} : { requires_user_confirmation: requiresUserConfirmation }),
      ...(requiresScholarReview === undefined ? {} : { requires_scholar_review: requiresScholarReview }),
      recorded_at: event.created_at,
      ...(shariahReference?.status === undefined ? {} : { shariah_status: shariahReference.status }),
      ...(shariahReference?.policy_basis === undefined ? {} : { shariah_policy_basis: shariahReference.policy_basis }),
      shariah_source_ids: shariahReference?.source_ids ?? [],
      ...(accountingReference?.nav === undefined ? {} : { accounting_nav: accountingReference.nav }),
      ...(accountingReference?.period_end === undefined ? {} : { accounting_period_end: accountingReference.period_end }),
      ...(accountingReference?.holdings[holdingId]?.current_value === undefined ? {} : { accounting_holding_value: accountingReference.holdings[holdingId].current_value }),
      audit_source_ids: unique([...event.source_ids, ...(shariahReference?.source_ids ?? []), ...(dividendReference?.source_ids ?? []), ...payloadSourceIds, ...policySourceIds]),
      paid_amount: paidAmount,
      remaining_amount: remainingAmount,
      status: statusFor(amount, paidAmount),
    }]
  })

  const obligationIdsByCorrectionKey = new Map<string, string[]>()
  const currentObligationByCorrectionKey = new Map<string, PurificationObligationProjection>()
  for (const obligation of rawObligations) {
    const correctionKey = purificationObligationCorrectionKey(obligation)
    const obligationIds = obligationIdsByCorrectionKey.get(correctionKey) ?? []
    obligationIds.push(obligation.obligation_id)
    obligationIdsByCorrectionKey.set(correctionKey, obligationIds)

    const current = currentObligationByCorrectionKey.get(correctionKey)
    if (current === undefined || obligation.recorded_at >= current.recorded_at) {
      currentObligationByCorrectionKey.set(correctionKey, obligation)
    }
  }

  const obligations = [...currentObligationByCorrectionKey.entries()].map(([correctionKey, obligation]) => {
    const obligationIds = obligationIdsByCorrectionKey.get(correctionKey) ?? [obligation.obligation_id]
    const paidAmount = roundMoney(obligationIds
      .flatMap((obligationId) => paymentsByObligation.get(obligationId) ?? [])
      .filter((payment) => payment.currency === obligation.currency)
      .reduce((sum, payment) => sum + payment.amount, 0))
    return {
      ...obligation,
      paid_amount: paidAmount,
      remaining_amount: Math.max(0, roundMoney(obligation.amount - paidAmount)),
      status: statusFor(obligation.amount, paidAmount),
    }
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
