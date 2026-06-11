import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Fundamentals } from '../secEdgar'
import {
  EdgarFundamentalsProvider,
  LocalManualFundamentalsProvider,
  parseLocalManualFundamentals,
  resolveFundamentalsForTicker,
} from '../fundamentalsProvider'

// A minimal valid local-manual JSON document (mirrors config/fundamentals/_TEMPLATE.json shape).
function validDoc() {
  return {
    ticker: 'TEST',
    entity_name: 'Test Entity PJSC',
    currency: 'AED',
    source: {
      annual_report_url: 'https://example.com/annual-report-2024.pdf',
      filed: '2025-03-01',
      note: 'Operator-entered from the audited annual report (consolidated income statement + balance sheet).',
    },
    latest_annual: {
      fiscal_year: 2024,
      filed: '2025-03-01',
      period_end: '2024-12-31',
      net_income_musd: 1000,
      revenue_musd: 5000,
      d_and_a_musd: 400,
      capex_musd: 600,
      diluted_shares_m: 500,
    },
    annual_series: [
      {
        fiscal_year: 2024,
        filed: '2025-03-01',
        period_end: '2024-12-31',
        net_income_musd: 1000,
        revenue_musd: 5000,
        d_and_a_musd: 400,
        capex_musd: 600,
        diluted_shares_m: 500,
      },
      {
        fiscal_year: 2023,
        filed: '2024-03-01',
        period_end: '2023-12-31',
        net_income_musd: 900,
        revenue_musd: 4500,
        diluted_shares_m: 500,
      },
    ],
  }
}

describe('parseLocalManualFundamentals', () => {
  it('parses a valid document into Fundamentals carrying the currency + provenance', () => {
    const f = parseLocalManualFundamentals(validDoc())
    expect(f).toBeDefined()
    if (f === undefined) return
    expect(f.entity_name).toBe('Test Entity PJSC')
    expect(f.currency).toBe('AED')
    expect(f.latest_annual.fiscal_year).toBe(2024)
    expect(f.latest_annual.currency).toBe('AED')
    expect(f.latest_annual.net_income_musd).toBe(1000)
    expect(f.annual_series.length).toBe(2)
    // provenance becomes a synthetic filing ref pointing at the annual report.
    expect(f.filings[0]?.url).toBe('https://example.com/annual-report-2024.pdf')
  })

  it('returns undefined fail-closed for a malformed document (missing currency)', () => {
    const bad = validDoc() as Record<string, unknown>
    delete bad['currency']
    expect(parseLocalManualFundamentals(bad)).toBeUndefined()
  })

  it('returns undefined fail-closed for a non-object', () => {
    expect(parseLocalManualFundamentals('nope')).toBeUndefined()
    expect(parseLocalManualFundamentals(null)).toBeUndefined()
  })
})

describe('LocalManualFundamentalsProvider', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'owlfolio-fund-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('resolves a ticker from a {TICKER}.json file in the store dir', async () => {
    writeFileSync(join(dir, 'DEWA.json'), JSON.stringify({ ...validDoc(), ticker: 'DEWA' }))
    const provider = new LocalManualFundamentalsProvider(dir)
    const f = await provider.resolve('DEWA')
    expect(f).toBeDefined()
    expect(f?.currency).toBe('AED')
  })

  it('is case-insensitive on the ticker', async () => {
    writeFileSync(join(dir, 'DEWA.json'), JSON.stringify({ ...validDoc(), ticker: 'DEWA' }))
    const provider = new LocalManualFundamentalsProvider(dir)
    expect(await provider.resolve('dewa')).toBeDefined()
  })

  it('returns undefined fail-closed when no file exists for the ticker', async () => {
    const provider = new LocalManualFundamentalsProvider(dir)
    expect(await provider.resolve('NOPE')).toBeUndefined()
  })

  it('skips the _TEMPLATE placeholder (never resolves it as a real name)', async () => {
    const provider = new LocalManualFundamentalsProvider(dir)
    expect(await provider.resolve('_TEMPLATE')).toBeUndefined()
  })

  it('returns undefined fail-closed for a malformed JSON file', async () => {
    writeFileSync(join(dir, 'BROKEN.json'), '{ not valid json ')
    const provider = new LocalManualFundamentalsProvider(dir)
    expect(await provider.resolve('BROKEN')).toBeUndefined()
  })
})

describe('resolveFundamentalsForTicker (resolver chain)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'owlfolio-fund-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const edgarFundamentals: Fundamentals = {
    cik: '0000909832',
    entity_name: 'EDGAR ENTITY',
    currency: 'USD',
    latest_annual: { fiscal_year: 2025, currency: 'USD', net_income_musd: 42, diluted_shares_m: 10 },
    annual_series: [{ fiscal_year: 2025, currency: 'USD', net_income_musd: 42, diluted_shares_m: 10 }],
    filings: [],
  }

  it('prefers the local-manual store over EDGAR (operator override wins)', async () => {
    writeFileSync(join(dir, 'OVR.json'), JSON.stringify({ ...validDoc(), ticker: 'OVR', entity_name: 'Local Override Co' }))
    const f = await resolveFundamentalsForTicker('OVR', {
      localStoreDir: dir,
      fetchEdgar: async () => edgarFundamentals,
    })
    expect(f?.entity_name).toBe('Local Override Co')
  })

  it('falls back to EDGAR when no local entry exists', async () => {
    const f = await resolveFundamentalsForTicker('AAPL', {
      localStoreDir: dir,
      fetchEdgar: async () => edgarFundamentals,
    })
    expect(f?.entity_name).toBe('EDGAR ENTITY')
  })

  it('returns undefined fail-closed when neither source resolves', async () => {
    const f = await resolveFundamentalsForTicker('NOPE', {
      localStoreDir: dir,
      fetchEdgar: async () => undefined,
    })
    expect(f).toBeUndefined()
  })

  it('never throws — an EDGAR fetch error degrades to undefined', async () => {
    const f = await resolveFundamentalsForTicker('AAPL', {
      localStoreDir: dir,
      fetchEdgar: async () => {
        throw new Error('network down')
      },
    })
    expect(f).toBeUndefined()
  })
})

describe('EdgarFundamentalsProvider', () => {
  it('wraps an injected EDGAR fetcher', async () => {
    const provider = new EdgarFundamentalsProvider(async (ticker) =>
      ticker === 'X'
        ? {
            cik: '1',
            entity_name: 'X Co',
            currency: 'USD',
            latest_annual: { fiscal_year: 2025, currency: 'USD' },
            annual_series: [{ fiscal_year: 2025, currency: 'USD' }],
            filings: [],
          }
        : undefined,
    )
    expect((await provider.resolve('X'))?.entity_name).toBe('X Co')
    expect(await provider.resolve('Y')).toBeUndefined()
  })
})
