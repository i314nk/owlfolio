import { describe, expect, it } from 'vitest'

import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectMonitorAlerts } from '../projections/monitorAlertProjection'

let seq = 0
const evt = (over: Partial<LedgerEventEnvelope<Record<string, unknown>>>): LedgerEventEnvelope<unknown> => {
  seq += 1
  return {
    event_id: `e${seq}`,
    event_type: 'watchlist_monitor_alert_recorded',
    aggregate_type: 'watchlist_item',
    aggregate_id: 'w1',
    actor_type: 'worker',
    payload: {},
    source_ids: [],
    created_at: `2026-06-08T00:00:${String(seq).padStart(2, '0')}Z`,
    schema_version: 1,
    ...over,
  } as LedgerEventEnvelope<unknown>
}

describe('projectMonitorAlerts — empty / fail-closed', () => {
  it('returns [] when there are no monitor events', () => {
    expect(projectMonitorAlerts([])).toEqual([])
  })

  it('ignores non-monitor events', () => {
    const events = [evt({ event_type: 'research_case_created', aggregate_type: 'research_case', payload: { ticker: 'AAA' } })]
    expect(projectMonitorAlerts(events)).toEqual([])
  })

  it('does NOT surface a no-signal watchlist monitor observation as an alert', () => {
    const events = [
      evt({
        aggregate_id: 'w1',
        payload: {
          alert_id: 'wmon_w1',
          watchlist_item_id: 'w1',
          ticker: 'AAA',
          alert_kind: 'no_signal',
          buy_window_alert: false,
          suppressed: false,
          rerun_needed: false,
          message: 'AAA: price above buy price; no buy-window',
        },
      }),
    ]
    expect(projectMonitorAlerts(events)).toEqual([])
  })
})

describe('projectMonitorAlerts — watchlist buy window', () => {
  it('maps a buy_window alert to kind=buy_window, severity=attention, with discount detail and a watchlist action', () => {
    const events = [
      evt({
        aggregate_id: 'w1',
        payload: {
          alert_id: 'wmon_w1',
          watchlist_item_id: 'w1',
          research_case_id: 'rc1',
          ticker: 'AAA',
          alert_kind: 'buy_window',
          buy_window_alert: true,
          suppressed: false,
          rerun_needed: false,
          discount_to_buy_pct: 12.5,
          case_age_months: 3,
          message: 'AAA: BUY-WINDOW — 12.5% below buy price.',
        },
      }),
    ]
    const [alert] = projectMonitorAlerts(events)
    expect(alert?.kind).toBe('buy_window')
    expect(alert?.severity).toBe('attention')
    expect(alert?.subject.ticker).toBe('AAA')
    expect(alert?.subject.watchlist_item_id).toBe('w1')
    expect(alert?.detail).toContain('12.5%')
    expect(alert?.is_observation).toBe(true)
    expect(alert?.human_action.href).toBe('/watchlist')
    expect(alert?.headline).toContain('AAA')
  })

  it('maps a suppressed/stale buy window to kind=staleness, severity=info, re-run-needed detail', () => {
    const events = [
      evt({
        aggregate_id: 'w1',
        payload: {
          alert_id: 'wmon_w1',
          watchlist_item_id: 'w1',
          ticker: 'BBB',
          alert_kind: 'buy_window_suppressed',
          buy_window_alert: false,
          suppressed: true,
          suppression_reason: 'research case is older than 12 months; re-run needed',
          rerun_needed: true,
          discount_to_buy_pct: 8,
          message: 'BBB: cheap but STALE — buy alert suppressed',
        },
      }),
    ]
    const [alert] = projectMonitorAlerts(events)
    expect(alert?.kind).toBe('staleness')
    expect(alert?.severity).toBe('info')
    expect(alert?.detail.toLowerCase()).toContain('re-run')
  })

  it('maps a shariah_rescreen FAIL to kind=shariah_rescreen, severity=info, propose-removal detail', () => {
    const events = [
      evt({
        aggregate_id: 'w1',
        payload: {
          alert_id: 'wsh_w1',
          watchlist_item_id: 'w1',
          ticker: 'CCC',
          alert_kind: 'shariah_rescreen',
          buy_window_alert: false,
          suppressed: false,
          rerun_needed: false,
          shariah_verdict: 'FAIL',
          propose_removal: true,
          message: 'CCC: Shariah re-screen FAIL — propose removal',
        },
      }),
    ]
    const [alert] = projectMonitorAlerts(events)
    expect(alert?.kind).toBe('shariah_rescreen')
    expect(alert?.severity).toBe('info')
    expect(alert?.detail).toContain('FAIL')
  })
})

