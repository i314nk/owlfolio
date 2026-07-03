import { describe, expect, it } from 'vitest'
import { ShariahReasoningAgentSchema, buildShariahReasoningPrompt } from '../shariahReasoningPass'

describe('ShariahReasoningAgentSchema', () => {
  it('parses a grounded overlay (sector_status + impermissible_income + citation + proposed_sources)', () => {
    const parsed = ShariahReasoningAgentSchema.safeParse({
      shariah_judgment: { sector_status: 'compliant', impermissible_income: 128, sector_citation: 'sec_edgar_10k_x' },
      proposed_sources: [{ source_id: 's1', title: 'T', url: 'https://www.sec.gov/x', excerpt: 'e' }],
    })
    expect(parsed.success).toBe(true)
  })
  it('accepts impermissible_income null (undetermined — never guessed 0)', () => {
    const parsed = ShariahReasoningAgentSchema.safeParse({
      shariah_judgment: { sector_status: 'compliant', impermissible_income: null, sector_citation: 'sec_edgar_10k_x' },
      proposed_sources: [{ source_id: 's1', title: 'T', url: 'https://www.sec.gov/x', excerpt: 'e' }],
    })
    expect(parsed.success).toBe(true)
  })
})

describe('buildShariahReasoningPrompt', () => {
  it('instructs the overlay + that the harness owns the AAOIFI ratios (model supplies grounded inputs only)', () => {
    const prompt = buildShariahReasoningPrompt({
      research_case_id: 'rc_x', ticker: 'MSFT', model_id: 'm',
      laneDigest: [], corpusSourceIds: ['sec_edgar_10k_x'], preVerifiedSourceIds: ['sec_edgar_10k_x'],
    })
    expect(prompt).toMatch(/sector_status/)
    expect(prompt).toMatch(/impermissible_income/)
    expect(prompt).toMatch(/do NOT.*(ratio|purification)/i)
    expect(prompt).toMatch(/null/i)
  })
})
