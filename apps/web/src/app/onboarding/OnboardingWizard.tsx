'use client'

import { createElement, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'

import type { AppConfig } from '@owlfolio/shared'

import { StatusBadge } from '../../components/StatusBadge'
import type { ProviderOption, ProviderReadiness } from '../../lib/providerReadiness'

type OnboardingWizardProps = {
  initialConfig: AppConfig
  initialIsInitialized: boolean
  initialReadiness: ProviderReadiness
  providerOptions: ProviderOption[]
}

const sectionStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.035)',
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

const radioCardBaseStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.035)',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  color: '#f7f8ff',
  borderRadius: '1rem',
  cursor: 'pointer',
  display: 'grid',
  gap: '0.5rem',
  padding: '1rem',
}

const selectedRadioCardStyle: CSSProperties = {
  ...radioCardBaseStyle,
  background: 'rgba(124, 140, 255, 0.1)',
  border: '1px solid rgba(124, 140, 255, 0.34)',
  boxShadow: '0 0 0 1px rgba(124, 140, 255, 0.18) inset',
}

const selectStyle: CSSProperties = {
  appearance: 'none',
  background: '#0f172a',
  border: '1px solid rgba(124, 140, 255, 0.34)',
  borderRadius: '0.8rem',
  color: '#f7f8ff',
  fontSize: '1rem',
  fontWeight: 700,
  padding: '0.85rem 1rem',
}