describe('projectMonitorAlerts — holding monitor', () => {
  it('maps a tranche alert to kind=tranche, severity=attention, with thesis-gated note and a portfolio action', () => {
    const events = [
      evt({
        event_type: 'holding_monitor_alert_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'h1',
        payload: {
          alert_id: 'hmon_h1',
          holding_id: 'h1',
          ticker: 'DDD',
          alert_kind: 'tranche_review',
          tranche_review_alert: true,
          triggered_tranches: ['T2'],
          thesis_gated_note: 'thesis re-check FIRST, then deploy — never mechanical averaging-down.',
          trim_review_alert: false,
          rerun_needed: false,
          message: 'DDD: holding monitor — tranche_review',
        },
      }),
    ]
    const [alert] = projectMonitorAlerts(events)
    expect(alert?.kind).toBe('tranche')
    expect(alert?.severity).toBe('attention')
    expect(alert?.subject.holding_id).toBe('h1')
    expect(alert?.detail).toContain('T2')
    expect(alert?.detail.toLowerCase()).toContain('thesis')
    expect(alert?.human_action.href).toBe('/portfolio#h1')
  })

  it('surfaces position-sizing lot-tag fields (tranche_id, trigger_type, buy_price_version, deployed_pct)', () => {
    const events = [
      evt({
        event_type: 'holding_monitor_alert_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'h2',
        payload: {
          alert_id: 'hmon_h2',
          holding_id: 'h2',
          ticker: 'EEE',
          alert_kind: 'tranche_review',
          tranche_review_alert: true,
          tranche_id: 'T2',
          trigger_type: 'time_completion',
          buy_price_version: 'v2',
          deployed_pct: 0.4,
          ladder_id: 'cold',
          thesis_gated_note: 'thesis re-check FIRST, then deploy — never mechanical averaging-down.',
          trim_review_alert: false,
          rerun_needed: false,
          message: 'EEE: holding monitor — tranche_review',
        },
      }),
    ]
    const [alert] = projectMonitorAlerts(events)
    expect(alert?.kind).toBe('tranche')
    expect(alert?.headline).toContain('T2')
    expect(alert?.headline.toLowerCase()).toContain('time-completion')
    expect(alert?.detail).toContain('v2')
    expect(alert?.detail).toContain('40%')
  })

  it('maps a concentration alert to kind=concentration, severity=attention with weight%', () => {
    const events = [
      evt({
        event_type: 'holding_monitor_alert_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'h1',
        payload: {
          alert_id: 'hmon_h1',
          holding_id: 'h1',
          ticker: 'EEE',
          alert_kind: 'concentration_trim_review',
          tranche_review_alert: false,
          triggered_tranches: [],
          trim_review_alert: true,
          weight_pct: 22.4,
          rerun_needed: false,
          message: 'EEE: concentration 22.4% exceeds cap',
        },
      }),
    ]
    const alerts = projectMonitorAlerts(events)
    const concentration = alerts.find((a) => a.kind === 'concentration')
    expect(concentration?.severity).toBe('attention')
    expect(concentration?.detail).toContain('22.4%')
  })

  it('splits a combined tranche+concentration+annual alert into one alert per kind', () => {
    const events = [
      evt({
        event_type: 'holding_monitor_alert_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'h1',
        payload: {
          alert_id: 'hmon_h1',
          holding_id: 'h1',
          ticker: 'FFF',
          alert_kind: 'tranche_review+concentration_trim_review+annual_rerun',
          tranche_review_alert: true,
          triggered_tranches: ['T3'],
          trim_review_alert: true,
          weight_pct: 18,
          rerun_needed: true,
          case_age_months: 14,
          message: 'FFF: holding monitor',
        },
      }),
    ]
    const kinds = projectMonitorAlerts(events).map((a) => a.kind).sort()
    expect(kinds).toEqual(['annual_rerun', 'concentration', 'tranche'])
  })
})

