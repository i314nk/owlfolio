import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectHoldings, type HoldingProjection } from './holdingProjection'

export type CashLedgerStatus = 'placeholder' | 'ledger_backed'
export type AccountingHoldingValuationStatus = 'valued' | 'missing_valuation'
export type AccountingCashFlowType = 'deposit' | 'withdrawal' | 'dividend' | 'fee'

export type AccountingCashFlow = {
  event_id: string
  flow_type: AccountingCashFlowType
  amount: number
  currency: string
  occurred_at: string
  cash_account_id?: string
  holding_id?: string
  source_ids: string[]
}

export type AccountingDataWarning = {
  code: 'missing_valuation' | 'valuation_missing_data'
  message: string
  holding_id?: string
  event_id?: string
}

export type AccountingSnapshotInput = {
  snapshot_id: string
  period_start: string
  period_end: string
  currency: string
  recorded_at: string
  /**
   * The ONE expected (NOT guaranteed) Mudarabah savings profit rate, from SavingsSleeveConfig. Optional
   * and additive: when supplied, the projection surfaces `expected_savings_return` on the idle savings
   * balance. The projection is otherwise pure and cannot read app config, so the rate is passed in.
   */
  savings_expected_profit_rate?: number
}

/**
 * The EXPECTED — explicitly NOT GUARANTEED — return on idle capital sitting in the capital-stable
 * Mudarabah savings sleeve. `basis: 'expected_not_guaranteed'` is the honest label: a Mudarabah profit
 * share is an expectation, never a promised/risk-free yield. amount = savings_balance × rate.
 */
export type ExpectedSavingsReturn = {
  amount: number
  /** Honest-labeling marker. Always 'expected_not_guaranteed' — surfaced text must not imply certainty. */
  basis: 'expected_not_guaranteed'
  rate: number
  model: 'mudarabah'
}

export type AccountingHoldingSnapshot = {
  holding_id: string
  ticker?: string
  currency: string
  shares: number
  cost_basis: number
  current_value?: number
  unrealized_gain_loss?: number
  valuation_status: AccountingHoldingValuationStatus
  latest_valuation_at?: string
  valuation_event_id?: string
  valuation_source?: string
  valuation_source_ids?: string[]
}

export type AccountingSnapshotProjection = {
  snapshot_id: string
  period_start: string
  period_end: string
  currency: string
  nav: number
  current_value: number
  invested_cost_basis: number
  unrealized_gain_loss: number
  realized_gain_loss: number
  cash_balance: number
  deposits: number
  withdrawals: number
  dividends: number
  fees: number
  net_cash_flow: number
  /**
   * Idle, un-deployed capital sitting in the Shariah-compliant savings sleeve (= `cash_balance`). Cash is
   * a first-class position: holding here when nothing clears the deployment hurdle is the CORRECT posture
   * (fat-pitch discipline), never under-deployment.
   */
  savings_balance: number
  /**
   * EXPECTED (NOT guaranteed) return on `savings_balance`, present only when a savings rate was supplied.
   * See {@link ExpectedSavingsReturn}.
   */
  expected_savings_return?: ExpectedSavingsReturn
  cash_ledger_status: CashLedgerStatus
  cash_flows: AccountingCashFlow[]
  audit_event_ids: string[]
  source_ids: string[]
  missing_data_warnings: AccountingDataWarning[]
  missing_valuation_holding_ids: string[]
  holdings: AccountingHoldingSnapshot[]
  updated_at: string
}

export type AccountingSnapshotRecordedPayload = AccountingSnapshotProjection

function roundMoney(value: number): number {
  return Number(value.toFixed(2))
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

function getStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key]
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function eventDateForAccounting(event: LedgerEventEnvelope<unknown>): string {
  if (!isRecord(event.payload)) {
    return event.created_at.slice(0, 10)
  }

  if (event.event_type === 'holding_valuation_recorded') {
    return getString(event.payload, 'valued_at') ?? event.created_at.slice(0, 10)
  }

  if (event.event_type === 'holding_opened') {
    return getString(event.payload, 'opened_at') ?? event.created_at.slice(0, 10)
  }

  if (event.event_type === 'cash_deposited') {
    return getString(event.payload, 'deposited_at') ?? event.created_at.slice(0, 10)
  }

  if (event.event_type === 'cash_withdrawn') {
    return getString(event.payload, 'withdrawn_at') ?? event.created_at.slice(0, 10)
  }

  if (event.event_type === 'dividend_income_recorded') {
    return getString(event.payload, 'received_at') ?? event.created_at.slice(0, 10)
  }

  if (event.event_type === 'fee_charged') {
    return getString(event.payload, 'charged_at') ?? event.created_at.slice(0, 10)
  }

  if (event.event_type === 'holding_realized_gain_loss_recorded') {
    return getString(event.payload, 'realized_at') ?? event.created_at.slice(0, 10)
  }

  return event.created_at.slice(0, 10)
}

