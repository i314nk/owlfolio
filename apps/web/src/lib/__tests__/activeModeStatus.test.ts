import { describe, expect, it } from 'vitest'

import { selectActiveModeStatus, type ActiveModeStatusInput } from '../activeModeStatus'

const PROVIDERS_HREF = '/settings/providers'

function baseInput(overrides: Partial<ActiveModeStatusInput> = {}): ActiveModeStatusInput {
  return {
    mode: 'personal-local',
    providerConnected: true,
    capitalSet: true,
    providerId: 'openrouter',
    modelId: 'claude-opus-4.8',
    ...overrides,
  }
}

describe('selectActiveModeStatus', () => {
  it('reports unconfigured with a clickable fix link', () => {
    const status = selectActiveModeStatus(baseInput({ mode: 'unconfigured' }))

    expect(status.kind).toBe('unconfigured')
    expect(status.label).toBe('Not set up — choose a mode')
    expect(status.href).toBe(PROVIDERS_HREF)
  })

  it('reports demo mode against the mock provider with no fix link', () => {
    const status = selectActiveModeStatus(baseInput({ mode: 'demo' }))

    expect(status.kind).toBe('demo')
    expect(status.label).toBe('Demo · mock-provider (sample data)')
    expect(status.href).toBeUndefined()
  })

  it('reports personal-local with the provider not connected as clickable', () => {
    const status = selectActiveModeStatus(
      baseInput({ providerConnected: false, capitalSet: false }),
    )

    expect(status.kind).toBe('provider-not-connected')
    expect(status.label).toBe('Personal-local · provider not connected')
    expect(status.href).toBe(PROVIDERS_HREF)
  })

  it('reports personal-local with capital not set as clickable when provider is connected', () => {
    const status = selectActiveModeStatus(
      baseInput({ providerConnected: true, capitalSet: false }),
    )

    expect(status.kind).toBe('capital-not-set')
    expect(status.label).toBe('Personal-local · capital not set')
    expect(status.href).toBe(PROVIDERS_HREF)
  })

  it('reports personal-local ready with provider / model and no fix link', () => {
    const status = selectActiveModeStatus(
      baseInput({ providerId: 'openrouter', modelId: 'claude-opus-4.8' }),
    )

    expect(status.kind).toBe('ready')
    expect(status.label).toBe('Personal-local · openrouter / claude-opus-4.8')
    expect(status.href).toBeUndefined()
  })

  it('prioritises provider-not-connected over capital when both are missing', () => {
    const status = selectActiveModeStatus(
      baseInput({ providerConnected: false, capitalSet: false }),
    )

    expect(status.kind).toBe('provider-not-connected')
  })
})
