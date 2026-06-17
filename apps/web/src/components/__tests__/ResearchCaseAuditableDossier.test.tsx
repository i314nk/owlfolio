import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ResearchCasePanel } from '../ResearchCasePanel'
import type { MarketQuote } from '../ResearchCasePanel'
import type { AppResearchCase } from '../../lib/workflow'
import type { ResearchCaseValuationProjection } from '@owlfolio/ledger/projections/researchCaseProjection'

// RELIGHTENED DECISION (R1) — the auditable dossier (§4). The MODEL proposes the verdict + valuation +
// buy-below with cited reasoning; the deterministic side emits a flag-only sanity-check. The dossier
// LEADS with what the human needs to decide (model verdict + valuation_status, the model-proposed buy-below
// + in-buy-zone, the sanity flags) and beneath it surfaces the reasoning to audit (cited valuation_reasoning,
// the reference fair value labeled a cross-check, market-implied growth, the independent bear case).

function baseCase(valuationOverrides: Partial<ResearchCaseValuationProjection> = {}): AppResearchCase {
  return {
    research_case_id: 'rc_dossier_001',
    version: 1,
    superseded: false,
    stage: 'decision_drafted',
    company_id: 'company_dossier',
    ticker: 'DSR',
    strategy_id: 'buffett-munger',
    decision_id: 'decision_dossier_001',
    decision: 'WATCH',
    reason: 'Quality compounder; the model judges the price implies more than the business sustains.',
    thesis_summary: 'A wide-moat compounder reinvesting at high incremental returns.',
    investment_verdict: 'WATCH',
    strategy_compliance: 'CONDITIONAL',
    shariah_status: 'COMPLIANT',
    valuation_status: 'EXPENSIVE',
    next_required_action: 'Audit the reasoning; wait for the price to meet the model buy-below.',
    updated_at: '2026-06-09T12:00:00.000Z',
    red_team: {
      status: 'red_team_complete',
      strongest_objection: {
        claim: 'Cloud margins compress as hyperscaler competition intensifies.',
        severity: 'high',
        citations: ['src_competitor_10k_2025'],
      },
    },
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
      // R1 model-proposed + sanity layer (these now drive the dossier).
      proposed_buy_below: 147.0,
      reference_fair_value: 210.0,
      in_buy_zone: false,
      market_implied_growth: 0.09,
      sanity_flags: [
        'Implied growth 9% exceeds the demonstrated owner-earnings CAGR — the model assumes more than the history shows.',
      ],
      valuation_reasoning: {
        owner_earnings_basis: 'FY2025 10-K owner earnings of $16.27/sh (NI + D&A − maint capex − SBC − ΔWC).',
        assumed_growth: 0.06,
        assumed_growth_rationale: 'Reinvestment 40% × incremental ROIC 20% supports ~6% near-term, cited to the cash-flow statement.',
        discount_rationale: '10% flat discount — no WACC, no beta.',
      },
      ...valuationOverrides,
    },
    gate_checklist: [],
    source_ids: [],
    source_evidence: [],
    ledger_timeline: [],
  } as unknown as AppResearchCase
}

function render(researchCase: AppResearchCase, marketQuote?: MarketQuote): string {
  return renderToStaticMarkup(
    createElement(ResearchCasePanel, {
      researchCase,
      mode: 'personal-local',
      ...(marketQuote === undefined ? {} : { marketQuote }),
    }),
  )
}

const QUOTE: MarketQuote = {
  price_per_share: 168.0,
  currency: 'USD',
  as_of: '2026-06-09T00:00:00.000Z',
  source: 'Yahoo Finance',
}

