'use client'

import { createElement, useEffect, useMemo, useState, type CSSProperties } from 'react'

import type { AppConfig } from '@owlfolio/shared'

import { StatusBadge } from '../../components/StatusBadge'
import type { ProviderOption, ProviderReadiness } from '../../lib/providerReadiness'

type OnboardingWizardProps = {
  initialConfig: AppConfig
  initialIsInitialized: boolean
  initialReadiness: ProviderReadiness
  providerOptions: ProviderOption[]
}

const pageStyle: CSSProperties = {
  background: 'linear-gradient(135deg, #f8fafc 0%, #ecfdf5 100%)',
  color: '#0f172a',
  minHeight: '100vh',
  padding: '3rem clamp(1rem, 4vw, 4rem)',
}

const sectionStyle: CSSProperties = {
  background: '#ffffff',
  border: '1px solid #dbeafe',
  borderRadius: '1.25rem',
  boxShadow: '0 20px 45px rgba(15, 23, 42, 0.08)',
  padding: '1.25rem',
}

const cardGridStyle: CSSProperties = {
  display: 'grid',
  gap: '1rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
}

const radioCardBaseStyle: CSSProperties = {
  background: '#ffffff',
  border: '1px solid #cbd5e1',
  borderRadius: '1rem',
  cursor: 'pointer',
  display: 'grid',
  gap: '0.5rem',
  padding: '1rem',
}

const actionButtonStyle: CSSProperties = {
  background: '#047857',
  border: 0,
  borderRadius: '999px',
  color: '#ffffff',
  cursor: 'pointer',
  fontSize: '0.95rem',
  fontWeight: 800,
  padding: '0.8rem 1.1rem',
}

const eyebrowStyle: CSSProperties = {
  color: '#047857',
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

  async function startWorkflow() {
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
    { style: pageStyle },
    createElement(
      'section',
      { style: { margin: '0 auto', maxWidth: '1040px' } },
      createElement('p', { style: { color: '#047857', fontWeight: 800, letterSpacing: '0.08em', margin: 0, textTransform: 'uppercase' } }, 'Owlfolio'),
      createElement('h1', { style: { fontSize: 'clamp(2.25rem, 5vw, 4.5rem)', lineHeight: 1, margin: '0.5rem 0 1rem' } }, 'Set up Owlfolio'),
      createElement('p', { style: { color: '#475569', fontSize: '1.1rem', maxWidth: '760px' } }, 'Configure a deterministic demo or a personal local workflow without editing environment files in the UI.'),
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
              { style: { ...radioCardBaseStyle, borderColor: config.mode === 'demo' ? '#047857' : '#cbd5e1' } },
              createElement('input', { checked: config.mode === 'demo', name: 'mode', onChange: () => updateMode('demo'), type: 'radio' }),
              createElement('strong', null, 'Demo mode'),
              createElement('span', null, 'Deterministic vertical slice with the mock provider and durable demo ledger.'),
            ),
            createElement(
              'label',
              { style: { ...radioCardBaseStyle, borderColor: config.mode === 'personal-local' ? '#047857' : '#cbd5e1' } },
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
            { style: { color: '#334155', display: 'grid', gap: '0.5rem', maxWidth: '420px' } },
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
                    provider: {
                      ...current.provider,
                      provider_id: nextProvider.provider_id,
                      support_level: nextProvider.support_level,
                    },
                  }))
                },
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
              createElement('p', { style: { color: '#334155', margin: '0.35rem 0' } }, selectedProvider.description),
              createElement('p', { style: { color: '#334155', margin: '0.35rem 0' } }, `Auth source: ${readiness.auth_source}`),
              createElement('p', { style: { color: '#334155', margin: '0.35rem 0' } }, `Support level: ${readiness.support_level}`),
              createElement('p', { style: { color: '#334155', margin: '0.35rem 0' } }, readiness.status_label),
            ),
          ),
        ),
        createElement(
          'section',
          { style: sectionStyle },
          createElement('p', { style: eyebrowStyle }, 'Strategy'),
          createElement('p', { style: { fontSize: '1.15rem', fontWeight: 800, margin: '0.5rem 0' } }, 'Buffett-Munger certified'),
          createElement('p', { style: { color: '#334155', margin: 0 } }, 'Certified default workflow for the current Owlfolio v0.2 slice.'),
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
          createElement('p', { style: { color: '#334155', margin: 0 } }, 'Broker credential integration stays out of the setup flow; this is a discovery-universe filter only.'),
        ),
        createElement(
          'section',
          { style: sectionStyle },
          createElement('p', { style: eyebrowStyle }, 'Initialize ledger / start workflow'),
          createElement('p', { style: { color: '#334155', marginTop: 0 } }, config.mode === 'demo' ? 'Seed the durable demo ledger and open the command center.' : 'Create a durable personal ledger and continue into the command center.'),
          errorMessage === undefined ? null : createElement('p', { style: { color: '#b91c1c', fontWeight: 700 } }, errorMessage),
          createElement('button', { disabled: isStarting, onClick: () => void startWorkflow(), style: actionButtonStyle, type: 'button' }, isStarting ? 'Starting…' : 'Start workflow'),
        ),
      ),
    ),
  )
}
