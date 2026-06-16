'use client'

import { createElement, useEffect, useMemo, useState, type CSSProperties } from 'react'

import { curatedRealTierModelsForProvider, type CuratedModel, type ModelTierSuitability } from '@owlfolio/providers/modelCatalog'
import type { AppConfig } from '@owlfolio/shared'

import { StatusBadge } from '../../components/StatusBadge'
import type { ProviderOption, ProviderReadiness } from '../../lib/providerReadiness'

type OnboardingWizardProps = {
  initialConfig: AppConfig
  initialIsInitialized: boolean
  initialReadiness: ProviderReadiness
  providerOptions: ProviderOption[]
  allowAdvancedPersonalMockProvider?: boolean
}

const sectionStyle: CSSProperties = {
  background: 'var(--owl-color-panel-elevated)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '1.25rem',
  boxShadow: '0 20px 45px rgba(0, 0, 0, 0.18)',
  padding: '1.25rem',
}

const cardGridStyle: CSSProperties = {
  display: 'grid',
  gap: '1rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
}

const connectionCardBaseStyle: CSSProperties = {
  background: 'var(--owl-color-panel)',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderRadius: '1rem',
  color: '#f7f8ff',
  cursor: 'pointer',
  display: 'grid',
  gap: '0.65rem',
  padding: '1rem',
  textAlign: 'left',
}

const selectedConnectionCardStyle: CSSProperties = {
  ...connectionCardBaseStyle,
  background: 'rgba(124, 140, 255, 0.1)',
  border: '1px solid rgba(124, 140, 255, 0.4)',
  boxShadow: '0 0 0 1px rgba(124, 140, 255, 0.2) inset',
}

const selectStyle: CSSProperties = {
  appearance: 'none',
  background: 'var(--owl-color-panel-deep)',
  border: '1px solid rgba(124, 140, 255, 0.34)',
  borderRadius: '0.8rem',
  color: '#f7f8ff',
  fontSize: '1rem',
  fontWeight: 700,
  padding: '0.85rem 1rem',
}

const actionButtonStyle: CSSProperties = {
  background: '#6366f1',
  border: 0,
  borderRadius: '999px',
  color: '#ffffff',
  cursor: 'pointer',
  fontSize: '0.95rem',
  fontWeight: 800,
  padding: '0.8rem 1.1rem',
}

const disabledActionButtonStyle: CSSProperties = {
  ...actionButtonStyle,
  background: '#475569',
  cursor: 'not-allowed',
}

const eyebrowStyle: CSSProperties = {
  color: '#6366f1',
  fontSize: '0.85rem',
  fontWeight: 800,
  letterSpacing: '0.08em',
  margin: 0,
  textTransform: 'uppercase',
}

const helpLinkStyle: CSSProperties = {
  color: '#a5b4fc',
  fontWeight: 800,
  textDecoration: 'none',
}

type ConnectionOption = {
  key: 'codex' | 'demo' | 'openrouter' | 'claude'
  provider: ProviderOption
  mode: AppConfig['mode']
  title: string
  badge: string
  description: string
  /**
   * 'fixed': single hard-wired model (Codex gpt-5.5 / demo mock) — no chooser.
   * 'choose': the user picks ONE model from the tier-grouped dropdown.
   * 'none': no model surface (unused today).
   */
  modelChoice: 'fixed' | 'choose'
}

const TIER_GROUP_LABELS: Record<ModelTierSuitability, string> = {
  T1: 'Tier 1',
  T2: 'Tier 2',
  T3: 'Tier 3',
}

const TIER_ORDER: ModelTierSuitability[] = ['T1', 'T2', 'T3']

function conciseNextStepFor(selectedProvider: ProviderOption, readiness: ProviderReadiness): string {
  const surfaceId = selectedProvider.provider_surface_id ?? readiness.provider_surface_id

  if (surfaceId === 'openai-codex-cli') {
    return 'Sign in to ChatGPT/Codex on this computer, then come back and check again.'
  }

  return selectedProvider.simple_next_step ?? 'Finish the local sign-in on this computer, then come back and check again.'
}

