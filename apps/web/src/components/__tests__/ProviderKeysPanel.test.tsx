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
    expect(html).not.toContain('Owner’s Manual has no in-app OAuth')
    // Section B (API keys) still renders.
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

  it('renders the single-model note and no tier machinery (model tiering removed — owner, 2026-07-18)', () => {
    const html = renderToStaticMarkup(createElement(ProviderKeysPanel, baseProps()))
    // ONE model runs the analysis; the guided setup above owns the choice.
    expect(html).toContain('One model runs the whole analysis')
    // The per-tier override UI and its route are gone.
    expect(html).not.toContain('/api/settings/model-roles')
    expect(html).not.toContain('name="tier"')
    expect(html).not.toContain('Tier philosophy')
    expect(html).not.toContain('per-tier model overrides')
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
