import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import type { AppConfig } from '@owlfolio/shared'
import { describe, expect, it } from 'vitest'

import { resolveModelSwitcher } from '../resolveModelSwitcher'

function personalLocal(provider: Partial<AppConfig['provider']>): AppConfig {
  const base = defaultPersonalLocalAppConfig()
  return { ...base, provider: { ...base.provider, ...provider } as AppConfig['provider'] }
}

describe('resolveModelSwitcher', () => {
  it('returns a provider-grouped switcher when ≥2 models are reachable across connected providers', async () => {
    const config = personalLocal({ provider_id: 'openrouter', support_level: 'experimental', model_id: 'anthropic/claude-opus-4.8' })
    const switcher = await resolveModelSwitcher(config, { OPENROUTER_API_KEY: 'or-key' })

    expect(switcher).toBeDefined()
    expect(switcher?.active_provider_id).toBe('openrouter')
    expect(switcher?.active_model_id).toBe('anthropic/claude-opus-4.8')
    const groupIds = switcher?.providers.map((group) => group.provider_id)
    // The connected provider appears as a group; the demo mock-provider never does.
    expect(groupIds).toContain('openrouter')
    expect(groupIds).not.toContain('mock-provider')
    // The active model is present under its provider group (so the control shows a valid current value).
    const openrouter = switcher?.providers.find((group) => group.provider_id === 'openrouter')
    expect(openrouter?.models.some((model) => model.model_id === 'anthropic/claude-opus-4.8')).toBe(true)
  })

  it('exposes a connected provider as a group listing its multiple curated models (OpenRouter)', async () => {
    const config = personalLocal({ provider_id: 'openrouter', support_level: 'experimental', model_id: 'anthropic/claude-opus-4.8' })
    const switcher = await resolveModelSwitcher(config, { OPENROUTER_API_KEY: 'or-key' })

    expect(switcher).toBeDefined()
    const openrouter = switcher?.providers.find((group) => group.provider_id === 'openrouter')
    expect(openrouter).toBeDefined()
    expect((openrouter?.models.length ?? 0)).toBeGreaterThanOrEqual(2)
  })

  it('returns undefined for a non-personal-local mode (the switcher is a personal-local affordance)', async () => {
    const config: AppConfig = { ...defaultPersonalLocalAppConfig(), mode: 'unconfigured' }
    expect(await resolveModelSwitcher(config, { OPENROUTER_API_KEY: 'or-key' })).toBeUndefined()
  })

  it('returns undefined when the ACTIVE provider offers no curated switcher group (the local surface)', async () => {
    // The local surface is always "ready" but has NO curated model list, so it never forms a switcher
    // group — the indicator stays plain and the model is managed on the providers page.
    const config = personalLocal({ provider_id: 'local', support_level: 'experimental', model_id: 'llama3.3:70b' })
    expect(await resolveModelSwitcher(config, { OPENROUTER_API_KEY: 'or-key' })).toBeUndefined()
  })

  it('returns undefined when the active provider has no credentials (no API keys supplied)', async () => {
    const config = personalLocal({ provider_id: 'openrouter', support_level: 'experimental', model_id: 'anthropic/claude-opus-4.8' })
    expect(await resolveModelSwitcher(config, {})).toBeUndefined()
  })
})
