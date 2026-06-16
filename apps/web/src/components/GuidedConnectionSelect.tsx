'use client'

import { createElement, type CSSProperties } from 'react'

import { curatedRealTierModelsForProvider, type CuratedModel, type ModelTierSuitability } from '@owlfolio/providers/modelCatalog'
import type { AppConfig } from '@owlfolio/shared'

import type { ProviderOption } from '../lib/providerReadiness'

/**
 * Shared, reusable provider/connection toggle + tier-grouped model dropdown.
 *
 * EXTRACTED from the onboarding wizard (commit 93ad5a4) so the wizard AND the
 * `/settings/providers` guided-setup surface render the SAME options from a single
 * source — they cannot drift. The wizard re-exports the pure helpers here for its
 * existing tests; the providers page imports the component + helpers directly.
 *
 * This module is pure presentation + pure selection helpers. It never initialises,
 * switches, or persists anything — the caller owns the mode switch and the
 * PUT /api/onboarding/config write.
 */

export type ConnectionOption = {
  key: 'codex' | 'demo' | 'openrouter' | 'claude'
  provider: ProviderOption
  mode: AppConfig['mode']
  title: string
  badge: string
  description: string
  /**
   * 'fixed': single hard-wired model (Codex gpt-5.5 / demo mock) — no chooser.
   * 'choose': the user picks ONE model from the tier-grouped dropdown.
   */
  modelChoice: 'fixed' | 'choose'
}

const TIER_GROUP_LABELS: Record<ModelTierSuitability, string> = {
  T1: 'Tier 1',
  T2: 'Tier 2',
  T3: 'Tier 3',
}

const TIER_ORDER: ModelTierSuitability[] = ['T1', 'T2', 'T3']

const connectionCardBaseStyle: CSSProperties = {
  background: 'var(--owl-color-panel)',
  border: '1px solid var(--owl-color-border)',
  borderRadius: 'var(--owl-radius-card)',
  color: 'var(--owl-color-text)',
  cursor: 'pointer',
  display: 'grid',
  gap: '0.65rem',
  padding: '1rem',
  textAlign: 'left',
}

const selectedConnectionCardStyle: CSSProperties = {
  ...connectionCardBaseStyle,
  background: 'rgba(22, 163, 74, 0.10)',
  border: '1px solid var(--owl-color-border-strong)',
}

const cardGridStyle: CSSProperties = {
  display: 'grid',
  gap: '1rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
}

const cardBadgeStyle: CSSProperties = {
  color: 'var(--owl-color-gold-bright)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: '0.78rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const cardDescriptionStyle: CSSProperties = {
  color: 'var(--owl-color-muted)',
  lineHeight: 1.45,
}

const modelLabelStyle: CSSProperties = {
  color: 'var(--owl-color-quiet)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-2xs)',
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
}

const modelValueStyle: CSSProperties = {
  color: 'var(--owl-color-gold-bright)',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-sm)',
  fontWeight: 600,
}

