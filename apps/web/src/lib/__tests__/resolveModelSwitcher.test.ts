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
    const switcher = await resolveModelSwitcher(config, { OPENROUTER_API_KEY: 'or-key', ANTHROPIC_API_KEY: 'an-key' })

    expect(switcher).toBeDefined()
    expect(switcher?.active_provider_id).toBe('openrouter')
    expect(switcher?.active_model_id).toBe('anthropic/claude-opus-4.8')
    const groupIds = switcher?.providers.map((group) => group.provider_id)
    // Both connected providers appear as groups; the demo mock-provider never does.
    expect(groupIds).toContain('openrouter')
    expect(groupIds).toContain('anthropic-api')
    expect(groupIds).not.toContain('mock-provider')
    // The active model is present under its provider group (so the control shows a valid current value).
    const openrouter = switcher?.providers.find((group) => group.provider_id === 'openrouter')
    expect(openrouter?.models.some((model) => model.model_id === 'anthropic/claude-opus-4.8')).toBe(true)
  })

  it('exposes a connected provider as a group listing its multiple curated models (OpenRouter)', async () => {
    // NOTE: readiness for the Codex/OpenAI CLI lane can also resolve from an on-disk session on the host,
    // so we assert OpenRouter's group + multi-model presence rather than that it is the ONLY group.
    const config = personalLocal({ provider_id: 'openrouter', support_level: 'experimental', model_id: 'anthropic/claude-opus-4.8' })
    const switcher = await resolveModelSwitcher(config, { OPENROUTER_API_KEY: 'or-key' })

    expect(switcher).toBeDefined()
    const openrouter = switcher?.providers.find((group) => group.provider_id === 'openrouter')
    expect(openrouter).toBeDefined()
    expect((openrouter?.models.length ?? 0)).toBeGreaterThanOrEqual(2)
  })

  it('returns undefined in demo mode (the switcher is a personal-local affordance)', async () => {
    const config: AppConfig = { ...defaultPersonalLocalAppConfig(), mode: 'demo' }
    expect(await resolveModelSwitcher(config, { OPENROUTER_API_KEY: 'or-key', ANTHROPIC_API_KEY: 'an-key' })).toBeUndefined()
  })

  it('returns undefined when the ACTIVE provider is not connected (stay a fix-link, do not silently switch)', async () => {
    // Active provider is the gemini direct API but no Gemini key is set; OpenRouter is connected but is not active.
    const config = personalLocal({ provider_id: 'gemini-developer-api', support_level: 'experimental', model_id: 'gemini-3.5-flash' })
    expect(await resolveModelSwitcher(config, { OPENROUTER_API_KEY: 'or-key' })).toBeUndefined()
  })

  it('returns undefined when the active provider has no credentials (no API keys supplied)', async () => {
    const config = personalLocal({ provider_id: 'openrouter', support_level: 'experimental', model_id: 'anthropic/claude-opus-4.8' })
    expect(await resolveModelSwitcher(config, {})).toBeUndefined()
  })
})
