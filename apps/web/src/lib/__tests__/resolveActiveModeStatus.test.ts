import { describe, expect, it } from 'vitest'

import { resolveActiveModeStatus } from '../resolveActiveModeStatus'
import { ACTIVE_MODE_FIX_HREF } from '../activeModeStatus'
import { defaultDemoAppConfig, defaultPersonalLocalAppConfig, type AppConfig } from '@owlfolio/shared'

/**
 * Production-honesty coverage for the app-wide active-mode indicator (M4).
 *
 * A persisted `demo` config must surface as the honest "not set up — connect a provider" state in
 * PRODUCTION (the nav indicator is mounted app-wide), but keep the legitimate demo label under the
 * test harness so the e2e/unit demo path stays green. We simulate production with the
 * `OWLFOLIO_DISABLE_TEST_DEFAULTS` escape hatch that `shouldUseTestDemoDefault` honours.
 */
describe('resolveActiveModeStatus demo/mock production honesty', () => {
  it('renders the honest unconfigured state for a demo config in production', async () => {
    const status = await resolveActiveModeStatus(defaultDemoAppConfig(), {
      OWLFOLIO_DISABLE_TEST_DEFAULTS: '1',
    })

    expect(status.kind).toBe('unconfigured')
    expect(status.label).toBe('No provider configured')
    expect(status.href).toBe(ACTIVE_MODE_FIX_HREF)
    expect(status.label).not.toContain('mock-provider')
    expect(status.label).not.toContain('Demo')
  })

  it('keeps the demo label for a demo config under the test harness', async () => {
    // No env override → VITEST keeps test-demo defaults on, so demo stays a legitimate configured mode.
    const status = await resolveActiveModeStatus(defaultDemoAppConfig())

    expect(status.kind).toBe('demo')
    expect(status.label).toBe('Demo · mock-provider (sample data)')
    expect(status.href).toBeUndefined()
  })

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
