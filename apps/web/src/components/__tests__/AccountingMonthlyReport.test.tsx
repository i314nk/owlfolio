import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { AccountingSnapshotProjection } from '@owlfolio/ledger/projections/accountingProjection'

import { AccountingMonthlyReport } from '../AccountingMonthlyReport'

function snapshot(overrides: Partial<AccountingSnapshotProjection> = {}): AccountingSnapshotProjection {
  return {
    snapshot_id: 'acct_2026_06',
    period_start: '2026-06-01',
    period_end: '2026-06-30',
    currency: 'USD',
    nav: 2925,
    current_value: 2925,
    invested_cost_basis: 2640.3,
    unrealized_gain_loss: 284.7,
    realized_gain_loss: 0,
    cash_balance: 0,
    deposits: 0,
    withdrawals: 0,
    dividends: 0,
    fees: 0,
    net_cash_flow: 0,
    cash_ledger_status: 'placeholder',
    cash_flows: [],
    audit_event_ids: ['evt_holding_opened_msft', 'evt_holding_valuation_msft'],
    source_ids: ['manual-valuation:MSFT:2026-06-01'],
    missing_data_warnings: [],
    missing_valuation_holding_ids: [],
    holdings: [
      {
        holding_id: 'holding_msft_001',
        ticker: 'MSFT',
        currency: 'USD',
        shares: 3.25,
        cost_basis: 2640.3,
        current_value: 2925,
        unrealized_gain_loss: 284.7,
        valuation_status: 'valued',
        latest_valuation_at: '2026-06-01',
        valuation_event_id: 'evt_holding_valuation_msft',
        valuation_source: 'manual-entry',
        valuation_source_ids: ['manual-valuation:MSFT:2026-06-01'],
      },
    ],
    updated_at: '2026-06-30T23:59:00.000Z',
    ...overrides,
  }
}