describe('ResearchCasePanel auditable dossier (R1)', () => {
  it('leads with the model verdict + valuation_status and the model-proposed buy-below + in-buy-zone', () => {
    const html = render(baseCase(), QUOTE)
    // The model verdict + valuation status lead.
    expect(html).toContain('WATCH')
    expect(html).toContain('EXPENSIVE')
    // The decision panel and the model-proposed buy-below.
    expect(html).toContain('data-testid="decision-summary"')
    expect(html).toContain('Model buy-below')
    expect(html).toContain('$147.00')
    // The live price + the arithmetic in-buy-zone read (price 168 > buy-below 147 → not in zone).
    expect(html).toContain('$168.00')
    expect(html.toLowerCase()).toContain('not in the buy zone')
  })

  it('renders the sanity-check flags as advisory annotations (flags, not blocks)', () => {
    const html = render(baseCase(), QUOTE)
    expect(html).toContain('data-testid="sanity-flags"')
    expect(html).toContain('Implied growth 9% exceeds the demonstrated owner-earnings CAGR')
    // Framed as a sanity-check, advisory — never a block.
    expect(html.toLowerCase()).toContain('sanity-check')
    expect(html.toLowerCase()).toContain('does not block')
  })

  it('shows the cited valuation_reasoning beneath (owner-earnings basis, assumed growth + why, discount)', () => {
    const html = render(baseCase(), QUOTE)
    expect(html).toContain('data-testid="valuation-reasoning"')
    expect(html).toContain('FY2025 10-K owner earnings of $16.27/sh')
    expect(html).toContain('Reinvestment 40% × incremental ROIC 20%')
    expect(html).toContain('10% flat discount')
    // The assumed growth surfaced as the model's, with the rationale.
    expect(html.toLowerCase()).toContain('assumes')
  })

  it('labels the reference fair value as a deterministic cross-check, not the decision', () => {
    const html = render(baseCase(), QUOTE)
    expect(html).toContain('$210.00')
    expect(html.toLowerCase()).toContain('cross-check (not the decision)')
  })

  it('surfaces the market-implied growth read', () => {
    const html = render(baseCase(), QUOTE)
    expect(html.toLowerCase()).toContain('the market implies')
    expect(html).toContain('9.0%')
  })

  it('surfaces the implied exit multiple (§2 flag-only sanity output) as a ledger line', () => {
    const html = render(baseCase({ implied_exit_multiple: 7.8 }), QUOTE)
    expect(html).toContain('Implied exit multiple')
    expect(html).toContain('7.8× OE')
  })

  it('renders the implied-exit-multiple directional flag annotation when it fires (high), alongside the line', () => {
    const html = render(baseCase({
      implied_exit_multiple: 21.4,
      sanity_flags: [
        'sanity_implied_exit_multiple_high: today\'s price implies an exit multiple of 21.4× owner-earnings (> the 18× sanity cap), well above a defensible exit.',
      ],
    }), QUOTE)
    // The ledger line shows the multiple.
    expect(html).toContain('Implied exit multiple')
    expect(html).toContain('21.4× OE')
    // The directional flag annotation renders inside the advisory (non-blocking) sanity-flags panel.
    expect(html).toContain('data-testid="sanity-flags"')
    expect(html.toLowerCase()).toContain('above a defensible exit')
    expect(html.toLowerCase()).toContain('does not block')
  })

  it('surfaces the independent bear case (red-team strongest objection)', () => {
    const html = render(baseCase(), QUOTE)
    expect(html.toLowerCase()).toContain('bear case')
    expect(html).toContain('Cloud margins compress as hyperscaler competition intensifies.')
  })

  it('shows in-buy-zone when the live price is at/below the model buy-below', () => {
    const html = render(baseCase({ in_buy_zone: true }), {
      ...QUOTE,
      price_per_share: 140.0,
    })
    expect(html).toContain('$140.00')
    expect(html.toLowerCase()).toContain('in the buy zone')
  })

  it('retires the growth-axis band viz and the band/gap ledger labels entirely', () => {
    const html = render(baseCase(), QUOTE)
    expect(html).not.toContain('data-testid="growth-band-axis"')
    expect(html).not.toContain('data-testid="sustainable-band-span"')
    expect(html).not.toContain('data-testid="implied-growth-marker"')
    expect(html).not.toContain('data-testid="buy-threshold-marker"')
    expect(html).not.toContain('Sustainable band')
    expect(html).not.toContain('Required growth gap')
    expect(html).not.toContain('Buy-threshold growth')
  })
})

describe('ResearchCasePanel auditable dossier uses the Owlfolio design system only', () => {
  const FOREIGN_PALETTE_LITERALS = ['#6366f1', '#a5b4fc', '124, 140, 255', '124,140,255']
  it('the decision + sanity + reasoning builders reference owl-* tokens and no foreign palette', () => {
    const source = readFileSync(fileURLToPath(new URL('../ResearchCasePanel.tsx', import.meta.url)), 'utf8')
    const start = source.indexOf('function createDecisionPanel')
    expect(start).toBeGreaterThan(-1)
    const end = source.indexOf('\nfunction createValuationPanel')
    const region = source.slice(start, end === -1 ? undefined : end)
    expect(region).toContain('var(--owl-color')
    for (const literal of FOREIGN_PALETTE_LITERALS) {
      expect(region, `decision/sanity/reasoning region should not contain "${literal}"`).not.toContain(literal)
    }
  })

  it('no longer defines the retired growth-band axis builder', () => {
    const source = readFileSync(fileURLToPath(new URL('../ResearchCasePanel.tsx', import.meta.url)), 'utf8')
    expect(source).not.toContain('function createGrowthBandAxis')
  })
})
