import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { SavingsSleeveConfig } from '@owlfolio/shared'

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

  it('forward-DCF removal: does NOT surface the dollar reference fair value (even from a legacy-shape case), while the reverse-DCF read still shows', () => {
    // baseCase() carries the retired forward-DCF reference_fair_value: 210 (legacy shape). The dossier must
    // NOT render it ($210.00) nor any "reference fair value" / "cross-check (not the decision)" label — a
    // dollar reference FV below the model buy-below read as a contradiction. The reverse-DCF market-implied
    // growth read stays.
    const html = render(baseCase(), QUOTE)
    expect(html).not.toContain('$210.00')
    expect(html.toLowerCase()).not.toContain('reference fair value')
    expect(html.toLowerCase()).not.toContain('cross-check (not the decision)')
    expect(html.toLowerCase()).toContain('the market implies')
  })

  it('forward-DCF removal (fresh shape): a case with NO reference_fair_value / fair_value_per_share renders no forward-FV figure, while the reverse-DCF read still shows', () => {
    // A fresh-shape case (post-removal emission): neither the dollar reference_fair_value nor
    // fair_value_per_share is present. The dossier must render no "reference fair value" / "cross-check"
    // label and no forward-FV figure, while the reverse-DCF market-implied growth read still shows.
    const fresh = baseCase()
    const valuation = { ...fresh.valuation } as Record<string, unknown>
    delete valuation.reference_fair_value
    delete valuation.fair_value_per_share
    const html = render({ ...fresh, valuation } as unknown as AppResearchCase, QUOTE)
    expect(html.toLowerCase()).not.toContain('reference fair value')
    // The dollar-FV "cross-check" labels are gone (a generic "valuation cross-check" prose note is fine).
    expect(html.toLowerCase()).not.toContain('cross-check (not the decision)')
    expect(html.toLowerCase()).not.toContain('cross-check, not the decision')
    expect(html.toLowerCase()).toContain('the market implies')
  })

  it('renders an honest degraded decision card for RESEARCH_MORE runs with no buy figures (never silently omits the section)', () => {
    // The SPGI dogfood: a run whose synthesis could not ground a valuation clamps to RESEARCH_MORE with
    // no buy-below / no sanity flags / no buy-zone read — and the decision card vanished entirely. The
    // card must instead STATE the outcome: the verdict, and why no buy signal is recordable.
    const fresh = baseCase()
    const html = render({
      ...fresh,
      investment_verdict: 'RESEARCH_MORE',
      valuation_status: 'INSUFFICIENT_DATA',
      decision: 'RESEARCH_MORE',
      reason: 'BUY not recordable: missing the data a buy signal needs.',
      valuation: { moat_class: 'wide', moat_passes_gate: true },
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('data-testid="decision-summary"')
    expect(html).toContain('RESEARCH_MORE')
    expect(html.toLowerCase()).toContain('no recordable buy signal')
    expect(html).toContain('BUY not recordable: missing the data a buy signal needs.')
  })

  it('shows the model-assumed sustainable growth in the decision key figures, beside the market-implied read', () => {
    // Owner requirement: the decision card must show the MODEL's assumed sustainable growth (its own
    // judgment) next to the market-implied growth (what the price demands), so the gap is readable at
    // the point of decision. baseCase: growth_rate 0.06 (the model's headline assumed growth).
    const html = render(baseCase(), QUOTE)
    const keyFigures = html.slice(html.indexOf('decision-key-figures'))
    expect(keyFigures).toContain('Model assumed growth')
    expect(keyFigures).toContain('6.0%')
  })

  it('surfaces the market-implied growth read', () => {
    const html = render(baseCase(), QUOTE)
    expect(html.toLowerCase()).toContain('the market implies')
    expect(html).toContain('9.0%')
  })

  it('surfaces the implied exit multiple (§2 flag-only sanity output) as a ledger line', () => {
    const html = render(baseCase({ implied_exit_multiple: 7.8 }), QUOTE)
    expect(html).toContain('Market-implied exit multiple')
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
    expect(html).toContain('Market-implied exit multiple')
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

  // D1 (owner feedback, post-B8): the pre-pillar JOINT MoS judgment is RETIRED from the dossier — the
  // book's mechanical 30%/50% thresholds (margin_of_safety_grade, T0) own the margin now. A legacy case
  // carrying the field renders NO joint headline; the thesis-break audit (key assumption + triggers)
  // survives as its own card.
  it('the pre-pillar joint MoS judgment no longer renders, even when the legacy field is present', () => {
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
      margin_of_safety_moat_ungrounded: true,
    } as unknown as AppResearchCase, QUOTE)
    expect(html).not.toContain('Margin of safety (joint)')
    expect(html).not.toContain('data-testid="mos-moat-sourced"')
    expect(html).not.toContain('data-testid="mos-moat-ungrounded"')
    expect(html).not.toContain('data-testid="margin-of-safety-audit"')
    // The thesis-break audit survives (its own card).
    expect(html).toContain('data-testid="thesis-break-audit"')
    expect(html).toContain('The assumed 6% durable growth holds.')
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
    // forward-DCF removal: the dollar reference fair value stat is gone even though baseCase carries the
    // legacy reference_fair_value (no label, no cross-check sub-note, no $210.00 figure).
    expect(html).not.toContain('Reference fair value')
    expect(html.toLowerCase()).not.toContain('cross-check, not the decision')
    expect(html).not.toContain('$210.00')
    // the two hidden price-implied assumptions surfaced together
    expect(html).toContain('Market-implied growth')
    expect(html).toContain('Market-implied exit multiple')
    expect(html).toContain('12.3× OE')
    // the strip uses the owl ledger-stat idiom
    expect(html).toContain('owl-ledger-line')
    expect(html).toContain('owl-ledger-stat')
    // D1: the decision moved to the END — the key-figures strip renders after the P4 valuation reasoning.
    expect(html.indexOf('data-testid="decision-key-figures"')).toBeGreaterThan(html.indexOf('data-testid="valuation-reasoning"'))
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
  it('D1: the DECISION comes at the end — after Pillar 4 valuation and the synthesis header', () => {
    const html = render(baseCase(), QUOTE)
    const synthesisIndex = html.indexOf('data-testid="pillar-header-synthesis"')
    const decisionIndex = html.indexOf('data-testid="decision-summary"')
    const valuationReasoningIndex = html.indexOf('data-testid="valuation-reasoning"')
    const thesisBreakIndex = html.indexOf('data-testid="thesis-break-audit"')
    expect(synthesisIndex).toBeGreaterThan(-1)
    expect(decisionIndex).toBeGreaterThan(-1)
    expect(valuationReasoningIndex).toBeGreaterThan(-1)
    // Price is the last FILTER; the decision is the last WORD: valuation (P4) → synthesis → decision.
    expect(valuationReasoningIndex).toBeLessThan(synthesisIndex)
    expect(synthesisIndex).toBeLessThan(decisionIndex)
    // The thesis-break audit rides directly with the decision (after it, same end region).
    expect(thesisBreakIndex).toBeGreaterThan(decisionIndex)
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
    expect(html).toContain('Deep-dive specialist lanes (2 of 5 grounded)')
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

  // ACCESSIBLE CITATIONS — markers are NOT hover-only: each is a real keyboard/SR-reachable in-page anchor
  // to its source entry (owl-focusable + aria-label naming the source), so a keyboard / screen-reader user
  // reaches the evidence without a mouse hover.
  it('renders citation markers as focusable in-page anchors with a source-naming aria-label', () => {
    const html = render({
      ...baseCase(),
      circle_competence: {
        in_competence: true,
        cashflow_predictability: 'durably_predictable',
        cashflow_drivers: [{ driver: 'Recurring float', citation: 'sec_edgar_10k_abc', grounded: true }],
      },
    } as unknown as AppResearchCase, QUOTE)
    // The marker is an anchor to the matching source entry, keyboard-focusable, with an accessible name.
    expect(html).toContain('href="#source-sec_edgar_10k_abc"')
    expect(html).toContain('owl-focusable')
    expect(html).toContain('aria-label="Source: sec_edgar_10k_abc — jump to evidence"')
  })

  // The unverified-citation variant keeps its distinct (risk-tone) treatment AND an aria-label that says it
  // did not verify — an unverified cite is never quietly hidden, even from a screen reader.
  it('marks an unverified citation distinctly and notes "did not verify" in its accessible name', () => {
    const html = render({
      ...baseCase(),
      circle_competence: {
        in_competence: true,
        cashflow_predictability: 'durably_predictable',
        cashflow_drivers: [{ driver: 'Unverified driver', citation: 'sec_edgar_10k_xyz', grounded: false }],
      },
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('aria-label="Source: sec_edgar_10k_xyz — did not verify; jump to evidence"')
    expect(html).toContain('title="Citation did not verify: sec_edgar_10k_xyz"')
    // The distinct risk tone is applied (not the verified gold tone).
    expect(html).toContain('var(--owl-color-risk-bright)')
  })

  // The evidence entry the marker links to carries the matching stable id, so the anchor lands on it. The
  // Sources list is surfaced always-visible (the anchor target is never hidden behind a collapsed details).
  it('gives each evidence source the stable anchor id the citation marker links to', () => {
    const html = render({
      ...baseCase(),
      source_evidence: [
        { source_id: 'sec_edgar_10k_abc', title: 'Berkshire 10-K FY2025', excerpt: 'Float drivers.' },
      ],
      circle_competence: {
        in_competence: true,
        cashflow_predictability: 'durably_predictable',
        cashflow_drivers: [{ driver: 'Recurring float', citation: 'sec_edgar_10k_abc', grounded: true }],
      },
    } as unknown as AppResearchCase, QUOTE)
    // Marker href and evidence id agree (sanitized consistently) so the in-page jump resolves.
    expect(html).toContain('href="#source-sec_edgar_10k_abc"')
    expect(html).toContain('id="source-sec_edgar_10k_abc"')
    // The Sources list now lives INSIDE the collapsed "Evidence & sources" drop-down (the anchor ids are
    // still present; the browser auto-expands the <details> when a citation navigates to a source fragment).
    expect(html).toContain('Evidence &amp; sources')
    const sourceIdIdx = html.indexOf('id="source-sec_edgar_10k_abc"')
    expect(sourceIdIdx).toBeGreaterThan(-1)
    expect(sourceIdIdx).toBeGreaterThan(html.indexOf('Evidence &amp; sources'))
  })

  it('states which provider and model the run was executed by in the engine marker', () => {
    const html = render({
      ...baseCase(),
      authored_by_provider_id: 'openai',
      authored_by_model_id: 'gpt-5.5',
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('run by openai / gpt-5.5')
  })

  it('shows just the provider when the model id is absent (legacy run)', () => {
    const html = render({
      ...baseCase(),
      authored_by_provider_id: 'openai',
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('run by openai')
    expect(html).not.toContain('run by openai /')
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

  // S3 (Phase 3 pillars) — the moat pillar judgment display: taxonomy chips from GROUNDED drivers,
  // the grounded-or-labeled direction (a narrowing carries the sell-signal principle; an ungrounded
  // claim says so), and the per-peer cited/model-asserted standout labels.
  it('renders moat types, direction, and the peer-standout labels (S3, grounded-or-labeled)', () => {
    const html = render(baseCase({
      judgment: {
        moat: {
          proposed_tier: 'wide', resolved_tier: 'wide', grounded_driver_count: 2, anchor_computable: false,
          resolved_moat_types: ['brand', 'scale_advantage'],
          moat_direction: 'narrowing',
          direction_drivers: [{ evidence: 'private-label share erosion 200bps/yr', citation: 'src_10k', grounded: true }],
          peer_standout: {
            peers: [
              { name: 'PeerCo A', gross_margin_note: '~38% FY2024 gross margin', citation: 'src_peer', model_asserted: false, grounded: true },
              { name: 'PeerCo B', gross_margin_note: '~31% FY2024 gross margin', model_asserted: true, grounded: false },
            ],
            judgment: 'stands_out',
            reasoning: 'Above all named peers.',
            grounded_peer_count: 1,
          },
        },
      },
    } as unknown as Partial<ResearchCaseValuationProjection>), QUOTE)
    expect(html).toContain('Moat types (grounded): brand, scale advantage')
    expect(html).toContain('Moat direction: NARROWING (grounded)')
    expect(html).toContain('sell signal')
    expect(html).toContain('PeerCo A ~38% FY2024 gross margin (cited)')
    expect(html).toContain('PeerCo B ~31% FY2024 gross margin (model-asserted, not verified)')
  })

  // D1 (owner feedback): the MOATS IDENTIFIED card — Pillar 2 opens with WHICH moats were found
  // (grounded taxonomy chips + drivers + direction + peer standout) BEFORE the three named tests.
  it('renders the moats-identified card in Pillar 2 carrying the taxonomy, direction, and peer labels', () => {
    const html = render(baseCase({
      judgment: {
        moat: {
          proposed_tier: 'wide', resolved_tier: 'wide', grounded_driver_count: 2, anchor_computable: false,
          moat_drivers: [
            { advantage: 'Membership flywheel locks in renewals', citation: 'src_10k', grounded: true, moat_type: 'switching_costs' },
            { advantage: 'Kirkland private-label brand', citation: 'src_10k', grounded: true, moat_type: 'brand' },
          ],
          resolved_moat_types: ['switching_costs', 'brand'],
          moat_direction: 'stable',
          peer_standout: {
            peers: [{ name: 'PeerCo A', gross_margin_note: '~38% FY2024 gross margin', citation: 'src_peer', model_asserted: false, grounded: true }],
            judgment: 'stands_out',
            reasoning: 'Above all named peers.',
            grounded_peer_count: 1,
          },
        },
      },
    } as unknown as Partial<ResearchCaseValuationProjection>), QUOTE)
    const cardStart = html.indexOf('data-testid="moats-identified-card"')
    const cardEnd = html.indexOf('data-testid="moat-tests-card"')
    expect(cardStart).toBeGreaterThan(-1)
    const card = html.slice(cardStart, cardEnd)
    expect(card).toContain('Moat types (grounded): switching costs, brand')
    expect(card).toContain('Membership flywheel locks in renewals')
    expect(card).toContain('Moat direction: STABLE (grounded)')
    expect(card).toContain('PeerCo A ~38% FY2024 gross margin (cited)')
    // The moat width + provenance line moved here from the valuation panel.
    expect(card).toContain('WIDE proposed → WIDE resolved')
  })

  it('the moats-identified card renders an honest fallback on a pre-pillar case (no crash, class still shown)', () => {
    const html = render(baseCase(), QUOTE)
    const cardStart = html.indexOf('data-testid="moats-identified-card"')
    expect(cardStart).toBeGreaterThan(-1)
    const card = html.slice(cardStart, html.indexOf('data-testid="moat-tests-card"'))
    expect(card).toContain('WIDE')
    expect(card.toLowerCase()).toContain('predates')
  })

  it('labels a claimed-but-ungrounded direction as undetermined with no weight (S3 fail-closed display)', () => {
    const html = render(baseCase({
      judgment: {
        moat: {
          proposed_tier: 'wide', resolved_tier: 'wide', grounded_driver_count: 2, anchor_computable: false,
          moat_direction: 'undetermined', direction_ungrounded: true,
        },
      },
    } as unknown as Partial<ResearchCaseValuationProjection>), QUOTE)
    expect(html).toContain('Moat direction: undetermined (claimed but ungrounded — carries no weight)')
  })

  // CONSOLIDATION (Priority 3) — per-dimension findings live ONLY in the lanes; valuation reasoning ONLY in
  // the Valuation box; the decision-evidence section keeps ONLY the unique whole-case thesis. The unique
  // AAOIFI ratio ledger is preserved (relocated to its own compliance block), not lost.
  it('removes the duplicated valuation/shariah/risks cards; the thesis lives in the verdict summary', () => {
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
    // The whole-case thesis now lives in the hero verdict summary (the standalone Thesis card was removed).
    expect(html).toContain('Verdict summary')
    expect(html).not.toContain('data-testid="research-dossier-card-thesis"')
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
  // COLLAPSIBLE DEFAULTS (Priority 1) — the lanes section collapses; the decision surface stays open.
  it('makes every info-box a <details>: lanes + thesis-break collapsed, the decision box expanded by default', () => {
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
    // The decision box is now a collapsible <details>, EXPANDED by default (its headline summary stays visible).
    const decisionIdx = html.indexOf('data-testid="decision-summary"')
    const decisionTag = html.slice(decisionIdx - 80, html.indexOf('>', decisionIdx))
    expect(decisionTag).toContain('<details')
    expect(decisionTag).toContain('open=""')
    // The thesis-break audit is a collapsed <details> info-box (headline + drill-down), no `open` attribute.
    const mosIdx = html.indexOf('data-testid="thesis-break-audit"')
    const mosTag = html.slice(mosIdx - 80, html.indexOf('>', mosIdx))
    expect(mosTag).toContain('<details')
    expect(mosTag).not.toContain('open=""')
  })
})

// ALL FIVE LANES VISIBLE (honest skip surfacing) — a deep-dive lane that grounded zero verifiable sources is
// silently skipped upstream (no specialist_finding event). On a COMPLETED dossier the lanes section must still
// render all 5 expected lanes: grounded lanes as full cards, the missing ones as honest "incomplete"
// placeholders, with a grounded-vs-expected header count. Display-only; the upstream skip is unchanged.
// Shariah runs as a dedicated focused pass (not a parallel lane) and renders via the Shariah panel / remainder.
describe('ResearchCasePanel specialist lanes surface all 5 expected lanes', () => {
  const ALL_LANES = ['business_quality', 'moat', 'management', 'financial_quality', 'risks']

  it('renders the 2 missing lanes as incomplete placeholders when only 3 of 5 grounded (shariah finding goes to remainder)', () => {
    const html = render({
      ...baseCase(),
      specialist_findings: [
        { finding_id: 'f_moat', specialist_lane: 'moat', finding_summary: 'Wide moat.', confidence: 'high', source_ids: ['s1'] },
        { finding_id: 'f_shariah', specialist_lane: 'shariah', finding_summary: 'Compliant.', confidence: 'high', source_ids: ['s2'] },
        { finding_id: 'f_risks', specialist_lane: 'risks', finding_summary: 'Manageable risks.', confidence: 'normal', source_ids: ['s3'] },
        { finding_id: 'f_fq', specialist_lane: 'financial_quality', finding_summary: 'Elite margins.', confidence: 'normal', source_ids: ['s4'] },
      ],
    } as unknown as AppResearchCase, QUOTE)
    // Honest grounded-vs-expected count in the section header (shariah is not an ordered lane).
    expect(html).toContain('Deep-dive specialist lanes (3 of 5 grounded)')
    // All five ordered lane labels are present (grounded + incomplete); shariah renders via remainder.
    expect(html).toContain('Business quality')
    expect(html).toContain('Moat')
    expect(html).toContain('Management')
    expect(html).toContain('Financial quality')
    expect(html).toContain('Shariah')
    expect(html).toContain('Risks')
    // The two ungrounded ordered lanes render as incomplete placeholders with stable testids.
    expect(html).toContain('data-testid="specialist-lane-incomplete-business_quality"')
    expect(html).toContain('data-testid="specialist-lane-incomplete-management"')
    // The grounded ordered lanes are NOT placeholders.
    expect(html).not.toContain('data-testid="specialist-lane-incomplete-moat"')
    expect(html).not.toContain('data-testid="specialist-lane-incomplete-risks"')
    expect(html).not.toContain('data-testid="specialist-lane-incomplete-financial_quality"')
    // Shariah is not an ordered lane — no incomplete placeholder for it.
    expect(html).not.toContain('data-testid="specialist-lane-incomplete-shariah"')
    // The placeholder carries the honest, non-investment-grade status.
    expect(html.toLowerCase()).toContain('no verifiable sources grounded this run')
  })

  it('renders a placeholder-prose lane (model emitted "...") as incomplete, not a literal "..." card', () => {
    const html = render({
      ...baseCase(),
      specialist_findings: [
        { finding_id: 'f_bq', specialist_lane: 'business_quality', finding_summary: 'Fortress business.', confidence: 'high', source_ids: ['s1'] },
        { finding_id: 'f_moat', specialist_lane: 'moat', finding_summary: 'Wide moat.', confidence: 'high', source_ids: ['s2'] },
        { finding_id: 'f_mgmt', specialist_lane: 'management', finding_summary: 'Sound stewards.', confidence: 'high', source_ids: ['s3'] },
        { finding_id: 'f_shariah', specialist_lane: 'shariah', finding_summary: 'Compliant.', confidence: 'high', source_ids: ['s4'] },
        { finding_id: 'f_risks', specialist_lane: 'risks', finding_summary: 'Manageable risks.', confidence: 'normal', source_ids: ['s5'] },
        // The financial_quality lane grounded 3 sources but the model returned only "..." — no written analysis.
        { finding_id: 'f_fq', specialist_lane: 'financial_quality', finding_summary: '...', confidence: 'high', source_ids: ['s6', 's7', 's8'] },
      ],
    } as unknown as AppResearchCase, QUOTE)
    // The empty financial_quality lane is surfaced as an incomplete slot with the "returned no written analysis" reason…
    expect(html).toContain('data-testid="specialist-lane-incomplete-financial_quality"')
    expect(html.toLowerCase()).toContain('returned no written analysis')
    // …and the grounded count reflects it honestly (4 real of 5, not 5; shariah goes to remainder).
    expect(html).toContain('Deep-dive specialist lanes (4 of 5 grounded)')
  })

  it('renders all 5 as normal cards (no incomplete placeholders) when all 5 grounded', () => {
    const html = render({
      ...baseCase(),
      specialist_findings: ALL_LANES.map((lane, i) => ({
        finding_id: `f_${lane}`,
        specialist_lane: lane,
        finding_summary: `${lane} summary.`,
        confidence: 'normal',
        source_ids: [`s${i}`],
      })),
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('Deep-dive specialist lanes (5 of 5 grounded)')
    for (const lane of ALL_LANES) {
      expect(html).not.toContain(`data-testid="specialist-lane-incomplete-${lane}"`)
    }
  })

  it('leaves a legacy dossier (no specialist_findings) unaffected — 5 ordered lanes grounded, no incomplete placeholders', () => {
    // baseCase() is a legacy decision dossier (no standalone pipeline); it falls back to all 7 legacy lane
    // findings. The 5 orderedLanes render as normal cards; legacy shariah and valuation findings land in
    // remainder and also render normally. No incomplete placeholders appear.
    const html = render(baseCase(), QUOTE)
    expect(html).toContain('data-testid="specialist-lanes-flow"')
    expect(html).toContain('Deep-dive specialist lanes (5 of 5 grounded)')
    for (const lane of ALL_LANES) {
      expect(html).not.toContain(`data-testid="specialist-lane-incomplete-${lane}"`)
    }
  })

  it('leaves a true empty / non-deep-dive case unaffected (no lanes section, no incomplete cards)', () => {
    // The set-aside dossier has no specialist_findings and is not a legacy fallback → the lanes section does
    // not render at all, and certainly never shows incomplete cards.
    const html = render(setAsideCase(), QUOTE)
    expect(html).not.toContain('data-testid="specialist-lanes-flow"')
    for (const lane of ALL_LANES) {
      expect(html).not.toContain(`data-testid="specialist-lane-incomplete-${lane}"`)
    }
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
// When the circle gate sets a candidate aside, the expensive 5-lane deep dive never ran: verdict PASS +
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
    // Citation traceability preserved (evidence/sources still render).
    expect(html).toContain('Evidence &amp; sources')
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
    const foreground = html.slice(0, html.indexOf('Evidence &amp; sources'))
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
    expect(html).toContain('data-testid="thesis-break-audit"')
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

  it('states the sector permissibility judgment (business activities) above the AAOIFI ratios', () => {
    // Owner complaint (the Visa dogfood): the Shariah section only talked numbers — nothing about
    // whether the BUSINESS is permissible. The pass's grounded sector_status is now stated first.
    const html = render({
      ...baseCase(),
      shariah_status: 'CONDITIONAL',
      shariah_sector_status: 'compliant',
      shariah_financial: {
        debt_ratio: 0.041,
        cash_securities_ratio: 0.028,
        impermissible_income_pct: 0.02,
        verdict: 'CONDITIONAL',
        purification_pct: 0.02,
      },
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('data-testid="shariah-sector-permissibility"')
    expect(html).toContain('Business activities')
    expect(html).toContain('Permissible')
  })

  it('states a non-compliant sector as NOT permissible', () => {
    const html = render({
      ...baseCase(),
      shariah_status: 'NON_COMPLIANT',
      shariah_sector_status: 'non_compliant',
      shariah_financial: {
        debt_ratio: 0.041,
        cash_securities_ratio: 0.028,
        impermissible_income_pct: 0.02,
        verdict: 'FAIL',
        purification_pct: 0.02,
      },
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('data-testid="shariah-sector-permissibility"')
    expect(html).toContain('Not permissible')
  })

  it('itemizes every impermissible-income line (interest, dividends, model residual) in the AAOIFI ledger', () => {
    // Owner requirement: ALL impermissible-income components are SHOWN — the composition the
    // purification % was computed from, not one opaque number.
    const html = render({
      ...baseCase(),
      shariah_status: 'CONDITIONAL',
      shariah_financial: {
        debt_ratio: 0.0134,
        cash_securities_ratio: 0.0355,
        impermissible_income_pct: 0.004,
        verdict: 'CONDITIONAL',
        purification_pct: 0.004,
        impermissible_income_lines: [
          { concept: 'InvestmentIncomeInterest', label: 'interest income', amount_musd: 2790 },
          { concept: 'InvestmentIncomeDividend', label: 'dividend income', amount_musd: 120 },
          { concept: 'model_judgment', label: 'model-quantified additional impermissible income (beyond disclosed interest/dividends)', amount_musd: 90 },
        ],
      },
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('data-testid="shariah-impermissible-income-lines"')
    expect(html).toContain('interest income')
    expect(html).toContain('dividend income')
    expect(html).toContain('$2,790M')
    expect(html).toContain('$120M')
    expect(html).toContain('$90M')
  })
})

// DISCOUNT-ANCHOR VINTAGE (#3) — the discount's risk-free anchor is the compliant savings rate. The dossier
// surfaces the breakdown AND when that rate was last set, so a stale / never-set anchor is VISIBLE rather
// than silently trusted. Read-only: it never changes the discount math (the rate flows via discountRate()).
describe('ResearchCasePanel discount-anchor vintage', () => {
  function renderWithSavings(savings?: SavingsSleeveConfig): string {
    return renderToStaticMarkup(
      createElement(ResearchCasePanel, {
        researchCase: baseCase(),
        mode: 'personal-local',
        marketQuote: QUOTE,
        ...(savings === undefined ? {} : { savings }),
      }),
    )
  }

  it('shows the savings-rate vintage line when the rate has been set', () => {
    const html = renderWithSavings({
      savings_expected_profit_rate: 0.03,
      savings_model: 'mudarabah',
      equity_risk_margin: 0.05,
      savings_rate_set_at: '2026-06-28T00:00:00.000Z',
    })
    expect(html).toContain('data-testid="discount-anchor-provenance"')
    expect(html).toContain('compliant savings 3.0%')
    expect(html).toContain('equity premium 5.5%')
    expect(html).toContain('savings rate last set Jun 28, 2026')
  })

  it('flags "using default — not set" when no savings rate vintage is recorded', () => {
    const html = renderWithSavings({
      savings_expected_profit_rate: 0.02,
      savings_model: 'mudarabah',
      equity_risk_margin: 0.05,
    })
    expect(html).toContain('data-testid="discount-anchor-provenance"')
    expect(html).toContain('savings rate: using default 2.0% — not set')
  })

  it('renders a legacy config with no savings sleeve as "not set" (no crash)', () => {
    const html = renderWithSavings(undefined)
    expect(html).toContain('data-testid="discount-anchor-provenance"')
    expect(html).toContain('savings rate: using default 2.0% — not set')
  })
})

describe('ResearchCasePanel Shariah deep-screen-incomplete caveat (fail-closed)', () => {
  it('surfaces the "compliance not deep-verified this run" caveat when the shariah deep re-screen was skipped', () => {
    const html = render(
      { ...baseCase(), shariah_deep_screen_incomplete: true } as unknown as AppResearchCase,
      QUOTE,
    )
    expect(html).toContain('data-testid="shariah-deep-screen-incomplete"')
    expect(html).toContain('Compliance not deep-verified this run.')
    expect(html).toContain('cited no verified source')
    // The quick-screen verdict is NOT flipped — it still reads COMPLIANT alongside the caveat.
    expect(html).toContain('COMPLIANT')
  })

  it('omits the caveat when the shariah deep re-screen grounded (legacy/normal run — flag absent)', () => {
    const html = render(baseCase(), QUOTE)
    expect(html).not.toContain('data-testid="shariah-deep-screen-incomplete"')
    expect(html).not.toContain('Compliance not deep-verified this run.')
  })
})

// S5 (Phase 3 pillars) — the MANAGEMENT pillar card: resolved integrity/talent tiers, the veto
// badge naming the failed trait, unverified-flag labeling, the T0 strip, and the retained-earnings
// test rendered honestly (deferred-on-data, never a fabricated number).
describe('management pillar card (S5)', () => {
  it('renders the veto badge, tiers, labeled flags, T0 strip, and the retained-earnings result', () => {
    const html = render({
      ...baseCase(),
      management_judgment: {
        resolved_integrity: 'red_flag',
        resolved_talent: 'adequate',
        integrity: {
          comp_structure: { summary: 'Bonus on revenue growth alone.', alignment: 'misaligned', citation: 'src_def14a' },
          comp_grounded: true,
          flags: [
            { claim: 'Undisclosed related-party purchases', severity: 'high', citation: 'src_def14a', grounded: true },
            { claim: 'Rumored option backdating', severity: 'high', citation: 'src_blog', grounded: false },
          ],
          grounded_high_flag_count: 1,
          proposed_integrity: 'red_flag',
          integrity_reasoning: 'Cited related-party dealing.',
        },
        talent: {
          talent_drivers: [{ evidence: 'Debt paid down through the cycle', citation: 'src_10k', grounded: true }],
          grounded_driver_count: 1,
          proposed_talent: 'excellent',
          talent_reasoning: 'One grounded driver.',
          talent_grounding_capped: true,
        },
        talent_t0: {
          roic: { computable: true, band: 'solid', median_roic: 0.12, latest_roic: 0.11, years_used: 8 },
          payout: { computable: true, years_used: 8, dividend_paying_years: 8, buyback_years: 6, payout_ratio_latest: 0.55, buybacks_below_sbc: true },
          debt: { computable: false, reason: 'total debt not tagged for the latest year' },
        },
        retained_earnings: { computable: false, reason: 'price history unavailable: fetch failed' },
      },
      management_veto_applied: 'integrity',
      management_veto_reason: 'management_veto (integrity): grounded red flag.',
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('data-testid="management-pillar-card"')
    expect(html).toContain('MANAGEMENT VETO (integrity)')
    expect(html).toContain('Integrity: RED FLAG')
    expect(html).toContain('Talent: ADEQUATE')
    expect(html).toContain('cite-verified): Undisclosed related-party purchases')
    expect(html).toContain('UNVERIFIED — carries no weight): Rumored option backdating')
    expect(html).toContain('ROIC: median 12.0% — solid')
    expect(html).toContain('buybacks below SBC')
    expect(html).toContain('Debt: not computable (total debt not tagged for the latest year)')
    expect(html).toContain('Retained-earnings test (Buffett): deferred on data')
  })

  it('renders nothing when no management judgment exists (legacy cases)', () => {
    const html = render(baseCase(), QUOTE)
    expect(html).not.toContain('management-pillar-card')
  })
})

// S8 (Phase 3 pillars) — the PILLAR frame: the dossier reads as Buffett's checklist applied in
// order, and a gated case says structurally WHICH pillars never ran.
describe('pillar frame (S8)', () => {
  it('renders the pillar headers in checklist order with the moat-tests card under Pillar 2', () => {
    const html = render({
      ...baseCase(),
      moat_tests: {
        capital_efficiency: { computable: true, band: 'excellent', median_roic: 0.21, latest_roic: 0.2, years_used: 8, note: 'Median ROIC 21.0% over 8 years — excellent (>=15% — likely a moat).' },
        two_engine: { computable: true, revenue_engine: true, margin_engine: true, passes: true, revenue_cagr: 0.07, margin_trend_bps_per_year: 30, years_used: 8, note: 'Both engines running.' },
        standout: { computable: false, reason: 'gross profit not tagged by this filer (neither GrossProfit nor revenue−COGS resolves)' },
      },
    } as unknown as AppResearchCase, QUOTE)
    const order = ['pillar-header-front-gate', 'pillar-header-pillar-1', 'pillar-header-pillar-2', 'pillar-header-pillar-3', 'pillar-header-pillar-4', 'pillar-header-synthesis']
    const positions = order.map((id) => html.indexOf(`data-testid="${id}"`))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions]).toEqual([...positions].slice().sort((a, b) => a - b))
    // D1: the MOATS IDENTIFIED card leads Pillar 2, BEFORE the three named tests.
    const p2 = html.indexOf('data-testid="pillar-header-pillar-2"')
    const moatsCard = html.indexOf('data-testid="moats-identified-card"')
    const testsCard = html.indexOf('data-testid="moat-tests-card"')
    const p3 = html.indexOf('data-testid="pillar-header-pillar-3"')
    expect(moatsCard).toBeGreaterThan(p2)
    expect(moatsCard).toBeLessThan(testsCard)
    expect(testsCard).toBeLessThan(p3)
    // The three named tests render computable-or-honestly-deferred under Pillar 2.
    expect(html).toContain('data-testid="moat-tests-card"')
    expect(html).toContain('EXCELLENT — Median ROIC 21.0%')
    expect(html).toContain('PASSES — Both engines running.')
    expect(html).toContain('not computable (gross profit not tagged')
  })

  it('a moat-gate-short-circuited case marks Pillars 3–4 "not evaluated — failed at the moat filter"', () => {
    const html = render({
      ...baseCase(),
      moat_gate_short_circuited: true,
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('data-testid="moat-gate-short-circuit-banner"')
    expect(html).toContain('data-testid="pillar-status-pillar-3"')
    expect(html).toContain('data-testid="pillar-status-pillar-4"')
    expect(html).toContain('not evaluated — failed at the moat filter')
    // Pillars 1–2 carry no not-evaluated status (they ran).
    expect(html).not.toContain('data-testid="pillar-status-pillar-1"')
    expect(html).not.toContain('data-testid="pillar-status-pillar-2"')
  })

  it('a moat-gate-overridden run keeps the permanent label', () => {
    const html = render({
      ...baseCase(),
      moat_gate_overridden: true,
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('data-testid="moat-gate-overridden-marker"')
    expect(html).toContain('Moat gate overridden by user')
  })
})

// B3 (Phase 4) — the ONE-PAGER card renders the seven items under Pillar 1 and is absent on legacy cases.
describe('the one-pager card (B3)', () => {
  it('renders the seven items with the plain-English sentence leading', () => {
    const html = render({
      ...baseCase(),
      one_pager: {
        plain_english: 'Sells memberships that grant access to low-priced bulk goods.',
        segments: ['Warehouses US', 'International'],
        revenue_drivers: ['Membership fees', 'Merchandise at thin markups'],
        most_profitable_segments: ['Membership fees'],
        strengths: ['Renewal economics'],
        weak_spots: ['Thin margins leave little room for error'],
        growth_levers: ['New warehouses', 'Fee increases'],
      },
    } as unknown as AppResearchCase, QUOTE)
    expect(html).toContain('data-testid="one-pager-card"')
    expect(html).toContain('Sells memberships that grant access to low-priced bulk goods.')
    expect(html).toContain('Where the real profits come from')
    expect(html).toContain('Thin margins leave little room for error')
    // Renders under the Pillar 1 header, before Pillar 2.
    const p1 = html.indexOf('pillar-header-pillar-1')
    const card = html.indexOf('one-pager-card')
    const p2 = html.indexOf('pillar-header-pillar-2')
    expect(p1).toBeLessThan(card)
    expect(card).toBeLessThan(p2)
  })

  it('is absent on legacy cases (no one_pager projected)', () => {
    const html = render(baseCase(), QUOTE)
    expect(html).not.toContain('one-pager-card')
  })
})
