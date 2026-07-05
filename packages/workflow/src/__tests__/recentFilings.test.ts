import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildReadableRecentFilings, selectLatestAnnualFiling, selectRecentReadableFilings, type FilingRef } from '../secEdgar.js'

const here = dirname(fileURLToPath(import.meta.url))
const costSubs = JSON.parse(readFileSync(join(here, '..', '__fixtures__', 'sec-edgar', 'cost-submissions.json'), 'utf8'))
const novoSubs = JSON.parse(readFileSync(join(here, '..', '__fixtures__', 'sec-edgar', 'novo-submissions.json'), 'utf8'))

describe('buildReadableRecentFilings', () => {
  const filings = buildReadableRecentFilings(costSubs, '0000909832')

  it('returns only 8-K / 10-Q (and amendments) — never 10-K, DEF 14A, or Form 4', () => {
    expect(filings.length).toBeGreaterThan(0)
    const forms = new Set(filings.map((f) => f.form))
    for (const f of forms) expect(['8-K', '8-K/A', '10-Q', '10-Q/A']).toContain(f)
    expect(forms.has('10-Q')).toBe(true)
    expect(forms.has('8-K')).toBe(true)
  })

  it('builds Archives URLs and is newest-first', () => {
    expect(filings[0]!.url).toContain('https://www.sec.gov/Archives/edgar/data/909832/')
    for (let i = 1; i < filings.length; i++) {
      expect(filings[i - 1]!.filed >= filings[i]!.filed).toBe(true)
    }
  })
})

describe('selectRecentReadableFilings', () => {
  const ref = (form: string, filed: string): FilingRef => ({ form, filed, url: `https://www.sec.gov/x/${form}-${filed}` })
  const fundamentals = {
    filings: [ref('10-K', '2025-10-08')],
    recent_filings: [ref('8-K', '2026-02-01'), ref('10-Q', '2025-12-15'), ref('8-K', '2025-09-01'), ref('10-Q', '2025-06-01')],
  }

  it('keeps only filings filed AFTER the latest annual, newest-first', () => {
    const sel = selectRecentReadableFilings(fundamentals, { max: 5 })
    expect(sel.map((f) => f.filed)).toEqual(['2026-02-01', '2025-12-15'])
  })

  it('caps to max', () => {
    const many = { filings: [ref('10-K', '2020-01-01')], recent_filings: fundamentals.recent_filings }
    expect(selectRecentReadableFilings(many, { max: 2 })).toHaveLength(2)
  })

  it('fail-closed: no recent_filings → []', () => {
    expect(selectRecentReadableFilings({ filings: [ref('10-K', '2025-10-08')] }, {})).toEqual([])
  })

  it('anchors on a 20-F for a foreign filer (isAnnualForm, not 10-K-literal)', () => {
    const foreign = {
      filings: [ref('20-F', '2026-02-04')],
      recent_filings: [ref('6-K', '2026-04-30'), ref('6-K', '2025-08-07')],
    }
    expect(selectRecentReadableFilings(foreign, { max: 5 }).map((f) => f.filed)).toEqual(['2026-04-30'])
  })
})

describe('foreign-filer interim coverage (6-K)', () => {
  const filings = buildReadableRecentFilings(novoSubs, '0000353278')

  it('returns 6-K and 6-K/A rows, never 20-F', () => {
    const forms = new Set(filings.map((f) => f.form))
    expect(forms.has('6-K')).toBe(true)
    expect(forms.has('6-K/A')).toBe(true)
    expect(forms.has('20-F')).toBe(false)
  })

  it('builds Archives URLs, newest-first', () => {
    expect(filings[0]!.url).toContain('https://www.sec.gov/Archives/edgar/data/353278/')
    expect(filings[0]!.filed).toBe('2026-04-30')
  })
})

describe('selectLatestAnnualFiling', () => {
  const ref = (form: string, filed: string): FilingRef => ({ form, filed, url: `https://www.sec.gov/x/${form}-${filed}` })

  it('returns the newest annual filing regardless of form (10-K filer)', () => {
    expect(selectLatestAnnualFiling({ filings: [ref('10-K', '2025-10-08'), ref('10-K', '2024-10-09')] })?.filed).toBe('2025-10-08')
  })

  it('returns a 20-F for a foreign filer', () => {
    expect(selectLatestAnnualFiling({ filings: [ref('20-F', '2026-02-04')] })?.form).toBe('20-F')
  })

  it('fail-closed: no filings → undefined', () => {
    expect(selectLatestAnnualFiling({})).toBeUndefined()
    expect(selectLatestAnnualFiling({ filings: [] })).toBeUndefined()
  })
})
