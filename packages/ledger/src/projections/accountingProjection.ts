import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectHoldings, type HoldingProjection } from './holdingProjection'

export type CashLedgerStatus = 'placeholder'
export type AccountingHoldingValuationStatus = 'valued' | 'missing_valuation'

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
  cash_ledger_status: CashLedgerStatus
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

  return event.created_at.slice(0, 10)
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

  return {
    snapshot_id: input.snapshot_id,
    period_start: input.period_start,
    period_end: input.period_end,
    currency: input.currency,
    nav: currentValue,
    current_value: currentValue,
    invested_cost_basis: investedCostBasis,
    unrealized_gain_loss: unrealizedGainLoss,
    cash_balance: 0,
    deposits: 0,
    withdrawals: 0,
    cash_ledger_status: 'placeholder',
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
