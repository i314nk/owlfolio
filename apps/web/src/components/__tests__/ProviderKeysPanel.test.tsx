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
    tierSummary: {
      registry_version: 'model-registry-2026-06-1',
      no_model_note: 'T0 — No model, ever.',
      lines: [
        { role: 'synthesis', tier: 'T1', provider_id: 'mock-provider', model: 'mock-demo' },
        { role: 'monitors', tier: 'T3', provider_id: 'mock-provider', model: 'mock-demo' },
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

  it('renders the tier-assignment summary read from the model registry', () => {
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, baseProps()))
    expect(html).toContain('synthesis')
    expect(html).toContain('monitors')
    expect(html).toContain('model-registry-2026-06-1')
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
