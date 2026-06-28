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

  // Margin-of-safety audit surface: the model's key_wrong_assumption + thesis_break_triggers.
  it('renders the key-wrong-assumption line and the thesis-break-triggers list when present', () => {
    const html = render({
      ...baseCase(),
      key_wrong_assumption: 'The assumed 6% durable growth holds — if pricing power erodes the thesis breaks.',
      thesis_break_triggers: [
        'Gross margin falls below 40% for two consecutive quarters.',
        'Membership renewal rate drops below 88%.',
      ],
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('The assumed 6% durable growth holds — if pricing power erodes the thesis breaks.')
    expect(html).toContain('Gross margin falls below 40% for two consecutive quarters.')
    expect(html).toContain('Membership renewal rate drops below 88%.')
  })

  it('falls back to "Not yet available" for the margin-of-safety surface when absent (legacy case, no crash)', () => {
    // baseCase carries neither field — both lines render the honest not-yet-available fallback.
    const html = render(baseCase(), QUOTE)
    expect(html).toContain('Key-wrong assumption')
    expect(html).toContain('Thesis-break triggers')
    expect(html).toContain('Not yet available')
  })

  // MARGIN-OF-SAFETY JOINT JUDGMENT (synthesis-owned) — the HEADLINE of the MoS audit surface, ABOVE the
  // key-wrong-assumption / thesis-break lines.
  it('renders the structured margin-of-safety joint judgment as the HEADLINE above key-wrong/thesis-break', () => {
    const html = render({
      ...baseCase(),
      key_wrong_assumption: 'The assumed 6% durable growth holds.',
      margin_of_safety_judgment: {
        sources: ['price', 'moat'],
        price_gap_reasoning: 'Price sits 25% below the model buy-below.',
        moat_durability_reasoning: 'The grounded wide moat lets time bail out estimate error.',
        adequacy: 'adequate',
        reasoning: 'Price gap and grounded moat jointly supply an adequate margin.',
      },
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('Margin of safety (joint)')
    expect(html).toContain('Price sits 25% below the model buy-below.')
    expect(html).toContain('The grounded wide moat lets time bail out estimate error.')
    expect(html).toContain('Price gap and grounded moat jointly supply an adequate margin.')
    expect(html.toLowerCase()).toContain('adequacy')
    // The headline renders ABOVE the key-wrong-assumption line.
    expect(html.indexOf('Margin of safety (joint)')).toBeLessThan(html.indexOf('Key-wrong assumption'))
  })

  it('surfaces the price margin AND the moat-durability thesis side by side in the MoS region (neither buried)', () => {
    const html = render({
      ...baseCase(),
      margin_of_safety_judgment: {
        sources: ['price', 'moat'],
        price_gap_reasoning: 'Price sits 25% below the model buy-below.',
        moat_durability_reasoning: 'The grounded wide moat lets time bail out estimate error.',
        adequacy: 'adequate',
        reasoning: 'Price gap and grounded moat jointly supply an adequate margin.',
      },
    } as unknown as AppResearchCase, QUOTE)
    // Both source columns are labelled and present in the joint MoS region.
    expect(html).toContain('Price margin')
    expect(html).toContain('Moat durability')
    // Both per-source reasonings render (neither is buried).
    expect(html).toContain('Price sits 25% below the model buy-below.')
    expect(html).toContain('The grounded wide moat lets time bail out estimate error.')
    // They appear side by side: the price column precedes the moat column in render order.
    expect(html.indexOf('Price margin')).toBeLessThan(html.indexOf('Moat durability'))
  })

  it('flags a MOAT-sourced margin visually (higher-stakes — scrutinize moat durability)', () => {
    const html = render({
      ...baseCase(),
      margin_of_safety_judgment: {
        sources: ['moat'],
        moat_durability_reasoning: 'Grounded fortress moat carries the margin.',
        adequacy: 'adequate',
        reasoning: 'Moat durability carries the margin.',
      },
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('data-testid="mos-moat-sourced"')
    expect(html.toLowerCase()).toContain('scrutinize moat durability')
  })

  it('surfaces the Guard-2 incoherence flag when a moat-sourced margin rests on an ungrounded moat', () => {
    const html = render({
      ...baseCase(),
      margin_of_safety_judgment: {
        sources: ['moat'],
        moat_durability_reasoning: 'Claims moat durability.',
        adequacy: 'adequate',
        reasoning: 'Incoherently rests on an ungrounded moat.',
      },
      margin_of_safety_moat_ungrounded: true,
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('data-testid="mos-moat-ungrounded"')
    expect(html.toLowerCase()).toContain('not grounded')
  })

  it('falls back gracefully for the joint margin-of-safety headline when absent (legacy case, no crash)', () => {
    const html = render(baseCase(), QUOTE)
    expect(html).toContain('Margin of safety (joint)')
    // No structured judgment → the honest not-yet-available fallback (no crash).
    expect(html).toContain('Not yet available')
  })

  // KEY-FIGURES STRIP (Priority 2) — the full decision-critical figure set LEADS the decision surface as
  // scannable stat blocks, not buried in prose.
  it('leads the decision surface with a key-figures strip carrying the full figure set', () => {
    const html = render(baseCase({ implied_exit_multiple: 12.3 }), QUOTE)
    expect(html).toContain('data-testid="decision-key-figures"')
    // model buy-below, live price, in-buy-zone
    expect(html).toContain('Model buy-below')
    expect(html).toContain('Live price')
    expect(html).toContain('Buy-zone')
    // reference fair value, with a SHORT label and a small secondary cross-check sub-note (not a giant
    // inline label that wraps to several lines).
    expect(html).toContain('Reference fair value')
    expect(html).toContain('cross-check, not the decision')
    expect(html).toContain('$210.00')
    // the two hidden price-implied assumptions surfaced together
    expect(html).toContain('Market-implied growth')
    expect(html).toContain('Implied exit multiple')
    expect(html).toContain('12.3× OE')
    // the strip uses the owl ledger-stat idiom
    expect(html).toContain('owl-ledger-line')
    expect(html).toContain('owl-ledger-stat')
    // The key-figures strip leads the decision surface, above the valuation reasoning prose.
    expect(html.indexOf('data-testid="decision-key-figures"')).toBeLessThan(html.indexOf('data-testid="valuation-reasoning"'))
  })

  it('renders honest "Not yet available" key figures when the price-implied assumptions are absent (legacy)', () => {
    // A legacy case whose valuation carries neither market_implied_growth nor implied_exit_multiple.
    const legacy = baseCase()
    const valuation = { ...legacy.valuation } as Record<string, unknown>
    delete valuation.market_implied_growth
    delete valuation.implied_exit_multiple
    delete valuation.reference_fair_value
    const html = render({ ...legacy, valuation } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('data-testid="decision-key-figures"')
    expect(html).toContain('Not yet available')
  })

  // MARGIN-OF-SAFETY LEADS THE DECISION REGION (Priority 3) — promoted above the valuation reasoning panel.
  it('leads the decision region with the margin-of-safety judgment (above the valuation reasoning)', () => {
    const html = render(baseCase(), QUOTE)
    const mosIndex = html.indexOf('data-testid="margin-of-safety-audit"')
    const valuationReasoningIndex = html.indexOf('data-testid="valuation-reasoning"')
    expect(mosIndex).toBeGreaterThan(-1)
    expect(valuationReasoningIndex).toBeGreaterThan(-1)
    // The MoS audit surface leads, above the valuation reasoning.
    expect(mosIndex).toBeLessThan(valuationReasoningIndex)
    // It carries a prominent gold accent rail (Priority 3 visual prominence).
    const mosHtml = html.slice(mosIndex - 200, mosIndex + 400)
    expect(mosHtml).toContain('var(--owl-color-gold)')
  })

  // VERTICAL STACKING + COLLAPSIBLE (Priority 1) — the specialist lanes section is collapsed by default
  // (<details>) and the lane cards stack FULL-WIDTH (one per row), no CSS multi-column masonry. A short and
  // a long card coexist in the one full-width flow container.
  it('stacks the specialist lanes full-width inside a collapsed <details> section (no masonry)', () => {
    const conclusion = 'POOL faces a genuine moat risk from private-label encroachment across its core distribution niche.'
    const reasoning =
      'Big-box retailers have begun sourcing directly from manufacturers, compressing the distributor margin pool over successive cycles and pressuring returns on capital well below the historical baseline.'
    const longText = `${conclusion} ${reasoning}`
    const html = render({
      ...baseCase(),
      specialist_findings: [
        { finding_id: 'f_short', specialist_lane: 'moat', finding_summary: 'Wide moat.', confidence: 'high', source_ids: ['s1'] },
        { finding_id: 'f_long', specialist_lane: 'risks', finding_summary: longText, confidence: 'normal', source_ids: ['s2', 's3'] },
      ],
    } as unknown as AppResearchCase, QUOTE)
    const flowStart = html.indexOf('data-testid="specialist-lanes-flow"')
    expect(flowStart).toBeGreaterThan(-1)
    // The section is collapsible (a <details> with the lane count in the summary), collapsed by default.
    const sectionStart = html.indexOf('data-testid="specialist-lanes-section"')
    expect(sectionStart).toBeGreaterThan(-1)
    expect(sectionStart).toBeLessThan(flowStart)
    const sectionTag = html.slice(sectionStart - 60, sectionStart)
    expect(sectionTag).toContain('<details')
    // Collapsed by default: the section <details> carries no `open` attribute.
    expect(html.slice(sectionStart - 60, html.indexOf('>', sectionStart))).not.toContain('open=""')
    expect(html).toContain('Deep-dive specialist lanes (2)')
    // The masonry multi-column packing is gone.
    expect(html).not.toContain('data-owl-flow="masonry"')
    // Both the short and the long card live inside the one full-width flow container.
    expect(html).toContain('Wide moat.')
    // The long card pulls its CONCLUSION to the top (at a glance, before the disclosure) and defers the
    // supporting REASONING inside the lane's own <details> (density treatment, Priority 4).
    const flowHtml = html.slice(flowStart)
    const detailsIdx = flowHtml.indexOf('<details')
    const detailsCloseIdx = flowHtml.indexOf('</details>', detailsIdx)
    const conclusionIdx = flowHtml.indexOf(conclusion)
    const reasoningIdx = flowHtml.indexOf(reasoning)
    expect(detailsIdx).toBeGreaterThan(-1)
    expect(conclusionIdx).toBeGreaterThan(-1)
    // The conclusion is shown at a glance, ahead of the disclosure; the reasoning is deferred inside it.
    expect(conclusionIdx).toBeLessThan(detailsIdx)
    expect(reasoningIdx).toBeGreaterThan(detailsIdx)
    expect(reasoningIdx).toBeLessThan(detailsCloseIdx)
  })

  it('still defers reasoning for a run-on lane finding with no internal sentence break (density)', () => {
    // A wall of text with no sentence terminator must still split (word-boundary fallback) — no content lost.
    const runOn = `${'durable scale advantage and recurring float compounding steadily '.repeat(5)}across cycles`
    const html = render({
      ...baseCase(),
      specialist_findings: [
        { finding_id: 'f_runon', specialist_lane: 'moat', finding_summary: runOn, confidence: 'high', source_ids: ['s1'] },
      ],
    } as unknown as AppResearchCase, QUOTE)
    const flowStart = html.indexOf('data-testid="specialist-lanes-flow"')
    const flowHtml = html.slice(flowStart)
    // The run-on still produces a disclosure, and the trailing text survives inside it (no truncation).
    expect(flowHtml).toContain('<details')
    expect(flowHtml).toContain('across cycles')
  })

  // COMPACT CITATION MARKERS (Priority 5) — the verbose inline [cited: <id>] is gone from the reading line;
  // a compact marker carries the full id on hover (title) and the id stays in the sources section.
  it('renders compact citation markers (full id preserved via title), not verbose inline [cited: ...]', () => {
    const html = render({
      ...baseCase(),
      circle_competence: {
        in_competence: true,
        cashflow_predictability: 'durably_predictable',
        competence_reasoning: 'Understandable cashflow engine.',
        cashflow_drivers: [{ driver: 'Recurring float', citation: 'sec_edgar_10k_abc', grounded: true }],
        predictability_breakers: [{ breaker: 'Cat-loss tail', citation: 'sec_edgar_10k_def', grounded: true }],
      },
    } as unknown as AppResearchCase, QUOTE)
    // Compact marker present; the verbose inline form is gone from the reading line.
    expect(html).toContain('data-testid="citation-marker"')
    expect(html).not.toContain('[cited: sec_edgar_10k_abc]')
    // Full id remains discoverable via the marker's title (hover) — traceability preserved.
    expect(html).toContain('title="Source: sec_edgar_10k_abc"')
    expect(html).toContain('title="Source: sec_edgar_10k_def"')
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

  // JUDGMENT PROVENANCE (Priority 2) — the moat / runway "proposed → resolved" anchor reads are PROSE; they
  // belong as labeled text lines, never crammed into numeric ledger-stat blocks.
  it('renders the moat/runway judgment provenance as labeled text, not inside numeric ledger-stats', () => {
    const html = render(baseCase({
      judgment: {
        moat: { proposed_tier: 'wide', resolved_tier: 'moderate', grounded_driver_count: 3, anchor_computable: false },
        runway: { proposed_tier: 'proven', resolved_tier: 'proven', grounded_driver_count: 2, anchor_computable: false },
      },
    } as unknown as Partial<ResearchCaseValuationProjection>), QUOTE)
    // The prose anchor reads are gone from the numeric stat-strip (no "Moat anchor"/"Runway anchor" stats).
    expect(html).not.toContain('Moat anchor')
    expect(html).not.toContain('Runway anchor')
    // They render in a dedicated Judgment provenance text block instead — the provenance prose lives there.
    const provIdx = html.indexOf('data-testid="judgment-provenance"')
    expect(provIdx).toBeGreaterThan(-1)
    const provHtml = html.slice(provIdx, html.indexOf('</div>', provIdx))
    expect(provHtml).toContain('proposed →')
    expect(html).toContain('Moat: WIDE proposed → MODERATE resolved')
    expect(html).toContain('Runway: PROVEN proposed → PROVEN resolved')
  })

  // CONSOLIDATION (Priority 3) — per-dimension findings live ONLY in the lanes; valuation reasoning ONLY in
  // the Valuation box; the decision-evidence section keeps ONLY the unique whole-case thesis. The unique
  // AAOIFI ratio ledger is preserved (relocated to its own compliance block), not lost.
  it('keeps only the thesis card and removes the duplicated valuation/shariah/risks cards', () => {
    const html = render({
      ...baseCase(),
      valuation_rationale: 'Duplicated valuation rationale card text.',
      shariah_rationale: 'Duplicated shariah rationale card text.',
      risks: ['Duplicated risk card line.'],
      shariah_financial: {
        debt_ratio: 0.0134,
        cash_securities_ratio: 0.0355,
        impermissible_income_pct: 0.004,
        verdict: 'PASS',
        purification_pct: 0.004,
      },
    } as unknown as AppResearchCase, QUOTE)
    // The whole-case thesis still renders.
    expect(html).toContain('data-testid="research-dossier-card-thesis"')
    // The duplicated per-dimension cards are gone.
    expect(html).not.toContain('data-testid="research-dossier-card-valuation"')
    expect(html).not.toContain('data-testid="research-dossier-card-shariah-compliance"')
    expect(html).not.toContain('data-testid="research-dossier-card-risks-open-questions"')
    // The unique AAOIFI ratio ledger is preserved in its own compliance block.
    expect(html).toContain('data-testid="compliance-ratios"')
    expect(html).toContain('AAOIFI financial ratios (harness-computed)')
  })

  // MoS BODY (Priority 5) — LEAD with the synthesis-owned joint reasoning; render the per-source columns
  // ONLY when their reasoning is present; never an empty "No reasoning recorded" column.
  it('leads the MoS box with the joint reasoning and renders no empty per-source column when both absent', () => {
    const html = render({
      ...baseCase(),
      margin_of_safety_judgment: {
        sources: ['price', 'moat'],
        adequacy: 'adequate',
        reasoning: 'The price gap plus the grounded moat jointly supply an adequate margin.',
      },
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('The price gap plus the grounded moat jointly supply an adequate margin.')
    // No empty per-source columns / "No reasoning recorded" placeholders dominate the box.
    expect(html).not.toContain('No reasoning recorded')
    // The compact rests-on note replaces the empty boxes.
    expect(html).toContain('Margin rests on: price gap + moat durability')
    // The joint reasoning leads the box, above the rests-on line.
    const mosIdx = html.indexOf('data-testid="margin-of-safety-audit"')
    const reasoningIdx = html.indexOf('The price gap plus the grounded moat jointly supply an adequate margin.')
    const restsOnIdx = html.indexOf('Rests on:')
    expect(reasoningIdx).toBeGreaterThan(mosIdx)
    expect(reasoningIdx).toBeLessThan(restsOnIdx)
  })

  it('renders only the per-source MoS column whose reasoning is present', () => {
    const html = render({
      ...baseCase(),
      margin_of_safety_judgment: {
        sources: ['price', 'moat'],
        price_gap_reasoning: 'Price sits 25% below the model buy-below.',
        adequacy: 'adequate',
        reasoning: 'Joint judgment leads.',
      },
    } as unknown as AppResearchCase, QUOTE)
    // Price reasoning present → its column renders; the moat column is absent (no moat_durability_reasoning).
    expect(html).toContain('Price margin')
    expect(html).toContain('Price sits 25% below the model buy-below.')
    expect(html).not.toContain('Moat durability')
    expect(html).not.toContain('No reasoning recorded')
  })

  // COLLAPSIBLE DEFAULTS (Priority 1) — the lanes section collapses; the decision + MoS surfaces stay open.
  it('collapses the lanes section by default while the decision + MoS surfaces stay open', () => {
    const html = render({
      ...baseCase(),
      specialist_findings: [
        { finding_id: 'f1', specialist_lane: 'moat', finding_summary: 'Wide moat.', confidence: 'high', source_ids: ['s1'] },
      ],
    } as unknown as AppResearchCase, QUOTE)
    const lanesIdx = html.indexOf('data-testid="specialist-lanes-section"')
    expect(lanesIdx).toBeGreaterThan(-1)
    // The lanes section <details> carries no `open` attribute (collapsed by default).
    expect(html.slice(lanesIdx - 60, html.indexOf('>', lanesIdx))).not.toContain('open=""')
    // The decision + MoS surfaces are plain <section>s (always visible), not collapsed behind <details>.
    const decisionIdx = html.indexOf('data-testid="decision-summary"')
    const mosIdx = html.indexOf('data-testid="margin-of-safety-audit"')
    expect(html.slice(decisionIdx - 60, decisionIdx)).toContain('<section')
    expect(html.slice(mosIdx - 60, mosIdx)).toContain('<section')
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

// ── Set-aside (circle-of-competence early exit) dossier ───────────────────────
//
// When the circle gate sets a candidate aside, the expensive 7-lane deep dive never ran: verdict PASS +
// valuation_status INSUFFICIENT_DATA, the circle judgment, the outside_circle mirror flag, NO specialist
// findings, NO valuation. The dossier must tell the honest short story (set aside, here's why) and OMIT the
// full deep-dive scaffold — no "Pending" key-figures strip, no discount figure, no "Not yet available" MoS,
// no empty lanes.

function setAsideCase(): AppResearchCase {
  return {
    research_case_id: 'rc_set_aside_001',
    version: 1,
    superseded: false,
    stage: 'decision_drafted',
    company_id: 'company_set_aside',
    ticker: 'SAS',
    strategy_id: 'buffett-munger',
    decision_id: 'decision_set_aside_001',
    decision: 'PASS',
    investment_verdict: 'PASS',
    strategy_compliance: 'INSUFFICIENT_DATA',
    valuation_status: 'INSUFFICIENT_DATA',
    reason: 'Outside circle of competence — cashflow predictability could not be demonstrated from filings.',
    thesis_summary: 'Set aside outside the circle of competence.',
    next_required_action: 'No further research — set aside (outside the circle of competence).',
    // Realistic set-aside shape: the swarm ALWAYS runs the quick screen before the circle gate, so a real
    // set-aside carries quick_screen_id + screening_result. This keeps isLegacyDecisionDossier() false (as in
    // production) so the collapsed audit trail renders the REAL quick-screen record — not the legacy fallback
    // digest a quick_screen-less fixture would wrongly trip. The visible foreground stays clean either way.
    quick_screen_id: 'quick_rc_set_aside_001',
    screening_result: 'deep_dive_candidate',
    engine_version: 'engine-test',
    updated_at: '2026-06-09T12:00:00.000Z',
    circle_competence: {
      in_competence: false,
      cashflow_predictability: 'not_predictable',
      competence_reasoning: 'The cashflows depend on commodity prices the filings do not let us forecast.',
      reason: 'circle_competence_unmet: the model judged this business’s cashflows NOT durably predictable.',
      cashflow_drivers: [{ driver: 'Spot commodity spread', citation: 'sec_edgar_10k_sas', grounded: true }],
      predictability_breakers: [{ breaker: 'Cyclical demand swings', citation: 'sec_edgar_10k_sas2', grounded: true }],
    },
    valuation: { circle_competence_unmet: true, outside_circle: true },
    gate_checklist: [],
    source_ids: [],
    source_evidence: [],
    ledger_timeline: [],
  } as unknown as AppResearchCase
}

describe('ResearchCasePanel set-aside (circle early-exit) dossier', () => {
  it('foregrounds the circle reasoning with a dominant set-aside headline and engine-version marker', () => {
    const html = render(setAsideCase())
    // Dominant set-aside state leads — calm gold, not a green PASS badge.
    expect(html).toContain('data-testid="set-aside-dossier"')
    expect(html).toContain('data-testid="set-aside-hero"')
    expect(html).toContain('SET ASIDE')
    expect(html).toContain('Set aside — outside circle of competence')
    // The grounded circle judgment foregrounded (drivers, breakers, reasoning).
    expect(html).toContain('data-testid="circle-competence"')
    expect(html).toContain('Spot commodity spread')
    expect(html).toContain('Cyclical demand swings')
    expect(html).toContain('Outside competence — set aside')
    // Engine-version provenance preserved.
    expect(html).toContain('data-testid="engine-version-marker"')
    // Citation traceability preserved (evidence/audit details still render).
    expect(html).toContain('Evidence and audit details')
  })

  it('omits the entire deep-dive scaffold and all valuation noise', () => {
    const html = render(setAsideCase(), QUOTE)
    // None of the deep-dive scaffold testids render anywhere (these are unique to the full render).
    expect(html).not.toContain('data-testid="decision-key-figures"')
    expect(html).not.toContain('data-testid="decision-summary"')
    expect(html).not.toContain('data-testid="margin-of-safety-audit"')
    expect(html).not.toContain('data-testid="valuation-reasoning"')
    expect(html).not.toContain('data-testid="specialist-lanes-flow"')
    // The VISIBLE foreground (everything above the collapsed Evidence-and-audit details) carries no
    // empty-placeholder valuation noise — no "Pending" key figures, no "Not yet available" MoS, no discount.
    // (The collapsed audit details reuses the shared legacy quick-screen/deep-dive digest, same as the
    // gated/reject path; that is the audit trail, not the deep-dive scaffold.)
    const foreground = html.slice(0, html.indexOf('Evidence and audit details'))
    expect(foreground).not.toContain('Not yet available')
    expect(foreground).not.toContain('Pending')
    expect(foreground).not.toContain('discount')
  })

  it('demotes verdict/valuation/strategy labels to a single quiet secondary metadata line', () => {
    const html = render(setAsideCase())
    // The raw labels appear only as the subordinate provenance line, not as four co-equal chips.
    expect(html).toContain('data-testid="set-aside-meta"')
    const metaIdx = html.indexOf('data-testid="set-aside-meta"')
    const metaHtml = html.slice(metaIdx, html.indexOf('</p>', metaIdx))
    expect(metaHtml).toContain('PASS')
    expect(metaHtml).toContain('Valuation: INSUFFICIENT_DATA')
    expect(metaHtml).toContain('Strategy: INSUFFICIENT_DATA')
  })

  it('does NOT treat a full deep-dive run (circle passed, has findings) as set aside', () => {
    const html = render({
      ...baseCase(),
      circle_competence: { in_competence: true, cashflow_predictability: 'durably_predictable' },
      specialist_findings: [
        { finding_id: 'f1', specialist_lane: 'moat', finding_summary: 'Wide moat.', confidence: 'high', source_ids: ['s1'] },
      ],
    } as unknown as AppResearchCase, QUOTE)
    expect(html).not.toContain('data-testid="set-aside-dossier"')
    expect(html).toContain('data-testid="decision-key-figures"')
    expect(html).toContain('data-testid="margin-of-safety-audit"')
    expect(html).toContain('data-testid="specialist-lanes-flow"')
  })

  it('renders a legacy case with no circle data normally (not set aside)', () => {
    const html = render(baseCase(), QUOTE)
    expect(html).not.toContain('data-testid="set-aside-dossier"')
    expect(html).toContain('data-testid="decision-key-figures"')
  })
})

// The quick screen is now tool-grounded: it reads a verified primary filing before judging. The dossier
// surfaces the count of grounded quick-screen sources so the grounding is visible (not "0 sources").
describe('ResearchCasePanel quick-screen grounded source count', () => {
  function quickScreenCase(quickScreenSourceIds?: string[]): AppResearchCase {
    return {
      ...baseCase(),
      quick_screen_id: 'quick_rc_dossier_001',
      screening_result: 'deep_dive_candidate',
      business_quality: 'Strong',
      ...(quickScreenSourceIds === undefined ? {} : { quick_screen_source_ids: quickScreenSourceIds }),
    } as unknown as AppResearchCase
  }

  it('renders the grounded quick-screen source count when quick-screen sources are present', () => {
    const html = render(quickScreenCase(['src_qs_1', 'src_qs_2']), QUOTE)
    expect(html).toContain('Single-agent business-quality gate')
    expect(html).toContain('Sources')
    expect(html).toContain('2 sources')
  })

  it('renders the singular form for exactly one grounded quick-screen source', () => {
    const html = render(quickScreenCase(['src_qs_1']), QUOTE)
    expect(html).toContain('1 source')
    expect(html).not.toContain('1 sources')
  })

  it('renders gracefully ("—") for a legacy quick screen with no grounded sources', () => {
    const html = render(quickScreenCase(), QUOTE)
    expect(html).toContain('Single-agent business-quality gate')
    // No crash; the Sources line falls back to an em dash.
    expect(html).toContain('—')
  })
})

describe('ResearchCasePanel Shariah compliance — fail-closed UNDETERMINED purification', () => {
  it('renders the UNDETERMINED state honestly (purification cannot be determined, NOT 0.0%)', () => {
    const html = render({
      ...baseCase(),
      shariah_status: 'UNDETERMINED',
      // No shariah_financial (impermissible income undetermined → ratios not-computable).
      shariah_impermissible_income_undetermined: true,
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('data-testid="shariah-aaoifi-undetermined"')
    expect(html.toLowerCase()).toContain('purification cannot be determined')
    // The fail-OPEN regression must NOT appear: no falsely-clean 0.0% purification on undetermined data.
    expect(html).not.toContain('Purification: 0.0%')
  })

  it('a genuine computed verdict still renders the AAOIFI ratio ledger with its purification %', () => {
    const html = render({
      ...baseCase(),
      shariah_status: 'CONDITIONAL',
      shariah_financial: {
        debt_ratio: 0.0134,
        cash_securities_ratio: 0.0355,
        impermissible_income_pct: 0.004,
        verdict: 'CONDITIONAL',
        purification_pct: 0.004,
      },
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('data-testid="shariah-aaoifi-ledger"')
    expect(html).toContain('Purification: 0.4%')
    expect(html).not.toContain('data-testid="shariah-aaoifi-undetermined"')
  })
})
