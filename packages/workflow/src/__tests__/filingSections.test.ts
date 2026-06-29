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