function cashFlowFromEvent(event: LedgerEventEnvelope<unknown>): AccountingCashFlow | undefined {
  if (!isRecord(event.payload)) {
    return undefined
  }

  const amount = getNumber(event.payload, 'amount')
  const currency = getString(event.payload, 'currency')
  if (amount === undefined || currency === undefined) {
    return undefined
  }

  const cashAccountId = getString(event.payload, 'cash_account_id') ?? event.aggregate_id
  const holdingId = getString(event.payload, 'holding_id')
  const base = {
    event_id: event.event_id,
    currency,
    occurred_at: eventDateForAccounting(event),
    ...(cashAccountId === undefined ? {} : { cash_account_id: cashAccountId }),
    ...(holdingId === undefined ? {} : { holding_id: holdingId }),
    source_ids: [...event.source_ids],
  }

  if (event.event_type === 'cash_deposited') {
    return { ...base, flow_type: 'deposit', amount: roundMoney(amount) }
  }
  if (event.event_type === 'cash_withdrawn') {
    return { ...base, flow_type: 'withdrawal', amount: -roundMoney(amount) }
  }
  if (event.event_type === 'dividend_income_recorded') {
    return { ...base, flow_type: 'dividend', amount: roundMoney(amount) }
  }
  if (event.event_type === 'fee_charged') {
    return { ...base, flow_type: 'fee', amount: -roundMoney(amount) }
  }

  return undefined
}

function realizedGainLossFromEvent(event: LedgerEventEnvelope<unknown>, currency: string): number | undefined {
  if (event.event_type !== 'holding_realized_gain_loss_recorded' || !isRecord(event.payload)) {
    return undefined
  }
  if (getString(event.payload, 'currency') !== currency) {
    return undefined
  }
  const amount = getNumber(event.payload, 'amount')
  return amount === undefined ? undefined : roundMoney(amount)
}

function isAccountingAuditEvent(event: LedgerEventEnvelope<unknown>, currency: string): boolean {
  if (!isRecord(event.payload)) {
    return false
  }
  const eventCurrency = getString(event.payload, 'currency')
  if (eventCurrency !== undefined && eventCurrency !== currency) {
    return false
  }
  return event.event_type === 'holding_opened'
    || event.event_type === 'holding_valuation_recorded'
    || event.event_type === 'holding_realized_gain_loss_recorded'
    || event.event_type === 'cash_deposited'
    || event.event_type === 'cash_withdrawn'
    || event.event_type === 'dividend_income_recorded'
    || event.event_type === 'fee_charged'
}

function warningLabelForHolding(holding: AccountingHoldingSnapshot): string {
  return holding.ticker ?? holding.holding_id
}

function valuationMissingDataWarnings(
  events: LedgerEventEnvelope<unknown>[],
  currency: string,
  holdings: AccountingHoldingSnapshot[],
): AccountingDataWarning[] {
  const currentValuationEventIds = new Set(holdings
    .map((holding) => holding.valuation_event_id)
    .filter((eventId): eventId is string => eventId !== undefined))

  return events.flatMap((event) => {
    if (!currentValuationEventIds.has(event.event_id)) {
      return []
    }
    if (event.event_type !== 'holding_valuation_recorded' || !isRecord(event.payload)) {
      return []
    }
    if (getString(event.payload, 'currency') !== currency) {
      return []
    }
    const missingData = getStringArray(event.payload, 'missing_data')
    if (missingData.length === 0) {
      return []
    }
    const holdingId = getString(event.payload, 'holding_id') ?? event.aggregate_id
    const label = getString(event.payload, 'ticker') ?? holdings.find((holding) => holding.holding_id === holdingId)?.ticker ?? holdingId
    return [{
      code: 'valuation_missing_data' as const,
      holding_id: holdingId,
      event_id: event.event_id,
      message: `${label} valuation source reported missing data: ${missingData.join(', ')}`,
    }]
  })
}

