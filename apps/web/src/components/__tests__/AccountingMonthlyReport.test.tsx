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
    cash_balance: 0,
    deposits: 0,
    withdrawals: 0,
    cash_ledger_status: 'placeholder',
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
    expect(html).toContain('Current period summary')
    expect(html).toContain('June 2026')
    expect(html).toContain('Projected NAV (manual valuations)')
    expect(html).toContain('as of 2026-06-30')
    expect(html).toContain('$2,925.00')
    expect(html).toContain('Invested cost basis')
    expect(html).toContain('$2,640.30')
    expect(html).toContain('Unrealized P&amp;L')
    expect(html).toContain('$284.70')
    expect(html).toContain('Cash balance (placeholder)')
    expect(html).toContain('Deposits (untracked)')
    expect(html).toContain('Withdrawals (untracked)')
    expect(html).toContain('Fees and dividends are not modeled yet')
    expect(html).toContain('MSFT')
    expect(html).toContain('Shares: 3.25')
    expect(html).toContain('Manual valuation freshness: 2026-06-01')
    expect(html).toContain('Snapshot history')
    expect(html).toContain('2026-05-31')
    expect(html).toContain('Audit/source links preview')
    expect(html).toContain('Cash, deposits, and withdrawals are placeholders')
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
    expect(html).toContain('Zero totals are expected until you open a holding and record a manual valuation.')
    expect(html).toContain('Current projected NAV: $125.00')
    expect(html).toContain('Next step: open a holding, record lot data, then add a manual valuation snapshot.')
    expect(html).toContain('Source/audit preview: future cash, dividend, fee, and valuation events will appear here with ledger links.')
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
        limitations: ['Cash, deposits, and withdrawals are placeholders until cash ledger events are modeled.'],
      },
    }))

    expect(html).toContain('Missing valuations')
    expect(html).toContain('1 holding needs a valuation before NAV is complete')
    expect(html).toContain('Valuation missing')
  })
})
