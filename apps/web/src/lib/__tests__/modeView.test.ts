import { describe, expect, it } from 'vitest'

import { defaultDemoAppConfig, defaultPersonalLocalAppConfig, defaultUnconfiguredAppConfig } from '@owlfolio/shared'

import { isUnconfigured } from '../modeView'

describe('isUnconfigured', () => {
  it('is true only for the unconfigured mode', () => {
    expect(isUnconfigured(defaultUnconfiguredAppConfig())).toBe(true)
    expect(isUnconfigured(defaultDemoAppConfig())).toBe(false)
    expect(isUnconfigured(defaultPersonalLocalAppConfig())).toBe(false)
  })

  it('treats a config that explicitly carries mode unconfigured as unconfigured regardless of other fields', () => {
    const config = { ...defaultDemoAppConfig(), mode: 'unconfigured' as const }
    expect(isUnconfigured(config)).toBe(true)
  })
})
