import { describe, expect, it, vi } from 'vitest'

import { discoverEightKExhibits } from '../secEdgar.js'

// ---------------------------------------------------------------------------
// 8-K exhibit discovery (the exhibit arc): an earnings 8-K's PRIMARY document is an announcement
// cover — the actual data lives in the EX-99 press-release exhibits listed in the accession
// directory's index.json (live find: COST's renewal rates / comparable sales / margins were all in
// costex991…htm while the model could only read the cover). Fail-closed: any guard/fetch/parse
// problem returns [] and the re-review simply reads what it has.
// ---------------------------------------------------------------------------

const PRIMARY = 'https://www.sec.gov/Archives/edgar/data/909832/000090983225000164/cost-20251211.htm'

function indexJson(names: string[]) {
  return {
    directory: { item: names.map((name) => ({ name, type: 'text.gif' })) },
  }
}

function fetchReturning(body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch
}

describe('discoverEightKExhibits', () => {
  it('returns EX-99 exhibit URLs from the accession index.json, 99.1 first, capped at 2', async () => {
    const fetchImpl = fetchReturning(indexJson([
      '0000909832-25-000164-index.html',
      'cost-20251211.htm', // the primary doc — never an exhibit
      'costco6.jpg',
      'costex9928-k121125.htm', // EX-99.2
      'costex9918-k121125.htm', // EX-99.1 — the press release
      'costex9938-k121125.htm', // EX-99.3 (beyond the cap)
    ]))
    const urls = await discoverEightKExhibits(PRIMARY, { fetchImpl })
    expect(urls).toEqual([
      'https://www.sec.gov/Archives/edgar/data/909832/000090983225000164/costex9918-k121125.htm',
      'https://www.sec.gov/Archives/edgar/data/909832/000090983225000164/costex9928-k121125.htm',
    ])
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://www.sec.gov/Archives/edgar/data/909832/000090983225000164/index.json',
      expect.anything(),
    )
  })

  it('fail-closed: no EX-99 documents / fetch failure / non-SEC URL all return []', async () => {
    expect(await discoverEightKExhibits(PRIMARY, { fetchImpl: fetchReturning(indexJson(['cost-20251211.htm', 'a.xml'])) })).toEqual([])
    const failing = vi.fn(async () => new Response('nope', { status: 403 })) as unknown as typeof fetch
    expect(await discoverEightKExhibits(PRIMARY, { fetchImpl: failing })).toEqual([])
    expect(await discoverEightKExhibits('https://evil.example.com/x/doc.htm', { fetchImpl: fetchReturning(indexJson(['ex991.htm'])) })).toEqual([])
  })

  it('only .htm exhibits count (xml/jpg/txt variants of EX-99 are not readable documents)', async () => {
    const fetchImpl = fetchReturning(indexJson(['ex99-1.xml', 'ex99photo.jpg', 'pressex991.htm']))
    const urls = await discoverEightKExhibits(PRIMARY, { fetchImpl })
    expect(urls).toEqual(['https://www.sec.gov/Archives/edgar/data/909832/000090983225000164/pressex991.htm'])
  })
})
