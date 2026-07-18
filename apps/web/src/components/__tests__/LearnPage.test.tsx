import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('LearnPage source', () => {
  const pageSource = readFileSync('apps/web/src/app/learn/page.tsx', 'utf8')
  const tabsSource = readFileSync('apps/web/src/components/LearnTabs.tsx', 'utf8')

  it('routes the header chrome through the dictionary and keeps the english-content note (long-form pattern)', () => {
    expect(pageSource).toContain("t(locale, 'ln_kicker')")
    expect(pageSource).toContain("t(locale, 'ln_title')")
    expect(pageSource).toContain("t(locale, 'ln_desc')")
    expect(pageSource).toContain('englishContentNote')
  })

  it('claims no calibration file — post-mortems live in the ledger; calibration is a deferred pass', () => {
    expect(tabsSource).not.toContain('calibration file')
  })

  it('keeps the rebrand rules: no book mentions, no book rule-number vocabulary', () => {
    expect(tabsSource).not.toMatch(/the book\b/)
    expect(tabsSource).not.toMatch(/[Rr]ule \d/)
    expect(pageSource).not.toMatch(/the book\b/)
  })
})
