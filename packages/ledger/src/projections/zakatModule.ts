// Zakat module — lifecycle-spec-v3 Module 8 (Portfolio & Accounting Engine).
//
// DETERMINISTIC arithmetic (model-tiering T0). 2.5% on a user-set zakatable base each ḥawl date; default
// base = market value of holdings + cash (common contemporary position for traded equities); alternative
// bases (net current assets) supported. The methodology (base method + rate + ḥawl date) is a USER-AUTHORED
// SETTING, never an agent judgment. Output is a statement; the human authors the actual zakat payment —
// like purification, there is NO auto-payment.

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectAccountingSnapshot } from './accountingProjection'

export type ZakatBaseMethod = 'market_value_holdings_plus_cash' | 'net_current_assets'

/** Standard zakat rate on monetary wealth (2.5%). User may override (e.g. lunar-vs-solar adjustment). */
export const DEFAULT_ZAKAT_RATE = 0.025
export const DEFAULT_ZAKAT_BASE_METHOD: ZakatBaseMethod = 'market_value_holdings_plus_cash'

export type ComputeZakatInput = {
  /** Market value of holdings (the accounting snapshot current_value). */
  holdings_market_value: number
  /** Cash balance. */
  cash: number
  /** Used only when base_method === 'net_current_assets'; a user-supplied figure. */
  net_current_assets?: number
  base_method?: ZakatBaseMethod
  /** User-authored rate; defaults to 2.5%. */
  rate?: number
}

export type ZakatComputation = {
  base_method: ZakatBaseMethod
  zakatable_base: number
  rate: number
  zakat_due: number
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2))
}

function clampNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Pure zakat arithmetic: zakatable base x rate at the ḥawl date. The base method + rate are user-authored
 * settings. Clamps a negative/non-finite base to zero (never a negative obligation).
 */
export function computeZakat(input: ComputeZakatInput): ZakatComputation {
  const baseMethod = input.base_method ?? DEFAULT_ZAKAT_BASE_METHOD
  const rate = Number.isFinite(input.rate) && (input.rate as number) >= 0 ? (input.rate as number) : DEFAULT_ZAKAT_RATE

  let rawBase: number
  if (baseMethod === 'net_current_assets') {
    rawBase = input.net_current_assets ?? 0
  } else {
    rawBase = clampNonNegative(input.holdings_market_value) + clampNonNegative(input.cash)
  }

  const zakatable_base = roundMoney(clampNonNegative(rawBase))
  const zakat_due = roundMoney(zakatable_base * rate)

  return { base_method: baseMethod, zakatable_base, rate, zakat_due }
}

export type ZakatStatementOptions = {
  /** The user's annual zakat anniversary (the ḥawl date), an ISO date (YYYY-MM-DD). */
  hawl_date: string
  currency: string
  base_method?: ZakatBaseMethod
  /** Required input when base_method === 'net_current_assets' (user-authored). */
  net_current_assets?: number
  rate?: number
  recorded_at?: string
}

export type ZakatStatement = {
  hawl_date: string
  currency: string
  base_method: ZakatBaseMethod
  holdings_market_value: number
  cash: number
  zakatable_base: number
  rate: number
  zakat_due: number
  is_observation: true
  caveats: string[]
  missing_data_warnings: string[]
}

const ZAKAT_CAVEATS = [
  'Tracking aid, not a religious, legal, tax, or financial ruling or a payment service.',
  'Zakat methodology (base method, rate, ḥawl date) is a user-authored setting, not an Owlfolio judgment.',
  'Owlfolio never disburses zakat automatically; the human authors the actual zakat payment.',
]

/**
 * Zakat statement (read-only projection) at the ḥawl date. Holdings market value + cash are derived
 * deterministically from the accounting snapshot bounded by the ḥawl date. Produces NO payment event.
 */
export function projectZakatStatement(
  events: LedgerEventEnvelope<unknown>[],
  options: ZakatStatementOptions,
): ZakatStatement {
  const snapshot = projectAccountingSnapshot(events, {
    snapshot_id: `zakat_${options.hawl_date}`,
    period_start: '0000-01-01',
    period_end: options.hawl_date,
    currency: options.currency,
    recorded_at: options.recorded_at ?? `${options.hawl_date}T00:00:00.000Z`,
  })

  const computation = computeZakat({
    holdings_market_value: snapshot.current_value,
    cash: snapshot.cash_balance,
    ...(options.net_current_assets === undefined ? {} : { net_current_assets: options.net_current_assets }),
    ...(options.base_method === undefined ? {} : { base_method: options.base_method }),
    ...(options.rate === undefined ? {} : { rate: options.rate }),
  })

  const missing_data_warnings = snapshot.missing_data_warnings.map((warning) => warning.message)

  return {
    hawl_date: options.hawl_date,
    currency: options.currency,
    base_method: computation.base_method,
    holdings_market_value: roundMoney(snapshot.current_value),
    cash: roundMoney(snapshot.cash_balance),
    zakatable_base: computation.zakatable_base,
    rate: computation.rate,
    zakat_due: computation.zakat_due,
    is_observation: true,
    caveats: [...ZAKAT_CAVEATS],
    missing_data_warnings,
  }
}
