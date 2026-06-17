import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ResearchCasePanel } from '../ResearchCasePanel'
import type { AppResearchCase } from '../../lib/workflow'

// Valuation-core revision (growth-axis): the dossier presents market-implied growth vs a sustainable-growth
// band with the buy-threshold (band_low − required_gap) marked — NOT the old price-vs-fair-value bar.

function baseCase(verdictState: NonNullable<NonNullable<AppResearchCase['valuation']>['verdict_state']>): AppResearchCase {
  return {
    research_case_id: 'rc_band_001',
    version: 1,
    superseded: false,
    stage: 'decision_drafted',
    company_id: 'company_band',
    ticker: 'BND',
    strategy_id: 'buffett-munger',
    decision_id: 'decision_band_001',
    decision: 'WATCH',
    reason: 'Quality compounder; price implies more than the business sustains.',
    investment_verdict: 'WATCH',
    strategy_compliance: 'CONDITIONAL',
    shariah_status: 'COMPLIANT',
    valuation_status: 'EXPENSIVE',
    next_required_action: 'Await a gap below the band.',
    updated_at: '2026-06-09T12:00:00.000Z',
    valuation: {
      moat_class: 'wide',
      moat_passes_gate: true,
      runway: 'proven',
      discount_rate: 0.1,
      growth_rate: 0.06,
      terminal_growth_rate: 0.01,
      roic: 0.25,
      incremental_roic: 0.2,
      reinvestment_rate: 0.4,
      normalized_owner_earnings_per_share: 16.27,
      fair_value_per_share: 210.0,
      buy_price_per_share: 147.0,
      implied_multiple: 12.9,
      verdict_state: verdictState,
    },
    gate_checklist: [],
    source_ids: [],
    source_evidence: [],
    ledger_timeline: [],
  } as AppResearchCase
}

function render(researchCase: AppResearchCase): string {
  return renderToStaticMarkup(createElement(ResearchCasePanel, { researchCase, mode: 'personal-local' }))
}

describe('ResearchCasePanel growth-axis band visualization', () => {
  it('renders the growth-band axis with band, implied-growth marker, and buy-threshold marker', () => {
    const html = render(baseCase({
      state: 'WATCH',
      market_implied_growth: 0.09,
      band_low: 0.05,
      band_high: 0.08,
      band_center: 0.065,
      band_grounding_status: 'grounded',
      band_basis_citations: ['src_msft_10k_2025', 'src_msft_cashflow_2025'],
      required_gap: 0.02,
      gap_to_band: -0.06,
    }))
    expect(html).toContain('data-testid="growth-band-axis"')
    expect(html).toContain('data-testid="implied-growth-marker"')
    expect(html).toContain('data-testid="buy-threshold-marker"')
  })

  it('leads with the implied-vs-band one-line summary and the band-basis grounding', () => {
    const html = render(baseCase({
      state: 'WATCH',
      market_implied_growth: 0.09,
      band_low: 0.05,
      band_high: 0.08,
      band_center: 0.065,
      band_grounding_status: 'grounded',
      band_basis_citations: ['src_msft_10k_2025'],
      required_gap: 0.02,
      gap_to_band: -0.06,
    }))
    // Lead line: market implies X%, band low–high, buy below threshold, gap to buy.
    expect(html).toContain('Market implies')
    expect(html).toContain('can sustain')
    expect(html).toContain('buy below')
    expect(html).toContain('Gap to buy')
    // Band basis citations rendered (collapsible details).
    expect(html).toContain('Band basis')
    expect(html).toContain('src_msft_10k_2025')
  })

  it('swaps the ledger/verdict labels to the band + gap framing and retires the MoS-haircut bar', () => {
    const html = render(baseCase({
      state: 'WATCH',
      market_implied_growth: 0.09,
      band_low: 0.05,
      band_high: 0.08,
      band_center: 0.065,
      band_grounding_status: 'grounded',
      required_gap: 0.02,
      gap_to_band: -0.06,
    }))
    expect(html).toContain('Sustainable band')
    expect(html).toContain('Required growth gap')
    // The OLD price-vs-FV bar / MoS-as-price-haircut framing is gone from the valuation panel: no
    // "Buy below (X discount)" bar tick, no "less X% margin of safety" haircut summary, and the
    // ledger no longer carries the bare "Margin of safety" price-haircut stat label.
    expect(html).not.toContain('Buy below (')
    expect(html).not.toContain('margin of safety (')
    expect(html).not.toContain('% margin of safety')
    expect(html).not.toContain('discount to fair value')
    // Fair value is kept only as a clearly-labelled band-center reference.
    expect(html).toContain('band-center reference')
  })

  it('colours a BUY-WINDOW implied marker in the cheap/accent zone', () => {
    const html = render(baseCase({
      state: 'BUY-WINDOW',
      market_implied_growth: 0.02,
      band_low: 0.05,
      band_high: 0.08,
      band_center: 0.065,
      band_grounding_status: 'grounded',
      required_gap: 0.02,
      gap_to_band: 0.01,
    }))
    expect(html).toContain('data-testid="implied-growth-marker"')
    expect(html).toContain('data-implied-zone="buy"')
  })

  it('flags an above-band implied marker as a risk zone with an above-sustainable-band note', () => {
    const html = render(baseCase({
      state: 'WATCH',
      market_implied_growth: 0.12,
      band_low: 0.05,
      band_high: 0.08,
      band_center: 0.065,
      band_grounding_status: 'grounded',
      required_gap: 0.02,
      gap_to_band: -0.09,
      implied_above_band: true,
    }))
    expect(html).toContain('data-implied-zone="above-band"')
    expect(html).toContain('above sustainable band')
  })

  it('surfaces an unsupported_high band-grounding badge', () => {
    const html = render(baseCase({
      state: 'WATCH',
      market_implied_growth: 0.09,
      band_low: 0.05,
      band_high: 0.08,
      band_center: 0.065,
      band_grounding_status: 'unsupported_high',
      required_gap: 0.02,
      gap_to_band: -0.06,
    }))
    expect(html).toContain('unsupported_high')
  })
})

describe('ResearchCasePanel growth-axis uses the Owlfolio design system only', () => {
  const FOREIGN_PALETTE_LITERALS = ['#6366f1', '#a5b4fc', '124, 140, 255', '124,140,255']
  it('the growth-band axis builder references owl-* tokens and no foreign palette', () => {
    const source = readFileSync(fileURLToPath(new URL('../ResearchCasePanel.tsx', import.meta.url)), 'utf8')
    const start = source.indexOf('function createGrowthBandAxis')
    expect(start).toBeGreaterThan(-1)
    const end = source.indexOf('\nfunction ', start + 1)
    const region = source.slice(start, end === -1 ? undefined : end)
    expect(region).toContain('var(--owl-color')
    for (const literal of FOREIGN_PALETTE_LITERALS) {
      expect(region, `growth-band axis should not contain "${literal}"`).not.toContain(literal)
    }
  })
})
