import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ZAKAT_RATE,
  DEFAULT_ZAKAT_BASE_METHOD,
  computeZakat,
  projectZakatStatement,
} from '../projections/zakatModule'
import type { LedgerEventEnvelope } from '../eventEnvelope'

describe('computeZakat', () => {
  it('defaults to 2.5% on (market value of holdings + cash)', () => {
    expect(DEFAULT_ZAKAT_RATE).toBe(0.025)
    expect(DEFAULT_ZAKAT_BASE_METHOD).toBe('market_value_holdings_plus_cash')
    const result = computeZakat({
      holdings_market_value: 80_000,
      cash: 20_000,
    })
    expect(result.base_method).toBe('market_value_holdings_plus_cash')
    expect(result.zakatable_base).toBe(100_000)
    expect(result.rate).toBe(0.025)
    expect(result.zakat_due).toBe(2_500)
  })

  it('supports an alternative net_current_assets base method', () => {
    const result = computeZakat({
      holdings_market_value: 80_000,
      cash: 20_000,
      net_current_assets: 40_000,
      base_method: 'net_current_assets',
    })
    expect(result.base_method).toBe('net_current_assets')
    expect(result.zakatable_base).toBe(40_000)
    expect(result.zakat_due).toBe(1_000)
  })

  it('honours a user-set rate override', () => {
    const result = computeZakat({
      holdings_market_value: 100_000,
      cash: 0,
      rate: 0.025771, // lunar-vs-solar adjustment, user-authored
    })
    expect(result.rate).toBe(0.025771)
    expect(result.zakat_due).toBe(2577.1)
  })

  it('never returns a negative base or due (clamps to zero)', () => {
    const result = computeZakat({
      holdings_market_value: 0,
      cash: 0,
      net_current_assets: -500,
      base_method: 'net_current_assets',
    })
    expect(result.zakatable_base).toBe(0)
    expect(result.zakat_due).toBe(0)
  })
})

describe('projectZakatStatement', () => {
  const valuationEvent = (
    holding_id: string,
    market_value: number,
    valued_at: string,
  ): LedgerEventEnvelope<Record<string, unknown>> => ({
    event_id: `evt_val_${holding_id}_${valued_at}`,
    event_type: 'holding_valuation_recorded',
    aggregate_type: 'holding',
    aggregate_id: holding_id,
    actor_type: 'worker',
    payload: {
      snapshot_id: `snap_${holding_id}`,
      holding_id,
      market_value,
      shares: 10,
      price_per_share: market_value / 10,
      currency: 'USD',
      valued_at,
    },
    source_ids: [],
    created_at: `${valued_at}T00:00:00.000Z`,
    schema_version: 1,
  })

  const openEvent = (holding_id: string): LedgerEventEnvelope<Record<string, unknown>> => ({
    event_id: `evt_open_${holding_id}`,
    event_type: 'holding_opened',
    aggregate_type: 'holding',
    aggregate_id: holding_id,
    actor_type: 'user',
    payload: {
      holding_id,
      watchlist_item_id: `wl_${holding_id}`,
      research_case_id: `rc_${holding_id}`,
      opened_at: '2025-01-01',
      shares: 10,
      cost_basis_per_share: 10,
      currency: 'USD',
    },
    source_ids: [],
    created_at: '2025-01-01T00:00:00.000Z',
    schema_version: 1,
  })

  const cashDeposit = (amount: number, at: string): LedgerEventEnvelope<Record<string, unknown>> => ({
    event_id: `evt_cash_${at}`,
    event_type: 'cash_deposited',
    aggregate_type: 'cash_account',
    aggregate_id: 'cash_main',
    actor_type: 'user',
    payload: { cash_account_id: 'cash_main', amount, currency: 'USD', deposited_at: at },
    source_ids: [],
    created_at: `${at}T00:00:00.000Z`,
    schema_version: 1,
  })

  it('computes the zakat statement at the hawl date from holdings market value + cash', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      openEvent('h1'),
      valuationEvent('h1', 80_000, '2026-05-30'),
      cashDeposit(20_000, '2026-01-15'),
    ]

    const statement = projectZakatStatement(events, {
      hawl_date: '2026-06-01',
      currency: 'USD',
    })

    expect(statement.hawl_date).toBe('2026-06-01')
    expect(statement.base_method).toBe('market_value_holdings_plus_cash')
    expect(statement.holdings_market_value).toBe(80_000)
    expect(statement.cash).toBe(20_000)
    expect(statement.zakatable_base).toBe(100_000)
    expect(statement.zakat_due).toBe(2_500)
    expect(statement.is_observation).toBe(true)
    // Read-only projection — no auto-payment.
    expect(Object.keys(statement)).not.toContain('events')
  })

  it('respects a user-authored rate + base-method setting', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      openEvent('h1'),
      valuationEvent('h1', 50_000, '2026-05-30'),
      cashDeposit(10_000, '2026-01-15'),
    ]
    const statement = projectZakatStatement(events, {
      hawl_date: '2026-06-01',
      currency: 'USD',
      base_method: 'net_current_assets',
      net_current_assets: 12_000,
      rate: 0.03,
    })
    expect(statement.base_method).toBe('net_current_assets')
    expect(statement.zakatable_base).toBe(12_000)
    expect(statement.rate).toBe(0.03)
    expect(statement.zakat_due).toBe(360)
  })
})
