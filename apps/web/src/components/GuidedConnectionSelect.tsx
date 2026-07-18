'use client'

import { createElement, useState, type CSSProperties } from 'react'

import { curatedRealModelsForProvider, type CuratedModel } from '@owlfolio/providers/modelCatalog'
import type { OpenRouterCatalogModel } from '@owlfolio/providers/openRouterModels'
import type { AppConfig } from '@owlfolio/shared'

import type { ProviderOption } from '../lib/providerReadiness'

/**
 * Shared, reusable provider/connection toggle + curated model dropdown.
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
  /** Stable card id: 'openrouter' | 'local'. */
  key: string
  provider: ProviderOption
  mode: AppConfig['mode']
  title: string
  badge: string
  description: string
  /**
   * 'fixed': single hard-wired model (demo mock) — no chooser.
   * 'choose': the user picks ONE model (curated dropdown, or a free-form id where no curated list exists).
   */
  modelChoice: 'fixed' | 'choose'
}

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
  background: 'rgba(var(--owl-rgb-accent), 0.10)',
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
  const openRouterProvider = providerOptions.find((provider) => provider.provider_surface_id === 'openrouter-api' || provider.provider_id === 'openrouter')
  const options: ConnectionOption[] = []

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

  // The experimental LOCAL surface (owner, 2026-07-18): an OpenAI-compatible endpoint the user runs
  // themselves (Ollama / vLLM). The card carries the catalog's UNSTABLE/EXPERIMENTAL/UNTESTED wording
  // verbatim — this lane is deliberately never presented as a quietly-normal alternative.
  const localProvider = providerOptions.find((option) => option.provider_id === 'local')
  if (localProvider !== undefined) {
    options.push({
      key: 'local',
      provider: localProvider,
      mode: 'personal-local',
      title: 'Use a local model (Ollama / vLLM)',
      badge: 'Experimental',
      description: localProvider.description,
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

  return allowAdvancedPersonalMockProvider ? currentMode : 'personal-local'
}

/**
 * Default model id for a connection: a `choose` connection with a curated list (OpenRouter) pins the
 * first curated real model so the stored model_id is always a curated/runnable id (never the bare
 * `openrouter/auto` catalog default); otherwise (fixed demo mock, or the uncurated local surface) the
 * catalog's default_model_id is used.
 */
export function defaultModelForConnection(option: ConnectionOption): string | undefined {
  if (option.modelChoice === 'choose') {
    const curated = curatedRealModelsForProvider(option.provider.provider_id)
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
 * Curated model menu data for the `<select>` — a FLAT list read via `curatedRealModelsForProvider`
 * (never hardcoded here). Model tiering was removed (owner, 2026-07-18): ONE configured model runs
 * every stage of the analysis, so the menu is just the curated reasoning candidates.
 */
export function buildCuratedModelOptions(providerId: string): CuratedModel[] {
  return curatedRealModelsForProvider(providerId)
}

export type GuidedConnectionSelectProps = {
  connectionOptions: ConnectionOption[]
  selectedProviderId: AppConfig['provider']['provider_id']
  selectedModelId: string | undefined
  onSelectConnection: (option: ConnectionOption) => void
  onSelectModel: (provider: ProviderOption, modelId: string) => void
  /**
   * OpenRouter's live model catalog (fetched server-side, cached, fail-closed). When present, the OpenRouter
   * connection shows a searchable picker over the FULL catalog instead of only the curated shortlist. Empty
   * (fetch failed / non-OpenRouter) falls back to the curated tier-grouped `<select>`.
   */
  openRouterModels?: OpenRouterCatalogModel[]
  /**
   * The SAVED capability verdict for the ACTIVE provider+model (read from the persisted capability-
   * probe / certification reports). Rendered as the top-left note of the model selection; absent →
   * the note is omitted entirely (e.g. onboarding contexts that don't thread it).
   */
  modelCapability?: { state: 'capable' | 'failed' | 'unverified'; summary?: string; verified_at?: string; failure_reasons?: string[] }
}

/**
 * The shared provider toggle + model dropdown. Renders the connection cards (OpenRouter / Local) and,
 * for the selected connection, a fixed-model note, a curated model `<select>`, or a free-form model
 * input (the local surface has no curated list — model ids vary per install).
 */
export function GuidedConnectionSelect({
  connectionOptions,
  selectedProviderId,
  selectedModelId,
  onSelectConnection,
  onSelectModel,
  openRouterModels = [],
  modelCapability,
}: GuidedConnectionSelectProps) {
  const selectedConnection = connectionOptions.find((option) => isConnectionSelected(option, selectedProviderId))

  // Top-left capability note: the RECORDED probe verdict for the active model, with the probe button
  // beside it. Verify once — the verdict is persisted as a certification report and read back here.
  // Clicking Verify fetches the probe with a live spinner and surfaces the WHY on failure (both the
  // failed scenarios' recorded reasons and any probe-run error).
  // KEYED BY THE ACTIVE MODEL: the probe holds its verdict in component state (so a just-run probe
  // updates in place), which would otherwise survive a router.refresh() and keep showing the PREVIOUS
  // model's verdict after a new model is Set. The key remounts it, adopting the fresh server-computed
  // note for the newly saved model.
  const capabilityNote = modelCapability === undefined ? null : createElement(ModelCapabilityProbe, {
    key: `${selectedProviderId}:${selectedModelId ?? 'none'}`,
    initial: modelCapability,
  })

  return createElement(
    'div',
    { 'aria-label': 'Provider and model selection', style: { display: 'grid', gap: '1rem' } },
    capabilityNote,
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
    renderModelSelection(selectedConnection, selectedModelId, onSelectModel, openRouterModels),
  )
}

export function renderModelSelection(
  selectedConnection: ConnectionOption | undefined,
  selectedModelId: string | undefined,
  onSelectModel: (provider: ProviderOption, modelId: string) => void,
  openRouterModels: OpenRouterCatalogModel[] = [],
) {
  if (selectedConnection === undefined) {
    return null
  }

  // OpenRouter routes to hundreds of models; when the live catalog is available, offer a SEARCHABLE picker
  // over the full list (curated picks surfaced first as recommended) instead of only the curated shortlist.
  if (selectedConnection.provider.provider_id === 'openrouter' && openRouterModels.length > 0) {
    return createElement(OpenRouterModelPicker, {
      provider: selectedConnection.provider,
      selectedModelId,
      onSelectModel,
      liveModels: openRouterModels,
    })
  }

  // The local surface has NO curated model list (installed model ids vary per machine), so the model
  // is entered free-form; the catalog default (an Ollama-style id) is only a seed suggestion.
  if (selectedConnection.provider.provider_id === 'local') {
    return createElement(LocalModelPicker, {
      provider: selectedConnection.provider,
      selectedModelId,
      onSelectModel,
    })
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

  const models = buildCuratedModelOptions(selectedConnection.provider.provider_id)
  if (models.length === 0) {
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
      ...models.map((model) => createElement(
        'option',
        { key: model.model_id, value: model.model_id, translate: 'no' },
        `${model.model_id} — ${model.note}`,
      )),
    ),
    ),
  )
}

const modelHintStyle: CSSProperties = {
  color: 'var(--owl-color-quiet)',
  fontSize: 'var(--owl-text-2xs)',
  lineHeight: 1.4,
}

/**
 * Searchable OpenRouter model picker over the FULL live catalog. A native `<input list>` + `<datalist>`
 * gives free-text + browser autocomplete across hundreds of models with no heavy client JS, and lets the
 * user enter any model id (e.g. a brand-new route) directly. Curated/qualified picks are surfaced first;
 * every other model is honestly flagged experimental + fail-closed until it has its own certification report.
 */
/**
 * OpenRouter model picker: a CONTROLLED search input over the live catalog (curated picks first) plus an
 * explicit "Set model" button. Previously the input auto-persisted on every keystroke, which wrote
 * partial/invalid ids and made the choice feel like it never took. Now the model is committed only when Set
 * is clicked — disabled until the entered value is non-empty AND differs from the current selection. The
 * active model is shown beneath so the user gets clear confirmation.
 */
function OpenRouterModelPicker({ provider, selectedModelId, onSelectModel, liveModels }: {
  provider: ProviderOption
  selectedModelId: string | undefined
  onSelectModel: (provider: ProviderOption, modelId: string) => void
  liveModels: OpenRouterCatalogModel[]
}) {
  const datalistId = 'owl-openrouter-live-models'
  const curated = curatedRealModelsForProvider('openrouter')
  const curatedIds = new Set(curated.map((model) => model.model_id))
  const liveOnly = liveModels.filter((model) => !curatedIds.has(model.id))

  const [pendingModel, setPendingModel] = useState(selectedModelId ?? '')
  const trimmed = pendingModel.trim()
  const isCurrent = trimmed === (selectedModelId ?? '')
  const canSet = trimmed.length > 0 && !isCurrent

  return createElement(
    'label',
    { style: { display: 'grid', gap: '0.5rem', margin: '0 0 1rem', maxWidth: '520px' } },
    createElement('span', { style: modelLabelStyle }, 'Model (search all OpenRouter models)'),
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' } },
      createElement('input', {
        type: 'text',
        list: datalistId,
        'aria-label': 'Search or enter an OpenRouter model id',
        className: 'owl-select owl-focusable',
        placeholder: 'Search or type any model id (e.g. z-ai/glm-5.2-max)',
        value: pendingModel,
        onChange: (event: Event) => setPendingModel((event.target as HTMLInputElement).value),
        style: { flex: '1 1 16rem' },
      }),
      createElement('button', {
        type: 'button',
        className: 'owl-button owl-button-secondary owl-focusable',
        'aria-label': 'Set the selected OpenRouter model',
        disabled: !canSet,
        onClick: () => {
          if (canSet) {
            onSelectModel(provider, trimmed)
          }
        },
        style: { flex: '0 0 auto' },
      }, 'Set model'),
    ),
    createElement(
      'datalist',
      { id: datalistId },
      ...curated.map((model) => createElement(
        'option',
        { key: `curated:${model.model_id}`, value: model.model_id, translate: 'no' },
        `${model.model_id} — recommended · ${model.note}`,
      )),
      ...liveOnly.map((model) => createElement(
        'option',
        { key: `live:${model.id}`, value: model.id, translate: 'no' },
        model.name,
      )),
    ),
    createElement(
      'span',
      { style: modelValueStyle },
      selectedModelId === undefined || selectedModelId.length === 0
        ? 'No model set yet — search or type a model id, then click Set model.'
        : isCurrent
          ? `Active model: ${selectedModelId}`
          : `Active model: ${selectedModelId} — click Set model to switch to “${trimmed}”.`,
    ),
    createElement(
      'span',
      { style: modelHintStyle },
      `Searching OpenRouter's reasoning models the harness can drive (${liveModels.length} — reasoning + tool-calling + structured output; non-reasoning and incompatible models are filtered out). Curated picks are recommended; any other model is your call — it runs experimental until you decide it fits the job.`,
    ),
  )
}

/**
 * Free-form model input for the experimental LOCAL surface (Ollama / vLLM). There is no curated list —
 * installed model ids vary per machine — so the user types the id their local server actually serves
 * and commits it with an explicit Set button (same commit-on-click contract as the OpenRouter picker).
 */
function LocalModelPicker({ provider, selectedModelId, onSelectModel }: {
  provider: ProviderOption
  selectedModelId: string | undefined
  onSelectModel: (provider: ProviderOption, modelId: string) => void
}) {
  const [pendingModel, setPendingModel] = useState(selectedModelId ?? '')
  const trimmed = pendingModel.trim()
  const isCurrent = trimmed === (selectedModelId ?? '')
  const canSet = trimmed.length > 0 && !isCurrent

  return createElement(
    'label',
    { style: { display: 'grid', gap: '0.5rem', margin: '0 0 1rem', maxWidth: '520px' } },
    createElement('span', { style: modelLabelStyle }, 'Model (the id your local server serves)'),
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' } },
      createElement('input', {
        type: 'text',
        'aria-label': 'Enter the local model id',
        className: 'owl-select owl-focusable',
        placeholder: `e.g. ${provider.default_model_id ?? 'llama3.3:70b'}`,
        value: pendingModel,
        onChange: (event: Event) => setPendingModel((event.target as HTMLInputElement).value),
        style: { flex: '1 1 16rem' },
      }),
      createElement('button', {
        type: 'button',
        className: 'owl-button owl-button-secondary owl-focusable',
        'aria-label': 'Set the local model',
        disabled: !canSet,
        onClick: () => {
          if (canSet) {
            onSelectModel(provider, trimmed)
          }
        },
        style: { flex: '0 0 auto' },
      }, 'Set model'),
    ),
    createElement(
      'span',
      { style: modelValueStyle },
      selectedModelId === undefined || selectedModelId.length === 0
        ? 'No model set yet — type the model id your local server serves, then click Set model.'
        : isCurrent
          ? `Active model: ${selectedModelId}`
          : `Active model: ${selectedModelId} — click Set model to switch to “${trimmed}”.`,
    ),
    createElement(
      'span',
      { style: modelHintStyle },
      'UNSTABLE / EXPERIMENTAL / UNTESTED: this lane has not been tested end-to-end — expect failures; runs fail closed. The model id must match one your Ollama / vLLM server actually serves, and the analysis is only as good as that model.',
    ),
  )
}

// ── Model capability probe (stateful) ────────────────────────────────────────

type CapabilityNoteView = { state: 'capable' | 'failed' | 'unverified'; summary?: string; verified_at?: string; failure_reasons?: string[] }

/**
 * The capability note + Verify button. Runs the probe via fetch so the user gets a live spinner
 * instead of a frozen page, updates the verdict in place from the response, and shows the honest WHY
 * on failure: per-scenario recorded reasons for a completed-but-failing probe, or the route's error
 * for a run that could not complete. The verdict itself is persisted server-side (certification
 * report), so a reload shows the same state.
 */
export function ModelCapabilityProbe({ initial }: { initial: CapabilityNoteView }) {
  const [note, setNote] = useState<CapabilityNoteView>(initial)
  const [running, setRunning] = useState(false)
  const [probeError, setProbeError] = useState<string | undefined>(undefined)

  async function onVerify(): Promise<void> {
    setRunning(true)
    setProbeError(undefined)
    try {
      const response = await fetch('/api/providers/verify-model', { method: 'post', headers: { accept: 'application/json' } })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setProbeError(body?.error?.message ?? `verification failed (HTTP ${response.status})`)
        return
      }
      const scenarios = (body.scenarios ?? []) as { scenario_id: string; passed: boolean; status: string; details?: string }[]
      const passed = scenarios.filter((entry) => entry.passed).length
      const summary = `${passed}/${scenarios.length} probe scenarios passed`
      if (passed === scenarios.length && scenarios.length > 0) {
        setNote({ state: 'capable', summary })
      } else {
        setNote({
          state: 'failed',
          summary,
          failure_reasons: scenarios
            .filter((entry) => !entry.passed)
            .map((entry) => `${entry.scenario_id}: ${entry.details !== undefined && entry.details.length > 0 ? entry.details : entry.status}`),
        })
      }
    } catch (caughtError) {
      setProbeError(caughtError instanceof Error ? caughtError.message : 'verification failed')
    } finally {
      setRunning(false)
    }
  }

  const tone = note.state === 'capable' ? 'var(--owl-color-positive)' : note.state === 'failed' ? 'var(--owl-color-risk-bright)' : 'var(--owl-color-gold-bright)'
  const label = note.state === 'capable'
    ? `✓ Model verified capable — ${note.summary ?? ''}`
    : note.state === 'failed'
      ? `✗ Model failed the capability probe — ${note.summary ?? ''}`
      : 'Model not verified yet — run the capability probe'

  return createElement(
    'div',
    { 'data-testid': 'model-capability-note', style: { display: 'grid', gap: '0.45rem' } },
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
      createElement('span', { style: { color: tone, fontFamily: 'var(--owl-font-mono)', fontSize: 'var(--owl-text-sm)', fontWeight: 700 } }, label),
      running
        ? createElement(
            'span',
            { 'data-testid': 'verify-model-running', style: { alignItems: 'center', display: 'inline-flex', gap: '0.45rem', color: 'var(--owl-color-gold-bright)', fontSize: 'var(--owl-text-sm)' } },
            createElement('span', { className: 'owl-run-progress-spinner', 'aria-hidden': true }),
            'Verifying — running the probe scenarios…',
          )
        : createElement(
            'button',
            { className: 'owl-button owl-button-secondary owl-focusable', type: 'button', 'data-testid': 'verify-model-button', onClick: () => void onVerify() },
            note.state === 'unverified' ? 'Verify model' : 'Re-verify model',
          ),
      createElement('span', { style: { color: 'var(--owl-color-quiet)', fontSize: 'var(--owl-text-2xs)' } }, 'Runs the tool-loop + structured-output probe against the saved model. Uses provider quota.'),
    ),
    note.state === 'failed' && (note.failure_reasons?.length ?? 0) > 0
      ? createElement(
          'ul',
          { 'data-testid': 'verify-model-failure-reasons', style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-sm)', margin: 0, paddingLeft: '1.1rem' } },
          ...note.failure_reasons!.map((reason, index) => createElement('li', { key: index }, reason)),
        )
      : null,
    probeError === undefined
      ? null
      : createElement('p', { 'data-testid': 'verify-model-error', style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-sm)', margin: 0 } }, `Probe could not complete: ${probeError}`),
  )
}
