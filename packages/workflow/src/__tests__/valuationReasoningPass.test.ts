import { describe, expect, it } from 'vitest'
import { buildValuationReasoningPrompt } from '../valuationReasoningPass'

describe('buildValuationReasoningPrompt carries the F.2 discount-ownership guard', () => {
  it('tells the model NOT to choose its own discount rate / WACC (harness owns the discount)', () => {
    const prompt = buildValuationReasoningPrompt({
      research_case_id: 'test-case-001',
      ticker: 'KO',
      model_id: 'test-model',
      laneDigest: [
        { lane: 'moat', confidence: 'high', finding_summary: 'Wide moat via brand and distribution.' },
      ],
      corpusSourceIds: ['sec_edgar_10k_21344_fy2024'],
      preVerifiedSourceIds: ['sec_edgar_10k_21344_fy2024'],
    })
    expect(prompt).toMatch(/harness owns the discount/i)
    expect(prompt).toMatch(/do NOT[^.]*(discount rate|WACC|cost of capital|required return)/i)
  })
})

// Owner rule (2026-07-12): the exit multiple is anchored to NAMED COMPARABLES, never an unnamed
// industry average — median of the named set, conservative, exclusions explained.
describe('exit-multiple prompt calibration — named comparables', () => {
  it('demands named comps, median-conservative, and rejects a bare basis note via the retry-forcer', () => {
    const prompt = buildValuationReasoningPrompt({
      research_case_id: 'test-case-exit',
      ticker: 'TST',
      model_id: 'test-model',
      laneDigest: [],
      corpusSourceIds: ['src_1'],
      preVerifiedSourceIds: ['src_1'],
    } as never)
    expect(prompt).toContain('ANCHORED TO NAMED COMPARABLES')
    expect(prompt).toContain('MEDIAN of the named set')
    expect(prompt).toContain('EXCLUDE structurally different names')
    expect(prompt).not.toContain('compliant savings rate plus a fixed equity')
  })
})
