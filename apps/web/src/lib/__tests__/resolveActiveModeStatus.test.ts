import { describe, expect, it } from 'vitest'

import { resolveActiveModeStatus } from '../resolveActiveModeStatus'
import { ACTIVE_MODE_FIX_HREF } from '../activeModeStatus'
import { defaultPersonalLocalAppConfig, type AppConfig } from '@owlfolio/shared'

/**
 * Production-honesty coverage for the app-wide active-mode indicator (M4).
 */
describe('resolveActiveModeStatus production honesty', () => {
  it('degrades to not-connected (never throws) when the config pins a retired/unknown provider', async () => {
    // A config written before a provider lane was retired (e.g. the removed `openai` CLI lane) must NOT
    // crash the app-wide shell (rendered on every page, including /_not-found). It degrades to the
    // "connect a provider" fix indicator instead of the readiness snapshot throwing "Unknown provider".
    const base = defaultPersonalLocalAppConfig()
    const staleConfig = {
      ...base,
      provider: { ...base.provider, provider_id: 'openai' as unknown as AppConfig['provider']['provider_id'] },
    }

    const status = await resolveActiveModeStatus(staleConfig)

    expect(status).toBeDefined()
    // Provider unusable → the indicator becomes the clickable "fix" link, not a connected state.
    expect(status.href).toBe(ACTIVE_MODE_FIX_HREF)
  })
})
