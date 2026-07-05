import { describe, expect, it } from 'vitest'

import { defaultPersonalLocalAppConfig, defaultUnconfiguredAppConfig } from '@owlfolio/shared'

import { isUnconfigured, isUnconfiguredForUser } from '../modeView'

const productionEnv = { OWLFOLIO_DISABLE_TEST_DEFAULTS: '1' } as const

describe('isUnconfigured', () => {
  it('is true only for the unconfigured mode', () => {
    expect(isUnconfigured(defaultUnconfiguredAppConfig())).toBe(true)
    expect(isUnconfigured(defaultPersonalLocalAppConfig())).toBe(false)
  })

  it('treats a config that explicitly carries mode unconfigured as unconfigured regardless of other fields', () => {
    const config = { ...defaultPersonalLocalAppConfig(), mode: 'unconfigured' as const }
    expect(isUnconfigured(config)).toBe(true)
  })
})

describe('isUnconfiguredForUser', () => {
  it('is always true for the unconfigured mode', () => {
    expect(isUnconfiguredForUser(defaultUnconfiguredAppConfig(), productionEnv)).toBe(true)
    expect(isUnconfiguredForUser(defaultUnconfiguredAppConfig(), {})).toBe(true)
  })

  it('is false for a personal-local config', () => {
    expect(isUnconfiguredForUser(defaultPersonalLocalAppConfig(), productionEnv)).toBe(false)
  })
})
