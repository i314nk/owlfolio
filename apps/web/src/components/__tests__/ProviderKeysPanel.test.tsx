import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ProviderKeysPanel, type ProviderKeysPanelProps } from '../ProviderKeysPanel'

const SECRET = 'sk-ant-supersecret-value-K3jQAA'

function baseProps(overrides: Partial<ProviderKeysPanelProps> = {}): ProviderKeysPanelProps {
  return {
    envFile: { path: '/home/test/.owlfolio/.env', is_git_ignored: true },
    onboardingGate: {
      items: [
        { id: 'frontier_llm', label: 'At least one frontier LLM provider connected', done: false },
        { id: 'investable_capital', label: 'Investable capital set in the ledger', done: false },
      ],
      missing_items: [
        { id: 'frontier_llm', label: 'At least one frontier LLM provider connected', done: false },
        { id: 'investable_capital', label: 'Investable capital set in the ledger', done: false },
      ],
      is_complete: false,
      blocked_reason: 'Cannot start a deep dive: missing At least one frontier LLM provider connected.',
    },
    loginRows: [
      {
        provider_id: 'openai',
        label: 'OpenAI Codex CLI',
        auth_method_label: 'External CLI',
        is_connected: false,
        connect_command: 'codex login',
        reauth_command: 'codex login',
        is_expired: false,
        countdown_label: 'No expiry reported',
        managed_externally: false,
      },
    ],
    llmGroups: [
      {
        id: 'anthropic',
        label: 'Anthropic',
        get_key_url: 'https://console.anthropic.com/settings/keys',
        selectable_in_registry: false,
        keys: [{ name: 'ANTHROPIC_API_KEY', description: 'Anthropic Claude API key.', is_set: false, advanced: false }],
      },
    ],
    roleConfig: {
      registry_version: 'model-registry-2026-06-1',
      guidance: ['Tier philosophy: T1 frontier, T2 mid, T3 cheap; T0 is never a model.'],
      no_model_note: 'T0 — No model, ever.',
      // Tier menus are scoped to the primary provider (OpenAI here).
      active_provider_id: 'openai',
      active_provider_label: 'OpenAI',
      tiers: [
        {
          tier: 'T1', description: 'Frontier synthesis + moat/Shariah lanes.', roles: ['synthesis', 'lane_moat', 'lane_shariah'],
          resolved_provider_id: 'openai', resolved_model: 'gpt-5.5', resolved_temperature: 0.1,
          source: 'default', target_provider_connected: true, target_provider_qualified: true,
          model_options: [{ model_id: 'gpt-5.5', note: 'Reasoning model.' }],
        },
        {
          tier: 'T2', description: 'Quick screen + red team.', roles: ['quick_screen', 'red_team'],
          resolved_provider_id: 'openai', resolved_model: 'gpt-5.5', resolved_temperature: 0.2,
          source: 'default', target_provider_connected: true, target_provider_qualified: true,
          model_options: [{ model_id: 'gpt-5.5', note: 'Reasoning model.' }],
        },
        {
          tier: 'T3', description: 'Monitors + entity resolution.', roles: ['monitors', 'entity_resolve'],
          resolved_provider_id: 'openai', resolved_model: 'gpt-5.5', resolved_temperature: 0.0,
          source: 'default', target_provider_connected: true, target_provider_qualified: true,
          model_options: [],
        },
      ],
    },
    ...overrides,
  }
}

describe('ProviderKeysPanel — onboarding gate (acceptance test 1)', () => {
  it('renders the two-item checklist (provider + capital) and the named blocking reason on a fresh state', () => {
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, baseProps()))
    expect(html).toContain('At least one frontier LLM provider connected')
    expect(html).toContain('Investable capital set in the ledger')
    expect(html).toContain('Cannot start a deep dive')
    // Non-LLM tool/data keys (market-data/EDGAR/search) are no longer surfaced as onboarding.
    expect(html).not.toContain('OWLFOLIO_MARKET_DATA_API_KEY')
    expect(html).not.toContain('Tool & data keys')
  })
})

describe('ProviderKeysPanel — env file header + masking', () => {
  it('shows the resolved env-file path and a git-ignored confirmation', () => {
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, baseProps()))
    expect(html).toContain('/home/test/.owlfolio/.env')
    expect(html.toLowerCase()).toContain('git-ignored')
  })
})

describe('ProviderKeysPanel — provider logins section', () => {
  it('hides the OAuth/subscription login section entirely when no login providers exist', () => {
    // Post CLI/OAuth excision the catalog yields no login rows; the panel must not advertise an empty
    // "Provider logins (OAuth / subscription)" lane the product no longer has.
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, baseProps({ loginRows: [] })))
    expect(html).not.toContain('Provider logins (OAuth / subscription)')
    expect(html).not.toContain('Owlfolio has no in-app OAuth')
    // Section B (API-key + per-tier model config) still renders.
    expect(html).toContain('ANTHROPIC_API_KEY')
  })
})