describe('AccountingMonthlyReport', () => {
  it('renders current period summary, snapshot history, holdings, and cash limitations', () => {
    const current = snapshot()
    const html = renderToStaticMarkup(createElement(AccountingMonthlyReport, {
      report: {
        current_period_snapshot: current,
        snapshot_history: [current, snapshot({ snapshot_id: 'acct_2026_05', period_start: '2026-05-01', period_end: '2026-05-31', nav: 2640.3, current_value: 2640.3, unrealized_gain_loss: 0 })],
        limitations: [
          'Cash, deposits, and withdrawals are placeholders until cash ledger events are modeled.',
          'NAV currently equals valued holdings plus placeholder cash balance.',
        ],
      },
    }))

    expect(html).toContain('Monthly accounting report')
    // Editorial chrome: serif route header + gold hairline rule + vital-signs ledger line.
    expect(html).toContain('owl-page-title')
    expect(html).toContain('owl-rule')
    expect(html).toContain('owl-ledger-line')
    expect(html).toContain('owl-ledger-figure')
    expect(html).toContain('Period NAV')
    expect(html).toContain('Return %')
    expect(html).toContain('Automatically maintained accounting projection')
    expect(html).toContain('Current state')
    expect(html).toContain('$2,925.00 NAV for June 2026')
    expect(html).toContain('Last automation calculation')
    expect(html).toContain('Source / caveat / confidence')
    expect(html).toContain('Local ledger projection')
    expect(html).toContain('User action required')
    expect(html).toContain('No user action required for current NAV coverage')
    expect(html).toContain('Snapshot ID')
    expect(html).toContain('acct_2026_06')
    expect(html).toContain('Current period summary')
    expect(html).toContain('June 2026')
    expect(html).toContain('Current NAV')
    expect(html).toContain('as of 2026-06-30')
    expect(html).toContain('$2,925.00')
    expect(html).toContain('Invested cost basis')
    expect(html).toContain('$2,640.30')
    expect(html).toContain('Unrealized P&amp;L')
    expect(html).toContain('$284.70')
    expect(html).toContain('Cash balance (placeholder)')
    expect(html).toContain('Deposits (untracked)')
    expect(html).toContain('Withdrawals (untracked)')
    expect(html).toContain('No period cash-flow ledger events are linked yet')
    expect(html).toContain('Valuation event coverage')
    expect(html).toContain('Cash ledger events: no period deposit, withdrawal, dividend, or fee events linked')
    expect(html).toContain('Broker sync: not connected for this local alpha')
    expect(html).toContain('MSFT')
    expect(html).toContain('Shares: 3.25')
    expect(html).toContain('Valuation freshness: 2026-06-01')
    expect(html).toContain('href="/audit?event_id=evt_holding_valuation_msft#evt_holding_valuation_msft"')
    expect(html).toContain('manual-valuation:MSFT:2026-06-01')
    expect(html).toContain('Snapshot history')
    expect(html).toContain('2026-05-31')
    expect(html).toContain('Audit/source links preview')
    expect(html).toContain('Cash, deposit, withdrawal, dividend, and fee totals appear only when matching ledger events exist for the period.')
    expect(html).toContain('Learn: accounting controls and caveats')
    expect(html).toContain('<summary')
    expect(html).not.toContain('#047857')
    expect(html).not.toContain('#ecfdf5')
    expect(html).not.toContain('#f0fdf4')
  })

  it('renders ledger-backed cash, dividend, and fee flows separately from valuation state', () => {
    const current = snapshot({
      nav: 1457.5,
      current_value: 250,
      invested_cost_basis: 200,
      unrealized_gain_loss: 50,
      cash_balance: 1207.5,
      deposits: 200,
      withdrawals: 0,
      dividends: 8.75,
      fees: 1.25,
      net_cash_flow: 207.5,
      cash_ledger_status: 'ledger_backed',
      audit_event_ids: ['evt_cash_deposit_june', 'evt_dividend_cost_june', 'evt_fee_june'],
      source_ids: ['broker_dividend_notice_2026_06'],
      cash_flows: [
        { event_id: 'evt_cash_deposit_june', flow_type: 'deposit', amount: 200, currency: 'USD', occurred_at: '2026-06-05', cash_account_id: 'cash_usd', source_ids: [] },
        { event_id: 'evt_dividend_cost_june', flow_type: 'dividend', amount: 8.75, currency: 'USD', occurred_at: '2026-06-15', cash_account_id: 'cash_usd', holding_id: 'holding_msft_001', source_ids: ['broker_dividend_notice_2026_06'] },
        { event_id: 'evt_fee_june', flow_type: 'fee', amount: -1.25, currency: 'USD', occurred_at: '2026-06-20', cash_account_id: 'cash_usd', source_ids: [] },
      ],
      holdings: [
        {
          holding_id: 'holding_msft_001',
          ticker: 'MSFT',
          currency: 'USD',
          shares: 2,
          cost_basis: 200,
          current_value: 250,
          unrealized_gain_loss: 50,
          valuation_status: 'valued',
          latest_valuation_at: '2026-06-30',
        },
      ],
    })

    const html = renderToStaticMarkup(createElement(AccountingMonthlyReport, {
      report: {
        current_period_snapshot: current,
        snapshot_history: [current],
        limitations: ['Cash, dividends, and fees are ledger-backed local tracking aids, not broker statements or tax reports.'],
      },
    }))

    expect(html).toContain('Cash balance (ledger-backed)')
    expect(html).toContain('$1,207.50 (ledger_backed)')
    expect(html).toContain('Deposits')
    expect(html).toContain('$200.00')
    expect(html).toContain('Dividends')
    expect(html).toContain('$8.75')
    expect(html).toContain('Fees')
    expect(html).toContain('$1.25')
    expect(html).toContain('Net cash flow')
    expect(html).toContain('$207.50')
    expect(html).toContain('Cash-flow ledger events')
    expect(html).toContain('evt_dividend_cost_june')
    expect(html).toContain('Dividend')
    expect(html).toContain('broker_dividend_notice_2026_06')
    expect(html).toContain('Cash ledger events: 3 period events linked')
    expect(html).not.toContain('Fees and dividends are not modeled yet')
    expect(html).toContain('href="/audit?event_id=evt_dividend_cost_june#evt_dividend_cost_june"')
  })

  it('renders an honest zero-state with next steps and audit affordance previews', () => {
    const current = snapshot({
      nav: 125,
      current_value: 0,
      invested_cost_basis: 0,
      unrealized_gain_loss: 0,
      cash_balance: 125,
      holdings: [],
      missing_valuation_holding_ids: [],
    })
    const html = renderToStaticMarkup(createElement(AccountingMonthlyReport, {
      report: {
        current_period_snapshot: current,
        snapshot_history: [],
        limitations: ['Fees, dividends, deposits, and withdrawals remain untracked manual placeholders in this alpha.'],
      },
    }))

    expect(html).toContain('No holdings are present for this accounting period yet.')
    expect(html).toContain('Zero-total empty state')
    expect(html).toContain('No holdings yet')
    expect(html).not.toContain('Valuations current')
    expect(html).toContain('Zero totals are expected until ledger valuation or cash-flow events exist for an opened holding.')
    expect(html).toContain('Current projected NAV: $125.00')
    expect(html).toContain('Next step: open a holding, record lot data, then let valuation/cash-flow events feed accounting automatically.')
    expect(html).toContain('Open portfolio')
    expect(html).toContain('View audit trail')
    expect(html).toContain('$0.00')
  })

  it('surfaces missing valuations as an accounting alert instead of hiding them from the user', () => {
    const html = renderToStaticMarkup(createElement(AccountingMonthlyReport, {
      report: {
        current_period_snapshot: snapshot({
          nav: 0,
          current_value: 0,
          unrealized_gain_loss: 0,
          missing_valuation_holding_ids: ['holding_msft_001'],
          holdings: [
            {
              holding_id: 'holding_msft_001',
              ticker: 'MSFT',
              currency: 'USD',
              shares: 3.25,
              cost_basis: 2640.3,
              valuation_status: 'missing_valuation',
            },
          ],
        }),
        snapshot_history: [],
        limitations: ['Cash, deposit, withdrawal, dividend, and fee totals appear only when matching ledger events exist for the period.'],
      },
    }))

    expect(html).toContain('Missing valuations')
    expect(html).toContain('1 holding needs a valuation before NAV is complete')
    expect(html).toContain('Missing-data warnings')
    expect(html).toContain('Valuation missing')
    expect(html).toContain('color:var(--owl-color-risk-bright)')
  })
})
