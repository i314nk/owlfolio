'use client'

import { createElement, useMemo, useState, type CSSProperties } from 'react'

import type { AppConfig } from '@owlfolio/shared'

import {
  GuidedConnectionSelect,
  buildConnectionOptions,
  providerSelectionForConnection,
  type ConnectionOption,
} from './GuidedConnectionSelect'
import { StatusBadge } from './StatusBadge'
import type { ProviderOption } from '../lib/providerReadiness'

/**
 * The guided-setup surface for `/settings/providers` (onboarding S3). This is the WHOLE onboarding for
 * non-technical users: choose/switch a mode, pick a provider + tier-grouped model, learn how to get a key
 * or sign in per provider, and see the next step to set investable capital — all re-editable, never a
 * one-shot wizard.
 *
 * Discipline:
 *  - Mode switch posts to the idempotent S1 `switchMode` via POST /api/onboarding/mode (no re-implemented
 *    init here; re-selecting the current mode is a no-op upstream).
 *  - Provider/model selection persists via PUT /api/onboarding/config (writes config.provider/model_id).
 *  - The provider toggle + tier-grouped model dropdown come from the SHARED GuidedConnectionSelect, so this
 *    surface and the wizard cannot drift.
 *  - Key guidance is one accurate, non-overclaiming sentence + a link per provider (these providers remain
 *    experimental / fail-closed per the catalog).
 *  - The S4 gate's missing-items are surfaced so the end-to-end path stays visible.
 */

export type GuidedSetupGateItem = {
  id: string
  label: string
  done: boolean
}

export type GuidedSetupPanelProps = {
  initialConfig: AppConfig
  initialIsInitialized: boolean
  providerOptions: ProviderOption[]
  /** The S4 onboarding gate's outstanding items (provider connected / capital set). */
  missingItems: GuidedSetupGateItem[]
}

type KeyGuidance = {
  /** One accurate, non-overclaiming sentence on how to get a key / sign in. */
  sentence: string
  link_label: string
  link_href: string
  /** External (API-keys page) vs. local-command guidance. */
  external: boolean
}

// Accurate, non-overclaiming guidance. URLs match the providerKeys catalog get_key_url values; the
// providers themselves stay experimental / fail-closed until target-specific certification exists.
const KEY_GUIDANCE: Record<ConnectionOption['key'], KeyGuidance> = {
  demo: {
    sentence: 'Demo mode runs on safe local sample data — no account or key is required.',
    link_label: 'About demo mode',
    link_href: '/learn#providers',
    external: false,
  },
  codex: {
    sentence: 'Sign in to ChatGPT/Codex on this computer by running codex login in your terminal, then refresh readiness.',
    link_label: 'OpenAI sign-in',
    link_href: 'https://platform.openai.com/api-keys',
    external: true,
  },
  openrouter: {
    sentence: 'Create one OpenRouter API key, then set OPENROUTER_API_KEY below (each routed model still needs its own certification before it is trusted for research).',
    link_label: 'Get an OpenRouter key',
    link_href: 'https://openrouter.ai/keys',
    external: true,
  },
  claude: {
    sentence: 'Sign in with Claude Code by running claude login, or set an Anthropic console API key below.',
    link_label: 'Anthropic console keys',
    link_href: 'https://console.anthropic.com/settings/keys',
    external: true,
  },
}

// The guided-setup cards use the canonical .owl-section-card panel, with a slightly tighter gap to
// match the surrounding ProviderKeysPanel sections.
const sectionCardStyle: CSSProperties = { gap: 'var(--owl-space-4)' }

const subtleTextStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-sm)',
  lineHeight: 1.5,
  margin: 0,
}

type SwitchableMode = Extract<AppConfig['mode'], 'demo' | 'personal-local'>