export function buildConnectionOptions(providerOptions: ProviderOption[]): ConnectionOption[] {
  const mockProvider = providerOptions.find((provider) => provider.provider_id === 'mock-provider')
  const codexProvider = providerOptions.find((provider) => provider.provider_surface_id === 'openai-codex-cli' || provider.provider_id === 'openai')
  const openRouterProvider = providerOptions.find((provider) => provider.provider_surface_id === 'openrouter-api' || provider.provider_id === 'openrouter')
  const claudeProvider = providerOptions.find((provider) => provider.provider_surface_id === 'claude-cli' || provider.provider_id === 'claude')
  const options: ConnectionOption[] = []

  if (mockProvider !== undefined) {
    options.push({
      key: 'demo',
      provider: mockProvider,
      mode: 'demo',
      title: 'Try demo mode',
      badge: 'Demo',
      description: 'Open a safe sample workspace with local mock data. No account is required.',
      modelChoice: 'fixed',
    })
  }

  if (codexProvider !== undefined) {
    options.push({
      key: 'codex',
      provider: codexProvider,
      mode: 'personal-local',
      title: 'Use ChatGPT/Codex',
      badge: 'Local AI',
      description: 'Use a ChatGPT/Codex sign-in that already exists on this computer. Runs the gpt-5.5 model.',
      modelChoice: 'fixed',
    })
  }

  if (openRouterProvider !== undefined) {
    options.push({
      key: 'openrouter',
      provider: openRouterProvider,
      mode: 'personal-local',
      title: 'Use OpenRouter',
      badge: 'API key',
      description: 'One OpenRouter API key routes to many models. Pick one model below; readiness needs OPENROUTER_API_KEY.',
      modelChoice: 'choose',
    })
  }

  if (claudeProvider !== undefined) {
    options.push({
      key: 'claude',
      provider: claudeProvider,
      mode: 'personal-local',
      title: 'Use Claude Code',
      badge: 'Local AI',
      description: 'Use a Claude Code / Anthropic sign-in on this computer. Pick one Claude model below.',
      modelChoice: 'choose',
    })
  }

  return options
}

export function isConnectionSelected(option: ConnectionOption, providerId: AppConfig['provider']['provider_id']): boolean {
  return option.provider.provider_id === providerId
}

export function providerModeForOption(
  currentMode: AppConfig['mode'],
  nextProvider: ProviderOption,
  allowAdvancedPersonalMockProvider = false,
): AppConfig['mode'] {
  if (nextProvider.provider_id !== 'mock-provider') {
    return 'personal-local'
  }

  return allowAdvancedPersonalMockProvider ? currentMode : 'demo'
}

/**
 * Default model id for a connection: a `choose` connection (OpenRouter / Claude Code) pins the first
 * curated real-tier model so the stored model_id is always a curated/runnable id (never the bare
 * `openrouter/auto` catalog default); a `fixed` connection uses the catalog default (Codex gpt-5.5).
 */
export function defaultModelForConnection(option: ConnectionOption): string | undefined {
  if (option.modelChoice === 'choose') {
    const curated = curatedRealTierModelsForProvider(option.provider.provider_id)
    if (curated.length > 0) {
      return curated[0]!.model_id
    }
  }
  return option.provider.default_model_id
}

/**
 * Provider selection when a connection card is chosen. Preserves an existing explicit model choice for
 * the same provider; otherwise seeds the connection's default model so the run model is always concrete.
 */
export function providerSelectionForConnection(
  current: AppConfig['provider'],
  option: ConnectionOption,
): AppConfig['provider'] {
  const nextProvider = option.provider
  if (current.provider_id === nextProvider.provider_id && current.model_id !== undefined) {
    return {
      ...current,
      support_level: nextProvider.support_level,
    }
  }

  const defaultModelId = defaultModelForConnection(option)
  return {
    provider_id: nextProvider.provider_id,
    support_level: nextProvider.support_level,
    ...(defaultModelId === undefined ? {} : { model_id: defaultModelId }),
  }
}

export function providerSelectionForOption(
  current: AppConfig['provider'],
  nextProvider: ProviderOption,
): AppConfig['provider'] {
  if (current.provider_id === nextProvider.provider_id && current.model_id !== undefined) {
    return {
      ...current,
      support_level: nextProvider.support_level,
    }
  }

  return {
    provider_id: nextProvider.provider_id,
    support_level: nextProvider.support_level,
  }
}

/**
 * Tier-grouped model menu data for the `<select>`. GROUPING RULE: read the curated reasoning menu via
 * `curatedRealTierModelsForProvider(provider_id)` (never hardcoded here) and place EACH model under EVERY
 * tier in its `tier_suitability` — so a model suited to T1+T2 shows under both Tier 1 and Tier 2, and ALL
 * curated options remain visible/selectable. The tier grouping is purely organizational; the chosen value
 * is a single concrete `model_id`.
 */
