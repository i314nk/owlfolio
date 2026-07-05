import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ResearchCasePanel } from '../ResearchCasePanel'
import type { AppResearchCase } from '../../lib/workflow'

// The "Thesis re-review — vs. new filings" card. Per-trigger labels speak the SAME vocabulary as the
// overall verdict — INTACT (not tripped) / BROKEN (tripped) / INCONCLUSIVE (not assessable) — never
// the model's raw yes/no/unclear, whose "NO" reads as a confusing double-negative ("no, the break
// trigger didn't trip" is good news dressed as a negative).

function caseWith(reReview: NonNullable<AppResearchCase['re_review']>): AppResearchCase {
  return {
    research_case_id: 'rc_rr_card',
    version: 1,
    superseded: false,
    archived: false,
    stage: 'decision_drafted',
    ticker: 'COST',
    thesis_summary: 'Membership compounder.',
    updated_at: '2026-07-05T00:00:00.000Z',
    source_ids: [],
    ledger_timeline: [],
    re_review: reReview,
  } as unknown as AppResearchCase
}

function render(researchCase: AppResearchCase): string {
  return renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase, mode: 'personal-local' }))
}

describe('re-review card trigger labels', () => {
  it('maps tripped yes/no/unclear to BROKEN/INTACT/INCONCLUSIVE (verdict vocabulary, not raw model enums)', () => {
    const html = render(caseWith({
      re_review_id: 'rr_1',
      assessment: 'BROKEN',
      trigger_assessments: [
        { trigger: 'Renewal rate drops below 88%', tripped: 'yes', evidence_citation: 'rr_a', reasoning: 'renewal fell to 86%' },
        { trigger: 'Same-store sales turn negative', tripped: 'no', evidence_citation: 'rr_a', reasoning: 'comps +6.4%' },
        { trigger: 'Gross margin below 10.5%', tripped: 'unclear', evidence_citation: 'rr_a', reasoning: 'no margin data readable' },
      ],
      changed_dimensions: [],
      broken_claim: 'renewal economics',
      narrative: 'n',
      new_filings: [{ form: '8-K', filed: '2026-06-20', url: 'https://www.sec.gov/x/8k.htm', weight: 'strong' }],
      skipped_filings: [],
      recorded_at: '2026-07-05T00:00:00.000Z',
    }))
    expect(html).toContain('BROKEN: </strong>Renewal rate drops below 88%')
    expect(html).toContain('INTACT: </strong>Same-store sales turn negative')
    expect(html).toContain('INCONCLUSIVE: </strong>Gross margin below 10.5%')
    // The raw model enums never render as labels.
    expect(html).not.toContain('YES: ')
    expect(html).not.toContain('NO: ')
    expect(html).not.toContain('UNCLEAR: ')
  })
})
