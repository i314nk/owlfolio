import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { Discovery13fQuarter } from '@owlfolio/ledger/projections/discovery13fProjection'

import { buildActionMatrix, DiscoveryPanel, investorInitials } from '../DiscoveryPanel'

// The 13F discovery page (owner-approved 2026-07-16): summary + honesty rails, the manager-action
// heat-map matrix (rows = names, columns = the tracked investors, green ▲ buys / red-amber ▼ sells,
// held/watched flagged), manager portfolio cards, dormant filers labeled. Render-level truth
// checks — the projections have their own tests.

function quarter(over: Partial<Discovery13fQuarter>): Discovery13fQuarter {
  return {
    manager_name: 'Berkshire Hathaway Inc (Warren Buffett)',
    cik: '0001067983',
    period: '2026Q1',
    report_date: '2026-03-31',
    filed_date: '2026-05-14',
    total_value: 300_000_000_000,
    position_count: 40,
    top_holdings: [
      { cusip: '037833100', issuer: 'APPLE INC', ticker: 'AAPL', value: 60_000_000_000, shares: 300_000_000, pct: 0.2, change: 'UNCHANGED' },
    ],
    buys: [],
    sells: [],
    recorded_at: '2026-07-01T00:00:00.000Z',
    ...over,
  }
}

const berkshireQuarter = quarter({
  buys: [{ cusip: '92826C839', issuer: 'VISA INC', ticker: 'V', signal_type: 'NEW_POSITION', conviction_pct: 0.06 }],
  sells: [{ manager_name: 'Berkshire Hathaway Inc (Warren Buffett)', cusip: '02079K305', issuer: 'ALPHABET INC', ticker: 'GOOGL', signal_type: 'EXIT', prior_shares: 1, current_shares: 0, prior_conviction_pct: 0.02 }],
})
const himalayaQuarter = quarter({
  manager_name: 'Himalaya Capital Management LLC (Li Lu)',
  cik: '0001709323',
  total_value: 3_000_000_000,
  position_count: 14,
  top_holdings: [],
  buys: [{ cusip: '92826C839', issuer: 'VISA INC', ticker: 'V', signal_type: 'MEANINGFUL_ADD', conviction_pct: 0.01 }],
  sells: [{ manager_name: 'Himalaya Capital Management LLC (Li Lu)', cusip: '22160K105', issuer: 'COSTCO WHOLESALE CORP', ticker: 'COST', signal_type: 'MEANINGFUL_TRIM', prior_shares: 4, current_shares: 2, prior_conviction_pct: 0.1 }],
})

function render(over: Partial<Parameters<typeof DiscoveryPanel>[0]> = {}): string {
  return renderToStaticMarkup(createElement(DiscoveryPanel, {
    candidates: [],
    quarters: [],
    heldTickers: [],
    watchedTickers: [],
    ...over,
  }))
}

describe('buildActionMatrix', () => {
  it('one row per name, one cell per manager; the most-acted names rank first', () => {
    const matrix = buildActionMatrix([berkshireQuarter, himalayaQuarter])
    expect(matrix.map((r) => r.key)).toEqual(['V', 'COST', 'GOOGL'])
    const visa = matrix[0]!
    expect(visa.buying).toBe(2)
    expect(visa.selling).toBe(0)
    expect(visa.cells.get('0001067983')).toMatchObject({ signal: 'NEW_POSITION', conviction_pct: 0.06 })
    expect(visa.cells.get('0001709323')).toMatchObject({ signal: 'MEANINGFUL_ADD', period: '2026Q1' })
    expect(matrix[1]!.cells.get('0001709323')?.signal).toBe('MEANINGFUL_TRIM')
  })

  it('an unresolved ticker keys by cusip — never guessed', () => {
    const matrix = buildActionMatrix([quarter({ buys: [{ cusip: '922908363', issuer: 'SOME OBSCURE CORP', signal_type: 'NEW_POSITION', conviction_pct: 0.01 }] })])
    expect(matrix[0]?.key).toBe('922908363')
    expect(matrix[0]?.ticker).toBeUndefined()
  })
})

describe('investorInitials', () => {
  it('derives column initials from the investor in parentheses', () => {
    expect(investorInitials('Scion Asset Management (Michael Burry)')).toBe('MB')
    expect(investorInitials('Berkshire Hathaway Inc (Warren Buffett)')).toBe('WB')
    expect(investorInitials('Himalaya Capital Management LLC (Li Lu)')).toBe('LL')
  })
})

