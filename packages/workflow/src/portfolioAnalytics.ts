// Pure, deterministic portfolio analytics (lifecycle-spec-v3 Module 8):
// money-weighted return (alongside the existing TWR), per-position contribution
// to total return, and the realized/unrealized split. A local accounting aid,
// never a broker statement; missing data → honest not-computable.

import { computeMoneyWeightedReturn, type MwrCashFlow, type MwrResult } from './mwr'

export type PortfolioPositionInput = {
  holding_id: string
  ticker?: string
  total_cost_basis: number
  /** Latest market value of the open position (0 if fully exited). */
  market_value: number
  /** Realized gain/loss booked on this position (closed lots). */
  realized_gain_loss: number
  /** Dividends received on this position. */
  dividends_received: number
}

export type PortfolioAnalyticsInput = {
  as_of: string
  /**
   * Dated external/position cash flows from the investor's perspective: buys
   * negative, sells + dividends positive. The ending market value is supplied
   * separately and appended as the terminal inflow for the MWR.
   */
  cashFlows: MwrCashFlow[]
  /** Total market value of open positions at as_of (terminal inflow for MWR). */
  endingMarketValue: number
  positions: PortfolioPositionInput[]
}

export type PositionContribution = {
  holding_id: string
  ticker?: string
  total_cost_basis: number
  market_value: number
  realized_gain_loss: number
  dividends_received: number
  unrealized_gain_loss: number
  /** realized + unrealized + dividends. */
  total_gain_loss: number
  /** Share of the portfolio's total gain/loss (signed); undefined when total is ~0. */
  contribution_share?: number
}

export type RealizedUnrealizedSplit = {
  /** Sum of realized P&L + dividends across positions. */
  realized_gain_loss: number
  /** Sum of unrealized (market_value − cost) across positions. */
  unrealized_gain_loss: number
  total_gain_loss: number
}

export type PortfolioAnalytics = {
  as_of: string
  mwr: MwrResult
  contributions: PositionContribution[]
  realized_unrealized: RealizedUnrealizedSplit
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits))
}

export function computePortfolioAnalytics(input: PortfolioAnalyticsInput): PortfolioAnalytics {
  // MWR: dated flows + the ending market value as a terminal positive inflow.
  const mwrFlows: MwrCashFlow[] = [...input.cashFlows]
  if (input.endingMarketValue > 0) {
    mwrFlows.push({ occurred_at: input.as_of, amount: input.endingMarketValue })
  }
  const mwr = computeMoneyWeightedReturn(mwrFlows)

  // Per-position contribution.
  const contributions: PositionContribution[] = input.positions.map((position) => {
    const unrealized = round(position.market_value - position.total_cost_basis)
    const totalGain = round(unrealized + position.realized_gain_loss + position.dividends_received)
    const contribution: PositionContribution = {
      holding_id: position.holding_id,
      total_cost_basis: round(position.total_cost_basis),
      market_value: round(position.market_value),
      realized_gain_loss: round(position.realized_gain_loss),
      dividends_received: round(position.dividends_received),
      unrealized_gain_loss: unrealized,
      total_gain_loss: totalGain,
    }
    if (position.ticker !== undefined) contribution.ticker = position.ticker
    return contribution
  })

  const portfolioTotalGain = contributions.reduce((sum, contribution) => sum + contribution.total_gain_loss, 0)
  if (Math.abs(portfolioTotalGain) > 1e-9) {
    for (const contribution of contributions) {
      contribution.contribution_share = round(contribution.total_gain_loss / portfolioTotalGain, 6)
    }
  }

  const realized = round(
    input.positions.reduce((sum, position) => sum + position.realized_gain_loss + position.dividends_received, 0),
  )
  const unrealized = round(
    input.positions.reduce((sum, position) => sum + (position.market_value - position.total_cost_basis), 0),
  )

  return {
    as_of: input.as_of,
    mwr,
    contributions,
    realized_unrealized: {
      realized_gain_loss: realized,
      unrealized_gain_loss: unrealized,
      total_gain_loss: round(realized + unrealized),
    },
  }
}
