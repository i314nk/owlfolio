import { describe, expect, it } from 'vitest'

import {
  LLM_API_KEY_GROUPS,
  TOOL_DATA_KEY_GROUPS,
  buildOnboardingGate,
  buildTierAssignmentSummary,
  llmRegistrySelectability,
  oauthLoginExpiryView,
} from '../providerKeys'

describe('LLM and tool/data key catalogs', () => {
  it('lists the spec LLM providers with env var entries and a Get key link', () => {
    const labels = LLM_API_KEY_GROUPS.map((group) => group.label)
    expect(labels).toEqual(
      expect.arrayContaining(['Anthropic', 'OpenAI', 'Gemini', 'DeepSeek', 'Qwen / DashScope', 'Kimi / Moonshot', 'OpenRouter']),
    )
    const anthropic = LLM_API_KEY_GROUPS.find((group) => group.label === 'Anthropic')
    expect(anthropic?.get_key_url).toMatch(/^https:\/\//)
    expect(anthropic?.keys.some((key) => key.name === 'ANTHROPIC_API_KEY')).toBe(true)
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
    const withoutKey = llmRegistrySelectability({ ANTHROPIC_API_KEY: false })
    const withKey = llmRegistrySelectability({ ANTHROPIC_API_KEY: true })
    expect(withoutKey.anthropic).toBe(false)
    expect(withKey.anthropic).toBe(true)
  })
})

describe('buildTierAssignmentSummary (reads from modelRegistry)', () => {
  it('produces a synthesis/lanes/monitors tier summary from the registry', () => {
    const summary = buildTierAssignmentSummary({ activeProviderId: 'mock-provider', activeModel: 'mock-demo' })
    expect(summary.registry_version.length).toBeGreaterThan(0)
    const roles = summary.lines.map((line) => line.role)
    expect(roles).toContain('synthesis')
    expect(roles).toContain('monitors')
    const synthesis = summary.lines.find((line) => line.role === 'synthesis')
    expect(synthesis?.tier).toBe('T1')
    expect(synthesis?.provider_id).toBe('mock-provider')
  })
})

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
  it('reports all three items incomplete on a fresh install and names the first missing item', () => {
    const gate = buildOnboardingGate({
      has_frontier_llm_connected: false,
      has_market_data_key: false,
      has_investable_capital: false,
    })
    expect(gate.is_complete).toBe(false)
    expect(gate.items).toHaveLength(3)
    expect(gate.missing_items).toHaveLength(3)
    // The blocking reason must NAME exactly which item is missing.
    expect(gate.blocked_reason).toBeDefined()
    expect(gate.blocked_reason).toContain(gate.missing_items[0]!.label)
  })

  it('is complete once all three items are satisfied', () => {
    const gate = buildOnboardingGate({
      has_frontier_llm_connected: true,
      has_market_data_key: true,
      has_investable_capital: true,
    })
    expect(gate.is_complete).toBe(true)
    expect(gate.missing_items).toHaveLength(0)
    expect(gate.blocked_reason).toBeUndefined()
  })

  it('names the specific remaining item when only one is missing', () => {
    const gate = buildOnboardingGate({
      has_frontier_llm_connected: true,
      has_market_data_key: false,
      has_investable_capital: true,
    })
    expect(gate.is_complete).toBe(false)
    expect(gate.blocked_reason).toContain('market-data')
  })
})