export function GuidedSetupPanel({ initialConfig, initialIsInitialized, providerOptions, missingItems }: GuidedSetupPanelProps) {
  const [config, setConfig] = useState<AppConfig>(initialConfig)
  const [isInitialized, setIsInitialized] = useState(initialIsInitialized)
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>()

  const connectionOptions = useMemo<ConnectionOption[]>(() => buildConnectionOptions(providerOptions), [providerOptions])
  const selectedConnection = useMemo<ConnectionOption | undefined>(
    () => connectionOptions.find((option) => option.provider.provider_id === config.provider.provider_id),
    [connectionOptions, config.provider.provider_id],
  )

  async function persistConfig(provider: AppConfig['provider']) {
    setErrorMessage(undefined)
    setIsBusy(true)
    try {
      const response = await fetch('/api/onboarding/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      if (!response.ok) {
        throw new Error('Could not save the provider/model selection')
      }
      const payload = (await response.json()) as { config: AppConfig; is_initialized: boolean }
      setConfig(payload.config)
      setIsInitialized(payload.is_initialized)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error saving selection')
    } finally {
      setIsBusy(false)
    }
  }

  function onSelectConnection(option: ConnectionOption) {
    // Demo card → switch to demo mode; any real connection → personal-local + provider/model selection.
    if (option.mode === 'demo') {
      void switchToMode('demo')
      return
    }
    const provider = providerSelectionForConnection(config.provider, option)
    setConfig((current) => ({ ...current, provider }))
    void switchToMode('personal-local').then(() => persistConfig(provider))
  }

  function onSelectModel(provider: ProviderOption, modelId: string) {
    const next: AppConfig['provider'] = {
      ...config.provider,
      provider_id: provider.provider_id,
      support_level: provider.support_level,
      model_id: modelId,
    }
    setConfig((current) => ({ ...current, provider: next }))
    void persistConfig(next)
  }

  async function switchToMode(mode: SwitchableMode) {
    setErrorMessage(undefined)
    setIsBusy(true)
    try {
      const response = await fetch('/api/onboarding/mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (!response.ok) {
        throw new Error('Could not switch mode')
      }
      const payload = (await response.json()) as { config: AppConfig; is_initialized: boolean }
      setConfig(payload.config)
      setIsInitialized(payload.is_initialized)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error switching mode')
    } finally {
      setIsBusy(false)
    }
  }

  return createElement(
    'section',
    { 'aria-label': 'Guided setup', style: { display: 'grid', gap: '1.25rem', marginBottom: '1.5rem' } },
    // ── Header + mode switch ──
    createElement(
      'section',
      { className: 'owl-section-card', style: sectionCardStyle },
      createElement('p', { className: 'owl-section-accent' }, 'Step 1 · Choose a mode'),
      createElement('h2', { className: 'owl-section-title' }, 'Guided setup'),
      createElement(
        'p',
        { style: subtleTextStyle },
        'Pick a mode any time — switching is non-destructive and re-editable. Demo runs on safe sample data; Personal-local creates your own local ledger and uses a provider signed in on this computer.',
      ),
      createElement(
        'div',
        { 'aria-label': 'Mode switch', style: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' } },
        createElement('button', {
          type: 'button',
          disabled: isBusy,
          onClick: () => void switchToMode('demo'),
          className: `owl-button ${config.mode === 'demo' ? 'owl-button-primary' : 'owl-button-secondary'} owl-focusable`,
        }, 'Demo'),
        createElement('button', {
          type: 'button',
          disabled: isBusy,
          onClick: () => void switchToMode('personal-local'),
          className: `owl-button ${config.mode === 'personal-local' ? 'owl-button-primary' : 'owl-button-secondary'} owl-focusable`,
        }, 'Personal-local'),
        createElement(StatusBadge, { tone: isInitialized ? 'success' : 'warning' }, isInitialized ? 'Set up' : 'Setup needed'),
        createElement(StatusBadge, { tone: 'neutral' }, `Current: ${config.mode}`),
      ),
    ),
    // ── Provider + model selection (shared component) ──
    createElement(
      'section',
      { className: 'owl-section-card', style: sectionCardStyle },
      createElement('p', { className: 'owl-section-accent' }, 'Step 2 · Provider & model'),
      createElement('h2', { className: 'owl-section-title' }, 'Choose a provider and model'),
      createElement(
        'p',
        { style: subtleTextStyle },
        'Demo uses the mock provider. Codex runs the fixed gpt-5.5 model; OpenRouter and Claude Code let you pick one tier-grouped model. These providers are experimental and fail-closed until certified.',
      ),
      createElement(GuidedConnectionSelect, {
        connectionOptions,
        selectedProviderId: config.provider.provider_id,
        selectedModelId: config.provider.model_id,
        onSelectConnection,
        onSelectModel,
      }),
      errorMessage === undefined ? null : createElement('p', { role: 'alert', style: { color: 'var(--owl-color-risk-bright)', fontWeight: 700, margin: 0 } }, errorMessage),
    ),
    // ── Per-provider key guidance ──
    createElement(
      'section',
      { 'aria-label': 'Provider key guidance', className: 'owl-section-card', style: sectionCardStyle },
      createElement('p', { className: 'owl-section-accent' }, 'Step 3 · Connect your provider'),
      createElement('h2', { className: 'owl-section-title' }, 'How to get a key or sign in'),
      createElement(
        'div',
        { style: { display: 'grid', gap: '0.75rem' } },
        ...connectionOptions.map((option) => renderKeyGuidance(option, selectedConnection?.key === option.key)),
      ),
      createElement(
        'p',
        { style: subtleTextStyle },
        'Set keys in the LLM providers section below — keys are stored in a single local env file (server-only, masked) and never enter the ledger, logs, page source, or git.',
      ),
    ),
    // ── Capital next-step + gate missing-items ──
    createElement(
      'section',
      { 'aria-label': 'Set investable capital next step', className: 'owl-section-card', style: sectionCardStyle },
      createElement('p', { className: 'owl-section-accent' }, 'Step 4 · Set capital'),
      createElement('h2', { className: 'owl-section-title' }, 'Set investable capital'),
      createElement(
        'p',
        { style: subtleTextStyle },
        'Personal-local research needs investable capital set in your ledger. Set it on the portfolio, then a working run is: switch to personal-local → connect a provider → set capital → start a deep dive.',
      ),
      createElement(
        'p',
        { style: { margin: 0 } },
        createElement('a', { className: 'owl-back-link owl-focusable', href: '/portfolio#investable-capital' }, 'Set investable capital on the portfolio →'),
      ),
      renderMissingItems(missingItems),
    ),
  )
}

function renderKeyGuidance(option: ConnectionOption, isSelected: boolean) {
  const guidance = KEY_GUIDANCE[option.key]
  return createElement(
    'article',
    {
      key: option.key,
      'aria-label': `${option.title} key guidance`,
      style: {
        background: isSelected ? 'rgba(22, 163, 74, 0.10)' : 'var(--owl-color-panel-deep)',
        border: isSelected ? '1px solid var(--owl-color-border-strong)' : '1px solid var(--owl-color-border)',
        borderRadius: '0.7rem',
        display: 'grid',
        gap: '0.4rem',
        padding: '0.85rem 1rem',
      },
    },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' } },
      createElement('strong', { style: { color: 'var(--owl-color-gold-bright)' } }, option.title),
      createElement(StatusBadge, { tone: 'neutral' }, option.badge),
    ),
    createElement('p', { style: subtleTextStyle }, guidance.sentence),
    createElement(
      'a',
      {
        className: 'owl-back-link owl-focusable',
        href: guidance.link_href,
        ...(guidance.external ? { rel: 'noreferrer', target: '_blank' } : {}),
      },
      guidance.external ? `${guidance.link_label} ↗` : guidance.link_label,
    ),
  )
}

function renderMissingItems(missingItems: GuidedSetupGateItem[]) {
  if (missingItems.length === 0) {
    return createElement('p', { style: { ...subtleTextStyle, color: 'var(--owl-color-accent-bright)' } }, 'All setup steps are complete — deep dives can start.')
  }
  return createElement(
    'div',
    { 'aria-label': 'Remaining setup items', style: { display: 'grid', gap: '0.5rem' } },
    createElement('p', { style: { ...subtleTextStyle, fontWeight: 700 } }, 'Still needed before a working run:'),
    createElement(
      'ul',
      { style: { display: 'grid', gap: '0.4rem', listStyle: 'none', margin: 0, padding: 0 } },
      ...missingItems.map((item) =>
        createElement(
          'li',
          { key: item.id, style: { alignItems: 'center', display: 'flex', gap: '0.5rem' } },
          createElement(StatusBadge, { tone: 'warning' }, 'missing'),
          createElement('span', { style: subtleTextStyle }, item.label),
        ),
      ),
    ),
  )
}
