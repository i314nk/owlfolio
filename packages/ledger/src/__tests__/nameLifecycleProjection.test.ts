import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import {
  projectNameLifecycle,
  type NameLifecycleProjection,
} from '../projections/nameLifecycleProjection'

function evt(overrides: Partial<LedgerEventEnvelope<unknown>> & {
  event_type: string
  aggregate_type: LedgerEventEnvelope<unknown>['aggregate_type']
  aggregate_id: string
  payload: unknown
  created_at: string
}): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_${overrides.event_type}_${overrides.aggregate_id}`,
    actor_type: 'system',
    source_ids: [],
    schema_version: 1,
    ...overrides,
  }
}

function byTicker(rows: NameLifecycleProjection[], ticker: string): NameLifecycleProjection {
  const row = rows.find((r) => r.ticker === ticker)
  if (row === undefined) {
    throw new Error(`expected a row for ${ticker}`)
  }
  return row
}

describe('projectNameLifecycle — derived states', () => {
  it('derives one row per ticker in each of candidate / watched / held / exited states', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      // CANDIDATE: a research case in a pre-watchlist stage.
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_cand_001',
        payload: { ticker: 'CAND', company_id: 'company_cand' },
        created_at: '2026-06-01T00:00:00.000Z',
      }),

      // WATCHED: research case -> watchlist draft created -> confirmed (user-approved), no holding.
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_watch_001',
        payload: { ticker: 'WTCH', company_id: 'company_wtch' },
        created_at: '2026-06-01T00:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_created',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_wtch_001',
        payload: { watchlist_item_id: 'watch_wtch_001', research_case_id: 'rc_watch_001', ticker: 'WTCH' },
        created_at: '2026-06-01T01:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_confirmed',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_wtch_001',
        payload: { watchlist_item_id: 'watch_wtch_001', research_case_id: 'rc_watch_001' },
        created_at: '2026-06-01T02:00:00.000Z',
      }),

      // HELD: full chain through holding_opened, no holding_closed.
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_held_001',
        payload: { ticker: 'HELD', company_id: 'company_held' },
        created_at: '2026-06-01T00:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_created',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_held_001',
        payload: { watchlist_item_id: 'watch_held_001', research_case_id: 'rc_held_001', ticker: 'HELD' },
        created_at: '2026-06-01T01:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_confirmed',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_held_001',
        payload: { watchlist_item_id: 'watch_held_001', research_case_id: 'rc_held_001' },
        created_at: '2026-06-01T02:00:00.000Z',
      }),
      evt({
        event_type: 'holding_opened',
        aggregate_type: 'holding',
        aggregate_id: 'holding_held_001',
        payload: {
          holding_id: 'holding_held_001',
          watchlist_item_id: 'watch_held_001',
          research_case_id: 'rc_held_001',
          ticker: 'HELD',
          shares: 10,
          cost_basis_per_share: 100,
        },
        created_at: '2026-06-01T03:00:00.000Z',
      }),

      // EXITED via sale: a holding that was later closed.
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_sold_001',
        payload: { ticker: 'SOLD', company_id: 'company_sold' },
        created_at: '2026-06-01T00:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_created',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_sold_001',
        payload: { watchlist_item_id: 'watch_sold_001', research_case_id: 'rc_sold_001', ticker: 'SOLD' },
        created_at: '2026-06-01T01:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_confirmed',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_sold_001',
        payload: { watchlist_item_id: 'watch_sold_001', research_case_id: 'rc_sold_001' },
        created_at: '2026-06-01T02:00:00.000Z',
      }),
      evt({
        event_type: 'holding_opened',
        aggregate_type: 'holding',
        aggregate_id: 'holding_sold_001',
        payload: {
          holding_id: 'holding_sold_001',
          watchlist_item_id: 'watch_sold_001',
          research_case_id: 'rc_sold_001',
          ticker: 'SOLD',
          shares: 5,
          cost_basis_per_share: 50,
        },
        created_at: '2026-06-01T03:00:00.000Z',
      }),
      evt({
        event_type: 'holding_closed',
        aggregate_type: 'holding',
        aggregate_id: 'holding_sold_001',
        payload: { holding_id: 'holding_sold_001', closed_at: '2026-06-02' },
        created_at: '2026-06-02T00:00:00.000Z',
      }),
    ]

    const rows = projectNameLifecycle(events)

    expect(byTicker(rows, 'CAND').state).toBe('candidate')
    expect(byTicker(rows, 'WTCH').state).toBe('watched')
    expect(byTicker(rows, 'HELD').state).toBe('held')
    expect(byTicker(rows, 'SOLD').state).toBe('exited')
    expect(byTicker(rows, 'SOLD').exit_provenance).toBe('sold')

    // One row per ticker.
    expect(rows.filter((r) => r.ticker === 'HELD')).toHaveLength(1)
  })

  it('projects opened_at onto a held row from the holding_opened event (Phase 6 minimum-hold clock)', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_clock_001',
        payload: { ticker: 'CLOCK', company_id: 'company_clock' },
        created_at: '2026-06-01T00:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_created',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_clock_001',
        payload: { watchlist_item_id: 'watch_clock_001', research_case_id: 'rc_clock_001', ticker: 'CLOCK' },
        created_at: '2026-06-01T01:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_confirmed',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_clock_001',
        payload: { watchlist_item_id: 'watch_clock_001', research_case_id: 'rc_clock_001' },
        created_at: '2026-06-01T02:00:00.000Z',
      }),
      evt({
        event_type: 'holding_opened',
        aggregate_type: 'holding',
        aggregate_id: 'holding_clock_001',
        payload: {
          holding_id: 'holding_clock_001',
          watchlist_item_id: 'watch_clock_001',
          research_case_id: 'rc_clock_001',
          ticker: 'CLOCK',
          shares: 10,
          cost_basis_per_share: 100,
          opened_at: '2024-01-15',
        },
        created_at: '2024-01-15T03:00:00.000Z',
      }),
    ]

    const rows = projectNameLifecycle(events)
    const held = byTicker(rows, 'CLOCK')
    expect(held.state).toBe('held')
    expect(held.opened_at).toBe('2024-01-15')
  })

  it('marks a screened-out research case (rejected / pass) as exited with screened_out provenance', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_rej_001',
        payload: { ticker: 'REJX', company_id: 'company_rejx' },
        created_at: '2026-06-01T00:00:00.000Z',
      }),
      evt({
        event_type: 'quick_screen_drafted',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_rej_001',
        payload: { research_case_id: 'rc_rej_001', ticker: 'REJX', screening_result: 'reject' },
        created_at: '2026-06-01T01:00:00.000Z',
      }),
    ]

    const rows = projectNameLifecycle(events)
    expect(byTicker(rows, 'REJX').state).toBe('exited')
    expect(byTicker(rows, 'REJX').exit_provenance).toBe('screened_out')
  })
})

describe('projectNameLifecycle — deteriorating-watched is HONEST (owner refinement #1)', () => {
  function watchedChain(researchCaseId: string, watchlistItemId: string, ticker: string): LedgerEventEnvelope<unknown>[] {
    return [
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: researchCaseId,
        payload: { ticker, company_id: `company_${ticker.toLowerCase()}` },
        created_at: '2026-06-01T00:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_created',
        aggregate_type: 'watchlist_item',
        aggregate_id: watchlistItemId,
        payload: { watchlist_item_id: watchlistItemId, research_case_id: researchCaseId, ticker },
        created_at: '2026-06-01T01:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_confirmed',
        aggregate_type: 'watchlist_item',
        aggregate_id: watchlistItemId,
        payload: { watchlist_item_id: watchlistItemId, research_case_id: researchCaseId },
        created_at: '2026-06-01T02:00:00.000Z',
      }),
    ]
  }

  it('keeps a watched name with a FAILED Shariah gate in `watched` but flags the tripped falsifier', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      ...watchedChain('rc_det_001', 'watch_det_001', 'DETR'),
      evt({
        event_type: 'shariah_gate_decision_recorded',
        aggregate_type: 'decision',
        aggregate_id: 'gate_det_001',
        payload: {
          gate_decision_id: 'gate_det_001',
          target_id: 'watch_det_001',
          research_case_id: 'rc_det_001',
          status: 'FAIL',
          allowed: false,
          reasons: ['Interest-bearing debt ratio breached the threshold on the newer 10-K.'],
        },
        created_at: '2026-06-03T00:00:00.000Z',
      }),
    ]

    const row = byTicker(projectNameLifecycle(events), 'DETR')
    // Still watched — NOT synthesized into exited or a half-state (no prune event exists yet).
    expect(row.state).toBe('watched')
    expect(row.falsifier_tripped).toBe(true)
    expect(row.falsifier_reason).toBeTruthy()
    expect(row.gate_clean).toBe(false)
    // Phase 6 S9: a falsified watched name OFFERS the human-authored prune action.
    expect(row.prune_action_available).toBe(true)
  })

  it('flags a watched name that went stale on a newer filing (suppressed monitor alert)', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      ...watchedChain('rc_stale_001', 'watch_stale_001', 'STLE'),
      evt({
        event_type: 'watchlist_monitor_alert_recorded',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_stale_001',
        actor_type: 'worker',
        payload: {
          watchlist_item_id: 'watch_stale_001',
          research_case_id: 'rc_stale_001',
          ticker: 'STLE',
          suppressed: true,
          suppression_reason: 'A cheap price was seen but the case is stale on a newer 10-K.',
        },
        created_at: '2026-06-04T00:00:00.000Z',
      }),
    ]

    const row = byTicker(projectNameLifecycle(events), 'STLE')
    expect(row.state).toBe('watched')
    expect(row.falsifier_tripped).toBe(true)
    expect(row.falsifier_reason).toContain('stale')
    expect(row.prune_action_available).toBe(true)
  })

  it('leaves a healthy watched name unflagged', () => {
    const row = byTicker(projectNameLifecycle(watchedChain('rc_ok_001', 'watch_ok_001', 'OKAY')), 'OKAY')
    expect(row.state).toBe('watched')
    expect(row.falsifier_tripped).toBeUndefined()
    // A clean watched name has nothing to prune.
    expect(row.prune_action_available).toBe(false)
  })

  it('does not offer the prune action on a held or candidate name', () => {
    const heldEvents: LedgerEventEnvelope<unknown>[] = [
      ...watchedChain('rc_held_p', 'watch_held_p', 'HELD'),
      evt({
        event_type: 'holding_opened',
        aggregate_type: 'holding',
        aggregate_id: 'holding_held_p',
        payload: {
          holding_id: 'holding_held_p',
          watchlist_item_id: 'watch_held_p',
          research_case_id: 'rc_held_p',
          ticker: 'HELD',
          shares: 2,
          cost_basis_per_share: 20,
        },
        created_at: '2026-06-02T00:00:00.000Z',
      }),
    ]
    expect(byTicker(projectNameLifecycle(heldEvents), 'HELD').prune_action_available).toBe(false)

    const candidateEvents: LedgerEventEnvelope<unknown>[] = [
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_cand_p',
        payload: { ticker: 'CAND', company_id: 'company_cand' },
        created_at: '2026-06-01T00:00:00.000Z',
      }),
    ]
    expect(byTicker(projectNameLifecycle(candidateEvents), 'CAND').prune_action_available).toBe(false)
  })

  it('folds a pruned watched name to exited/pruned (Phase 6 S9 softer exit)', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      ...watchedChain('rc_prune_001', 'watch_prune_001', 'PRNE'),
      evt({
        event_type: 'watchlist_item_pruned',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_prune_001',
        actor_type: 'user',
        payload: {
          watchlist_item_id: 'watch_prune_001',
          research_case_id: 'rc_prune_001',
          ticker: 'PRNE',
          pruned_at: '2026-06-06',
          reason: 'Shariah re-screen returned FAIL.',
        },
        created_at: '2026-06-06T00:00:00.000Z',
      }),
    ]

    const row = byTicker(projectNameLifecycle(events), 'PRNE')
    expect(row.state).toBe('exited')
    expect(row.exit_provenance).toBe('pruned')
    // Exited → no prune action on a dead row.
    expect(row.prune_action_available).toBe(false)
  })

  it('lets a live re-discovery WIN over a prior pruned watch, keeping the prune as history', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      ...watchedChain('rc_reprune_v1', 'watch_reprune_001', 'RPRN'),
      evt({
        event_type: 'watchlist_item_pruned',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_reprune_001',
        actor_type: 'user',
        payload: {
          watchlist_item_id: 'watch_reprune_001',
          research_case_id: 'rc_reprune_v1',
          ticker: 'RPRN',
          pruned_at: '2026-06-06',
          reason: 'stale on a newer 10-K',
        },
        created_at: '2026-06-06T00:00:00.000Z',
      }),
      // Re-discovered later as a NEW (non-superseded) live candidate for the same ticker.
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_reprune_v2',
        payload: { ticker: 'RPRN', company_id: 'company_rprn' },
        created_at: '2026-06-10T00:00:00.000Z',
      }),
    ]

    const row = byTicker(projectNameLifecycle(events), 'RPRN')
    // Live wins — the name is not exited; exit_provenance must NOT leak onto the live row.
    expect(row.state).toBe('candidate')
    expect(row.exit_provenance).toBeUndefined()
    // The prune is preserved as history.
    expect(row.prior_exit_provenance).toBe('pruned')
  })
})

describe('projectNameLifecycle — exit-provenance is RETAINED (owner refinement #2)', () => {
  it('distinguishes a sold former holding from a screened-out reject, both exited', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      // Sold former holding.
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_sold_002',
        payload: { ticker: 'SLDX', company_id: 'company_sldx' },
        created_at: '2026-06-01T00:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_created',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_sold_002',
        payload: { watchlist_item_id: 'watch_sold_002', research_case_id: 'rc_sold_002', ticker: 'SLDX' },
        created_at: '2026-06-01T01:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_confirmed',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_sold_002',
        payload: { watchlist_item_id: 'watch_sold_002', research_case_id: 'rc_sold_002' },
        created_at: '2026-06-01T02:00:00.000Z',
      }),
      evt({
        event_type: 'holding_opened',
        aggregate_type: 'holding',
        aggregate_id: 'holding_sold_002',
        payload: {
          holding_id: 'holding_sold_002',
          watchlist_item_id: 'watch_sold_002',
          research_case_id: 'rc_sold_002',
          ticker: 'SLDX',
          shares: 3,
          cost_basis_per_share: 30,
        },
        created_at: '2026-06-01T03:00:00.000Z',
      }),
      evt({
        event_type: 'holding_closed',
        aggregate_type: 'holding',
        aggregate_id: 'holding_sold_002',
        payload: { holding_id: 'holding_sold_002', closed_at: '2026-06-05' },
        created_at: '2026-06-05T00:00:00.000Z',
      }),

      // Screened-out reject.
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_rej_002',
        payload: { ticker: 'PASX', company_id: 'company_pasx' },
        created_at: '2026-06-01T00:00:00.000Z',
      }),
      evt({
        event_type: 'quick_screen_drafted',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_rej_002',
        payload: { research_case_id: 'rc_rej_002', ticker: 'PASX', screening_result: 'pass' },
        created_at: '2026-06-01T01:00:00.000Z',
      }),
    ]

    const rows = projectNameLifecycle(events)
    const sold = byTicker(rows, 'SLDX')
    const screenedOut = byTicker(rows, 'PASX')

    expect(sold.state).toBe('exited')
    expect(screenedOut.state).toBe('exited')
    // Same state, OPPOSITE histories — provenance must distinguish them.
    expect(sold.exit_provenance).toBe('sold')
    expect(screenedOut.exit_provenance).toBe('screened_out')
    expect(sold.exit_provenance).not.toBe(screenedOut.exit_provenance)
  })

  it('retains the prior exit_provenance when an exited name is re-discovered as a candidate', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_redisc_v1',
        payload: { ticker: 'REDX', company_id: 'company_redx' },
        created_at: '2026-06-01T00:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_created',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_redisc_001',
        payload: { watchlist_item_id: 'watch_redisc_001', research_case_id: 'rc_redisc_v1', ticker: 'REDX' },
        created_at: '2026-06-01T01:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_confirmed',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_redisc_001',
        payload: { watchlist_item_id: 'watch_redisc_001', research_case_id: 'rc_redisc_v1' },
        created_at: '2026-06-01T02:00:00.000Z',
      }),
      evt({
        event_type: 'holding_opened',
        aggregate_type: 'holding',
        aggregate_id: 'holding_redisc_001',
        payload: {
          holding_id: 'holding_redisc_001',
          watchlist_item_id: 'watch_redisc_001',
          research_case_id: 'rc_redisc_v1',
          ticker: 'REDX',
          shares: 2,
          cost_basis_per_share: 20,
        },
        created_at: '2026-06-01T03:00:00.000Z',
      }),
      evt({
        event_type: 'holding_closed',
        aggregate_type: 'holding',
        aggregate_id: 'holding_redisc_001',
        payload: { holding_id: 'holding_redisc_001', closed_at: '2026-06-05' },
        created_at: '2026-06-05T00:00:00.000Z',
      }),
      // Re-discovered later as a NEW research case (supersedes the old one), back in a live stage.
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_redisc_v2',
        payload: { ticker: 'REDX', company_id: 'company_redx', supersedes_research_case_id: 'rc_redisc_v1', version: 2 },
        created_at: '2026-06-10T00:00:00.000Z',
      }),
    ]

    const row = byTicker(projectNameLifecycle(events), 'REDX')
    expect(row.state).toBe('candidate')
    // A live row must NOT expose exit_provenance — it is not exited.
    expect(row.exit_provenance).toBeUndefined()
    // History is not lost — it moves to the distinct prior_exit_provenance field.
    expect(row.prior_exit_provenance).toBe('sold')
  })

  it('lets a live re-discovery WIN over an unrelated rejected case for the same ticker (finding #1)', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      // An earlier, NON-superseded rejected case for the ticker.
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_dual_rej',
        payload: { ticker: 'DUAL', company_id: 'company_dual' },
        created_at: '2026-06-01T00:00:00.000Z',
      }),
      evt({
        event_type: 'quick_screen_drafted',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_dual_rej',
        payload: { research_case_id: 'rc_dual_rej', ticker: 'DUAL', screening_result: 'reject' },
        created_at: '2026-06-01T01:00:00.000Z',
      }),
      // A fresh, NON-superseded live candidate for the SAME ticker (no supersession link).
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_dual_live',
        payload: { ticker: 'DUAL', company_id: 'company_dual' },
        created_at: '2026-06-10T00:00:00.000Z',
      }),
    ]

    const row = byTicker(projectNameLifecycle(events), 'DUAL')
    // Live wins — the name is not exited.
    expect(row.state).toBe('candidate')
    expect(row.exit_provenance).toBeUndefined()
    // The prior screen-out is preserved as history.
    expect(row.prior_exit_provenance).toBe('screened_out')
  })

  it('does not leak a stale screened_out provenance onto a currently-held name (finding #2)', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      // An unrelated, NON-superseded rejected case for the ticker.
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_hold_rej',
        payload: { ticker: 'HOLX', company_id: 'company_holx' },
        created_at: '2026-06-01T00:00:00.000Z',
      }),
      evt({
        event_type: 'quick_screen_drafted',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_hold_rej',
        payload: { research_case_id: 'rc_hold_rej', ticker: 'HOLX', screening_result: 'reject' },
        created_at: '2026-06-01T01:00:00.000Z',
      }),
      // A separate live chain to an OPEN holding for the same ticker.
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_hold_live',
        payload: { ticker: 'HOLX', company_id: 'company_holx' },
        created_at: '2026-06-10T00:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_created',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_hold_live',
        payload: { watchlist_item_id: 'watch_hold_live', research_case_id: 'rc_hold_live', ticker: 'HOLX' },
        created_at: '2026-06-10T01:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_confirmed',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_hold_live',
        payload: { watchlist_item_id: 'watch_hold_live', research_case_id: 'rc_hold_live' },
        created_at: '2026-06-10T02:00:00.000Z',
      }),
      evt({
        event_type: 'holding_opened',
        aggregate_type: 'holding',
        aggregate_id: 'holding_hold_live',
        payload: {
          holding_id: 'holding_hold_live',
          watchlist_item_id: 'watch_hold_live',
          research_case_id: 'rc_hold_live',
          ticker: 'HOLX',
          shares: 7,
          cost_basis_per_share: 70,
        },
        created_at: '2026-06-10T03:00:00.000Z',
      }),
    ]

    const row = byTicker(projectNameLifecycle(events), 'HOLX')
    // Held wins — and a live row must NOT carry exit_provenance.
    expect(row.state).toBe('held')
    expect(row.exit_provenance).toBeUndefined()
    // The prior screen-out is preserved as history on the distinct field.
    expect(row.prior_exit_provenance).toBe('screened_out')
  })
})

describe('projectNameLifecycle — Phase 5 S2 downside floor (sizing reads it alongside buy_price_per_share)', () => {
  it('surfaces the downside floor (per-share + basis + reliability) from the newest admit recommendation', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_floor_001',
        payload: { ticker: 'FLOOR', company_id: 'company_floor' },
        created_at: '2026-06-01T00:00:00.000Z',
      }),
      // Newest admit recommendation carries a computed net-cash floor (newest-recorded wins).
      evt({
        event_type: 'admit_judgment_recorded',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_floor_001',
        actor_type: 'provider',
        payload: {
          admit_judgment_id: 'admit_floor_1',
          research_case_id: 'rc_floor_001',
          ticker: 'FLOOR',
          permanent_loss_risk: { level: 'low', argument: 'a', citations: ['s'] },
          impairment_call: 'fixable_temporary',
          admittable: true,
          downside_floor: { status: 'floor', floor_per_share: 5, basis: 'net_cash', reliability: 'sound', components: {} },
        },
        created_at: '2026-06-02T00:00:00.000Z',
      }),
    ]
    const row = byTicker(projectNameLifecycle(events), 'FLOOR')
    expect(row.downside_floor_per_share).toBe(5)
    expect(row.downside_floor_basis).toBe('net_cash')
    expect(row.downside_floor_reliability).toBe('sound')
  })
})

describe('projectNameLifecycle — frozen undiscounted IV (Phase 6 S3; the valuation-inverted trigger reads it)', () => {
  it('projects frozen_iv + frozen_iv_valuation_version onto a held row from the watchlist lineage', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_iv_001',
        payload: { ticker: 'IVH', company_id: 'company_ivh' },
        created_at: '2026-06-01T00:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_created',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_iv_001',
        actor_type: 'user',
        payload: {
          watchlist_item_id: 'watch_iv_001',
          research_case_id: 'rc_iv_001',
          ticker: 'IVH',
          // Frozen undiscounted IV (216) is DISTINCT from the discounted locked buy-below (150).
          locked_buy_below: 150,
          buy_below_valuation_version: 'valuation-2026-06-1',
          frozen_iv: 216,
          frozen_iv_valuation_version: 'valuation-2026-06-1',
        },
        created_at: '2026-06-01T01:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_confirmed',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_iv_001',
        actor_type: 'user',
        payload: { watchlist_item_id: 'watch_iv_001', research_case_id: 'rc_iv_001' },
        created_at: '2026-06-01T02:00:00.000Z',
      }),
      evt({
        event_type: 'holding_opened',
        aggregate_type: 'holding',
        aggregate_id: 'holding_iv_001',
        payload: {
          holding_id: 'holding_iv_001',
          watchlist_item_id: 'watch_iv_001',
          research_case_id: 'rc_iv_001',
          ticker: 'IVH',
          shares: 10,
          cost_basis_per_share: 120,
        },
        created_at: '2026-06-01T03:00:00.000Z',
      }),
    ]
    const row = byTicker(projectNameLifecycle(events), 'IVH')
    expect(row.state).toBe('held')
    // The sell-decision flow reads the FROZEN IV (not the discounted buy-below) off the lifecycle row.
    expect(row.frozen_iv).toBe(216)
    expect(row.frozen_iv_valuation_version).toBe('valuation-2026-06-1')
  })

  it('leaves frozen_iv absent when the lineage froze none (never falls back to the discounted buy-below)', () => {
    const events: LedgerEventEnvelope<unknown>[] = [
      evt({
        event_type: 'research_case_created',
        aggregate_type: 'research_case',
        aggregate_id: 'rc_noiv_001',
        payload: { ticker: 'NOIV', company_id: 'company_noiv' },
        created_at: '2026-06-01T00:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_created',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_noiv_001',
        actor_type: 'user',
        payload: {
          watchlist_item_id: 'watch_noiv_001',
          research_case_id: 'rc_noiv_001',
          ticker: 'NOIV',
          locked_buy_below: 150,
          buy_below_valuation_version: 'valuation-2026-06-1',
        },
        created_at: '2026-06-01T01:00:00.000Z',
      }),
      evt({
        event_type: 'watchlist_draft_confirmed',
        aggregate_type: 'watchlist_item',
        aggregate_id: 'watch_noiv_001',
        actor_type: 'user',
        payload: { watchlist_item_id: 'watch_noiv_001', research_case_id: 'rc_noiv_001' },
        created_at: '2026-06-01T02:00:00.000Z',
      }),
    ]
    const row = byTicker(projectNameLifecycle(events), 'NOIV')
    expect(row.state).toBe('watched')
    expect(row.frozen_iv).toBeUndefined()
    expect(row.frozen_iv_valuation_version).toBeUndefined()
    expect(row.locked_buy_below).toBe(150)
  })
})
