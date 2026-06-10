import { describe, expect, it } from 'vitest'

import { extractDiscoverySignal } from '../projections/discoveryCandidateProjection'

describe('extractDiscoverySignal', () => {
  it('returns undefined when metadata is absent', () => {
    expect(extractDiscoverySignal(undefined)).toBeUndefined()
  })

  it('returns undefined when there is no signal_type', () => {
    expect(extractDiscoverySignal({ source: 'strategy_screen' })).toBeUndefined()
  })

  it('extracts a CLUSTER_BUY signal with managers, conviction%, and resolved ticker state', () => {
    const signal = extractDiscoverySignal({
      source: '13f_clone',
      signal_type: 'CLUSTER_BUY',
      contributing_managers: ['Berkshire Hathaway', 'Pabrai Funds'],
      conviction_pct: 0.123,
      ticker_resolution: 'resolved',
      rationale: 'CLUSTER_BUY from Berkshire Hathaway, Pabrai Funds',
    })
    expect(signal?.signal_type).toBe('CLUSTER_BUY')
    expect(signal?.contributing_managers).toEqual(['Berkshire Hathaway', 'Pabrai Funds'])
    expect(signal?.conviction_pct).toBeCloseTo(0.123)
    expect(signal?.ticker_unresolved).toBe(false)
    expect(signal?.rationale).toContain('CLUSTER_BUY')
  })

  it('flags an unresolved ticker resolution', () => {
    const signal = extractDiscoverySignal({
      signal_type: 'NEW_POSITION',
      contributing_managers: ['Greenlight'],
      conviction_pct: 0.04,
      ticker_resolution: 'unresolved',
    })
    expect(signal?.ticker_unresolved).toBe(true)
  })

  it('coerces a non-standard signal_type defensively to undefined signal', () => {
    expect(extractDiscoverySignal({ signal_type: 42 })).toBeUndefined()
  })
})
