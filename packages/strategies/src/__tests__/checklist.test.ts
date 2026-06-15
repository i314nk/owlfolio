import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CHECKLIST_PARAMS,
  type ChecklistItemDefinition,
  type ChecklistParams,
} from '../checklistParams'
import {
  evaluateChecklistCompletion,
  type ChecklistAnswer,
  type ChecklistCompletion,
} from '../checklist'

// Phase 7 S1 — two decision-NEUTRAL hygiene checklists (11 business + 6 cognitive), data-defined and
// extensible, plus a pure completion evaluator that forces the question (which items remain) and NEVER
// scores the answers. Mirrors the no-Kelly discipline: scoring is made structurally unrepresentable.
// Island slice: pure, no I/O, not wired into sign-off flows yet.

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

const allAddressed = (
  params: ChecklistParams = CHECKLIST_PARAMS,
): Record<string, ChecklistAnswer> =>
  Object.fromEntries(
    params.items.map((i) => [i.id, { addressed: true, note: `addressed: ${i.id}` }]),
  )

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

describe('evaluateChecklistCompletion — pure, decision-neutral completion', () => {
  it('all items addressed with non-empty notes → complete, no unaddressed', () => {
    const result = evaluateChecklistCompletion(allAddressed())
    expect(result.complete).toBe(true)
    expect(result.unaddressed).toEqual([])
  })

  it('one item with an empty note → incomplete and names exactly that id', () => {
    const answers = allAddressed()
    answers.moat_erosion = { addressed: true, note: '' }
    const result = evaluateChecklistCompletion(answers)
    expect(result.complete).toBe(false)
    expect(result.unaddressed).toEqual(['moat_erosion'])
  })

  it('a whitespace-only note → still unaddressed (note must be non-empty)', () => {
    const answers = allAddressed()
    answers.disposition = { addressed: true, note: '   \n\t ' }
    const result = evaluateChecklistCompletion(answers)
    expect(result.complete).toBe(false)
    expect(result.unaddressed).toEqual(['disposition'])
  })

  it('a missing answer → unaddressed', () => {
    const answers = allAddressed()
    delete answers.thesis_drift
    const result = evaluateChecklistCompletion(answers)
    expect(result.complete).toBe(false)
    expect(result.unaddressed).toEqual(['thesis_drift'])
  })

  it('addressed:false with a non-empty note → still unaddressed', () => {
    const answers = allAddressed()
    answers.anchoring = { addressed: false, note: 'I wrote something but did not affirm' }
    const result = evaluateChecklistCompletion(answers)
    expect(result.complete).toBe(false)
    expect(result.unaddressed).toEqual(['anchoring'])
  })

  it('empty answer set → all 17 items unaddressed', () => {
    const result = evaluateChecklistCompletion({})
    expect(result.complete).toBe(false)
    expect(result.unaddressed).toHaveLength(17)
    expect(new Set(result.unaddressed)).toEqual(
      new Set([...BUSINESS_IDS, ...COGNITIVE_IDS]),
    )
  })

  describe('decision-neutral structural invariant (the load-bearing one)', () => {
    it('the return has EXACTLY {complete, unaddressed} — no numeric/score/tally field', () => {
      const result = evaluateChecklistCompletion(allAddressed())
      expect(Object.keys(result).sort()).toEqual(['complete', 'unaddressed'])
    })

    it('carries no score/count/ratio/passed/total/percentage verdict key', () => {
      const partial = allAddressed()
      partial.moat_erosion = { addressed: true, note: '' }
      const result: ChecklistCompletion = evaluateChecklistCompletion(partial)
      const forbidden = [
        'score',
        'count',
        'ratio',
        'passed',
        'total',
        'percentage',
        'pct',
        'tally',
        'verdict',
        'rank',
        'weight',
        'n_addressed',
      ]
      for (const key of forbidden) {
        expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(false)
      }
      // No value in the return is itself a number (no count smuggled in as the only field).
      expect(typeof result.complete).toBe('boolean')
      expect(Array.isArray(result.unaddressed)).toBe(true)
      for (const v of Object.values(result)) {
        expect(typeof v).not.toBe('number')
      }
    })

    it('the module source contains no tally arithmetic over answers feeding a verdict', () => {
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
        /\.reduce\s*\(/, // no fold accumulating a numeric verdict
      ]
      for (const re of forbidden) {
        expect(stripped).not.toMatch(re)
      }
    })
  })

  describe('extensibility — adding an item is data, and is automatically required', () => {
    it('an extra item in params is required even when today’s 17 are all addressed', () => {
      const extended: ChecklistParams = {
        version: 'checklist-test-extended',
        items: [
          ...CHECKLIST_PARAMS.items,
          {
            id: 'new_future_item',
            category: 'business',
            prompt: 'A brand new question added later as pure data?',
          },
        ],
      }
      // Address ONLY today's 17 items; the new one is left unaddressed.
      const answersForSeventeen = allAddressed(CHECKLIST_PARAMS)
      const result = evaluateChecklistCompletion(answersForSeventeen, extended)
      expect(result.complete).toBe(false)
      expect(result.unaddressed).toEqual(['new_future_item'])
    })

    it('addressing the extra item too → complete again', () => {
      const extended: ChecklistParams = {
        version: 'checklist-test-extended',
        items: [
          ...CHECKLIST_PARAMS.items,
          {
            id: 'new_future_item',
            category: 'business',
            prompt: 'A brand new question added later as pure data?',
          },
        ],
      }
      const result = evaluateChecklistCompletion(allAddressed(extended), extended)
      expect(result.complete).toBe(true)
      expect(result.unaddressed).toEqual([])
    })
  })
})
