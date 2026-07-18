import { describe, expect, it } from 'vitest'

import { selectActiveModeStatus, type ActiveModeStatusInput } from '../activeModeStatus'

const PROVIDERS_HREF = '/settings/providers'

function baseInput(overrides: Partial<ActiveModeStatusInput> = {}): ActiveModeStatusInput {
  return {
    mode: 'personal-local',
    providerConnected: true,
    providerId: 'openrouter',
    modelId: 'claude-opus-4.8',
    ...overrides,
  }
}

describe('selectActiveModeStatus', () => {
  it('reports unconfigured with a clickable fix link', () => {
    const status = selectActiveModeStatus(baseInput({ mode: 'unconfigured' }))

    expect(status.kind).toBe('unconfigured')
    expect(status.label).toBe('No provider configured')
    expect(status.href).toBe(PROVIDERS_HREF)
  })

  it('reports personal-local with the provider not connected as clickable', () => {
    const status = selectActiveModeStatus(
      baseInput({ providerConnected: false }),
    )

    expect(status.kind).toBe('provider-not-connected')
    expect(status.label).toBe('Personal-local · provider not connected')
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

})