function accountingHoldingFrom(holding: HoldingProjection): AccountingHoldingSnapshot {
  const base: Pick<AccountingHoldingSnapshot, 'holding_id' | 'currency' | 'shares' | 'cost_basis'> & { ticker?: string } = {
    holding_id: holding.holding_id,
    currency: holding.currency,
    shares: holding.shares,
    cost_basis: holding.total_cost_basis,
  }
  if (holding.ticker !== undefined) {
    base.ticker = holding.ticker
  }

  if (holding.latest_market_value === undefined) {
    return {
      ...base,
      valuation_status: 'missing_valuation',
    }
  }

  const unrealizedGainLoss = holding.unrealized_gain_loss ?? roundMoney(holding.latest_market_value - holding.total_cost_basis)
  return {
    ...base,
    current_value: holding.latest_market_value,
    unrealized_gain_loss: unrealizedGainLoss,
    valuation_status: 'valued',
    ...(holding.latest_valuation_at === undefined ? {} : { latest_valuation_at: holding.latest_valuation_at }),
    ...(holding.latest_valuation_event_id === undefined ? {} : { valuation_event_id: holding.latest_valuation_event_id }),
    ...(holding.latest_valuation_source === undefined ? {} : { valuation_source: holding.latest_valuation_source }),
    ...(holding.latest_valuation_source_ids === undefined ? {} : { valuation_source_ids: [...holding.latest_valuation_source_ids] }),
  }
}

export function projectAccountingSnapshot(
  events: LedgerEventEnvelope<unknown>[],
  input: AccountingSnapshotInput,
): AccountingSnapshotProjection {
  const asOfEvents = events.filter((event) => eventDateForAccounting(event) <= input.period_end)
  const auditEvents = asOfEvents
    .filter((event) => isAccountingAuditEvent(event, input.currency))
    .sort((left, right) => (
      eventDateForAccounting(left).localeCompare(eventDateForAccounting(right))
      || left.created_at.localeCompare(right.created_at)
      || left.event_id.localeCompare(right.event_id)
    ))
  const holdings = projectHoldings(asOfEvents)
    .filter((holding) => holding.currency === input.currency)
    .map(accountingHoldingFrom)
  const currentValue = roundMoney(holdings.reduce((sum, holding) => sum + (holding.current_value ?? 0), 0))
  const investedCostBasis = roundMoney(holdings.reduce((sum, holding) => sum + holding.cost_basis, 0))
  const unrealizedGainLoss = roundMoney(holdings.reduce((sum, holding) => sum + (holding.unrealized_gain_loss ?? 0), 0))
  const asOfCashFlows = asOfEvents
    .map(cashFlowFromEvent)
    .filter((flow): flow is AccountingCashFlow => flow !== undefined && flow.currency === input.currency)
  const cashFlows = asOfCashFlows.filter((flow) => flow.occurred_at >= input.period_start && flow.occurred_at <= input.period_end)
  const cashBalance = roundMoney(asOfCashFlows.reduce((sum, flow) => sum + flow.amount, 0))
  const deposits = roundMoney(cashFlows
    .filter((flow) => flow.flow_type === 'deposit')
    .reduce((sum, flow) => sum + flow.amount, 0))
  const withdrawals = roundMoney(cashFlows
    .filter((flow) => flow.flow_type === 'withdrawal')
    .reduce((sum, flow) => sum + Math.abs(flow.amount), 0))
  const dividends = roundMoney(cashFlows
    .filter((flow) => flow.flow_type === 'dividend')
    .reduce((sum, flow) => sum + flow.amount, 0))
  const fees = roundMoney(cashFlows
    .filter((flow) => flow.flow_type === 'fee')
    .reduce((sum, flow) => sum + Math.abs(flow.amount), 0))
  const realizedGainLoss = roundMoney(auditEvents
    .filter((event) => eventDateForAccounting(event) >= input.period_start && eventDateForAccounting(event) <= input.period_end)
    .map((event) => realizedGainLossFromEvent(event, input.currency))
    .filter((amount): amount is number => amount !== undefined)
    .reduce((sum, amount) => sum + amount, 0))
  const netCashFlow = roundMoney(deposits - withdrawals + dividends - fees)
  const nav = roundMoney(currentValue + cashBalance)
  // Idle, un-deployed capital lives in the savings sleeve. savings_balance === cash_balance.
  const savingsBalance = cashBalance
  // EXPECTED (NOT guaranteed) Mudarabah return, only when a rate was supplied.
  const savingsRate = input.savings_expected_profit_rate
  const expectedSavingsReturn: ExpectedSavingsReturn | undefined =
    typeof savingsRate === 'number' && Number.isFinite(savingsRate)
      ? {
        amount: roundMoney(savingsBalance * savingsRate),
        basis: 'expected_not_guaranteed',
        rate: savingsRate,
        model: 'mudarabah',
      }
      : undefined
  const missingValuationHoldingIds = holdings
    .filter((holding) => holding.valuation_status === 'missing_valuation')
    .map((holding) => holding.holding_id)
  const missingValuationWarnings = holdings
    .filter((holding) => holding.valuation_status === 'missing_valuation')
    .map((holding): AccountingDataWarning => ({
      code: 'missing_valuation',
      holding_id: holding.holding_id,
      message: `${warningLabelForHolding(holding)} is missing a valuation; NAV excludes current value.`,
    }))
  const missingDataWarnings = [
    ...missingValuationWarnings,
    ...valuationMissingDataWarnings(auditEvents, input.currency, holdings),
  ]
  const auditEventIds = auditEvents.map((event) => event.event_id)
  const sourceIds = uniqueStrings(auditEvents.flatMap((event) => event.source_ids))

  return {
    snapshot_id: input.snapshot_id,
    period_start: input.period_start,
    period_end: input.period_end,
    currency: input.currency,
    nav,
    current_value: currentValue,
    invested_cost_basis: investedCostBasis,
    unrealized_gain_loss: unrealizedGainLoss,
    realized_gain_loss: realizedGainLoss,
    cash_balance: cashBalance,
    deposits,
    withdrawals,
    dividends,
    fees,
    net_cash_flow: netCashFlow,
    savings_balance: savingsBalance,
    ...(expectedSavingsReturn === undefined ? {} : { expected_savings_return: expectedSavingsReturn }),
    cash_ledger_status: asOfCashFlows.length > 0 ? 'ledger_backed' : 'placeholder',
    cash_flows: cashFlows,
    audit_event_ids: auditEventIds,
    source_ids: sourceIds,
    missing_data_warnings: missingDataWarnings,
    missing_valuation_holding_ids: missingValuationHoldingIds,
    holdings,
    updated_at: input.recorded_at,
  }
}

