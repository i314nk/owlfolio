'use client'

import { createElement, useState, type CSSProperties } from 'react'

/**
 * The deliberate "Run backtest" action on /calibration. POSTs to /api/calibration/start, which records a
 * `calibration_run_requested` ledger event and spawns the worker (202). The backtest itself is
 * deterministic + observation-only and runs in the worker (EDGAR + 10yr prices are network-bound). The
 * page renders the recorded run on the next refresh — this button never runs the backtest synchronously.
 */
export function RunCalibrationButton() {
  const [state, setState] = useState<'idle' | 'running' | 'queued' | 'error'>('idle')
  const [error, setError] = useState<string | undefined>()

  async function run() {
    setState('running')
    setError(undefined)
    try {
      const response = await fetch('/api/calibration/start', { method: 'POST' })
      const body = await response.json()
      if (!response.ok) {
        setState('error')
        setError(typeof body.error === 'string' ? body.error : 'Unable to enqueue calibration run')
        return
      }
      setState('queued')
    } catch (caughtError) {
      setState('error')
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to enqueue calibration run')
    }
  }

  const buttonStyle: CSSProperties = {
    background: 'var(--owl-color-gold)',
    color: '#1a1205',
    border: 'none',
    borderRadius: '0.7rem',
    padding: '0.6rem 1.1rem',
    fontWeight: 700,
    fontSize: 'var(--owl-text-sm)',
    cursor: state === 'running' ? 'wait' : 'pointer',
    opacity: state === 'running' ? 0.7 : 1,
  }

  return createElement(
    'div',
    { style: { display: 'grid', gap: '0.5rem', justifyItems: 'start' } },
    createElement(
      'button',
      { type: 'button', className: 'owl-focusable', onClick: run, disabled: state === 'running', style: buttonStyle },
      state === 'running' ? 'Enqueuing...' : 'Run backtest',
    ),
    state === 'queued'
      ? createElement(
          'p',
          { style: { color: 'var(--owl-color-emerald, #34d399)', fontSize: 'var(--owl-text-sm)', margin: 0 } },
          'Backtest enqueued. The worker runs it (deterministic, observation-only); refresh to see the recorded run + coverage.',
        )
      : null,
    state === 'error' && error !== undefined
      ? createElement('p', { style: { color: 'var(--owl-color-danger, #f87171)', fontSize: 'var(--owl-text-sm)', margin: 0 } }, error)
      : null,
  )
}
