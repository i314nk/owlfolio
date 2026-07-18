import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('PassivePage source', () => {
  const source = readFileSync('apps/web/src/app/passive/page.tsx', 'utf8')

  it('states the passive principles without book rule-number vocabulary (rebrand rule)', () => {
    // The numbered-rules framing is the book's; the app states the principles plainly and the
    // owner adds the credit himself later.
    expect(source).not.toMatch(/Rule \d/)
    expect(source).toContain('Own the market first')
    expect(source).toContain('Contribute on a schedule, not a feeling')
    expect(source).toContain('Never sell the sleeve')
  })

  it('carries the concentration honesty note: Shariah ETFs are less diversified by construction', () => {
    expect(source).toContain('less diversified')
    // The note names why: the screens exclude entire sectors.
    expect(source).toMatch(/exclude entire sectors/i)
  })

  it('keeps the educational-only rails and stays off the ledger', () => {
    expect(source).toContain('EDUCATIONAL CONTENT, NOT ADVICE')
    expect(source).not.toContain('SQLiteEventStore')
    // The header description (now in the dictionary) keeps the does-not-track disclaimer.
    const dictionary = readFileSync('apps/web/src/lib/i18n.ts', 'utf8')
    expect(dictionary).toContain('does not track, recommend, or execute')
  })

  it('routes the chrome through the dictionary and shows the english-content note off-English (long-form page pattern)', () => {
    expect(source).toContain("t(locale, 'ps_kicker')")
    expect(source).toContain("t(locale, 'ps_title')")
    expect(source).toContain("t(locale, 'ps_desc')")
    expect(source).toContain('englishContentNote')
    expect(source).toContain('resolveLocale')
  })
})