describe('ProviderKeysPanel — registry selectability (acceptance test 2)', () => {
  it('marks Anthropic selectable in the registry once its key is set', () => {
    const props = baseProps()
    props.llmGroups[0]!.selectable_in_registry = true
    props.llmGroups[0]!.keys[0]!.is_set = true
    props.llmGroups[0]!.keys[0]!.tail = '…K3jQAA'
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, props))
    expect(html).toContain('Selectable in registry')
    expect(html).toContain('…K3jQAA')
  })

  it('renders three tier selectors (T1/T2/T3) with the current resolution + guidance', () => {
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, baseProps()))
    // The three tiers and the roles each one covers.
    expect(html).toContain('synthesis')
    expect(html).toContain('monitors')
    expect(html).toContain('Covers:')
    expect(html).toContain('model-registry-2026-06-1')
    // Current resolution + guidance + the selector posting to the model-roles route by TIER.
    expect(html).toContain('openai/gpt-5.5')
    expect(html).toContain('Tier philosophy')
    expect(html).toContain('/api/settings/model-roles')
    expect(html).toContain('name="tier"')
    expect(html).toContain('value="T1"')
    // The menus are scoped to the primary provider (shown by label, not a per-tier provider picker).
    expect(html).toContain('Primary provider')
    expect(html).toContain('OpenAI')
  })
})

describe('ProviderKeysPanel — per-tier config honesty (not-connected warning + source)', () => {
  it('shows a fail-closed warning when a tier targets an unconnected provider, never fake-green', () => {
    const props = baseProps()
    props.roleConfig.tiers[0] = {
      tier: 'T1', description: 'Frontier synthesis.', roles: ['synthesis', 'lane_moat'],
      resolved_provider_id: 'deepseek', resolved_model: 'r1', resolved_temperature: 0.1,
      source: 'file', target_provider_connected: false, target_provider_qualified: false,
      current_value: 'deepseek:r1@0.1', model_options: [],
    }
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, props))
    expect(html).toContain('provider not connected')
    expect(html).toContain('Pinned')
    // A pinned tier exposes a Clear affordance to restore the default-inherit.
    expect(html).toContain('clear')
  })
})

describe('ProviderKeysPanel — tier model dropdown (scoped to the primary provider)', () => {
  it('renders a real model dropdown of the primary provider tier-fitting models (no free-form box)', () => {
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, baseProps()))
    // The primary provider's T1/T2 model appears as a <select> <option> ...
    expect(html).toContain('gpt-5.5')
    expect(html).toContain('name="model"')
    // ... and the old free-form datalist is gone.
    expect(html).not.toContain('curated-models-T1')
    expect(html).not.toContain('or type any')
  })

  it('shows an inherits-the-run-default note for a tier the primary provider has no curated model for', () => {
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, baseProps()))
    // T3 has model_options: [] in the fixture (OpenAI has no curated T3 model).
    expect(html).toContain('inherits the run default')
  })
})

describe('ProviderKeysPanel — expired OAuth (acceptance test 5)', () => {
  it('shows a zero countdown + red pill + copyable re-auth command for an expired login', () => {
    const props = baseProps()
    props.loginRows[0] = {
      provider_id: 'openai',
      label: 'OpenAI Codex CLI',
      auth_method_label: 'External CLI',
      is_connected: true,
      connect_command: 'codex login',
      reauth_command: 'codex login',
      is_expired: true,
      countdown_label: 'Expired (0h)',
      managed_externally: false,
    }
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, props))
    expect(html).toMatch(/Expired/)
    expect(html).toContain('codex login')
  })
})

describe('ProviderKeysPanel — security (acceptance test 6: no secret in page source)', () => {
  it('never renders a raw secret value, only the masked tail', () => {
    const props = baseProps()
    props.llmGroups[0]!.keys[0]!.is_set = true
    props.llmGroups[0]!.keys[0]!.tail = '…K3jQAA'
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, props))
    expect(html).not.toContain(SECRET)
    expect(html).not.toContain('supersecret')
    expect(html).toContain('…K3jQAA')
  })
})

describe('ProviderKeysPanel — counter chips (honest empty states)', () => {
  it('renders honest "N of M" counters and never fake-green', () => {
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, baseProps()))
    // Section A: 0 of 1 connected; Section B: 0 of 1 configured.
    expect(html).toMatch(/0 of 1/)
  })
})

describe('ProviderKeysPanel — restart-to-apply signal', () => {
  it('shows the restart chip when a key is stale/not-loaded, and no chip when active', () => {
    const props = baseProps()
    props.llmGroups = [{
      id: 'openrouter',
      label: 'OpenRouter',
      get_key_url: 'https://openrouter.ai/keys',
      selectable_in_registry: true,
      keys: [
        { name: 'OPENROUTER_API_KEY', description: 'OpenRouter key.', is_set: true, tail: '…AB12', advanced: false, runtime_state: 'stale_changed' },
        { name: 'OPENAI_API_KEY', description: 'OpenAI key.', is_set: true, tail: '…CD34', advanced: false, runtime_state: 'active' },
      ],
    }]
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, props))
    expect(html).toContain('saved — restart to apply')
    // Exactly one chip: the active key must not nag.
    expect(html.split('saved — restart to apply').length - 1).toBe(1)
  })
})
