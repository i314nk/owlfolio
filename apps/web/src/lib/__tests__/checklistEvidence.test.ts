import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CHECKLIST_PARAMS, listBusinessItems } from '@owlfolio/strategies/checklistParams'
import type { ResearchCaseProjection } from '@owlfolio/ledger/projections/researchCaseProjection'

import { resolveBusinessFindings, resolveChecklistEvidence } from '../checklistEvidence'

// ---------------------------------------------------------------------------
// Phase 7 S4 — the EVIDENCE READ-LAYER. A PURE read of the persisted research-case projection: for each
// BUSINESS checklist item carrying a `reads` field, marshal the value at that projected path beside the
// item. It MUST be a read of the projection only — NO valuation/cluster/shariah engine call, ever.
// Cognitive items (no `reads`) get NO evidence.
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url))

/** A projection populated with every persisted evidence field the 11 business items read. */
function fullProjection(): ResearchCaseProjection {
  return {
    research_case_id: 'rc_test',
    version: 1,
    superseded: false,
    stage: 'admit',
    shariah_status: 'COMPLIANT',
    owner_earnings_valuation: { confidence: 'medium' },
    valuation: {
      market_implied_growth: 0.08,
      moat_class: 'monopoly',
      terminal_value_pct_of_iv: 0.62,
      owner_earnings_bridge: { reported_net_income_per_share: 5 } as never,
      growth_window_years: 4,
      growth_points_used: 5,
      growth_method: 'log_linear_regression',
    },
    sizing_recommendation: {
      worst_case: {
        aggregate_cluster_downside_fraction: 0.03,
        cluster_key: 'sic:73',
        cluster_basis: 'sic_proxy',
      },
    },
  } as unknown as ResearchCaseProjection
}

describe('resolveChecklistEvidence — the S4 reads-only evidence marshaller', () => {
  it('marshals each business item with a reads field from the PROJECTED value (not a fresh computation)', () => {
    const evidence = resolveChecklistEvidence(fullProjection())

    // Item -> the projected field it reads. Each value is the projection's, formatted for display.
    expect(evidence.overpaying_for_quality).toContain('0.08')
    expect(evidence.moat_erosion).toContain('monopoly')
    expect(evidence.terminal_value_optimism).toContain('0.62')
    expect(evidence.cyclical_peak).toContain('medium')
    expect(evidence.quality_of_earnings).toBeDefined()
    // Item 8: the NEW persist-only cluster key evidence.
    expect(evidence.concentration_correlation).toContain('sic:73')
    expect(evidence.shariah_drift).toContain('COMPLIANT')
    // Item 11: the NEW persist-only data-completeness window evidence.
    expect(evidence.data_completeness).toContain('4')
  })

  it('renders NO evidence for cognitive items (human-only, no reads)', () => {
    const evidence = resolveChecklistEvidence(fullProjection())
    for (const item of CHECKLIST_PARAMS.items) {
      if (item.category === 'cognitive') {
        expect(evidence[item.id]).toBeUndefined()
      }
    }
  })

  it('renders NO evidence for business items that have no reads field', () => {
    const evidence = resolveChecklistEvidence(fullProjection())
    const noReads = CHECKLIST_PARAMS.items.filter((i) => i.category === 'business' && i.reads === undefined)
    expect(noReads.length).toBeGreaterThan(0)
    for (const item of noReads) {
      expect(evidence[item.id]).toBeUndefined()
    }
  })

  it('omits an item whose projected value is absent (no fabricated evidence)', () => {
    const sparse = { research_case_id: 'rc_x', version: 1, superseded: false, stage: 'admit' } as unknown as ResearchCaseProjection
    const evidence = resolveChecklistEvidence(sparse)
    for (const item of CHECKLIST_PARAMS.items) {
      expect(evidence[item.id]).toBeUndefined()
    }
  })

  it('is structurally a PURE read of the projection — imports NO valuation/cluster/shariah engine', () => {
    const src = readFileSync(resolve(__dirname, '../checklistEvidence.ts'), 'utf8')
    // No engine modules: the evidence layer reads persisted projection fields only.
    expect(src).not.toMatch(/correlatedClusters|evaluateClusterCap/)
    expect(src).not.toMatch(/twoStageValuation|demonstratedOwnerEarningsGrowth|secEdgar/)
    expect(src).not.toMatch(/shariah(Assessment|Policy|Engine)/i)
    // It does not recompute: no import from a strategies engine other than the checklist DATA params.
    expect(src).not.toMatch(/computeSizingRecommendation|sizingAssessment/)
  })
})

describe('resolveBusinessFindings', () => {
  it('returns a non-empty finding for every business item, even with an empty projection', () => {
    const findings = resolveBusinessFindings(undefined)
    for (const item of listBusinessItems()) {
      expect(findings[item.id]?.trim().length ?? 0).toBeGreaterThan(0)
    }
  })
  it('surfaces a grounded value when the projection has it', () => {
    const projection = { valuation: { terminal_value_pct_of_iv: 0.42 } } as never
    const findings = resolveBusinessFindings(projection)
    expect(findings.terminal_value_optimism).toContain('0.42')
  })
  it('marks a non-groundable item as qualitative rather than leaving it blank', () => {
    const findings = resolveBusinessFindings(undefined)
    expect(findings.capital_allocation?.toLowerCase()).toContain('qualitative')
  })
  it('never emits a finding keyed to a cognitive item', () => {
    const findings = resolveBusinessFindings(undefined)
    expect(findings.anchoring).toBeUndefined()
  })
})
