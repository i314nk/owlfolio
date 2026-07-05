'use client'

import { createElement, useMemo, useState, type CSSProperties } from 'react'

import type { AppConfig } from '@owlfolio/shared'

import type { OpenRouterCatalogModel } from '@owlfolio/providers/openRouterModels'

import {
  GuidedConnectionSelect,
  buildConnectionOptions,
  providerSelectionForConnection,
  type ConnectionOption,
} from './GuidedConnectionSelect'
import type { ProviderOption } from '../lib/providerReadiness'

/**
 * The provider/model selection surface for `/settings/providers` (onboarding S3): pick a provider signed
 * in on this computer (or with an API key) and choose its model. Selecting a provider sets up the
 * personal-local workspace automatically — re-editable, never a one-shot wizard.
 *
 * Discipline:
 *  - Mode switch posts to the idempotent S1 `switchMode` via POST /api/onboarding/mode (no re-implemented
 *    init here; re-selecting the current mode is a no-op upstream).
 *  - Provider/model selection persists via PUT /api/onboarding/config (writes config.provider/model_id).
 *  - The provider toggle + tier-grouped model dropdown come from the SHARED GuidedConnectionSelect, so this
 *    surface and the wizard cannot drift.
 *  - How to GET a key / sign in lives in the LLM-providers + logins sections below (single source of truth):
 *    this surface no longer duplicates that guidance.
 */


export type GuidedSetupPanelProps = {
  initialConfig: AppConfig
  initialIsInitialized: boolean
  providerOptions: ProviderOption[]
  /** OpenRouter's live model catalog for the searchable picker (optional; empty falls back to curated). */
  openRouterModels?: OpenRouterCatalogModel[]
}

// The selection card uses the canonical .owl-section-card panel, with a slightly tighter gap to match
// the surrounding ProviderKeysPanel sections.
const sectionCardStyle: CSSProperties = { gap: 'var(--owl-space-4)' }

const subtleTextStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  fontSize: 'var(--owl-text-sm)',
  lineHeight: 1.5,
  margin: 0,
}

type SwitchableMode = Extract<AppConfig['mode'], 'personal-local'>

export function GuidedSetupPanel({ initialConfig, initialIsInitialized, providerOptions, openRouterModels = [] }: GuidedSetupPanelProps) {
  const [config, setConfig] = useState<AppConfig>(initialConfig)
  // Initialization + busy state are tracked for the config/mode write paths; the mode toggle UI that read
  // them was removed (personal-local is the only user mode), so only the setters are referenced now.
  const [, setIsInitialized] = useState(initialIsInitialized)
  const [, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>()

  const connectionOptions = useMemo<ConnectionOption[]>(() => buildConnectionOptions(providerOptions), [providerOptions])

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
    // Any connection → personal-local + provider/model selection.
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
    // ── Provider + model selection (shared component) ──
    createElement(
      'section',
      { className: 'owl-section-card', style: sectionCardStyle },
      createElement('p', { className: 'owl-section-accent' }, 'Provider & model'),
      createElement('h2', { className: 'owl-section-title' }, 'Choose a provider and model'),
      createElement(
        'p',
        { style: subtleTextStyle },
        'Pick a provider signed in on this computer (or with an API key), then choose its model. Selecting a provider sets up your personal-local workspace automatically. Research quality depends on the model you choose — these providers are experimental, and the choice is yours. Connect logins and set API keys in the sections below.',
      ),
      createElement(GuidedConnectionSelect, {
        connectionOptions,
        selectedProviderId: config.provider.provider_id,
        selectedModelId: config.provider.model_id,
        onSelectConnection,
        onSelectModel,
        openRouterModels,
      }),
      errorMessage === undefined ? null : createElement('p', { role: 'alert', style: { color: 'var(--owl-color-risk-bright)', fontWeight: 700, margin: 0 } }, errorMessage),
    ),
  )
}