describe('projectMonitorAlerts — shariah grace + sell review (urgent)', () => {
  it('maps a grace start to kind=shariah_grace with the deadline and days-left in detail', () => {
    const events = [
      evt({
        event_type: 'holding_shariah_grace_started',
        aggregate_type: 'holding',
        aggregate_id: 'h2',
        created_at: '2026-06-08T00:00:00Z',
        payload: {
          grace_id: 'grace_h2',
          holding_id: 'h2',
          ticker: 'GGG',
          started_at: '2026-06-08T00:00:00Z',
          deadline: '2026-09-06',
          grace_days: 90,
          shariah_verdict: 'FAIL',
          reason: 'AAOIFI breach — 90-day grace started',
          message: 'GGG: grace started',
        },
      }),
    ]
    const [alert] = projectMonitorAlerts(events, { now: new Date('2026-06-08T00:00:00Z') })
    expect(alert?.kind).toBe('shariah_grace')
    expect(alert?.detail).toContain('2026-09-06')
    expect(alert?.detail.toLowerCase()).toContain('day')
  })

  it('escalates a grace whose deadline has passed to severity=urgent', () => {
    const events = [
      evt({
        event_type: 'holding_shariah_grace_started',
        aggregate_type: 'holding',
        aggregate_id: 'h2',
        payload: {
          grace_id: 'grace_h2',
          holding_id: 'h2',
          ticker: 'GGG',
          started_at: '2026-01-01T00:00:00Z',
          deadline: '2026-04-01',
          grace_days: 90,
          shariah_verdict: 'FAIL',
          message: 'GGG: grace started',
        },
      }),
    ]
    const [alert] = projectMonitorAlerts(events, { now: new Date('2026-06-08T00:00:00Z') })
    expect(alert?.severity).toBe('urgent')
  })

  it('maps a sell review draft to kind=sell_review (or divest_required), severity=urgent, portfolio action', () => {
    const events = [
      evt({
        event_type: 'holding_sell_review_drafted',
        aggregate_type: 'holding',
        aggregate_id: 'h3',
        payload: {
          sell_review_id: 'sr_h3',
          holding_id: 'h3',
          ticker: 'HHH',
          reason_code: 'unresolvable_shariah_breach',
          detail: 'AAOIFI breach unresolved past grace deadline.',
          reasons: ['thesis_broken', 'unresolvable_shariah_breach'],
          weakest_reason: 'overvaluation_alone',
          message: 'HHH: DIVEST-REQUIRED draft',
        },
      }),
    ]
    const [alert] = projectMonitorAlerts(events)
    expect(alert?.kind).toBe('divest_required')
    expect(alert?.severity).toBe('urgent')
    expect(alert?.is_draft).toBe(true)
    expect(alert?.human_action.href).toBe('/portfolio#h3')
    expect(alert?.detail.toLowerCase()).toContain('breach')
  })

  it('maps a non-shariah sell review to kind=sell_review', () => {
    const events = [
      evt({
        event_type: 'holding_sell_review_drafted',
        aggregate_type: 'holding',
        aggregate_id: 'h3',
        payload: {
          sell_review_id: 'sr_h3',
          holding_id: 'h3',
          ticker: 'III',
          reason_code: 'thesis_broken',
          detail: 'Thesis broke.',
          message: 'III: SELL-REVIEW draft',
        },
      }),
    ]
    const [alert] = projectMonitorAlerts(events)
    expect(alert?.kind).toBe('sell_review')
    expect(alert?.severity).toBe('urgent')
  })
})

