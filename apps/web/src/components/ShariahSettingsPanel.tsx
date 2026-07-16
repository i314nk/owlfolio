'use client'

import { createElement, useState, type CSSProperties, type ReactNode } from 'react'

// createElement (no JSX) — repo convention for components imported under vitest (jsx: preserve).

const trackBase: CSSProperties = {
  alignItems: 'center',
  background: 'rgba(148, 163, 184, 0.25)',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  borderRadius: '999px',
  cursor: 'pointer',
  display: 'inline-flex',
  height: '1.4rem',
  padding: '0.12rem',
  transition: 'background 120ms ease',
  width: '2.6rem',
}
const trackOn: CSSProperties = { ...trackBase, background: 'rgba(52, 211, 153, 0.55)', border: '1px solid rgba(52, 211, 153, 0.6)' }
const thumbBase: CSSProperties = { background: 'var(--owl-color-bright)', borderRadius: '999px', display: 'block', height: '1.05rem', transition: 'transform 120ms ease', width: '1.05rem' }
const thumbOn: CSSProperties = { ...thumbBase, transform: 'translateX(1.15rem)' }

/**
 * The Shariah screening on/off toggle (owner-approved 2026-07-15). OFF is an opt-out, not a
 * repositioning: the default stays ON, and OFF is fail-visible everywhere downstream — transition
 * gates record DISABLED decisions (never a fake APPROVED), boards show a neutral GATE OFF chip,
 * the Shariah lanes stop spending provider quota, the quarterly re-screen task disables, and the
 * purification-rate surfaces hide. Names admitted while OFF stay labeled that way in the ledger.
 */
export function ShariahSettingsPanel({ initialEnabled }: { initialEnabled: boolean }): ReactNode {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saved, setSaved] = useState(initialEnabled)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | undefined>(undefined)

  async function save(): Promise<void> {
    setState('saving')
    setError(undefined)
    try {
      const doFetch = fetch.bind(globalThis)
      const response = await doFetch('/api/settings/shariah', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${response.status}`)
      }
      setSaved(enabled)
      setState('saved')
    } catch (caught) {
      setState('error')
      setError(caught instanceof Error ? caught.message : 'Unable to save')
    }
  }

  const dirty = enabled !== saved

  return createElement(
    'section',
    { 'aria-label': 'Shariah screening settings', className: 'owl-section-card', style: { gap: 'var(--owl-space-3)' } },
    createElement('p', { className: 'owl-section-accent' }, 'Shariah screening'),
    createElement(
      'div',
      { style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '0.8rem' } },
      createElement(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': enabled,
          'data-testid': 'shariah-toggle',
          onClick: () => { setState('idle'); setEnabled(!enabled) },
          style: enabled ? trackOn : trackBase,
          title: enabled ? 'Screening ON — click to turn off' : 'Screening OFF — click to turn on',
        },
        createElement('span', { style: enabled ? thumbOn : thumbBase }),
      ),
      createElement('span', { style: { color: 'var(--owl-color-text)', fontWeight: 700 } }, enabled ? 'Screening is ON (the default)' : 'Screening is OFF'),
      dirty
        ? createElement(
            'button',
            { type: 'button', className: 'owl-button owl-button-primary owl-focusable', disabled: state === 'saving', onClick: () => void save(), 'data-testid': 'shariah-save' },
            state === 'saving' ? 'Saving…' : 'Save',
          )
        : null,
      state === 'saved' && !dirty ? createElement('span', { style: { color: 'var(--owl-color-positive)', fontSize: 'var(--owl-text-sm)' } }, 'Saved') : null,
      state === 'error' ? createElement('span', { style: { color: 'var(--owl-color-risk-bright)', fontSize: 'var(--owl-text-sm)' } }, error ?? 'Unable to save') : null,
    ),
    createElement(
      'p',
      { className: 'owl-row-helper', style: { margin: 0, maxWidth: '46rem' } },
      'ON (the default): every admission and holding-open passes the grounded Shariah gate, the analysis runs the Shariah lanes, the quarterly re-screen monitors held names, and CONDITIONAL names carry their purification rate. '
      + 'OFF: no screening runs and no Shariah provider spend happens — gates record an explicit DISABLED decision (never a fake pass), boards show a neutral GATE OFF chip, and purification guidance is hidden. '
      + 'Names admitted while OFF are permanently labeled that way in the ledger; turning screening back ON gates the next analysis or re-screen normally, and never retroactively blesses an unscreened admission.',
    ),
  )
}
