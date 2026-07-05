import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { extractFilingItems, extractFilingSection, htmlToText } from '../filingSections.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtureDir = join(here, '..', '__fixtures__', 'sec-edgar')
const sample10k = readFileSync(join(fixtureDir, 'sample-10k.html'), 'utf8')

describe('htmlToText', () => {
  it('strips tags and decodes entities', () => {
    const text = htmlToText('<p>Acme &amp; Co&#39;s widgets &mdash; great</p>')
    expect(text).toContain("Acme & Co's widgets")
    expect(text).not.toContain('<p>')
    expect(text).not.toContain('&amp;')
  })
})

describe('extractFilingSection (10-K Items)', () => {
  it('returns the BODY of Item 1A, not the table-of-contents line', () => {
    const section = extractFilingSection(sample10k, '1A')
    expect(section).toBeDefined()
    expect(section!).toContain('loss of a major customer')
    // TOC disambiguation: the bare "Risk Factors 9" TOC entry must not be what we return.
    expect(section!.length).toBeGreaterThan(80)
  })

  it('respects Item boundaries — Item 1A does not bleed into Item 2', () => {
    const section = extractFilingSection(sample10k, '1A')!
    expect(section).not.toContain('corporate headquarters in Springfield') // that's Item 2
    expect(section).not.toContain('designs and sells industrial widgets') // that's Item 1
  })

  it('parses em-dash body headings ("Item 2—Management\'s…") — the COST 10-Q form (live re-review find)', () => {
    // COST's 10-Q body headings use an em-dash ("Item 1—Financial Statements") while its TOC uses the
    // dotted form ("Item 1. Financial Statements 3"). The period-only heading regex saw ONLY the TOC
    // lines, so every "section" the reader returned was a TOC entry with a page number — the live
    // re-review read 96 chars of "MD&A" and correctly reported it could not assess anything.
    const body = (item: string, words: number) => Array.from({ length: words }, (_, i) => `${item}word${i}`).join(' ')
    const doc = `<html><body>
      Item 1. Financial Statements 3
      Item 2. Management&#8217;s Discussion and Analysis of Financial Condition and Results of Operations 17
      Item 3. Quantitative and Qualitative Disclosures About Market Risk 24
      PART I&#8212;FINANCIAL INFORMATION
      Item 1&#8212;Financial Statements ${body('fin', 40)}
      Item 2&#8212;Management&#8217;s Discussion and Analysis ${body('mdna', 40)}
      Item 3&#8212;Quantitative and Qualitative Disclosures ${body('mkt', 40)}
    </body></html>`
    const mdna = extractFilingSection(doc, '2')
    expect(mdna).toBeDefined()
    expect(mdna!).toContain('mdnaword0') // the BODY, not the 96-char TOC line
    expect(mdna!).not.toContain('mktword0') // boundary: ends where Item 3 begins
    expect(extractFilingSection(doc, '1')).toContain('finword0')
  })

  it('an em-dash after an Item number in PROSE is not a heading ("holds Item 5—the disputed one—")', () => {
    // The dash form must not over-match mid-sentence references; require a capitalized section title.
    const doc = `<html><body>
      Item 1. Business ${'x '.repeat(80)} the schedule holds Item 5&#8212;the disputed one&#8212;for later review ${'y '.repeat(80)}
    </body></html>`
    expect(extractFilingItems(doc).map((i) => i.item)).not.toContain('5')
  })

  it('parses headings with a space before the period ("Item 7 .") — the SPGI markup-split form', () => {
    // The SPGI budget-exhaustion bug: SPGI's 10-K HTML splits the Item number and the period into
    // separate tags, so the stripped text reads "Item 7 . Management's Discussion…". The tight
    // "Item 7." heading regex missed Items 6/7/7A entirely — the model burned its whole tool budget
    // retrying a section the parser could not see, and the circle gate failed closed.
    const body = (item: string, words: number) => Array.from({ length: words }, (_, i) => `${item}word${i}`).join(' ')
    const doc = `<html><body>
      Item 1. Business ${body('one', 40)}
      Item 6 . [Reserved]
      Item 7 . Management's Discussion and Analysis ${body('mdna', 40)}
      Item 7A . Quantitative and Qualitative Disclosures ${body('qq', 40)}
      Item 8. Financial Statements ${body('fin', 40)}
    </body></html>`
    const items = extractFilingItems(doc).map((i) => i.item)
    expect(items).toContain('7')
    expect(items).toContain('7A')
    expect(extractFilingSection(doc, 'Item 7 MD&A')).toContain('mdnaword0')
    expect(extractFilingSection(doc, '7A')).toContain('qqword0')
    // The spaced heading must not bleed: Item 7 ends where 7A begins.
    expect(extractFilingSection(doc, '7')).not.toContain('qqword0')
  })

  it('accepts a title-suffixed section key ("Item 1A Risk Factors") — the form models naturally write', () => {
    // The stranded-run bug (3 live runs): models call read_source with the Item AND its title
    // ("Item 1 Business", "Item 1A Risk Factors", "Item 7 MD&A") — the old normalizer folded the title
    // into the key ("1ARISKFACTORS") so EVERY read failed with "section not found" + the index, and the
    // circle gate honestly failed closed. Whether a run grounded was a coin flip on the model's wording.
    expect(extractFilingSection(sample10k, 'Item 1A Risk Factors')).toContain('loss of a major customer')
    expect(extractFilingSection(sample10k, 'Item 1 Business')).toContain('designs and sells industrial widgets')
    expect(extractFilingSection(sample10k, 'Item 7 MD&A')).toBeDefined()
    // The title must not corrupt the code: "Item 1 Business" is Item 1, NOT Item 1B.
    expect(extractFilingSection(sample10k, 'Item 1 Business')).not.toContain('loss of a major customer')
  })

  it('distinguishes Item 1 from Item 1A', () => {
    const item1 = extractFilingSection(sample10k, '1')!
    expect(item1).toContain('designs and sells industrial widgets')
    expect(item1).not.toContain('loss of a major customer') // Item 1A
    // entity decoding in body text
    expect(item1).toContain('Acme & Co')
  })

  it('returns Item 7 (MD&A) body with decoded apostrophe in the heading', () => {
    const item7 = extractFilingSection(sample10k, '7')!
    expect(item7).toContain('Revenue grew 12%')
    expect(item7).toContain("Management's Discussion")
  })

  it('accepts loose section keys (case / "Item " prefix / whitespace)', () => {
    expect(extractFilingSection(sample10k, 'item 1a')).toBeDefined()
    expect(extractFilingSection(sample10k, 'Item 1A')).toBeDefined()
    expect(extractFilingSection(sample10k, ' 1a ')).toBeDefined()
  })

  it('fails closed (undefined) for an Item not present', () => {
    expect(extractFilingSection(sample10k, '5')).toBeUndefined()
  })

  it('fails closed (undefined) for unparseable input', () => {
    expect(extractFilingSection('just some prose with no item headings at all', '1A')).toBeUndefined()
  })
})

describe('extractFilingItems', () => {
  it('lists the body Items in document order', () => {
    const items = extractFilingItems(sample10k).map((i) => i.item)
    expect(items).toEqual(['1', '1A', '2', '7', '8'])
  })
})