export function OnboardingWizard({
  initialConfig,
  initialIsInitialized,
  initialReadiness,
  providerOptions,
  allowAdvancedPersonalMockProvider = false,
}: OnboardingWizardProps) {
  const [config, setConfig] = useState<AppConfig>(initialConfig)
  const [readiness, setReadiness] = useState<ProviderReadiness>(initialReadiness)
  const [isInitialized, setIsInitialized] = useState(initialIsInitialized)
  const [isStarting, setIsStarting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>()

  useEffect(() => {
    let cancelled = false

    async function refreshReadiness() {
      const response = await fetch(`/api/onboarding/readiness?provider=${encodeURIComponent(config.provider.provider_id)}`)
      if (!response.ok) {
        return
      }

      const payload = (await response.json()) as { readiness: ProviderReadiness }
      if (!cancelled) {
        setReadiness(payload.readiness)
      }
    }

    void refreshReadiness()

    return () => {
      cancelled = true
    }
  }, [config.provider.provider_id])

  const selectedProvider = useMemo<ProviderOption>(
    () => providerOptions.find((provider) => provider.provider_id === config.provider.provider_id) ?? {
      provider_id: config.provider.provider_id,
      label: config.provider.provider_id,
      support_level: config.provider.support_level,
      description: 'Provider metadata unavailable',
    },
    [config.provider.provider_id, config.provider.support_level, providerOptions],
  )

  const connectionOptions = useMemo<ConnectionOption[]>(() => buildConnectionOptions(providerOptions), [providerOptions])
  const selectedConnection = useMemo<ConnectionOption | undefined>(
    () => connectionOptions.find((option) => isConnectionSelected(option, config.provider.provider_id)),
    [connectionOptions, config.provider.provider_id],
  )
  const readinessMatchesSelection = readiness.provider_id === config.provider.provider_id
  const providerCanStart = readinessMatchesSelection && readiness.is_ready
  const statusLabel = readinessMatchesSelection ? conciseReadinessLabel(selectedProvider, readiness) : 'Checking readiness…'
  const nextStep = readinessMatchesSelection ? conciseNextStepFor(selectedProvider, readiness) : 'Wait for Owlfolio to refresh the selected provider readiness.'
  const startButtonDisabled = isStarting || !providerCanStart

  function selectConnection(option: ConnectionOption) {
    setErrorMessage(undefined)
    setConfig((current) => ({
      ...current,
      mode: option.mode,
      provider: option.mode === 'demo'
        ? {
            provider_id: 'mock-provider',
            support_level: 'certified',
            model_id: 'mock-buffett-munger-demo',
          }
        : providerSelectionForConnection(current.provider, option),
    }))
  }

  function selectModel(provider: ProviderOption, modelId: string) {
    setErrorMessage(undefined)
    setConfig((current) => ({
      ...current,
      provider: {
        ...current.provider,
        provider_id: provider.provider_id,
        support_level: provider.support_level,
        model_id: modelId,
      },
    }))
  }

  function selectProvider(nextProvider: ProviderOption) {
    setErrorMessage(undefined)
    setConfig((current) => {
      const nextMode = providerModeForOption(current.mode, nextProvider, allowAdvancedPersonalMockProvider)
      return {
        ...current,
        mode: nextMode,
        provider: nextProvider.provider_id === 'mock-provider' && nextMode === 'demo'
          ? {
              provider_id: 'mock-provider',
              support_level: 'certified',
              model_id: 'mock-buffett-munger-demo',
            }
          : providerSelectionForOption(current.provider, nextProvider),
      }
    })
  }

  async function startWorkflow() {
    if (!providerCanStart) {
      setErrorMessage(`Owlfolio cannot start yet: ${statusLabel}`)
      return
    }

    try {
      setIsStarting(true)
      setErrorMessage(undefined)

      const response = await fetch('/api/onboarding/start', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          mode: config.mode,
          provider: config.provider,
          strategy_id: config.strategy_id,
          shariah: config.shariah,
          market_universe: config.market_universe,
        }),
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => undefined)) as { error?: { message?: string } | string } | undefined
        const serverMessage = typeof payload?.error === 'string' ? payload.error : payload?.error?.message
        throw new Error(serverMessage ?? 'Failed to initialize onboarding state')
      }

      const payload = (await response.json()) as { config: AppConfig; next_destination: string }
      setConfig(payload.config)
      setIsInitialized(true)
      window.location.assign(payload.next_destination)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unknown onboarding error')
    } finally {
      setIsStarting(false)
    }
  }

  return createElement(
    'main',
    { className: 'owl-route-frame owl-route-frame-wide' },
    createElement(
      'section',
      { style: { display: 'grid', gap: '1rem' } },
      createElement('p', { style: { color: '#6366f1', fontWeight: 800, letterSpacing: '0.08em', margin: 0, textTransform: 'uppercase' } }, 'Owlfolio'),
      createElement('h1', { style: { fontSize: 'clamp(2.25rem, 5vw, 4.5rem)', lineHeight: 1, margin: '0.5rem 0 1rem' } }, 'Start setup'),
      createElement('p', { style: { color: '#cbd5e1', fontSize: '1.1rem', maxWidth: '760px' } }, 'Choose a safe demo workspace or connect a local AI assistant already signed in on this computer. Owlfolio stays local and only starts when the selected path is ready.'),
      createElement(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', margin: '1.5rem 0 2rem' } },
        createElement(StatusBadge, { tone: isInitialized ? 'success' : 'warning' }, isInitialized ? 'Setup complete' : 'Setup needed'),
        createElement(StatusBadge, { tone: providerCanStart ? 'success' : 'warning' }, providerCanStart ? 'Ready to start' : 'Needs setup'),
        createElement(StatusBadge, null, config.mode === 'demo' ? 'Demo mode' : 'Local AI assistant'),
        createElement(StatusBadge, null, selectedProvider.label),
      ),
      createElement(
        'div',
        { style: { display: 'grid', gap: '1rem' } },
        createElement(
          'section',
          { style: sectionStyle, 'aria-labelledby': 'setup-mode-heading' },
          createElement('p', { style: eyebrowStyle }, '1. Choose how to explore'),
          createElement('h2', { id: 'setup-mode-heading', style: { margin: '0.35rem 0 0.25rem' } }, 'Try demo or use a local assistant'),
          createElement('p', { style: { color: '#cbd5e1', marginTop: 0 } }, 'Demo mode is the fastest way in. Local assistant setup checks this computer for an existing ChatGPT/Codex sign-in.'),
          createElement(
            'div',
            { style: cardGridStyle },
            ...connectionOptions.map((option) => createElement(
              'button',
              {
                key: option.key,
                onClick: () => selectConnection(option),
                style: isConnectionSelected(option, config.provider.provider_id) ? selectedConnectionCardStyle : connectionCardBaseStyle,
                type: 'button',
              },
              createElement('span', { style: { color: '#a5b4fc', fontSize: '0.78rem', fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase' } }, option.badge),
              createElement('strong', { style: { fontSize: '1.08rem' } }, option.title),
              createElement('span', { style: { color: '#cbd5e1', lineHeight: 1.45 } }, option.description),
            )),
          ),
          createElement(
            'details',
            { style: { marginTop: '1rem' } },
            createElement('summary', { style: { color: '#cbd5e1', cursor: 'pointer', fontWeight: 800 } }, 'Advanced: choose a different provider'),
            createElement(
              'label',
              { style: { color: '#cbd5e1', display: 'grid', gap: '0.5rem', marginTop: '0.75rem', maxWidth: '420px' } },
              createElement('span', null, 'Provider family'),
              createElement(
                'select',
                {
                  'aria-label': 'Provider family',
                  onChange: (event: Event) => {
                    const target = event.target as HTMLSelectElement
                    const nextProvider = providerOptions.find((provider) => provider.provider_id === target.value)
                    if (nextProvider !== undefined) {
                      selectProvider(nextProvider)
                    }
                  },
                  style: selectStyle,
                  value: config.provider.provider_id,
                },
                ...providerOptions.map((provider) => createElement('option', { key: provider.provider_id, value: provider.provider_id }, provider.label)),
              ),
            ),
          ),
        ),
        createElement(
          'section',
          { style: sectionStyle, 'aria-labelledby': 'assistant-connection-heading' },
          createElement('p', { style: eyebrowStyle }, '2. Connect a local AI assistant'),
          createElement('h2', { id: 'assistant-connection-heading', style: { margin: '0.35rem 0 0.25rem' } }, selectedProvider.label),
          createElement('p', { style: { color: '#cbd5e1', marginTop: 0 } }, plainProviderSummary(selectedProvider, readiness)),
          renderModelSelection(selectedConnection, config.provider.model_id, selectModel),
          createElement(
            'div',
            {
              role: providerCanStart ? undefined : 'alert',
              style: {
                background: providerCanStart ? 'rgba(34, 197, 94, 0.12)' : 'rgba(248, 113, 113, 0.14)',
                border: providerCanStart ? '1px solid rgba(34, 197, 94, 0.28)' : '1px solid rgba(248, 113, 113, 0.32)',
                borderRadius: '0.9rem',
                color: providerCanStart ? '#bbf7d0' : '#fecaca',
                display: 'grid',
                gap: '0.35rem',
                padding: '0.9rem',
              },
            },
            createElement('strong', null, providerCanStart ? 'Ready to start' : 'Needs setup'),
            createElement('span', null, statusLabel),
            providerCanStart
              ? createElement('span', null, config.mode === 'demo' ? 'Action: open the local demo workspace and Command Center.' : 'Action: create the personal local ledger and open the Command Center.')
              : createElement('span', null, `Next step: ${nextStep}`),
            providerCanStart ? null : createElement('span', null, 'You can keep exploring with demo mode while setup is incomplete.'),
          ),
          createElement(
            'p',
            { style: { color: '#cbd5e1', marginBottom: 0 } },
            createElement('a', { className: 'owl-focusable', href: '/learn#providers', style: helpLinkStyle }, 'Learn setup guide'),
            ' or ',
            createElement('a', { className: 'owl-focusable', href: '/settings/providers', style: helpLinkStyle }, 'open advanced provider status'),
            '.',
          ),
          errorMessage === undefined ? null : createElement('p', { style: { color: '#fca5a5', fontWeight: 700 } }, errorMessage),
        ),
        createElement(
          'section',
          { style: sectionStyle, 'aria-labelledby': 'start-owlfolio-heading' },
          createElement('p', { style: eyebrowStyle }, '3. Start using Owlfolio'),
          createElement('h2', { id: 'start-owlfolio-heading', style: { margin: '0.35rem 0 0.25rem' } }, providerCanStart ? 'Ready when you are' : 'Finish setup first'),
          createElement('p', { style: { color: '#cbd5e1', marginTop: 0 } }, providerCanStart ? 'Owlfolio will create local state for the selected mode and then open the Command Center.' : 'Pick demo mode for an immediate local walkthrough, or finish the selected assistant sign-in before starting personal-local workflows.'),
          createElement('button', {
            disabled: startButtonDisabled,
            onClick: () => void startWorkflow(),
            style: { ...(startButtonDisabled ? disabledActionButtonStyle : actionButtonStyle), marginTop: '0.25rem' },
            type: 'button',
          }, isStarting ? 'Starting…' : providerCanStart ? 'Start using Owlfolio' : 'Finish setup first'),
        ),
        createElement(
          'details',
          { style: sectionStyle },
          createElement('summary', { style: { cursor: 'pointer', fontWeight: 900 } }, 'Default workflow settings'),
          createElement('p', { style: { color: '#cbd5e1' } }, 'Owlfolio starts with the Buffett-Munger workflow, Shariah guardrails enabled, and the public-equities discovery universe. You can tune these after setup; broker accounts are not part of onboarding.'),
        ),
      ),
    ),
  )
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

function buildConnectionOptions(providerOptions: ProviderOption[]): ConnectionOption[] {
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

function isConnectionSelected(option: ConnectionOption, providerId: AppConfig['provider']['provider_id']): boolean {
  return option.provider.provider_id === providerId
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

function renderModelSelection(
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
      { style: { color: '#cbd5e1', display: 'grid', gap: '0.3rem', margin: '0 0 1rem' } },
      createElement('span', { style: { fontWeight: 800 } }, 'Model'),
      createElement('span', { 'aria-label': 'Fixed model', style: { color: '#a5b4fc', fontWeight: 700 } }, `${fixedModelId} (only model)`),
    )
  }

  const groups = buildTierGroupedModelOptions(selectedConnection.provider.provider_id)
  if (groups.length === 0) {
    return null
  }

  return createElement(
    'label',
    { style: { color: '#cbd5e1', display: 'grid', gap: '0.5rem', margin: '0 0 1rem', maxWidth: '480px' } },
    createElement('span', { style: { fontWeight: 800 } }, 'Model (pick one)'),
    createElement(
      'select',
      {
        'aria-label': 'Choose one model',
        onChange: (event: Event) => {
          const target = event.target as HTMLSelectElement
          onSelectModel(selectedConnection.provider, target.value)
        },
        style: selectStyle,
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
  )
}

function plainProviderSummary(selectedProvider: ProviderOption, readiness: ProviderReadiness): string {
  const surfaceId = selectedProvider.provider_surface_id ?? readiness.provider_surface_id

  if (selectedProvider.provider_id === 'mock-provider') {
    return 'Demo mode uses safe sample data on this computer. No account is required.'
  }

  if (surfaceId === 'openai-codex-cli') {
    return 'Owlfolio checks for a ChatGPT/Codex sign-in that already exists on this computer.'
  }

  return `Owlfolio checks ${selectedProvider.label} on this computer before starting local workflows.`
}

function conciseReadinessLabel(selectedProvider: ProviderOption, readiness: ProviderReadiness): string {
  const surfaceId = selectedProvider.provider_surface_id ?? readiness.provider_surface_id

  if (selectedProvider.provider_id === 'mock-provider') {
    return readiness.is_ready ? 'Demo mode is ready on this computer.' : 'Demo mode is not ready yet.'
  }

  if (surfaceId === 'openai-codex-cli') {
    if (readiness.is_ready === false) {
      return 'Owlfolio cannot find your ChatGPT/Codex login yet.'
    }

    return 'ChatGPT/Codex is ready for local Owlfolio runs.'
  }

  return readiness.status_label.replace(/credentials/gi, 'sign-in').replace(/credential/gi, 'sign-in')
}
