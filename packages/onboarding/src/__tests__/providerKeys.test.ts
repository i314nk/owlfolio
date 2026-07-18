import { describe, expect, it } from 'vitest'

import {
  LLM_API_KEY_GROUPS,
  TOOL_DATA_KEY_GROUPS,
  buildOnboardingGate,
  llmRegistrySelectability,
  oauthLoginExpiryView,
} from '../providerKeys'

describe('LLM and tool/data key catalogs', () => {
  it('lists ONLY the OpenRouter + local key groups (PROVIDER CONSOLIDATION, owner 2026-07-18)', () => {
    expect(LLM_API_KEY_GROUPS.map((group) => group.id).sort()).toEqual(['local', 'openrouter'])
    const openrouter = LLM_API_KEY_GROUPS.find((group) => group.id === 'openrouter')
    expect(openrouter?.get_key_url).toMatch(/^https:\/\//)
    expect(openrouter?.keys.some((key) => key.name === 'OPENROUTER_API_KEY')).toBe(true)
    // The local group is loudly experimental and its keys are advanced/optional.
    const local = LLM_API_KEY_GROUPS.find((group) => group.id === 'local')
    expect(local?.label.toLowerCase()).toContain('untested')
    expect(local?.keys.some((key) => key.name === 'OWLFOLIO_LOCAL_API_BASE_URL')).toBe(true)
    for (const group of LLM_API_KEY_GROUPS) {
      for (const key of group.keys) {
        expect(key.description.length).toBeGreaterThan(0)
      }
    }
  })

  it('lists tool/data keys including market data and EDGAR user agent, with advanced flagged', () => {
    const allKeys = TOOL_DATA_KEY_GROUPS.flatMap((group) => group.keys)
    const names = allKeys.map((key) => key.name)
    expect(names).toContain('OWLFOLIO_MARKET_DATA_API_KEY')
    expect(names).toContain('OWLFOLIO_EDGAR_USER_AGENT')
    // At least one entry is advanced (hidden behind Show Advanced).
    expect(allKeys.some((key) => key.advanced === true)).toBe(true)
  })
})

describe('llmRegistrySelectability (acceptance test 2)', () => {
  it('marks a provider selectable once its API key is set', () => {
    const withoutKey = llmRegistrySelectability({ OPENROUTER_API_KEY: false })
    const withKey = llmRegistrySelectability({ OPENROUTER_API_KEY: true })
    expect(withoutKey.openrouter).toBe(false)
    expect(withKey.openrouter).toBe(true)
  })
})

// (The tier-assignment summary suite was removed with model tiering — owner, 2026-07-18.)

describe('oauthLoginExpiryView (acceptance test 5 — expired token)', () => {
  it('reports a zero countdown + a re-auth command when the token is expired', () => {
    const now = new Date('2026-06-09T00:00:00Z')
    const view = oauthLoginExpiryView(
      { expires_at: '2026-06-08T00:00:00Z', reauth_command: 'codex login' },
      now,
    )
    expect(view.is_expired).toBe(true)
    expect(view.countdown_label).toMatch(/0|expired/i)
    expect(view.reauth_command).toBe('codex login')
  })

  it('reports a positive countdown when not yet expired', () => {
    const now = new Date('2026-06-09T00:00:00Z')
    const view = oauthLoginExpiryView({ expires_at: '2026-06-10T00:00:00Z', reauth_command: 'codex login' }, now)
    expect(view.is_expired).toBe(false)
    expect(view.countdown_label).not.toMatch(/expired/i)
  })
})

describe('buildOnboardingGate (acceptance test 1)', () => {
  // SCALE-DOWN S5: the gate is provider-connected ONLY (capital retired with the money layer).
  it('the gate has ONE item — a connected frontier LLM; a fresh install names it as missing', () => {
    const fresh = buildOnboardingGate({ has_frontier_llm_connected: false })
    expect(fresh.is_complete).toBe(false)
    expect(fresh.items).toHaveLength(1)
    expect(fresh.missing_items[0]?.id).toBe('frontier_llm')
    expect(fresh.blocked_reason).toContain('frontier LLM')
    const done = buildOnboardingGate({ has_frontier_llm_connected: true })
    expect(done.is_complete).toBe(true)
  })


  it('is complete once provider + capital are satisfied, with NO market-data key', () => {
    const gate = buildOnboardingGate({
      has_frontier_llm_connected: true,
    })
    expect(gate.is_complete).toBe(true)
    expect(gate.missing_items).toHaveLength(0)
    expect(gate.blocked_reason).toBeUndefined()
  })

})
