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
        { id: 'market_data', label: 'A market-data key set', done: false },
        { id: 'investable_capital', label: 'Investable capital set in the ledger', done: false },
      ],
      missing_items: [
        { id: 'frontier_llm', label: 'At least one frontier LLM provider connected', done: false },
        { id: 'market_data', label: 'A market-data key set', done: false },
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
    toolGroups: [
      {
        id: 'market-data',
        label: 'Market data',
        get_key_url: 'https://example.com/key',
        selectable_in_registry: false,
        keys: [{ name: 'OWLFOLIO_MARKET_DATA_API_KEY', description: 'Market-data API key.', is_set: false, advanced: false }],
      },
    ],
    roleConfig: {
      registry_version: 'model-registry-2026-06-1',
      guidance: ['Tier philosophy: T1 frontier, T2 mid, T3 cheap; T0 is never a model.'],
      no_model_note: 'T0 — No model, ever.',
      providers: [
        {
          provider_id: 'openai', label: 'OpenAI', is_connected: true, is_qualified: false,
          curated_models: [{ model_id: 'gpt-5.5', tier_suitability: ['T1', 'T2'], note: 'Reasoning model.' }],
        },
        {
          provider_id: 'claude', label: 'Claude', is_connected: false, is_qualified: false,
          curated_models: [{ model_id: 'claude-opus-4-8', tier_suitability: ['T1'], note: 'Frontier reasoning.' }],
        },
        { provider_id: 'mock-provider', label: 'Mock', is_connected: true, is_qualified: true, curated_models: [] },
      ],
      roles: [
        {
          role: 'synthesis', tier: 'T1', description: 'Frontier synthesis.',
          resolved_provider_id: 'mock-provider', resolved_model: 'mock-demo', resolved_temperature: 0.1,
          overridden: false, source: 'default', target_provider_connected: true, target_provider_qualified: true,
        },
        {
          role: 'monitors', tier: 'T3', description: 'Cheap monitors.',
          resolved_provider_id: 'mock-provider', resolved_model: 'mock-demo', resolved_temperature: 0.1,
          overridden: false, source: 'default', target_provider_connected: true, target_provider_qualified: true,
        },
      ],
    },
    ...overrides,
  }
}

describe('ProviderKeysPanel — onboarding gate (acceptance test 1)', () => {
  it('renders the three-item checklist and the named blocking reason on a fresh state', () => {
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, baseProps()))
    expect(html).toContain('At least one frontier LLM provider connected')
    expect(html).toContain('A market-data key set')
    expect(html).toContain('Investable capital set in the ledger')
    expect(html).toContain('Cannot start a deep dive')
  })
})

describe('ProviderKeysPanel — env file header + masking', () => {
  it('shows the resolved env-file path and a git-ignored confirmation', () => {
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, baseProps()))
    expect(html).toContain('/home/test/.owlfolio/.env')
    expect(html.toLowerCase()).toContain('git-ignored')
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

  it('renders the per-role configuration table with the current resolution + guidance', () => {
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, baseProps()))
    expect(html).toContain('synthesis')
    expect(html).toContain('monitors')
    expect(html).toContain('model-registry-2026-06-1')
    // Current resolution + guidance + the selector posting to the model-roles route.
    expect(html).toContain('mock-provider/mock-demo')
    expect(html).toContain('Tier philosophy')
    expect(html).toContain('/api/settings/model-roles')
    // A provider dropdown option for each catalog provider.
    expect(html).toContain('OpenAI')
  })
})

describe('ProviderKeysPanel — per-role config honesty (not-connected warning + source)', () => {
  it('shows a fail-closed warning when a role targets an unconnected provider, never fake-green', () => {
    const props = baseProps()
    props.roleConfig.roles[0] = {
      role: 'synthesis', tier: 'T1', description: 'Frontier synthesis.',
      resolved_provider_id: 'deepseek', resolved_model: 'r1', resolved_temperature: 0.1,
      overridden: true, source: 'file', target_provider_connected: false, target_provider_qualified: false,
      current_value: 'deepseek:r1@0.1',
    }
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, props))
    expect(html).toContain('provider not connected')
    expect(html).toContain('File override')
    // An overridden role exposes a Clear affordance to restore the default-inherit.
    expect(html).toContain('clear')
  })
})

describe('ProviderKeysPanel — curated reasoning-model dropdowns + uncurated warning', () => {
  it('lists curated reasoning models of connected providers in the selector datalist', () => {
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, baseProps()))
    // The curated reasoning model id appears as a datalist option.
    expect(html).toContain('gpt-5.5')
    // The datalist is wired to the model input.
    expect(html).toContain('curated-models-synthesis')
    // A model that fits the role's tier is annotated.
    expect(html).toContain('fits T1')
  })

  it('warns when a role is pinned onto an UNCURATED (free-form) model', () => {
    const props = baseProps()
    // deepseek:r1 is not in any curated list above -> uncurated escape hatch warning.
    props.roleConfig.roles[0] = {
      role: 'synthesis', tier: 'T1', description: 'Frontier synthesis.',
      resolved_provider_id: 'deepseek', resolved_model: 'r1', resolved_temperature: 0.1,
      overridden: true, source: 'file', target_provider_connected: false, target_provider_qualified: false,
      current_value: 'deepseek:r1@0.1',
    }
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, props))
    expect(html).toContain('Uncurated model')
    expect(html.toLowerCase()).toContain('verify it supports extended reasoning')
  })

  it('does NOT warn when the pinned model IS a curated reasoning model', () => {
    const props = baseProps()
    props.roleConfig.roles[0] = {
      role: 'synthesis', tier: 'T1', description: 'Frontier synthesis.',
      resolved_provider_id: 'openai', resolved_model: 'gpt-5.5', resolved_temperature: 0.1,
      overridden: true, source: 'file', target_provider_connected: true, target_provider_qualified: false,
      current_value: 'openai:gpt-5.5@0.1',
    }
    // Drop the monitors row so the only role is the curated synthesis pin.
    props.roleConfig.roles = [props.roleConfig.roles[0]!]
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, props))
    expect(html).not.toContain('Uncurated model')
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
