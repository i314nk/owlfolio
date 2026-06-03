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

export type AccountingSnapshotInput = {
  snapshot_id: string
  period_start: string
  period_end: string
  currency: string
  recorded_at: string
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
  cash_balance: number
  deposits: number
  withdrawals: number
  dividends: number
  fees: number
  net_cash_flow: number
  cash_ledger_status: CashLedgerStatus
  cash_flows: AccountingCashFlow[]
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
  }
}

export function projectAccountingSnapshot(
  events: LedgerEventEnvelope<unknown>[],
  input: AccountingSnapshotInput,
): AccountingSnapshotProjection {
  const asOfEvents = events.filter((event) => eventDateForAccounting(event) <= input.period_end)
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
  const netCashFlow = roundMoney(deposits - withdrawals + dividends - fees)
  const nav = roundMoney(currentValue + cashBalance)

  return {
    snapshot_id: input.snapshot_id,
    period_start: input.period_start,
    period_end: input.period_end,
    currency: input.currency,
    nav,
    current_value: currentValue,
    invested_cost_basis: investedCostBasis,
    unrealized_gain_loss: unrealizedGainLoss,
    cash_balance: cashBalance,
    deposits,
    withdrawals,
    dividends,
    fees,
    net_cash_flow: netCashFlow,
    cash_ledger_status: asOfCashFlows.length > 0 ? 'ledger_backed' : 'placeholder',
    cash_flows: cashFlows,
    missing_valuation_holding_ids: holdings
      .filter((holding) => holding.valuation_status === 'missing_valuation')
      .map((holding) => holding.holding_id),
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

export function projectRecordedAccountingSnapshots(
  events: LedgerEventEnvelope<unknown>[],
): AccountingSnapshotProjection[] {
  return events.flatMap((event) => {
    if (event.event_type !== 'accounting_snapshot_recorded' || !isRecord(event.payload)) {
      return []
    }
    return [event.payload as AccountingSnapshotProjection]
  })
}