describe('projectMonitorAlerts — grouping / latest-per-subject / resolution', () => {
  it('keeps only the latest alert per (subject, kind)', () => {
    const events = [
      evt({
        aggregate_id: 'w1',
        created_at: '2026-06-01T00:00:00Z',
        payload: {
          alert_id: 'a1', watchlist_item_id: 'w1', ticker: 'AAA', alert_kind: 'buy_window',
          buy_window_alert: true, suppressed: false, rerun_needed: false, discount_to_buy_pct: 5, message: 'old',
        },
      }),
      evt({
        aggregate_id: 'w1',
        created_at: '2026-06-09T00:00:00Z',
        payload: {
          alert_id: 'a2', watchlist_item_id: 'w1', ticker: 'AAA', alert_kind: 'buy_window',
          buy_window_alert: true, suppressed: false, rerun_needed: false, discount_to_buy_pct: 9, message: 'new',
        },
      }),
    ]
    const alerts = projectMonitorAlerts(events).filter((a) => a.kind === 'buy_window')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.detail).toContain('9%')
  })

  it('resolves (drops) a buy-window when the watchlist item was later opened into a holding', () => {
    const events = [
      evt({
        aggregate_id: 'w1',
        created_at: '2026-06-01T00:00:00Z',
        payload: {
          alert_id: 'a1', watchlist_item_id: 'w1', ticker: 'AAA', alert_kind: 'buy_window',
          buy_window_alert: true, suppressed: false, rerun_needed: false, discount_to_buy_pct: 5, message: 'old',
        },
      }),
      evt({
        event_type: 'holding_opened',
        aggregate_type: 'holding',
        aggregate_id: 'h1',
        created_at: '2026-06-05T00:00:00Z',
        payload: { holding_id: 'h1', watchlist_item_id: 'w1', ticker: 'AAA' },
      }),
    ]
    expect(projectMonitorAlerts(events)).toEqual([])
  })

  it('resolves a holding monitor alert when the holding was later exited (post-mortem recorded)', () => {
    const events = [
      evt({
        event_type: 'holding_monitor_alert_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'h1',
        created_at: '2026-06-01T00:00:00Z',
        payload: {
          alert_id: 'hmon_h1', holding_id: 'h1', ticker: 'DDD', alert_kind: 'concentration_trim_review',
          tranche_review_alert: false, trim_review_alert: true, weight_pct: 22, rerun_needed: false, message: 'x',
        },
      }),
      evt({
        event_type: 'position_post_mortem_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'h1',
        created_at: '2026-06-05T00:00:00Z',
        payload: { holding_id: 'h1', ticker: 'DDD' },
      }),
    ]
    expect(projectMonitorAlerts(events)).toEqual([])
  })

  it('sorts urgent before attention before info', () => {
    const events = [
      evt({
        aggregate_id: 'w1',
        payload: {
          alert_id: 'a1', watchlist_item_id: 'w1', ticker: 'AAA', alert_kind: 'shariah_rescreen',
          buy_window_alert: false, suppressed: false, rerun_needed: false, shariah_verdict: 'CONDITIONAL', propose_removal: false, message: 'info',
        },
      }),
      evt({
        event_type: 'holding_sell_review_drafted',
        aggregate_type: 'holding',
        aggregate_id: 'h3',
        payload: { sell_review_id: 'sr_h3', holding_id: 'h3', ticker: 'HHH', reason_code: 'thesis_broken', detail: 'x', message: 'urgent' },
      }),
      evt({
        event_type: 'holding_monitor_alert_recorded',
        aggregate_type: 'holding',
        aggregate_id: 'h1',
        payload: {
          alert_id: 'hmon_h1', holding_id: 'h1', ticker: 'DDD', alert_kind: 'tranche_review',
          tranche_review_alert: true, triggered_tranches: ['T2'], trim_review_alert: false, rerun_needed: false, message: 'attention',
        },
      }),
    ]
    const severities = projectMonitorAlerts(events).map((a) => a.severity)
    expect(severities).toEqual(['urgent', 'attention', 'info'])
  })
})
