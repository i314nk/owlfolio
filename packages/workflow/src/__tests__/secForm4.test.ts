import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  classifyTransactionCode,
  computeInsiderSummary,
  parseForm4Ownership,
  resolveInsiderSummary,
  selectRecentForm4Filings,
  type Form4Filing,
  type Form4Transaction,
} from '../secForm4'
import { buildForm4Filings, type FilingRef } from '../secEdgar'

function tx(partial: Partial<Form4Transaction> & Pick<Form4Transaction, 'code' | 'shares'>): Form4Transaction {
  return {
    security_title: 'Common Stock',
    transaction_date: '2026-06-01',
    transaction_class: classifyTransactionCode(partial.code),
    acquired_disposed: partial.code === 'P' ? 'A' : 'D',
    price_per_share: undefined,
    shares_owned_following: undefined,
    direct_or_indirect: 'D',
    derivative: false,
    ...partial,
  }
}

function filing(owner: Partial<Form4Filing['owner']> & { name: string }, transactions: Form4Transaction[]): Form4Filing {
  return {
    issuer_symbol: 'XYZ',
    issuer_cik: '0000000001',
    period_of_report: '2026-06-01',
    owner: {
      cik: '0000000009',
      is_officer: true,
      is_director: false,
      is_ten_percent_owner: false,
      officer_title: 'CEO',
      ...owner,
    },
    transactions,
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const fixtureDir = join(here, '..', '__fixtures__', 'sec-edgar')
function fixtureText(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8')
}

// ---------------------------------------------------------------------------
// Transaction-code classification — the core correctness constraint.
// Discretionary (P/S) trades are the signal; mechanical (M/F/A) RSU/option/tax
// activity must NEVER be counted as a discretionary buy/sell.
// ---------------------------------------------------------------------------

describe('classifyTransactionCode', () => {
  it('classifies open-market purchase (P) as a discretionary buy', () => {
    expect(classifyTransactionCode('P')).toBe('discretionary_buy')
  })

  it('classifies open-market sale (S) as a discretionary sell', () => {
    expect(classifyTransactionCode('S')).toBe('discretionary_sell')
  })

  it('classifies RSU/option exercise (M), tax withholding (F), and grants (A) as mechanical', () => {
    expect(classifyTransactionCode('M')).toBe('mechanical')
    expect(classifyTransactionCode('F')).toBe('mechanical')
    expect(classifyTransactionCode('A')).toBe('mechanical')
  })

  it('classifies gifts and unknown codes as other (neither discretionary nor mechanical)', () => {
    expect(classifyTransactionCode('G')).toBe('other')
    expect(classifyTransactionCode('Z')).toBe('other')
    expect(classifyTransactionCode('')).toBe('other')
  })

  it('is case-insensitive (SEC codes are uppercase but be robust)', () => {
    expect(classifyTransactionCode('p')).toBe('discretionary_buy')
    expect(classifyTransactionCode('s')).toBe('discretionary_sell')
  })
})

// ---------------------------------------------------------------------------
// parseForm4Ownership — deterministic, namespace-agnostic, fail-closed.
// The AAPL fixture is an all-RSU filing (codes M/F): it must parse cleanly but
// contain ZERO discretionary trades.
// ---------------------------------------------------------------------------

describe('parseForm4Ownership', () => {
  it('parses issuer, reporting owner, relationship, and transactions from a real Form 4', () => {
    const filing = parseForm4Ownership(fixtureText('aapl-form4-rsu.xml'))
    expect(filing).toBeDefined()
    if (filing === undefined) return

    expect(filing.issuer_symbol).toBe('AAPL')
    expect(filing.issuer_cik).toBe('0000320193')
    expect(filing.period_of_report).toBe('2026-06-15')

    expect(filing.owner.name).toBe('Newstead Jennifer')
    expect(filing.owner.cik).toBe('0001780525')
    expect(filing.owner.is_officer).toBe(true)
    expect(filing.owner.is_director).toBe(false)
    expect(filing.owner.is_ten_percent_owner).toBe(false)
    expect(filing.owner.officer_title).toBe('SVP, GC and Secretary')

    // 2 non-derivative transactions + 1 derivative transaction.
    expect(filing.transactions).toHaveLength(3)
  })

  it('extracts the M (RSU settlement) row with a footnote-only price as undefined, not zero', () => {
    const filing = parseForm4Ownership(fixtureText('aapl-form4-rsu.xml'))
    const m = filing?.transactions.find((t) => t.code === 'M' && !t.derivative)
    expect(m).toMatchObject({
      security_title: 'Common Stock',
      transaction_date: '2026-06-15',
      code: 'M',
      transaction_class: 'mechanical',
      acquired_disposed: 'A',
      shares: 30104,
      price_per_share: undefined, // footnoteId only — price unknown, MUST NOT be 0
      shares_owned_following: 57784,
      direct_or_indirect: 'D',
      derivative: false,
    })
  })

  it('extracts the F (tax-withholding) row with its real price and disposed code', () => {
    const filing = parseForm4Ownership(fixtureText('aapl-form4-rsu.xml'))
    const f = filing?.transactions.find((t) => t.code === 'F')
    expect(f).toMatchObject({
      code: 'F',
      transaction_class: 'mechanical',
      acquired_disposed: 'D',
      shares: 16238,
      price_per_share: 296.42,
      shares_owned_following: 41546,
    })
  })

  it('tags derivative-table transactions as derivative', () => {
    const filing = parseForm4Ownership(fixtureText('aapl-form4-rsu.xml'))
    const deriv = filing?.transactions.filter((t) => t.derivative)
    expect(deriv).toHaveLength(1)
    expect(deriv?.[0]).toMatchObject({ security_title: 'Restricted Stock Unit', code: 'M', shares: 30104 })
  })

  it('returns undefined for empty/malformed xml (fail-closed)', () => {
    expect(parseForm4Ownership('')).toBeUndefined()
    expect(parseForm4Ownership('<not-a-form4/>')).toBeUndefined()
    // @ts-expect-error — defends the runtime guard against non-string input
    expect(parseForm4Ownership(undefined)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// computeInsiderSummary — the "code computes" deterministic rollup.
// ---------------------------------------------------------------------------

const AS_OF = '2026-06-30'

describe('computeInsiderSummary', () => {
  it('reports zero discretionary activity for an all-RSU filing (mechanics are NOT sales)', () => {
    const aapl = parseForm4Ownership(fixtureText('aapl-form4-rsu.xml'))
    const summary = computeInsiderSummary(aapl === undefined ? [] : [aapl], { asOf: AS_OF })
    expect(summary.computable).toBe(true)
    if (!summary.computable) return
    expect(summary.discretionary_buy_shares).toBe(0)
    expect(summary.discretionary_sell_shares).toBe(0)
    expect(summary.distinct_sellers).toBe(0)
    expect(summary.mechanical_disposed_shares).toBe(16238) // the F (tax-withholding) row, surfaced separately
    expect(summary.cluster).toBeUndefined()
  })

  it('tallies a discretionary sale with value and role split', () => {
    const summary = computeInsiderSummary(
      [filing({ name: 'Jane Officer', is_officer: true }, [tx({ code: 'S', shares: 1000, price_per_share: 50, transaction_date: '2026-06-10' })])],
      { asOf: AS_OF },
    )
    expect(summary.computable).toBe(true)
    if (!summary.computable) return
    expect(summary.discretionary_sell_shares).toBe(1000)
    expect(summary.discretionary_sell_value).toBe(50_000)
    expect(summary.distinct_sellers).toBe(1)
    expect(summary.officer_director_sell_shares).toBe(1000)
    expect(summary.ten_percent_owner_sell_shares).toBe(0)
  })

  it('tallies a discretionary purchase', () => {
    const summary = computeInsiderSummary(
      [filing({ name: 'Sam Director', is_officer: false, is_director: true }, [tx({ code: 'P', shares: 2000, price_per_share: 10, transaction_date: '2026-06-12' })])],
      { asOf: AS_OF },
    )
    if (!summary.computable) throw new Error('expected computable')
    expect(summary.discretionary_buy_shares).toBe(2000)
    expect(summary.discretionary_buy_value).toBe(20_000)
    expect(summary.distinct_buyers).toBe(1)
  })

  it('detects a cluster of discretionary sales by distinct insiders within the cluster window', () => {
    const summary = computeInsiderSummary(
      [
        filing({ name: 'A' }, [tx({ code: 'S', shares: 100, price_per_share: 10, transaction_date: '2026-06-05' })]),
        filing({ name: 'B' }, [tx({ code: 'S', shares: 200, price_per_share: 10, transaction_date: '2026-06-15' })]),
        filing({ name: 'C' }, [tx({ code: 'S', shares: 300, price_per_share: 10, transaction_date: '2026-06-20' })]),
      ],
      { asOf: AS_OF },
    )
    if (!summary.computable) throw new Error('expected computable')
    expect(summary.cluster).toBeDefined()
    expect(summary.cluster?.discretionary_sell_count).toBe(3)
    expect(summary.cluster?.distinct_sellers).toBe(3)
    expect(summary.cluster?.net_sell_value).toBe(6_000)
  })

  it('excludes transactions outside the trailing window', () => {
    const summary = computeInsiderSummary(
      [filing({ name: 'Old Seller' }, [tx({ code: 'S', shares: 9999, price_per_share: 10, transaction_date: '2024-01-01' })])],
      { asOf: AS_OF, windowMonths: 12 },
    )
    expect(summary.computable).toBe(false)
  })

  it('is not computable when there are no filings or no in-window transactions', () => {
    expect(computeInsiderSummary([], { asOf: AS_OF }).computable).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Parser on a real open-market SALE (code S) — the discretionary signal.
// ---------------------------------------------------------------------------

describe('parseForm4Ownership (open-market sale)', () => {
  it('parses an S transaction as a discretionary sell with price and disposed code', () => {
    const filing = parseForm4Ownership(fixtureText('insider-form4-sale.xml'))
    expect(filing?.issuer_symbol).toBe('WDGT')
    const s = filing?.transactions[0]
    expect(s).toMatchObject({
      code: 'S',
      transaction_class: 'discretionary_sell',
      acquired_disposed: 'D',
      shares: 5000,
      price_per_share: 150,
      shares_owned_following: 45000,
    })
  })
})

// ---------------------------------------------------------------------------
// selectRecentForm4Filings + resolveInsiderSummary — the live fetch orchestration
// (injected fetch; never touches the network).
// ---------------------------------------------------------------------------

function ref(filed: string, url: string): FilingRef {
  return { form: '4', filed, url }
}

describe('buildForm4Filings (raw-XML URL normalization)', () => {
  // EDGAR's submissions `primaryDocument` for a Form 4 is the XSL-RENDERED HTML path
  // (e.g. `xslF345X06/form4.xml`); the machine-readable ownership XML is the SAME filename with the
  // `xsl.../` render-prefix stripped. buildForm4Filings must return the raw-XML URL so the parser works.
  const subs = {
    filings: {
      recent: {
        form: ['4', '10-K'],
        filingDate: ['2026-06-17', '2026-02-01'],
        accessionNumber: ['0001140361-26-025622', '0000320193-26-000002'],
        primaryDocument: ['xslF345X06/form4.xml', 'aapl-10k.htm'],
      },
    },
  } as unknown as Parameters<typeof buildForm4Filings>[0]

  it('returns only Form 4 rows with the XSL render-prefix stripped to the raw XML url', () => {
    const filings = buildForm4Filings(subs, '0000320193')
    expect(filings).toHaveLength(1)
    expect(filings[0]?.url).toBe(
      'https://www.sec.gov/Archives/edgar/data/320193/000114036126025622/form4.xml',
    )
  })
})

describe('selectRecentForm4Filings', () => {
  it('drops filings older than the trailing window and caps the count, newest-first', () => {
    const filings = [
      ref('2026-06-20', 'a'),
      ref('2026-01-10', 'b'),
      ref('2024-01-01', 'c'), // outside 12 months
    ]
    const selected = selectRecentForm4Filings(filings, { asOf: AS_OF, withinMonths: 12, max: 40 })
    expect(selected.map((f) => f.url)).toEqual(['a', 'b'])
  })

  it('caps to max and keeps the newest', () => {
    const filings = [ref('2026-06-20', 'a'), ref('2026-06-19', 'b'), ref('2026-06-18', 'c')]
    const selected = selectRecentForm4Filings(filings, { asOf: AS_OF, withinMonths: 12, max: 2 })
    expect(selected.map((f) => f.url)).toEqual(['a', 'b'])
  })
})

describe('resolveInsiderSummary', () => {
  const saleXml = fixtureText('insider-form4-sale.xml')

  it('fetches, parses, and aggregates the selected Form 4 documents', async () => {
    const summary = await resolveInsiderSummary(
      [ref('2026-06-12', 'https://www.sec.gov/Archives/edgar/data/42/x/form4.xml')],
      { asOf: AS_OF },
      { fetchDocument: async () => saleXml },
    )
    expect(summary.computable).toBe(true)
    if (!summary.computable) return
    expect(summary.discretionary_sell_shares).toBe(5000)
    expect(summary.discretionary_sell_value).toBe(750_000)
    expect(summary.distinct_sellers).toBe(1)
  })

  it('skips documents that fail to fetch (fail-closed) and is not computable when all fail', async () => {
    const summary = await resolveInsiderSummary(
      [ref('2026-06-12', 'u1'), ref('2026-06-11', 'u2')],
      { asOf: AS_OF },
      { fetchDocument: async () => undefined },
    )
    expect(summary.computable).toBe(false)
  })

  it('is not computable for an empty filing list', async () => {
    const summary = await resolveInsiderSummary([], { asOf: AS_OF }, { fetchDocument: async () => saleXml })
    expect(summary.computable).toBe(false)
  })
})