describe('the 13F discovery page', () => {
  it('renders the summary header with the honesty rails and honest empty states', () => {
    const html = render()
    expect(html).toContain('13F discovery')
    expect(html).toContain('45 days')
    expect(html).toContain('long US equities only')
    expect(html).toContain('Nothing here is a buy or sell instruction')
    expect(html).toContain('No manager actions harvested yet')
    expect(html).toContain('No manager quarters harvested yet')
  })

  it('renders the action matrix: investor columns, ▲/▼ cells with conviction titles, rank chips, and the hold/watch flag', () => {
    const html = render({ quarters: [berkshireQuarter, himalayaQuarter], watchedTickers: ['COST'] })
    // Columns: one initial per tracked investor (7 on the roster).
    for (const initials of ['WB', 'MP', 'MB', 'LL', 'SK', 'BA', 'GS']) {
      expect(html).toContain(`>${initials}<`)
    }
    expect(html).toContain('▲')
    expect(html).toContain('▼')
    // The cell title carries the manager, the action, and the % of book — the honest tooltip.
    expect(html).toContain('Berkshire Hathaway (Warren Buffett): NEW position — 6.0% of the book · 13F 2026Q1')
    expect(html).toContain('2 BUYING')
    expect(html).toContain('1 SELLING')
    // The YOURS column: header marker + the watched glyph with its explanatory tooltip.
    expect(html).toContain('Your names: ⚑ held · ⚐ watched')
    expect(html).toContain('COST is on your watchlist')
    expect(html).toContain('⚐')
    // No performance numbers, no live prices — filing values only.
    expect(html).not.toMatch(/return/i)
  })

  it('one home per name: a HELD name gets a portfolio route instead of admission triage (SPGI dogfood)', () => {
    const spgiBuy = quarter({
      buys: [{ cusip: '78409V104', issuer: 'S&amp;P GLOBAL INC', ticker: 'SPGI', signal_type: 'NEW_POSITION', conviction_pct: 0.016 }],
    })
    const candidates = [{
      candidate_id: 'cand_spgi', ticker: 'SPGI', company_name: 'S&P Global', market: 'US',
      strategy_id: 'buffett-munger', discovery_source: '13f_clone', status: 'discovered',
      dedupe_key: 'spgi', discovered_at: '2026-07-16', source_ids: [],
    }] as never
    const html = render({ quarters: [spgiBuy], candidates, heldTickers: ['SPGI'] })
    expect(html).toContain('You hold SPGI — review your own thesis')
    expect(html).toContain('You hold this name')
    expect(html).toContain('/portfolio')
    // No admission triage on a name that already has a home.
    expect(html).not.toContain('Accept for screening')
    // The XML entity decodes for display even on legacy payloads.
    expect(html).toContain('S&amp;P Global Inc')  // '&' re-escaped by React: the DECODED name, cased right
    expect(html).not.toContain('Amp;p')
  })

  it('names the investor alongside the firm on manager cards — mapping legacy SEC filer names via the CIK', () => {
    const legacySecName = quarter({ manager_name: 'BAUPOST GROUP LLC/MA', cik: '0001061768' })
    const html = render({ quarters: [legacySecName] })
    expect(html).toContain('Baupost Group (Seth Klarman)')
    expect(html).not.toContain('BAUPOST GROUP LLC/MA')
  })

  it('labels the dormant/unharvested tracked managers instead of faking live books', () => {
    const html = render({ quarters: [berkshireQuarter] })
    expect(html).toContain('Pabrai')
    expect(html).toContain('below the 13F reporting threshold')
    expect(html).toContain('no quarter harvested yet')
  })

  it('an UNRESOLVED matrix row attaches its triage candidate by cusip; no leftover card renders', () => {
    const spierBuy = quarter({
      manager_name: 'Aquamarine Capital (Guy Spier)',
      cik: '0002104187',
      buys: [{ cusip: 'G6683N103', issuer: 'NU HLDGS LTD', signal_type: 'NEW_POSITION', conviction_pct: 0.03 }],
    })
    const candidates = [{
      candidate_id: 'cand_nu', ticker: 'UNRESOLVED:G6683N103', company_name: 'NU HLDGS LTD', market: 'US',
      strategy_id: 'buffett-munger', discovery_source: '13f_clone', status: 'discovered',
      dedupe_key: 'nu', discovered_at: '2026-07-16', source_ids: [],
    }, {
      candidate_id: 'cand_orphan', ticker: 'ADP', company_name: 'AUTOMATIC DATA PROC', market: 'US',
      strategy_id: 'buffett-munger', discovery_source: '13f_clone', status: 'discovered',
      dedupe_key: 'adp', discovered_at: '2026-07-10', source_ids: [],
    }] as never
    const html = render({ quarters: [spierBuy], candidates })
    // The unresolved row exists and carries the accept/reject triage (matched via the cusip).
    expect(html).toContain('data-matrix-row="G6683N103"')
    expect(html).toContain('Accept')
    // The removed-manager orphan (ADP) gets NO surface — the card is gone (owner 2026-07-16);
    // its candidate event remains in the ledger/audit only.
    expect(html).not.toContain('Other pending candidates')
    expect(html).not.toContain('ADP')
  })

  it('flags lagging filers so an old book never reads as current', () => {
    const scion = quarter({ manager_name: 'Scion Asset Management (Michael Burry)', cik: '0001649339', period: '2025Q3', report_date: '2025-09-30', filed_date: '2025-11-03' })
    const html = render({ quarters: [berkshireQuarter, scion] })
    expect(html).toContain('Lagging filers: Scion Asset Management (Michael Burry) (2025Q3)')
  })
})
