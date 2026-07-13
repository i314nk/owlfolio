import { describe, expect, it } from 'vitest'
import { buildValuationReasoningPrompt, ValuationReasoningAgentSchema } from '../valuationReasoningPass'

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

// LIVE FIND (SPGI rc_spgi_1783951008414): kimi returned `comps` as a STRING — the strict array
// schema failed the WHOLE stage (retry exhausted → unpriced → RESEARCH_MORE). A malformed comps
// shape must degrade to "unstructured" (the honest advisory covers it), never kill the valuation.
describe('comps shape tolerance (SPGI live find)', () => {
  it('a string comps value parses with comps undefined instead of failing the stage', () => {
    const parsed = ValuationReasoningAgentSchema.safeParse({
      valuation_reasoning: {
        assumed_growth: 0.06,
        assumed_growth_rationale: 'cited to segment growth',
        assumed_growth_citation: 'src_1',
        industry_exit_multiple: {
          multiple: 18,
          basis_note: 'comps: Mastercard ~28x P/FCF; Moody\u2019s ~25x; median tilted conservative to 18x.',
          comps: 'Mastercard ~28x, Moodys ~25x',
        },
      },
      proposed_sources: [{ source_id: 'src_1', title: '10-K', url: 'https://example.com/10k', excerpt: 'segment growth' }],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.valuation_reasoning.industry_exit_multiple?.comps).toBeUndefined()
      expect(parsed.data.valuation_reasoning.industry_exit_multiple?.multiple).toBe(18)
    }
  })
  it('malformed array entries are dropped; well-formed ones survive', () => {
    const parsed = ValuationReasoningAgentSchema.safeParse({
      valuation_reasoning: {
        assumed_growth: 0.06,
        assumed_growth_rationale: 'r',
        assumed_growth_citation: 'src_1',
        industry_exit_multiple: {
          multiple: 18,
          basis_note: 'a long enough basis note naming the comps and their figures for the floor',
          comps: [{ name: 'Mastercard', p_fcf: 28 }, { name: 'bad' }, 'garbage'],
        },
      },
      proposed_sources: [{ source_id: 'src_1', title: '10-K', url: 'https://example.com/10k', excerpt: 'segment growth' }],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.valuation_reasoning.industry_exit_multiple?.comps).toEqual([{ name: 'Mastercard', p_fcf: 28 }])
    }
  })
})
