// Purification Engine — quarterly statement, capital-gains purification setting, and exit finalization.
//
// lifecycle-spec-v3 Module 9. All DETERMINISTIC arithmetic (model-tiering T0) — "purification arithmetic
// is pure code, never a model." Output is a payable + a statement, never advice; the HUMAN authors every
// charitable disbursement. These projections are READ-ONLY: they never append a payment or disbursement
// event. Per-dividend accrual (rule 1+2) lives in purificationProjection.ts; this file adds rules 3
// (capital-gains, off by default), 4 (quarterly statement), and 5 (exit finalization).

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectPurificationLedger } from './purificationProjection'

/**
 * Capital-gains purification is OFF by default: the majority contemporary view purifies DIVIDENDS only.
 * A user-selectable stricter mode (a setting) purifies realized_gain x purification_pct on exit. We never
 * accrue gains purification unless the setting is explicitly enabled.
 */
export const CAPITAL_GAINS_PURIFICATION_DEFAULT_ENABLED = false

export type CapitalGainsPurificationInput = {
  /** Realized gain on exit (a LOSS, i.e. negative, never purifies). */
  realized_gain: number
  /** purification_pct carried by the CONDITIONAL holding (= impermissible income / total revenue). */
  purification_pct: number
  /** User-authored stricter-mode setting; defaults to OFF. */
  capital_gains_purification_enabled?: boolean
}

export type CapitalGainsPurificationResult = {
  enabled: boolean
  purification_amount: number
}

export type QuarterlyPurificationStatementOptions = {
  period_start: string
  period_end: string
}

export type QuarterlyPurificationHoldingLine = {
  holding_id: string
  ticker?: string
  currency: string
  accrued_this_period: number
  cumulative_accrued: number
  cumulative_paid: number
  cumulative_unpaid: number
}

export type QuarterlyPurificationCurrencySummary = {
  accrued_this_period: number
  cumulative_accrued: number
  cumulative_paid: number
  cumulative_unpaid: number
}

export type QuarterlyPurificationStatement = {
  period_start: string
  period_end: string
  is_observation: true
  per_holding: QuarterlyPurificationHoldingLine[]
  summary_by_currency: Record<string, QuarterlyPurificationCurrencySummary>
  caveats: string[]
}

export type ExitPurificationFinalization = {
  holding_id: string
  ticker?: string
  currency: string
  closed_at: string
  final_purification_accrued: number
  final_purification_paid: number
  final_purification_remaining: number
  is_finalized: true
  caveats: string[]
}

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

const STATEMENT_CAVEATS = [
  'Tracking aid, not a religious, legal, tax, or financial ruling or a payment service.',
  'Owlfolio never marks an obligation paid or disburses automatically; the human authors every charitable disbursement (a purification_payment_recorded event).',
]

/**
 * Capital-gains purification (rule 3). OFF by default — returns zero unless the user enables the stricter
 * mode. A realized LOSS never purifies. Pure arithmetic; no event is produced.
 */
export function computeCapitalGainsPurification(
  input: CapitalGainsPurificationInput,
): CapitalGainsPurificationResult {
  const enabled = input.capital_gains_purification_enabled ?? CAPITAL_GAINS_PURIFICATION_DEFAULT_ENABLED
  if (!enabled) {
    return { enabled: false, purification_amount: 0 }
  }
  if (!Number.isFinite(input.realized_gain) || !Number.isFinite(input.purification_pct)) {
    return { enabled: true, purification_amount: 0 }
  }
  const gain = Math.max(0, input.realized_gain)
  const pct = Math.max(0, input.purification_pct)
  return { enabled: true, purification_amount: roundMoney(gain * pct) }
}

/**
 * Quarterly purification statement (rule 4): amount accrued THIS period (per holding), plus cumulative
 * accrued / paid / unpaid across all time. Read-only projection over the purification ledger — produces NO
 * payment or disbursement event.
 */