export function buildTierGroupedModelOptions(providerId: string): { tier: ModelTierSuitability; label: string; models: CuratedModel[] }[] {
  const curated = curatedRealTierModelsForProvider(providerId)
  return TIER_ORDER
    .map((tier) => ({
      tier,
      label: TIER_GROUP_LABELS[tier],
      models: curated.filter((model) => model.tier_suitability.includes(tier)),
    }))
    .filter((group) => group.models.length > 0)
}

export type GuidedConnectionSelectProps = {
  connectionOptions: ConnectionOption[]
  selectedProviderId: AppConfig['provider']['provider_id']
  selectedModelId: string | undefined
  onSelectConnection: (option: ConnectionOption) => void
  onSelectModel: (provider: ProviderOption, modelId: string) => void
}

/**
 * The shared provider toggle + tier-grouped model dropdown. Renders the connection cards (Demo / Codex /
 * OpenRouter / Claude Code) and, for the selected connection, either a fixed-model note or a tier-grouped
 * model `<select>`.
 */
export function GuidedConnectionSelect({
  connectionOptions,
  selectedProviderId,
  selectedModelId,
  onSelectConnection,
  onSelectModel,
}: GuidedConnectionSelectProps) {
  const selectedConnection = connectionOptions.find((option) => isConnectionSelected(option, selectedProviderId))

  return createElement(
    'div',
    { 'aria-label': 'Provider and model selection', style: { display: 'grid', gap: '1rem' } },
    createElement(
      'div',
      { style: cardGridStyle },
      ...connectionOptions.map((option) => createElement(
        'button',
        {
          key: option.key,
          onClick: () => onSelectConnection(option),
          style: isConnectionSelected(option, selectedProviderId) ? selectedConnectionCardStyle : connectionCardBaseStyle,
          type: 'button',
        },
        createElement('span', { style: cardBadgeStyle }, option.badge),
        createElement('strong', { style: { color: 'var(--owl-color-text)', fontSize: '1.08rem' } }, option.title),
        createElement('span', { style: cardDescriptionStyle }, option.description),
      )),
    ),
    renderModelSelection(selectedConnection, selectedModelId, onSelectModel),
  )
}

export function renderModelSelection(
  selectedConnection: ConnectionOption | undefined,
  selectedModelId: string | undefined,
  onSelectModel: (provider: ProviderOption, modelId: string) => void,
) {
  if (selectedConnection === undefined || selectedConnection.mode === 'demo') {
    return null
  }

  if (selectedConnection.modelChoice === 'fixed') {
    const fixedModelId = selectedConnection.provider.default_model_id
    if (fixedModelId === undefined) {
      return null
    }
    return createElement(
      'div',
      { style: { display: 'grid', gap: '0.3rem', margin: '0 0 1rem' } },
      createElement('span', { style: modelLabelStyle }, 'Model'),
      createElement('span', { 'aria-label': 'Fixed model', style: modelValueStyle }, `${fixedModelId} (only model)`),
    )
  }

  const groups = buildTierGroupedModelOptions(selectedConnection.provider.provider_id)
  if (groups.length === 0) {
    return null
  }

  return createElement(
    'label',
    { style: { display: 'grid', gap: '0.5rem', margin: '0 0 1rem', maxWidth: '480px' } },
    createElement('span', { style: modelLabelStyle }, 'Model (pick one)'),
    createElement(
      'span',
      { className: 'owl-select-wrap' },
      createElement(
      'select',
      {
        'aria-label': 'Choose one model',
        className: 'owl-select owl-focusable',
        onChange: (event: Event) => {
          const target = event.target as HTMLSelectElement
          onSelectModel(selectedConnection.provider, target.value)
        },
        value: selectedModelId ?? '',
      },
      ...groups.map((group) => createElement(
        'optgroup',
        { key: group.tier, label: group.label },
        ...group.models.map((model) => createElement(
          'option',
          { key: `${group.tier}:${model.model_id}`, value: model.model_id },
          `${model.model_id} — ${model.note}`,
        )),
      )),
    ),
    ),
  )
}
