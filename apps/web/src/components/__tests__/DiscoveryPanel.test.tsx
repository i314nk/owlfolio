import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { Discovery13fQuarter } from '@owlfolio/ledger/projections/discovery13fProjection'

import { DiscoveryPanel } from '../DiscoveryPanel'

// The 13F discovery page (owner-approved 2026-07-16): summary + honesty rails, latest buys (the
// triage inbox), latest sells (held/watched flagged), manager portfolio cards, dormant filers
// labeled. Render-level truth checks — the projections have their own tests.

const berkshireQuarter: Discovery13fQuarter = {
  manager_name: 'BERKSHIRE HATHAWAY INC',
  cik: '0001067983',
  period: '2026Q1',
  report_date: '2026-03-31',
  filed_date: '2026-05-14',
  total_value: 300_000_000_000,
  position_count: 40,
  top_holdings: [
    { cusip: '037833100', issuer: 'APPLE INC', ticker: 'AAPL', value: 60_000_000_000, shares: 300_000_000, pct: 0.2, change: 'UNCHANGED' },
    { cusip: '22160K105', issuer: 'COSTCO WHOLESALE CORP', ticker: 'COST', value: 3_000_000_000, shares: 3_000_000, pct: 0.01, change: 'NEW' },
  ],
  sells: [
    { manager_name: 'BERKSHIRE HATHAWAY INC', cusip: '02079K305', issuer: 'ALPHABET INC', ticker: 'GOOGL', signal_type: 'EXIT', prior_shares: 1, current_shares: 0, prior_conviction_pct: 0.02 },
  ],
  recorded_at: '2026-07-01T00:00:00.000Z',
}

function render(over: Partial<Parameters<typeof DiscoveryPanel>[0]> = {}): string {
  return renderToStaticMarkup(createElement(DiscoveryPanel, {
    candidates: [],
    quarters: [],
    sells: [],
    heldOrWatchedTickers: [],
    ...over,
  }))
}

describe('the 13F discovery page', () => {
  it('renders the summary header with the honesty rails and honest empty states', () => {
    const html = render()
    expect(html).toContain('13F discovery')
    expect(html).toContain('45 days')
    expect(html).toContain('long US equities only')
    expect(html).toContain('Nothing here is a buy or sell instruction')
    expect(html).toContain('No new buy signals')
    expect(html).toContain('No exits or meaningful trims')
    expect(html).toContain('No manager quarters harvested yet')
  })

  it('renders a manager card: name, book value, positions, the as-of/filed stamp, top holdings with QoQ chips, and quarter sells', () => {
    const html = render({ quarters: [berkshireQuarter] })
    expect(html).toContain('Berkshire Hathaway')
    expect(html).toContain('$300.0B · 40 positions')
    expect(html).toContain('AS OF 2026-03-31 · FILED 2026-05-14')
    expect(html).toContain('AAPL')
    expect(html).toContain('20.0%')
    expect(html).toContain('NEW')
    expect(html).toContain('Sold this quarter: GOOGL (exit)')
    // No performance numbers, no live prices — filing values only.
    expect(html).not.toMatch(/return/i)
  })

  it('labels the dormant/unharvested tracked managers instead of faking live books', () => {
    const html = render({ quarters: [berkshireQuarter] })
    expect(html).toContain('Pabrai')
    expect(html).toContain('below the 13F reporting threshold')
    expect(html).toContain('no quarter harvested yet')
  })

  it('renders sell rows with EXIT/TRIM chips and flags a name the user holds or watches', () => {
    const html = render({
      sells: [
        { key: 'COST', ticker: 'COST', issuer: 'COSTCO WHOLESALE CORP', signal_type: 'EXIT', managers: ['HIMALAYA CAPITAL MANAGEMENT LLC (LI LU)'], period: '2026Q1' },
        { key: 'GOOGL', ticker: 'GOOGL', issuer: 'ALPHABET INC', signal_type: 'MEANINGFUL_TRIM', managers: ['BERKSHIRE HATHAWAY INC'], period: '2026Q1' },
      ],
      heldOrWatchedTickers: ['COST'],
    })
    expect(html).toContain('EXIT')
    expect(html).toContain('TRIM &gt;25%')
    expect(html).toContain('YOU HOLD/WATCH THIS')
    expect(html).toContain('Himalaya Capital')
    // Only the held/watched row carries the flag.
    expect(html.split('YOU HOLD/WATCH THIS')).toHaveLength(2)
  })

  it('an unresolved sell renders UNRESOLVED with the issuer name — never a guessed ticker', () => {
    const html = render({
      sells: [{ key: '922908363', issuer: 'SOME OBSCURE CORP', signal_type: 'EXIT', managers: ['GIVERNY CAPITAL INC'], period: '2026Q1' }],
    })
    expect(html).toContain('UNRESOLVED')
    expect(html).toContain('Some Obscure Corp')
  })
})
