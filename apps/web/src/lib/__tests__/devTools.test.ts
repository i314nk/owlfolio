import { describe, expect, it } from 'vitest'

import { isResearchResetEnabled } from '../devTools'

/**
 * The crux of the safety design: the destructive bulk reset must NOT be enabled in normal personal-local
 * operation, and must be enabled under the test harness or the explicit dev opt-in.
 */
describe('isResearchResetEnabled', () => {
  it('is FALSE for plain personal-local (no flags) — invisible in normal operation', () => {
    expect(isResearchResetEnabled({ env: {}, mode: 'personal-local' })).toBe(false)
  })

  it('is FALSE for unconfigured (no flags)', () => {
    expect(isResearchResetEnabled({ env: {}, mode: 'unconfigured' })).toBe(false)
  })

  it('is TRUE for personal-local when the dev opt-in OWLFOLIO_DEV_TOOLS=1 is set', () => {
    expect(isResearchResetEnabled({ env: { OWLFOLIO_DEV_TOOLS: '1' }, mode: 'personal-local' })).toBe(true)
  })

  it('is FALSE when OWLFOLIO_DEV_TOOLS is set to anything other than "1"', () => {
    expect(isResearchResetEnabled({ env: { OWLFOLIO_DEV_TOOLS: 'true' }, mode: 'personal-local' })).toBe(false)
    expect(isResearchResetEnabled({ env: { OWLFOLIO_DEV_TOOLS: '0' }, mode: 'personal-local' })).toBe(false)
  })

  it('is TRUE under the playwright test harness regardless of mode', () => {
    expect(isResearchResetEnabled({ env: { OWLFOLIO_TEST_MODE: 'playwright' }, mode: 'personal-local' })).toBe(true)
    expect(isResearchResetEnabled({ env: { OWLFOLIO_TEST_MODE: 'playwright' }, mode: 'unconfigured' })).toBe(true)
  })

  it('is FALSE when OWLFOLIO_TEST_MODE is set to a non-playwright value', () => {
    expect(isResearchResetEnabled({ env: { OWLFOLIO_TEST_MODE: 'vitest' }, mode: 'personal-local' })).toBe(false)
  })
})
