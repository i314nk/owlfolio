import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildProxyFilings, selectLatestProxyFiling, type FilingRef } from '../secEdgar.js'

const here = dirname(fileURLToPath(import.meta.url))
const costSubs = JSON.parse(readFileSync(join(here, '..', '__fixtures__', 'sec-edgar', 'cost-submissions.json'), 'utf8'))

describe('buildProxyFilings', () => {
  const filings = buildProxyFilings(costSubs, '0000909832')

  it('returns only DEF 14A — never DEFA14A supplements, PX14A6G third-party solicitations, or PRE 14A', () => {
    // The fixture naturally contains DEFA14A (11), PX14A6G (8), and PRE 14A (1) as negative rows.
    expect(filings).toHaveLength(10)
    expect(new Set(filings.map((f) => f.form))).toEqual(new Set(['DEF 14A']))
  })

  it('is newest-first with Archives URLs', () => {
    expect(filings[0]!.filed).toBe('2025-12-04')
    expect(filings[0]!.url).toContain('https://www.sec.gov/Archives/edgar/data/909832/')
    expect(filings[0]!.url.endsWith('/cost-20251204.htm')).toBe(true)
  })
})

describe('selectLatestProxyFiling', () => {
  const ref = (form: string, filed: string): FilingRef => ({ form, filed, url: `https://www.sec.gov/x/${filed}` })

  it('returns the newest proxy — latest-only contract, NO recency anchor (proxies are annual and may legitimately predate the latest 10-K)', () => {
    const f = { proxy_filings: [ref('DEF 14A', '2025-12-04'), ref('DEF 14A', '2024-12-05')] }
    expect(selectLatestProxyFiling(f)?.filed).toBe('2025-12-04')
  })

  it('fail-closed: no proxy filings → undefined', () => {
    expect(selectLatestProxyFiling({})).toBeUndefined()
    expect(selectLatestProxyFiling({ proxy_filings: [] })).toBeUndefined()
  })
})
