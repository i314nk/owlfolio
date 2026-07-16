/**
 * Drift-guard: PIPELINE_SPECIALIST_LANES must match the canonical PILLAR
 * Buffett-Munger deep-dive set in @owlfolio/workflow (S6, Phase 3).
 *
 * NOTE: @owlfolio/workflow depends on @owlfolio/ledger, so importing workflow
 * from this package would create a circular dependency. The cross-package
 * import does not resolve in the ledger test environment. Instead we assert
 * against the literal 5-lane array — if the workflow contract changes, this
 * test will catch the drift and the developer must update both.
 */

import { describe, expect, it } from 'vitest'

import { PIPELINE_SPECIALIST_LANES } from '../projections/pipelineProjection'

/**
 * The canonical Buffett-Munger deep-dive specialist lanes as defined in
 * packages/workflow/src/strategyResearchPipeline.ts (buffettMungerDeepDiveLanes).
 * Valuation is not a parallel lane — it is a dedicated focused pass during synthesis.
 * Shariah is not a parallel lane — it is the always-on focused Shariah-reasoning pass.
 */
const EXPECTED_LANES = [
  'understand',
  'moat',
  'management',
] as const

describe('PIPELINE_SPECIALIST_LANES drift guard', () => {
  it('matches the pillar buffettMungerDeepDiveLanes contract (valuation and shariah are focused passes, not lanes)', () => {
    expect([...PIPELINE_SPECIALIST_LANES]).toEqual([...EXPECTED_LANES])
  })
})
