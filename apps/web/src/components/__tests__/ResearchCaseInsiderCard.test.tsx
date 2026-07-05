import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ResearchCasePanel } from '../ResearchCasePanel'
import type { AppResearchCase } from '../../lib/workflow'

// The deterministic "Insider activity (Form 4)" dossier card (§3.3): renders the harness-computed insider
// summary regardless of whether the management lane echoed it. Discretionary open-market trades are the
// signal; mechanical RSU/option/tax disposals are shown separately, never as selling.

function caseWith(insiderSummary: NonNullable<AppResearchCase['insider_summary']>): AppResearchCase {
  return {
    research_case_id: 'rc_insider_card',
    version: 1,
    superseded: false,
    archived: false,
    stage: 'decision_drafted',
    ticker: 'V',
    thesis_summary: 'Payments network.',
    updated_at: '2026-07-05T00:00:00.000Z',
    source_ids: [],
    ledger_timeline: [],
    insider_summary: insiderSummary,
  } as unknown as AppResearchCase
}

function render(researchCase: AppResearchCase): string {
  return renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase, mode: 'personal-local' }))
}

describe('insider activity (Form 4) dossier card', () => {
  it('renders discretionary sells, the mechanical split, and the cluster when a summary is present', () => {
    const html = render(caseWith({
      as_of: '2026-06-30',
      window_months: 12,
      discretionary_buy_shares: 0,
      discretionary_sell_shares: 169332,
      discretionary_buy_value: 0,
      discretionary_sell_value: 57279146.22,
      distinct_buyers: 0,
      distinct_sellers: 6,
      officer_director_sell_shares: 169332,
      ten_percent_owner_sell_shares: 0,
      mechanical_disposed_shares: 155970,
      cluster: { window_days: 90, discretionary_sell_count: 5, distinct_sellers: 2, net_sell_value: 24898270.67 },
      window_truncated: true,
    }))
    expect(html).toContain('Insider activity (Form 4)')
    expect(html).toContain('169,332') // discretionary sell shares
    expect(html).toContain('155,970') // mechanical disposed, shown separately
    expect(html).toMatch(/[Cc]luster/) // the cluster line
    expect(html).toContain('data-testid="insider-activity-card"')
  })

  it('renders nothing when there is no insider summary', () => {
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: { research_case_id: 'rc_none', version: 1, superseded: false, archived: false, stage: 'decision_drafted', ticker: 'V', updated_at: '2026-07-05T00:00:00.000Z', source_ids: [], ledger_timeline: [] } as unknown as AppResearchCase,
      mode: 'personal-local',
    }))
    expect(html).not.toContain('insider-activity-card')
  })
})
