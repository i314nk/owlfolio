import { describe, expect, it } from 'vitest'

import { ENGINE_VERSION } from '../engineVersion'
import { ENGINE_VERSION as ENGINE_VERSION_FROM_INDEX } from '../strategyContract'
import { JUDGMENT_RUBRICS } from '../judgmentRubrics'
import { VALUATION_PARAMS } from '../valuationParams'

// ENGINE_VERSION is DERIVED from the live methodology version strings so it cannot silently fail to reflect
// a methodology change (the POOL episode). These tests pin the derivation: it must compose both source
// versions, so it auto-changes whenever EITHER is bumped.
describe('ENGINE_VERSION', () => {
  it('composes VALUATION_PARAMS.version + JUDGMENT_RUBRICS.version', () => {
    expect(ENGINE_VERSION).toBe(`${VALUATION_PARAMS.version} / ${JUDGMENT_RUBRICS.version}`)
  })

  it('contains both source version strings (changes if either changes)', () => {
    expect(ENGINE_VERSION).toContain(VALUATION_PARAMS.version)
    expect(ENGINE_VERSION).toContain(JUDGMENT_RUBRICS.version)
  })

  it('is re-exported from the package index for apps/web + workflow', () => {
    expect(ENGINE_VERSION_FROM_INDEX).toBe(ENGINE_VERSION)
  })
})