export function buildAccountingSnapshotRecordedEvent(
  snapshot: AccountingSnapshotProjection,
  options: {
    event_id: string
    actor_id: string
    created_at: string
    source_ids?: string[]
  },
): LedgerEventEnvelope<AccountingSnapshotRecordedPayload> {
  return {
    event_id: options.event_id,
    event_type: 'accounting_snapshot_recorded',
    aggregate_type: 'accounting_snapshot',
    aggregate_id: snapshot.snapshot_id,
    actor_type: 'worker',
    actor_id: options.actor_id,
    payload: structuredClone(snapshot),
    source_ids: options.source_ids ?? [],
    created_at: options.created_at,
    schema_version: 1,
  }
}

function normalizeRecordedAccountingSnapshot(payload: Record<string, unknown>): AccountingSnapshotProjection {
  const snapshot = payload as AccountingSnapshotProjection
  return {
    ...snapshot,
    realized_gain_loss: getNumber(payload, 'realized_gain_loss') ?? 0,
    // Back-compat: legacy recorded snapshots predate the savings sleeve; idle cash === savings balance.
    savings_balance: getNumber(payload, 'savings_balance') ?? getNumber(payload, 'cash_balance') ?? 0,
    cash_flows: Array.isArray(payload.cash_flows) ? snapshot.cash_flows : [],
    audit_event_ids: getStringArray(payload, 'audit_event_ids'),
    source_ids: getStringArray(payload, 'source_ids'),
    missing_data_warnings: Array.isArray(payload.missing_data_warnings) ? snapshot.missing_data_warnings : [],
    missing_valuation_holding_ids: getStringArray(payload, 'missing_valuation_holding_ids'),
    holdings: Array.isArray(payload.holdings) ? snapshot.holdings : [],
  }
}

export function projectRecordedAccountingSnapshots(
  events: LedgerEventEnvelope<unknown>[],
): AccountingSnapshotProjection[] {
  return events.flatMap((event) => {
    if (event.event_type !== 'accounting_snapshot_recorded' || !isRecord(event.payload)) {
      return []
    }
    return [normalizeRecordedAccountingSnapshot(event.payload)]
  })
}