export function projectQuarterlyPurificationStatement(
  events: LedgerEventEnvelope<unknown>[],
  options: QuarterlyPurificationStatementOptions,
): QuarterlyPurificationStatement {
  const ledger = projectPurificationLedger(events)

  const lineByKey = new Map<string, QuarterlyPurificationHoldingLine>()
  for (const obligation of ledger.obligations) {
    const key = `${obligation.holding_id}:${obligation.currency}`
    const line = lineByKey.get(key) ?? {
      holding_id: obligation.holding_id,
      ...(obligation.ticker === undefined ? {} : { ticker: obligation.ticker }),
      currency: obligation.currency,
      accrued_this_period: 0,
      cumulative_accrued: 0,
      cumulative_paid: 0,
      cumulative_unpaid: 0,
    }
    if (line.ticker === undefined && obligation.ticker !== undefined) {
      line.ticker = obligation.ticker
    }
    const inPeriod = obligation.period_end >= options.period_start && obligation.period_end <= options.period_end
    if (inPeriod) {
      line.accrued_this_period = roundMoney(line.accrued_this_period + obligation.amount)
    }
    line.cumulative_accrued = roundMoney(line.cumulative_accrued + obligation.amount)
    line.cumulative_paid = roundMoney(line.cumulative_paid + obligation.paid_amount)
    line.cumulative_unpaid = roundMoney(line.cumulative_unpaid + obligation.remaining_amount)
    lineByKey.set(key, line)
  }

  const per_holding = [...lineByKey.values()].sort((left, right) => {
    if (right.cumulative_unpaid !== left.cumulative_unpaid) {
      return right.cumulative_unpaid - left.cumulative_unpaid
    }
    return left.holding_id.localeCompare(right.holding_id)
  })

  const summary_by_currency: Record<string, QuarterlyPurificationCurrencySummary> = {}
  for (const line of per_holding) {
    const current = summary_by_currency[line.currency] ?? {
      accrued_this_period: 0,
      cumulative_accrued: 0,
      cumulative_paid: 0,
      cumulative_unpaid: 0,
    }
    current.accrued_this_period = roundMoney(current.accrued_this_period + line.accrued_this_period)
    current.cumulative_accrued = roundMoney(current.cumulative_accrued + line.cumulative_accrued)
    current.cumulative_paid = roundMoney(current.cumulative_paid + line.cumulative_paid)
    current.cumulative_unpaid = roundMoney(current.cumulative_unpaid + line.cumulative_unpaid)
    summary_by_currency[line.currency] = current
  }

  return {
    period_start: options.period_start,
    period_end: options.period_end,
    is_observation: true,
    per_holding,
    summary_by_currency,
    caveats: [...STATEMENT_CAVEATS],
  }
}

/**
 * Exit finalization (rule 5): on EXIT of a holding (holding_closed), lock the final cumulative purification
 * (accrued / paid / remaining) into the position's post-mortem record. Read-only projection — the human
 * still authors any outstanding disbursement; no payment event is produced.
 */
export function projectExitPurificationFinalizations(
  events: LedgerEventEnvelope<unknown>[],
): ExitPurificationFinalization[] {
  const closedAtByHolding = new Map<string, string>()
  for (const event of events) {
    if (event.event_type !== 'holding_closed' || !isRecord(event.payload)) {
      continue
    }
    const holdingId = getString(event.payload, 'holding_id') ?? event.aggregate_id
    const closedAt = getString(event.payload, 'closed_at')
      ?? getString(event.payload, 'closed_on')
      ?? event.created_at.slice(0, 10)
    closedAtByHolding.set(holdingId, closedAt)
  }

  if (closedAtByHolding.size === 0) {
    return []
  }

  const ledger = projectPurificationLedger(events)
  const finalizations: ExitPurificationFinalization[] = []

  for (const [holdingId, closedAt] of closedAtByHolding) {
    const obligations = ledger.obligations.filter((obligation) => obligation.holding_id === holdingId)
    const firstObligation = obligations[0]
    if (firstObligation === undefined) {
      continue
    }
    const currency = firstObligation.currency
    const ticker = obligations.find((obligation) => obligation.ticker !== undefined)?.ticker
    const accrued = roundMoney(obligations.reduce((sum, obligation) => sum + obligation.amount, 0))
    const paid = roundMoney(obligations.reduce((sum, obligation) => sum + obligation.paid_amount, 0))
    const remaining = Math.max(0, roundMoney(accrued - paid))
    finalizations.push({
      holding_id: holdingId,
      ...(ticker === undefined ? {} : { ticker }),
      currency,
      closed_at: closedAt,
      final_purification_accrued: accrued,
      final_purification_paid: paid,
      final_purification_remaining: remaining,
      is_finalized: true,
      caveats: [...STATEMENT_CAVEATS],
    })
  }

  return finalizations.sort((left, right) => left.holding_id.localeCompare(right.holding_id))
}
