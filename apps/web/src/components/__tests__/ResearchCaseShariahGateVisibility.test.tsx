import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ResearchCasePanel } from '../ResearchCasePanel'
import type { AppResearchCase } from '../../lib/workflow'

// SCREENING TOGGLE (owner, 2026-07-15): the dossier's Shariah gate section is REMOVED when the run
// was unscreened (its own recorded DISABLED state — replaced by a one-line fail-visible label) or
// when the Shariah mode is currently OFF. Nothing is deleted from the ledger: flipping the mode
// back ON restores the recorded gate section on screened dossiers.

function baseCase(overrides: Record<string, unknown>): AppResearchCase {
  return {
    research_case_id: 'rc_gate_vis_001',
    version: 1,
    superseded: false,
    stage: 'decision_drafted',
    company_id: 'company_gate',
    ticker: 'GATE',
    strategy_id: 'buffett-munger',
    decision: 'WATCH',
    investment_verdict: 'WATCH',
    strategy_compliance: 'CONDITIONAL',
    valuation_status: 'FAIR',
    next_required_action: 'Audit the reasoning.',
    updated_at: '2026-07-15T12:00:00.000Z',
    valuation: { moat_class: 'wide' },
    gate_checklist: [],
    source_ids: [],
    source_evidence: [],
    ledger_timeline: [],
    ...overrides,
  } as unknown as AppResearchCase
}

describe('the dossier Shariah gate section under the screening toggle', () => {
  it('a screened case with the mode ON shows the gate section', () => {
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: baseCase({ shariah_status: 'COMPLIANT', shariah_gate: { allowed: true, sector_status: 'compliant' } }),
      mode: 'personal-local',
      shariahEnabled: true,
    }))
    expect(html).toContain('Front gate — Shariah')
  })

  it('a screened case with the mode OFF hides the gate section (restored on re-enable)', () => {
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: baseCase({ shariah_status: 'COMPLIANT', shariah_gate: { allowed: true, sector_status: 'compliant' } }),
      mode: 'personal-local',
      shariahEnabled: false,
    }))
    expect(html).not.toContain('Front gate — Shariah')
  })

  it('an UNSCREENED run (DISABLED) shows the one-line fail-visible label instead — regardless of the mode', () => {
    const researchCase = baseCase({ shariah_status: 'DISABLED', shariah_gate: { allowed: true, sector_status: 'DISABLED' } })
    for (const shariahEnabled of [true, false]) {
      const html = renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase, mode: 'personal-local', shariahEnabled }))
      expect(html).not.toContain('Front gate — Shariah')
      expect(html).toContain('SHARIAH SCREENING WAS OFF FOR THIS RUN')
      // The verdict bullets never claim a Shariah status for an unscreened run.
      expect(html).not.toContain('Shariah: DISABLED')
    }
  })
})

// The sticky pillar jump bar (owner-approved 2026-07-17): chips with verdict glyphs; the gate chip
// follows the same visibility rules as the gate section; anchors exist for the click-to-expand jump.
describe('the dossier pillar jump nav', () => {
  it('renders one chip per pillar with anchors on the sections; the gate chip respects the screening mode', () => {
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: baseCase({ shariah_status: 'COMPLIANT', shariah_gate: { allowed: true, sector_status: 'compliant' } }),
      mode: 'personal-local',
      shariahEnabled: true,
    }))
    expect(html).toContain('data-testid="pillar-jump-nav"')
    for (const id of ['front-gate', 'pillar-1', 'pillar-2', 'pillar-3', 'pillar-4', 'synthesis']) {
      expect(html).toContain(`data-testid="pillar-jump-${id}"`)
      expect(html).toContain(`id="pillar-anchor-${id}"`)
    }
    // WATCH verdict → the SYN chip carries the caution glyph.
    expect(html).toContain('⚠')
  })

  it('drops the GATE chip when the mode is off — mirroring the hidden gate section', () => {
    const html = renderToStaticMarkup(createElement(ResearchCasePanel, {
      researchCase: baseCase({ shariah_status: 'COMPLIANT', shariah_gate: { allowed: true, sector_status: 'compliant' } }),
      mode: 'personal-local',
      shariahEnabled: false,
    }))
    expect(html).not.toContain('data-testid="pillar-jump-front-gate"')
    expect(html).toContain('data-testid="pillar-jump-pillar-1"')
  })
})
