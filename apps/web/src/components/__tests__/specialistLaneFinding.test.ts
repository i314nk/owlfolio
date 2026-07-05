import { describe, expect, it } from 'vitest'

import { splitLaneFinding, isPlaceholderLaneSummary } from '../ResearchCasePanel'

// The deep-dive specialist lane card shows the lane header + its reasoning. The always-visible line must
// NEVER cut a sentence mid-word (owner feedback): either it ends on a clean sentence boundary with the
// remainder behind the "Reasoning" disclosure, or — when there is no usable early boundary — it shows the
// full text rather than a mid-word "…" truncation.
describe('splitLaneFinding (no mid-sentence cutoff)', () => {
  it('keeps a short finding whole with no detail', () => {
    const { conclusion, detail } = splitLaneFinding('Wide, durable moat.')
    expect(conclusion).toBe('Wide, durable moat.')
    expect(detail).toBeUndefined()
  })

  it('splits a multi-sentence finding at the sentence boundary (conclusion is a whole sentence)', () => {
    // First sentence is ~250 chars — longer than the old 220 cap that forced a mid-word cut.
    const first =
      'Microsoft maintains a fortress-grade business quality with durable competitive moats across cloud, productivity, and AI, but faces meaningful near-term risks from OpenAI partnership concentration, massive AI infrastructure capex, and regulatory pressure.'
    const rest = 'The latest 10-K confirms elite earnings quality across segments.'
    const { conclusion, detail } = splitLaneFinding(`${first} ${rest}`)
    expect(conclusion).toBe(first)
    expect(conclusion.endsWith('.')).toBe(true)
    expect(conclusion).not.toContain('…')
    expect(detail).toBe(rest)
  })

  it('never emits a mid-word ellipsis: a long single sentence shows in full', () => {
    const runOn =
      'Microsoft maintains a fortress-grade business quality with durable competitive moats across cloud productivity and AI while facing meaningful near-term risks from OpenAI partnership concentration and massive AI infrastructure capital expenditure that could compress free cash flow through fiscal 2028'
    const { conclusion, detail } = splitLaneFinding(runOn)
    expect(conclusion).toBe(runOn)
    expect(conclusion).not.toContain('…')
    expect(detail).toBeUndefined()
  })
})

describe('isPlaceholderLaneSummary', () => {
  it('treats ellipsis / empty / punctuation-only summaries as placeholders', () => {
    expect(isPlaceholderLaneSummary('...')).toBe(true)
    expect(isPlaceholderLaneSummary('…')).toBe(true)
    expect(isPlaceholderLaneSummary('')).toBe(true)
    expect(isPlaceholderLaneSummary('   ')).toBe(true)
    expect(isPlaceholderLaneSummary('. -')).toBe(true)
    expect(isPlaceholderLaneSummary(undefined)).toBe(true)
  })

  it('treats real prose as non-placeholder', () => {
    expect(isPlaceholderLaneSummary('Fairly priced versus owner earnings.')).toBe(false)
    expect(isPlaceholderLaneSummary('Wide moat.')).toBe(false)
  })
})