const readinessActionStyle: CSSProperties = {
  background: 'rgba(15, 23, 42, 0.72)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '0.9rem',
  color: '#e2e8f0',
  display: 'grid',
  gap: '0.3rem',
  marginTop: '0.75rem',
  padding: '0.85rem',
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

export function OnboardingWizard({ initialConfig, initialIsInitialized, initialReadiness, providerOptions }: OnboardingWizardProps) {
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

  const personalProviderFallback = useMemo<ProviderOption | undefined>(
    () => providerOptions.find((provider) => provider.provider_id !== 'mock-provider'),
    [providerOptions],
  )

  function updateMode(mode: AppConfig['mode']) {
    setConfig((current) => {
      if (mode === 'demo') {
        return {
          ...current,
          mode,
          provider: {
            provider_id: 'mock-provider',
            support_level: 'certified',
            model_id: 'mock-buffett-munger-demo',
          },
        }
      }

      return {
        ...current,
        mode,
        provider: current.provider.provider_id === 'mock-provider' && personalProviderFallback !== undefined
          ? {
              provider_id: personalProviderFallback.provider_id,
              support_level: personalProviderFallback.support_level,
            }
          : current.provider,
      }
    })
  }

  const readinessMatchesSelection = readiness.provider_id === config.provider.provider_id
  const providerCanStart = readinessMatchesSelection && readiness.is_ready
  const startBlockMessage = readinessMatchesSelection
    ? `Provider cannot start yet: ${readiness.status_label}`
    : 'Checking provider readiness before workflow start.'
  const startButtonDisabled = isStarting || !providerCanStart

  async function startWorkflow() {
    if (!providerCanStart) {
      setErrorMessage(startBlockMessage)
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
      createElement('h1', { style: { fontSize: 'clamp(2.25rem, 5vw, 4.5rem)', lineHeight: 1, margin: '0.5rem 0 1rem' } }, 'Set up Owlfolio'),
      createElement('p', { style: { color: '#cbd5e1', fontSize: '1.1rem', maxWidth: '760px' } }, 'Configure a deterministic demo or a personal local workflow without editing environment files in the UI.'),
      createElement(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', margin: '1.5rem 0 2rem' } },
        createElement(StatusBadge, { tone: isInitialized ? 'success' : 'warning' }, isInitialized ? 'Initialized' : 'Not initialized yet'),
        createElement(StatusBadge, { tone: readiness.is_ready ? 'success' : 'warning' }, readiness.status_label),
        createElement(StatusBadge, null, selectedProvider.support_level),
      ),
      createElement(
        'div',
        { style: { display: 'grid', gap: '1rem' } },
        createElement(
          'section',
          { style: sectionStyle },
          createElement('p', { style: eyebrowStyle }, 'Choose mode'),
          createElement(
            'div',
            { style: cardGridStyle },
            createElement(
              'label',
              { style: config.mode === 'demo' ? selectedRadioCardStyle : radioCardBaseStyle },
              createElement('input', { checked: config.mode === 'demo', name: 'mode', onChange: () => updateMode('demo'), type: 'radio' }),
              createElement('strong', null, 'Demo mode'),
              createElement('span', null, 'Deterministic guided demo with the mock provider and a local demo ledger.'),
            ),
            createElement(
              'label',
              { style: config.mode === 'personal-local' ? selectedRadioCardStyle : radioCardBaseStyle },
              createElement('input', { checked: config.mode === 'personal-local', name: 'mode', onChange: () => updateMode('personal-local'), type: 'radio' }),
              createElement('strong', null, 'Personal local mode'),
              createElement('span', null, 'Persist local configuration and initialize a durable personal ledger without seeding demo events.'),
            ),
          ),
        ),
        createElement(
          'section',
          { style: sectionStyle },
          createElement('p', { style: eyebrowStyle }, 'Connect provider'),
          createElement(
            'label',
            { style: { color: '#cbd5e1', display: 'grid', gap: '0.5rem', maxWidth: '420px' } },
            createElement('span', null, 'Provider'),
            createElement(
              'select',
              {
                onChange: (event: Event) => {
                  const target = event.target as HTMLSelectElement
                  const nextProvider = providerOptions.find((provider) => provider.provider_id === target.value)
                  if (nextProvider === undefined) {
                    return
                  }

                  setConfig((current) => ({
                    ...current,
                    provider: providerSelectionForOption(current.provider, nextProvider),
                  }))
                },
                style: selectStyle,
                value: config.provider.provider_id,
              },
              ...providerOptions.map((provider) => createElement('option', { key: provider.provider_id, value: provider.provider_id }, provider.label)),
            ),
          ),
          createElement(
            'div',
            { style: { ...cardGridStyle, marginTop: '1rem' } },
            createElement(
              'article',
              { style: sectionStyle },
              createElement('p', { style: eyebrowStyle }, 'Readiness summary'),
              createElement('p', { style: { fontSize: '1.15rem', fontWeight: 800, margin: '0.5rem 0' } }, selectedProvider.label),
              createElement('p', { style: { color: '#cbd5e1', margin: '0.35rem 0' } }, selectedProvider.description),
              ...renderProviderSignInContract(selectedProvider, readiness),
              createElement('p', { style: { color: '#cbd5e1', margin: '0.35rem 0' } }, `Auth source: ${readiness.auth_source}`),
              createElement('p', { style: { color: '#cbd5e1', margin: '0.35rem 0' } }, `Support level: ${readiness.support_level}`),
              createElement('p', { style: { color: '#cbd5e1', margin: '0.35rem 0' } }, readiness.status_label),
              createElement(
                'div',
                { style: readinessActionStyle },
                createElement('strong', null, 'Readiness action'),
                providerCanStart
                  ? createElement('span', null, 'Action: initialize local ledger and open the Command Center.')
                  : createElement('span', null, 'Action: configure credentials or choose demo mode before starting.'),
                createElement('span', null, readinessSessionDetail(readiness)),
              ),
            ),
          ),
        ),
        createElement(
          'section',
          { style: sectionStyle },
          createElement('p', { style: eyebrowStyle }, 'Strategy'),
          createElement('p', { style: { fontSize: '1.15rem', fontWeight: 800, margin: '0.5rem 0' } }, 'Buffett-Munger certified'),
          createElement('p', { style: { color: '#cbd5e1', margin: 0 } }, 'Certified default workflow for local demo and personal research workflows.'),
        ),
        createElement(
          'section',
          { style: sectionStyle },
          createElement('p', { style: eyebrowStyle }, 'Shariah defaults'),
          createElement(
            'div',
            { style: cardGridStyle },
            createElement(
              'label',
              { style: radioCardBaseStyle },
              createElement(
                'span',
                null,
                createElement('input', {
                  checked: config.shariah.enabled,
                  onChange: (event: Event) => {
                    const enabled = (event.target as HTMLInputElement).checked
                    setConfig((current) => ({
                      ...current,
                      shariah: {
                        ...current.shariah,
                        enabled,
                      },
                    }))
                  },
                  type: 'checkbox',
                }),
                ' Enable Shariah guardrails',
              ),
              createElement('span', null, 'AAOIFI policy defaults remain on by default for both demo and personal local mode.'),
            ),
            createElement(
              'article',
              { style: radioCardBaseStyle },
              createElement('strong', null, 'AAOIFI'),
              createElement('span', null, `Allow conditional status: ${config.shariah.allow_conditional ? 'Yes' : 'No'}`),
              createElement('span', null, `Non-compliant income threshold: ${(config.shariah.non_compliant_income_threshold * 100).toFixed(0)}%`),
            ),
          ),
        ),
        createElement(
          'section',
          { style: sectionStyle },
          createElement('p', { style: eyebrowStyle }, 'Market universe'),
          createElement('p', { style: { fontSize: '1.15rem', fontWeight: 800, margin: '0.5rem 0' } }, config.market_universe.label),
          createElement('p', { style: { color: '#cbd5e1', margin: 0 } }, 'Broker credential integration stays out of the setup flow; this is a discovery-universe filter only.'),
        ),
        createElement(
          'section',
          { style: sectionStyle },
          createElement('p', { style: eyebrowStyle }, 'Initialize ledger / start workflow'),
          createElement('p', { style: { color: '#cbd5e1', marginTop: 0 } }, config.mode === 'demo' ? 'Seed the durable demo ledger and open the command center.' : 'Create a durable personal ledger and continue into the command center.'),
          providerCanStart
            ? createElement('p', { style: { color: '#6366f1', fontWeight: 700, marginTop: 0 } }, `${selectedProvider.label} is locally runnable for this workflow.`)
            : createElement(
                'div',
                { role: 'alert', style: { background: 'rgba(248, 113, 113, 0.16)', border: '1px solid rgba(248, 113, 113, 0.35)', borderRadius: '0.9rem', color: '#fecaca', display: 'grid', gap: '0.25rem', marginBottom: '0.9rem', padding: '0.9rem' } },
                createElement('strong', null, 'Provider cannot start yet'),
                createElement('span', null, startBlockMessage),
                createElement('span', null, `Auth source: ${readiness.auth_source}`),
                createElement('span', null, `Effective support: ${readiness.support_level}`),
                createElement('span', null, 'Action: configure credentials or choose demo mode before starting.'),
                readiness.auth_source === 'missing' || readiness.auth_source === 'certification report'
                  ? createElement('span', null, readinessSessionDetail(readiness))
                  : null,
              ),
          errorMessage === undefined ? null : createElement('p', { style: { color: '#fca5a5', fontWeight: 700 } }, errorMessage),
          createElement('button', {
            disabled: startButtonDisabled,
            onClick: () => void startWorkflow(),
            style: startButtonDisabled ? disabledActionButtonStyle : actionButtonStyle,
            type: 'button',
          }, isStarting ? 'Starting…' : providerCanStart ? 'Initialize Owlfolio workflow' : `Start blocked: ${selectedProvider.label} not locally runnable`),
        ),
      ),
    ),
  )
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

function readinessSessionDetail(readiness: ProviderReadiness): string {
  if (readiness.auth_source === 'missing') {
    return 'OAuth/session not signed in or credential path missing'
  }

  if (readiness.auth_source === 'certification report') {
    return 'Certification report blocked this provider session'
  }

  return `Credential/session source: ${readiness.auth_source}`
}

function renderProviderSignInContract(selectedProvider: ProviderOption, readiness: ProviderReadiness): ReactNode[] {
  const nodes: ReactNode[] = []

  if (selectedProvider.provider_family_label !== undefined) {
    nodes.push(createElement('p', { key: 'provider-family', style: { color: '#cbd5e1', margin: '0.35rem 0' } }, `Provider family: ${selectedProvider.provider_family_label}`))
  }

  if (selectedProvider.recommended_sign_in_label !== undefined || selectedProvider.recommended_sign_in_description !== undefined) {
    nodes.push(createElement(
      'section',
      { key: 'recommended-sign-in', style: readinessActionStyle },
      createElement('strong', null, 'Recommended sign-in'),
      createElement('span', null, 'One-screen flow: choose provider family → recommended sign-in → verify readiness → start workflow.'),
      selectedProvider.recommended_sign_in_label === undefined
        ? null
        : createElement('span', null, selectedProvider.recommended_sign_in_label),
      selectedProvider.recommended_sign_in_description === undefined
        ? null
        : createElement('span', null, selectedProvider.recommended_sign_in_description),
      createElement('span', null, `Next step: ${readiness.reauth_action ?? selectedProvider.simple_next_step ?? 'Verify provider readiness, then start the workflow.'}`),
    ))
  }

  const cliUseBoundary = cliUseBoundaryFor(selectedProvider, readiness)
  if (cliUseBoundary !== undefined) {
    nodes.push(createElement(
      'section',
      { key: 'cli-use-boundary', style: { ...readinessActionStyle, marginTop: '0.75rem' } },
      createElement('strong', null, cliUseBoundary.heading),
      createElement('span', null, 'Allowed use: Personal-local research drafts only'),
      createElement('span', null, 'Scheduled/headless workflows stay blocked until certification proves support.'),
      createElement('span', null, cliUseBoundary.certificationTruth),
      createElement('span', null, `Credential/session source: ${readiness.credential_source_label ?? readiness.auth_source}`),
    ))
  }

  if (selectedProvider.advanced_auth_options !== undefined && selectedProvider.advanced_auth_options.length > 0) {
    nodes.push(createElement(
      'details',
      { key: 'advanced-auth-options', style: { ...readinessActionStyle, marginTop: '0.75rem' } },
      createElement('summary', { style: { cursor: 'pointer', fontWeight: 900 } }, 'Advanced auth and certification options'),
      createElement(
        'ul',
        { style: { display: 'grid', gap: '0.5rem', margin: '0.75rem 0 0', paddingLeft: '1.2rem' } },
        ...selectedProvider.advanced_auth_options.map((option) => createElement(
          'li',
          { key: option.label },
          createElement('strong', null, option.label),
          createElement('span', null, ` — ${option.description} ${option.certification_note}`),
        )),
      ),
    ))
  }

  return nodes
}

function cliUseBoundaryFor(
  selectedProvider: ProviderOption,
  readiness: ProviderReadiness,
): { heading: string; certificationTruth: string } | undefined {
  const surfaceId = selectedProvider.provider_surface_id ?? readiness.provider_surface_id

  if (surfaceId === 'openai-codex-cli') {
    return {
      heading: 'Codex CLI use boundary',
      certificationTruth: 'Certification truth: experimental Codex CLI readiness does not certify direct OpenAI API or production automation.',
    }
  }

  if (surfaceId === 'gemini-cli') {
    return {
      heading: 'Gemini CLI use boundary',
      certificationTruth: 'Certification truth: experimental Gemini CLI readiness does not certify Gemini Developer API, Vertex, or production automation.',
    }
  }

  return undefined
}
