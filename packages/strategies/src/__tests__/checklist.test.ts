import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CHECKLIST_PARAMS,
  listBusinessItems,
  type ChecklistAudit,
  type ChecklistItemDefinition,
} from '../checklistParams'
import { evaluateChecklistCompletion } from '../checklist'

// Phase 7 — audit-and-decide: the HARNESS marshals one finding per business item, the human only
// acknowledges the cognitive reflection. Completion = every business item has a non-empty finding AND
// the human acknowledged. Decision-NEUTRAL: scoring is made structurally unrepresentable (no
// score/tally/count/weight in the return or the source). Mirrors the no-Kelly discipline.

const BUSINESS_IDS = [
  'overpaying_for_quality',
  'moat_erosion',
  'terminal_value_optimism',
  'cyclical_peak',
  'capital_allocation',
  'quality_of_earnings',
  'secular_disruption',
  'concentration_correlation',
  'thesis_drift',
  'shariah_drift',
  'data_completeness',
] as const

const COGNITIVE_IDS = [
  'anchoring',
  'rationalization_commitment',
  'pattern_match',
  'social_proof',
  'disposition',
  'recency_vividness',
] as const

function findingsForAllBusiness(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of listBusinessItems()) out[item.id] = `Finding for ${item.id}.`
  return out
}
function completeAudit(): ChecklistAudit {
  return {
    version: CHECKLIST_PARAMS.version,
    business_findings: findingsForAllBusiness(),
    cognitive_acknowledged: true,
  }
}

describe('CHECKLIST_PARAMS — data-defined checklist items', () => {
  it('is frozen and carries a version string', () => {
    expect(Object.isFrozen(CHECKLIST_PARAMS)).toBe(true)
    expect(typeof CHECKLIST_PARAMS.version).toBe('string')
    expect(CHECKLIST_PARAMS.version.length).toBeGreaterThan(0)
    expect(CHECKLIST_PARAMS.version).toBe('checklist-2026-06-phase7-2')
  })

  it('has exactly 17 items: 11 business + 6 cognitive', () => {
    expect(CHECKLIST_PARAMS.items).toHaveLength(17)
    const business = CHECKLIST_PARAMS.items.filter((i) => i.category === 'business')
    const cognitive = CHECKLIST_PARAMS.items.filter((i) => i.category === 'cognitive')
    expect(business).toHaveLength(11)
    expect(cognitive).toHaveLength(6)
  })

  it('contains exactly the expected business ids', () => {
    const ids = CHECKLIST_PARAMS.items
      .filter((i) => i.category === 'business')
      .map((i) => i.id)
    expect(new Set(ids)).toEqual(new Set(BUSINESS_IDS))
  })

  it('contains exactly the expected cognitive ids', () => {
    const ids = CHECKLIST_PARAMS.items
      .filter((i) => i.category === 'cognitive')
      .map((i) => i.id)
    expect(new Set(ids)).toEqual(new Set(COGNITIVE_IDS))
  })

  it('has unique ids and non-empty prompts for every item', () => {
    const ids = CHECKLIST_PARAMS.items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of CHECKLIST_PARAMS.items) {
      expect(item.prompt.trim().length).toBeGreaterThan(0)
    }
  })

  it('cognitive items NEVER carry a reads field (human-only, introspective)', () => {
    const cognitive = CHECKLIST_PARAMS.items.filter((i) => i.category === 'cognitive')
    for (const item of cognitive) {
      expect(item.reads).toBeUndefined()
      expect(Object.prototype.hasOwnProperty.call(item, 'reads')).toBe(false)
    }
  })

  it('sets the expected reads-hints on groundable business items', () => {
    const readsById = Object.fromEntries(
      CHECKLIST_PARAMS.items.map((i) => [i.id, i.reads]),
    )
    expect(readsById.overpaying_for_quality).toBe('valuation.market_implied_growth')
    expect(readsById.moat_erosion).toBe('valuation.moat_class')
    expect(readsById.terminal_value_optimism).toBe('valuation.terminal_value_pct_of_iv')
    expect(readsById.cyclical_peak).toBe('owner_earnings_valuation.confidence')
    expect(readsById.quality_of_earnings).toBe('valuation.owner_earnings_bridge')
    expect(readsById.concentration_correlation).toBe(
      'sizing_recommendation.worst_case.cluster_key',
    )
    expect(readsById.shariah_drift).toBe('shariah_status')
    expect(readsById.data_completeness).toBe('valuation.growth_window_years')
  })

  it('leaves non-groundable business items WITHOUT a reads field', () => {
    const noReads: ChecklistItemDefinition['id'][] = [
      'capital_allocation',
      'secular_disruption',
      'thesis_drift',
    ]
    for (const id of noReads) {
      const item = CHECKLIST_PARAMS.items.find((i) => i.id === id)
      expect(item).toBeDefined()
      expect(item?.reads).toBeUndefined()
      expect(Object.prototype.hasOwnProperty.call(item, 'reads')).toBe(false)
    }
  })

  it('uses the exact spec prompts (verbatim)', () => {
    const promptById = Object.fromEntries(
      CHECKLIST_PARAMS.items.map((i) => [i.id, i.prompt]),
    )
    expect(promptById.overpaying_for_quality).toBe(
      "Am I paying for growth that's already priced in?",
    )
    expect(promptById.anchoring).toBe(
      'Am I anchored to the purchase price, a past price, or my first estimate?',
    )
    expect(promptById.shariah_drift).toBe(
      'Is this still compliant, or has the financial-ratio / revenue mix drifted since admission?',
    )
  })
})

