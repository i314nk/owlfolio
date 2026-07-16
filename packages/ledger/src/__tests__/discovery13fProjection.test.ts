import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectDiscovery13f } from '../projections/discovery13fProjection'
import { projectMonitorAlerts } from '../projections/monitorAlertProjection'

// S2 of the 13F page (owner-approved 2026-07-16): the read model behind the manager cards and the
// SELLS board, plus the held/watched cross-reference alert — an OBSERVATION pointing at the user's
// own thesis review, never a sell instruction.

let seq = 0
function evt(over: Partial<LedgerEventEnvelope<Record<string, unknown>>>): LedgerEventEnvelope<unknown> {
  seq += 1
  return {
    event_id: `e13f_${seq}`,
    event_type: 'discovery_13f_quarter_recorded',
    aggregate_type: 'discovery_quarter',
    aggregate_id: 'q13f_0001067983_2026Q1',
    actor_type: 'worker',
    actor_id: 'worker_discovery_13f',
    payload: {},
    source_ids: [],
    created_at: `2026-07-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
    schema_version: 1,
    ...over,
  } as LedgerEventEnvelope<unknown>
}

function quarterEvent(over: Record<string, unknown>): LedgerEventEnvelope<unknown> {
  return evt({
    payload: {
      manager_name: 'Berkshire Hathaway',
      cik: '0001067983',
      period: '2026Q1',
      report_date: '2026-03-31',
      filed_date: '2026-05-14',
      total_value: 300_000_000_000,
      position_count: 40,
      top_holdings: [
        { cusip: '037833100', issuer: 'APPLE INC', ticker: 'AAPL', value: 60_000_000_000, shares: 300_000_000, pct: 0.2, change: 'UNCHANGED' },
      ],
      sells: [],
      is_observation: true,
      ...over,
    },
  })
}

describe('projectDiscovery13f — manager quarters', () => {
  it('returns empty boards with no events', () => {
    expect(projectDiscovery13f([])).toEqual({ quarters: [], sells: [] })
  })

  it('keeps the LATEST period per manager and sorts managers by total value', () => {
    const projection = projectDiscovery13f([
      quarterEvent({ period: '2025Q4', total_value: 280_000_000_000 }),
      quarterEvent({ period: '2026Q1', total_value: 300_000_000_000 }),
      quarterEvent({ manager_name: 'Himalaya Capital', cik: '0001709323', period: '2026Q1', total_value: 3_000_000_000 }),
    ])
    expect(projection.quarters.map((q) => [q.manager_name, q.period])).toEqual([
      ['Berkshire Hathaway', '2026Q1'],
      ['Himalaya Capital', '2026Q1'],
    ])
    expect(projection.quarters[0]?.report_date).toBe('2026-03-31')
    expect(projection.quarters[0]?.filed_date).toBe('2026-05-14')
    expect(projection.quarters[0]?.top_holdings[0]?.ticker).toBe('AAPL')
  })

  it('a re-harvest of the same period (later event) wins the tie', () => {
    const projection = projectDiscovery13f([
      quarterEvent({ position_count: 39 }),
      quarterEvent({ position_count: 40 }),
    ])
    expect(projection.quarters).toHaveLength(1)
    expect(projection.quarters[0]?.position_count).toBe(40)
  })

  it('tolerates malformed holdings/sells entries without dropping the quarter', () => {
    const projection = projectDiscovery13f([
      quarterEvent({
        top_holdings: [null, { issuer: 'NO CUSIP' }, { cusip: '037833100', issuer: 'APPLE INC', value: 1, shares: 1, pct: 0.1, change: 'BOGUS' }],
        sells: [null, { cusip: 'x', issuer: 'y', manager_name: 'z', signal_type: 'NOT_A_SIGNAL' }],
      }),
    ])
    expect(projection.quarters[0]?.top_holdings).toEqual([
      { cusip: '037833100', issuer: 'APPLE INC', value: 1, shares: 1, pct: 0.1, change: 'UNCHANGED' },
    ])
    expect(projection.quarters[0]?.sells).toEqual([])
  })
})

describe('projectDiscovery13f — buys + the roster allowlist (heat-map, 2026-07-16)', () => {
  it('folds v2 per-manager buys; legacy v1 snapshots project buys: []', () => {
    const projection = projectDiscovery13f([
      quarterEvent({
        buys: [
          { cusip: '22160K105', issuer: 'COSTCO WHOLESALE CORP', ticker: 'COST', signal_type: 'NEW_POSITION', conviction_pct: 0.04 },
          { cusip: 'bad', issuer: 'X', signal_type: 'NOT_A_SIGNAL' },
        ],
      }),
      quarterEvent({ manager_name: 'Himalaya Capital', cik: '0001709323' }),  // v1-shaped: no buys key
    ])
    expect(projection.quarters.find((q) => q.cik === '0001067983')?.buys).toEqual([
      { cusip: '22160K105', issuer: 'COSTCO WHOLESALE CORP', ticker: 'COST', signal_type: 'NEW_POSITION', conviction_pct: 0.04 },
    ])
    expect(projection.quarters.find((q) => q.cik === '0001709323')?.buys).toEqual([])
  })

  it('the ciks allowlist drops removed-roster managers from the active view (audit events untouched)', () => {
    const sell = { manager_name: 'Akre Capital', cusip: '02079K305', issuer: 'ALPHABET INC', ticker: 'GOOGL', signal_type: 'EXIT', prior_shares: 1, current_shares: 0, prior_conviction_pct: 0.02 }
    const events = [
      quarterEvent({}),
      quarterEvent({ manager_name: 'Akre Capital', cik: '0001112520', sells: [sell] }),
    ]
    const filtered = projectDiscovery13f(events, { ciks: ['0001067983'] })
    expect(filtered.quarters.map((q) => q.cik)).toEqual(['0001067983'])
    expect(filtered.sells).toEqual([])
    // Unfiltered still projects everything — history stays reachable.
    expect(projectDiscovery13f(events).quarters).toHaveLength(2)
  })
})

describe('projectDiscovery13f — the aggregated SELLS board', () => {
  const berkshireSell = {
    manager_name: 'Berkshire Hathaway', cusip: '22160K105', issuer: 'COSTCO WHOLESALE CORP', ticker: 'COST',
    signal_type: 'MEANINGFUL_TRIM', prior_shares: 1_000_000, current_shares: 500_000, prior_conviction_pct: 0.03,
  }
  const himalayaSell = {
    manager_name: 'Himalaya Capital', cusip: '22160K105', issuer: 'COSTCO WHOLESALE CORP', ticker: 'COST',
    signal_type: 'EXIT', prior_shares: 200_000, current_shares: 0, prior_conviction_pct: 0.1,
  }

  it('groups sells per name across managers; EXIT outranks TRIM; manager count ranks first', () => {
    const projection = projectDiscovery13f([
      quarterEvent({ sells: [berkshireSell, { ...berkshireSell, cusip: '02079K305', issuer: 'ALPHABET INC', ticker: 'GOOGL', signal_type: 'EXIT' }] }),
      quarterEvent({ manager_name: 'Himalaya Capital', cik: '0001709323', total_value: 3_000_000_000, sells: [himalayaSell] }),
    ])
    expect(projection.sells[0]).toMatchObject({
      key: 'COST',
      ticker: 'COST',
      signal_type: 'EXIT',
      managers: ['Berkshire Hathaway', 'Himalaya Capital'],
      period: '2026Q1',
    })
    expect(projection.sells[1]).toMatchObject({ key: 'GOOGL', signal_type: 'EXIT', managers: ['Berkshire Hathaway'] })
  })

  it('an unresolved ticker falls back to the cusip as the dedupe key — never guessed', () => {
    const { ticker: _t, ...noTicker } = berkshireSell
    const projection = projectDiscovery13f([quarterEvent({ sells: [noTicker] })])
    expect(projection.sells[0]?.key).toBe('22160K105')
    expect(projection.sells[0]?.ticker).toBeUndefined()
  })

  it('only each manager LATEST quarter contributes sells', () => {
    const projection = projectDiscovery13f([
      quarterEvent({ period: '2025Q4', sells: [berkshireSell] }),
      quarterEvent({ period: '2026Q1', sells: [] }),
    ])
    expect(projection.sells).toEqual([])
  })
})

describe('projectMonitorAlerts — the superinvestor held/watched cross-reference', () => {
  const holdingOpened = evt({
    event_type: 'holding_opened',
    aggregate_type: 'holding',
    aggregate_id: 'holding_cost_001',
    actor_type: 'user',
    payload: { holding_id: 'holding_cost_001', watchlist_item_id: 'watch_cost_001', research_case_id: 'rc_cost', ticker: 'COST', strategy_id: 'buffett-munger', shares: 3, cost_basis_per_share: 800, total_cost_basis: 2400, currency: 'USD', opened_at: '2026-05-31' },
  })
  const watchDrafted = evt({
    event_type: 'watchlist_draft_created',
    aggregate_type: 'watchlist_item',
    aggregate_id: 'watch_spgi_001',
    actor_type: 'user',
    payload: { watchlist_item_id: 'watch_spgi_001', research_case_id: 'rc_spgi', company_id: 'company_spgi', ticker: 'SPGI', strategy_id: 'buffett-munger', thesis_summary: 'Watch SPGI.', user_approved: true, created_by_actor_type: 'user', created_by_actor_id: 'user_local' },
  })
  const sells = [
    { manager_name: 'Himalaya Capital', cusip: '22160K105', issuer: 'COSTCO WHOLESALE CORP', ticker: 'COST', signal_type: 'EXIT', prior_shares: 200_000, current_shares: 0, prior_conviction_pct: 0.1 },
    { manager_name: 'Himalaya Capital', cusip: '78409V104', issuer: 'S&P GLOBAL INC', ticker: 'SPGI', signal_type: 'MEANINGFUL_TRIM', prior_shares: 100_000, current_shares: 60_000, prior_conviction_pct: 0.05 },
    { manager_name: 'Himalaya Capital', cusip: '02079K305', issuer: 'ALPHABET INC', ticker: 'GOOGL', signal_type: 'EXIT', prior_shares: 50_000, current_shares: 0, prior_conviction_pct: 0.04 },
  ]
  const quarterWithSells = quarterEvent({ manager_name: 'Himalaya Capital', cik: '0001709323', sells })

  it('raises one attention observation per HELD or WATCHED ticker a tracked manager sold — and none for unheld names', () => {
    const alerts = projectMonitorAlerts([holdingOpened, watchDrafted, quarterWithSells])
    const exits = alerts.filter((a) => a.kind === 'superinvestor_exit')
    expect(exits.map((a) => a.subject.ticker).sort()).toEqual(['COST', 'SPGI'])
    const cost = exits.find((a) => a.subject.ticker === 'COST')
    expect(cost?.severity).toBe('attention')
    expect(cost?.is_observation).toBe(true)
    expect(cost?.is_draft).toBe(false)
    expect(cost?.headline).toContain('Himalaya Capital')
    expect(cost?.headline).toContain('exited')
    expect(cost?.headline).toContain('2026Q1')
    expect(cost?.detail).toContain('never a sell instruction')
    expect(cost?.human_action.href).toBe('/discovery')
    const spgi = exits.find((a) => a.subject.ticker === 'SPGI')
    expect(spgi?.headline).toContain('meaningfully trimmed')
  })

  it('is idempotent per manager-quarter: a re-harvest never duplicates the alert', () => {
    const alerts = projectMonitorAlerts([holdingOpened, quarterWithSells, quarterEvent({ manager_name: 'Himalaya Capital', cik: '0001709323', sells })])
    expect(alerts.filter((a) => a.kind === 'superinvestor_exit')).toHaveLength(1)
  })

  it('raises nothing when the name is neither held nor watched, or the ticker is unresolved', () => {
    const { ticker: _t, ...unresolved } = sells[0]!
    const alerts = projectMonitorAlerts([quarterEvent({ sells: [sells[2], unresolved] })])
    expect(alerts.filter((a) => a.kind === 'superinvestor_exit')).toEqual([])
  })

  it('a closed holding or pruned watchlist item no longer cross-references', () => {
    const closed = evt({
      event_type: 'holding_closed',
      aggregate_type: 'holding',
      aggregate_id: 'holding_cost_001',
      actor_type: 'user',
      payload: { holding_id: 'holding_cost_001', ticker: 'COST', reason: 'valuation_inverted' },
    })
    const alerts = projectMonitorAlerts([holdingOpened, closed, quarterWithSells])
    expect(alerts.filter((a) => a.kind === 'superinvestor_exit')).toEqual([])
  })
})
