'use client'

import { createElement, useState, type ChangeEvent, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'

import type { ModelSwitcher } from '../lib/resolveModelSwitcher'

/**
 * The interactive form of the app-wide workspace indicator: a grouped model `<select>` (one optgroup per
 * connected provider) that switches the actively-used provider+model from anywhere in the app. Shown only
 * when `resolveModelSwitcher` returns ≥2 connected models. Persists via the same PUT /api/onboarding/config
 * write the guided picker uses, then `router.refresh()` re-renders every server surface with the new active
 * selection. DISPLAY + SWITCH only — no init, no mode change, no mutation of anything but the active model.
 */

export type ActiveModelSwitcherProps = {
  switcher: ModelSwitcher
}

const ENCODE_SEP = '::'

function encode(providerId: string, modelId: string): string {
  return `${providerId}${ENCODE_SEP}${modelId}`
}

const selectStyle: CSSProperties = {
  appearance: 'none',
  background: 'var(--owl-color-panel-deep)',
  border: '1px solid var(--owl-color-border-strong)',
  borderRadius: '0.5rem',
  color: 'var(--owl-color-gold-bright)',
  cursor: 'pointer',
  fontFamily: 'var(--owl-font-mono)',
  fontSize: 'var(--owl-text-xs)',
  fontWeight: 700,
  maxWidth: '16rem',
  padding: '0.2rem 0.5rem',
}

export function ActiveModelSwitcher({ switcher }: ActiveModelSwitcherProps) {
  const router = useRouter()
  const [value, setValue] = useState(encode(switcher.active_provider_id, switcher.active_model_id))
  const [isBusy, setIsBusy] = useState(false)

  async function onChange(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value
    setValue(next)
    const separatorIndex = next.indexOf(ENCODE_SEP)
    if (separatorIndex === -1) {
      return
    }
    const providerId = next.slice(0, separatorIndex)
    const modelId = next.slice(separatorIndex + ENCODE_SEP.length)
    const provider = switcher.providers.find((candidate) => candidate.provider_id === providerId)
    if (provider === undefined) {
      return
    }

    setIsBusy(true)
    try {
      const response = await fetch('/api/onboarding/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: { provider_id: providerId, support_level: provider.support_level, model_id: modelId },
        }),
      })
      if (response.ok) {
        // Re-render every server component (nav indicator, providers page, run surfaces) with the new active model.
        router.refresh()
      }
    } finally {
      setIsBusy(false)
    }
  }

  return createElement(
    'label',
    { className: 'owl-active-mode owl-active-mode-ready', 'aria-label': 'Active model switcher' },
    createElement('span', { className: 'owl-active-mode-kicker' }, 'Workspace'),
    createElement(
      'select',
      {
        'aria-label': 'Active provider and model',
        className: 'owl-focusable',
        disabled: isBusy,
        onChange,
        style: selectStyle,
        value,
      },
      ...switcher.providers.map((provider) =>
        createElement(
          'optgroup',
          { key: provider.provider_id, label: provider.label },
          ...provider.models.map((model) =>
            createElement('option', { key: model.model_id, value: encode(provider.provider_id, model.model_id) }, model.model_id),
          ),
        ),
      ),
    ),
  )
}