describe('evaluateChecklistCompletion (audit-and-decide)', () => {
  it('complete when every business item has a finding and cognitive acknowledged', () => {
    const r = evaluateChecklistCompletion(completeAudit())
    expect(r.complete).toBe(true)
    expect(r.missing).toEqual([])
  })
  it('incomplete and names the business item when a finding is missing', () => {
    const a = completeAudit()
    const id = listBusinessItems()[0]!.id
    delete a.business_findings[id]
    const r = evaluateChecklistCompletion(a)
    expect(r.complete).toBe(false)
    expect(r.missing).toContain(id)
  })
  it('treats a whitespace-only finding as missing', () => {
    const a = completeAudit()
    const id = listBusinessItems()[0]!.id
    a.business_findings[id] = '   '
    expect(evaluateChecklistCompletion(a).missing).toContain(id)
  })
  it('incomplete when cognitive reflection not acknowledged', () => {
    const a = completeAudit()
    a.cognitive_acknowledged = false
    const r = evaluateChecklistCompletion(a)
    expect(r.complete).toBe(false)
    expect(r.missing).toContain('cognitive_acknowledgement')
  })
  it('does not require findings for cognitive items', () => {
    const a = completeAudit()
    for (const id of Object.keys(a.business_findings)) {
      expect(CHECKLIST_PARAMS.items.find((i) => i.id === id)?.category).toBe('business')
    }
    expect(evaluateChecklistCompletion(a).complete).toBe(true)
  })
  it('decision-neutral: result is exactly { complete, missing }, no numeric field', () => {
    const r = evaluateChecklistCompletion(completeAudit()) as Record<string, unknown>
    expect(Object.keys(r).sort()).toEqual(['complete', 'missing'])
    for (const v of Object.values(r)) expect(typeof v).not.toBe('number')
  })
  it('extensibility: a newly-added business item is automatically required to have a finding', () => {
    const extended = {
      version: 'test-extended',
      items: [
        ...CHECKLIST_PARAMS.items,
        { id: 'new_business_risk', category: 'business' as const, prompt: 'New?' },
      ],
    }
    const r = evaluateChecklistCompletion(completeAudit(), extended)
    expect(r.complete).toBe(false)
    expect(r.missing).toContain('new_business_risk')
  })

  describe('decision-neutral structural invariant (the load-bearing one)', () => {
    it('the module source contains no tally arithmetic over the audit feeding a verdict', () => {
      // Mirror the no-Kelly grep style: strip comments + string literals, then assert no
      // scoring/tally identifiers survive in the evaluator source.
      const src = readFileSync(
        fileURLToPath(new URL('../checklist.ts', import.meta.url)),
        'utf8',
      )
      const stripped = src
        // strip block comments
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // strip line comments
        .replace(/\/\/[^\n]*/g, '')
        // strip string/template literals
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/`(?:[^`\\]|\\.)*`/g, '``')
      const forbidden = [
        /\bscore\b/i,
        /\btally\b/i,
        /\bpass_count\b/i,
        /\bn_of_m\b/i,
        /\bpassedCount\b/i,
        /\bratio\b/i,
        /\bpercentage\b/i,
        /\bweight\b/i,
        /\.reduce\s*\(/, // no fold accumulating a numeric verdict
      ]
      for (const re of forbidden) {
        expect(stripped).not.toMatch(re)
      }
    })
  })
})
