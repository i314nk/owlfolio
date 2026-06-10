import { describe, expect, it } from 'vitest'
import {
  classifySourceCategory,
  isCategoryAllowedForLane,
  laneSourcePolicy,
  SOURCE_POLICY,
  type SourceCategory,
} from '../sourcePolicy'

describe('classifySourceCategory', () => {
  it('classifies SEC EDGAR / sec.gov as a filing', () => {
    expect(classifySourceCategory('https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany')).toBe('filing')
    expect(classifySourceCategory('https://www.sec.gov/Archives/edgar/data/320193/aapl-10k.htm')).toBe('filing')
  })

  it('classifies a DEF 14A path as a proxy', () => {
    expect(classifySourceCategory('https://www.sec.gov/Archives/edgar/data/320193/def14a-2025.htm')).toBe('proxy')
    expect(classifySourceCategory('https://www.sec.gov/Archives/edgar/data/1/proxy-statement-2025.htm')).toBe('proxy')
  })

  it('classifies a Form 4 / insider path as insider_data', () => {
    expect(classifySourceCategory('https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=4')).toBe('insider_data')
    expect(classifySourceCategory('https://www.sec.gov/Archives/edgar/data/1/form4.xml')).toBe('insider_data')
  })

  it('classifies an earnings-call transcript as transcript', () => {
    expect(classifySourceCategory('https://example.test/aapl-q1-2026-earnings-call-transcript')).toBe('transcript')
  })

  it('classifies bloomberg/reuters/wsj/cnbc as financial_media', () => {
    expect(classifySourceCategory('https://www.bloomberg.com/news/articles/abc')).toBe('financial_media')
    expect(classifySourceCategory('https://www.reuters.com/business/x')).toBe('financial_media')
    expect(classifySourceCategory('https://www.wsj.com/articles/x')).toBe('financial_media')
    expect(classifySourceCategory('https://www.cnbc.com/2026/01/01/x.html')).toBe('financial_media')
  })

  it('classifies seekingalpha/substack/blogs as investor_writeup', () => {
    expect(classifySourceCategory('https://seekingalpha.com/article/123-thesis')).toBe('investor_writeup')
    expect(classifySourceCategory('https://someanalyst.substack.com/p/deep-dive')).toBe('investor_writeup')
    expect(classifySourceCategory('https://value.blog/2026/01/my-thesis')).toBe('investor_writeup')
  })

  it('classifies a known sell-side / broker research domain as sell_side', () => {
    expect(classifySourceCategory('https://research.morganstanley.com/note')).toBe('sell_side')
  })

  it('classifies a statistical/regulatory agency as regulatory_statistical', () => {
    expect(classifySourceCategory('https://www.bls.gov/data/')).toBe('regulatory_statistical')
    expect(classifySourceCategory('https://www.federalreserve.gov/releases/')).toBe('regulatory_statistical')
  })

  it('classifies a company IR / press path as company_disclosure', () => {
    expect(classifySourceCategory('https://investor.apple.com/news/press-release')).toBe('company_disclosure')
    expect(classifySourceCategory('https://www.apple.com/investor-relations/')).toBe('company_disclosure')
  })

  it('classifies an unrecognized domain as unknown', () => {
    expect(classifySourceCategory('https://random-unknown-domain-xyz.example/page')).toBe('unknown')
  })

  it('returns unknown for an unparseable url', () => {
    expect(classifySourceCategory('not a url')).toBe('unknown')
  })

  it('classifies the mock-provider EDGAR-shaped fixture URLs as filings (mock lanes must not be starved)', () => {
    expect(classifySourceCategory('https://www.sec.gov/Archives/edgar/data/0/msft-10k-2025.htm')).toBe('filing')
    expect(classifySourceCategory('https://www.sec.gov/Archives/edgar/data/0/msft-10q-2026.htm')).toBe('filing')
    // and they are admitted by the strictest classification lane:
    expect(isCategoryAllowedForLane('moat', 'filing')).toBe(true)
  })
})

describe('SOURCE_POLICY per-lane whitelist', () => {
  it('is versioned', () => {
    expect(SOURCE_POLICY.version).toMatch(/source-policy/)
  })

  it('MOAT/FINANCIAL_QUALITY/VALUATION/BUSINESS_QUALITY reject sell-side, media, investor writeups', () => {
    for (const lane of ['moat', 'financial_quality', 'valuation', 'business_quality']) {
      expect(isCategoryAllowedForLane(lane, 'filing')).toBe(true)
      expect(isCategoryAllowedForLane(lane, 'transcript')).toBe(true)
      expect(isCategoryAllowedForLane(lane, 'regulatory_statistical')).toBe(true)
      expect(isCategoryAllowedForLane(lane, 'company_disclosure')).toBe(true)
      expect(isCategoryAllowedForLane(lane, 'sell_side')).toBe(false)
      expect(isCategoryAllowedForLane(lane, 'financial_media')).toBe(false)
      expect(isCategoryAllowedForLane(lane, 'investor_writeup')).toBe(false)
    }
  })

  it('MANAGEMENT admits proxies + insider data + transcripts, rejects financial_media (media profile)', () => {
    expect(isCategoryAllowedForLane('management', 'proxy')).toBe(true)
    expect(isCategoryAllowedForLane('management', 'insider_data')).toBe(true)
    expect(isCategoryAllowedForLane('management', 'transcript')).toBe(true)
    expect(isCategoryAllowedForLane('management', 'filing')).toBe(true)
    expect(isCategoryAllowedForLane('management', 'financial_media')).toBe(false)
    expect(isCategoryAllowedForLane('management', 'investor_writeup')).toBe(false)
  })

  it('RISKS admits everything (knowing the consensus IS the job)', () => {
    const categories: SourceCategory[] = [
      'filing', 'transcript', 'regulatory_statistical', 'company_disclosure', 'proxy',
      'insider_data', 'screening_provider', 'sell_side', 'financial_media', 'investor_writeup', 'unknown',
    ]
    for (const c of categories) {
      expect(isCategoryAllowedForLane('risks', c)).toBe(true)
    }
  })

  it('SHARIAH admits filings + screening providers as cross-check', () => {
    expect(isCategoryAllowedForLane('shariah', 'filing')).toBe(true)
    expect(isCategoryAllowedForLane('shariah', 'screening_provider')).toBe(true)
    expect(isCategoryAllowedForLane('shariah', 'sell_side')).toBe(false)
  })

  it('classification lanes EXCLUDE unknown by default (conservative); RISKS allows unknown', () => {
    expect(isCategoryAllowedForLane('moat', 'unknown')).toBe(false)
    expect(isCategoryAllowedForLane('financial_quality', 'unknown')).toBe(false)
    expect(isCategoryAllowedForLane('management', 'unknown')).toBe(false)
    expect(isCategoryAllowedForLane('shariah', 'unknown')).toBe(false)
    expect(isCategoryAllowedForLane('risks', 'unknown')).toBe(true)
  })

  it('an unknown lane id falls back to the conservative classification policy (no implicit allow-all)', () => {
    expect(isCategoryAllowedForLane('some_new_lane', 'financial_media')).toBe(false)
    expect(isCategoryAllowedForLane('some_new_lane', 'filing')).toBe(true)
  })

  it('laneSourcePolicy returns the resolved allow/exclude lists', () => {
    const moat = laneSourcePolicy('moat')
    expect(moat.allow).toContain('filing')
    expect(moat.exclude).toContain('financial_media')
  })
})
