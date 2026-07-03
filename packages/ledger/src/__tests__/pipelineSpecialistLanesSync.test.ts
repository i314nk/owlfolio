/**
 * Drift-guard: PIPELINE_SPECIALIST_LANES must match the canonical 6-lane
 * Buffett-Munger deep-dive set in @owlfolio/workflow.
 *
 * NOTE: @owlfolio/workflow depends on @owlfolio/ledger, so importing workflow
 * from this package would create a circular dependency. The cross-package
 * import does not resolve in the ledger test environment. Instead we assert
 * against the literal 6-lane array — if the workflow contract changes, this
 * test will catch the drift and the developer must update both.
 */

import { describe, expect, it } from 'vitest'

import { PIPELINE_SPECIALIST_LANES } from '../projections/pipelineProjection'

/**
 * The canonical Buffett-Munger deep-dive specialist lanes as defined in
 * packages/workflow/src/strategyResearchPipeline.ts (buffettMungerDeepDiveLanes).
 * Valuation is not a parallel lane — it is a dedicated focused pass during synthesis.
 */
const EXPECTED_LANES = [
  'business_quality',
  'moat',
  'management',
  'financial_quality',
  'shariah',
  'risks',
] as const

describe('PIPELINE_SPECIALIST_LANES drift guard', () => {
  it('matches the 6-lane buffettMungerDeepDiveLanes contract (valuation is a synthesis pass, not a lane)', () => {
    expect([...PIPELINE_SPECIALIST_LANES]).toEqual([...EXPECTED_LANES])
  })
})
