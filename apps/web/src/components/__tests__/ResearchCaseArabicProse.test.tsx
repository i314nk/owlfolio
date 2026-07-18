import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ResearchCasePanel } from '../ResearchCasePanel'
import type { AppResearchCase } from '../../lib/workflow'

// ---------------------------------------------------------------------------
// Task #88 (owner, 2026-07-18): when the locale is Arabic AND the run recorded prose_ar, the
// dossier renders the ARABIC prose (one substitution at the panel entry — every card inherits),
// with a labeled note that the English ledger record stays authoritative. English locale — or a
// case without a recording — renders exactly as before.
// ---------------------------------------------------------------------------

const PROSE_AR = {
  decision_reason: 'مراقبة — بانتظار هامش الأمان.',
  thesis_summary: 'شركة نامية ذات خندق واسع تعيد الاستثمار بعوائد مرتفعة.',
  evidence_summary: 'موثَّق من التقرير السنوي 10-K.',
  valuation_rationale: 'التقييم مرتفع مقارنة بالقيمة الجوهرية.',
  shariah_rationale: 'القطاع متوافق مع المعايير الشرعية.',
  synthesis_summary: 'المسارات متوافقة على الجودة؛ والسعر هو الاعتراض الوحيد.',
}

function decidedCase(overrides: Partial<AppResearchCase> = {}): AppResearchCase {
  return {
    research_case_id: 'rc_ar_panel',
    version: 1,
    superseded: false,
    stage: 'decision_drafted',
    company_id: 'company_ar',
    ticker: 'ARB',
    strategy_id: 'buffett-munger',
    decision_id: 'decision_ar_panel',
    decision: 'WATCH',
    reason: 'Quality compounder; awaiting margin of safety.',
    thesis_summary: 'A wide-moat compounder reinvesting at high incremental returns.',
    investment_verdict: 'WATCH',
    strategy_compliance: 'CONDITIONAL',
    shariah_status: 'COMPLIANT',
    valuation_status: 'EXPENSIVE',
    source_ids: [],
    ledger_timeline: [],
    updated_at: '2026-07-18T12:00:00.000Z',
    ...overrides,
  } as AppResearchCase
}

describe('dossier Arabic prose rendering (task #88)', () => {
  it('ar locale + recorded prose_ar → the Arabic thesis renders with the authoritative-English note', () => {
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: decidedCase({ prose_ar: PROSE_AR }),
      locale: 'ar',
    }))
    expect(html).toContain('شركة نامية ذات خندق واسع')
    expect(html).toContain('data-testid="arabic-prose-note"')
    // The note names the boundary: the English ledger record is the authoritative version.
    expect(html).toContain('المرجعية المعتمدة')
    // The substituted English thesis is no longer shown.
    expect(html).not.toContain('A wide-moat compounder reinvesting')
  })

  it('en locale ignores a recorded prose_ar — the English record renders untouched, no note', () => {
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: decidedCase({ prose_ar: PROSE_AR }),
      locale: 'en',
    }))
    expect(html).toContain('A wide-moat compounder reinvesting')
    expect(html).not.toContain('arabic-prose-note')
    expect(html).not.toContain('شركة نامية')
  })

  it('ar locale WITHOUT a recording falls back to English prose and shows no rendering note', () => {
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: decidedCase(),
      locale: 'ar',
    }))
    expect(html).toContain('A wide-moat compounder reinvesting')
    expect(html).not.toContain('arabic-prose-note')
  })
})
