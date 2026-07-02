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
