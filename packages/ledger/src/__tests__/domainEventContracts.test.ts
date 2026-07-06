import { describe, expect, it } from 'vitest'

import {
  domainEventContracts,
  domainProjectionContracts,
  type DomainEventType,
} from '../domainEventContracts'

function contract(eventType: DomainEventType) {
  return domainEventContracts.find((candidate) => candidate.event_type === eventType)
}

describe('Owlfolio v2 domain event boundary contracts', () => {
  it('freezes the event families needed by discovery, scheduler, providers, Shariah, purification, accounting, and cash lanes', () => {
    expect(domainEventContracts.map((entry) => entry.event_type)).toEqual([
      'discovery_candidate_discovered',
      'discovery_candidate_queued_for_quick_screen',
      'discovery_candidate_rejected',
      'discovery_candidate_promoted_to_research_case',
      'queued_for_deep_dive',
      'deep_dive_started',
      'specialist_finding_recorded',
      'deep_dive_synthesis_drafted',
      'deep_dive_completed',
      'holding_valuation_recorded',
      'scheduled_task_defined',
      'scheduled_task_run_started',
      'scheduled_task_run_completed',
      'scheduled_task_run_failed',
      'provider_run_started',
      'provider_run_completed',
      'provider_run_failed',
      'certification_report_recorded',
      'shariah_evaluation_recorded',
      'shariah_status_changed',
      'shariah_gate_decision_recorded',
      'purification_obligation_recorded',
      'purification_payment_recorded',
      'accounting_snapshot_recorded',
      'cash_deposited',
      'cash_withdrawn',
      'dividend_income_recorded',
      'fee_charged',
      'holding_realized_gain_loss_recorded',
      'research_run_requested',
      'research_run_claimed',
      'research_run_failed',
      'deep_dive_approval_pending',
      'deep_dive_run_requested',
      'investable_capital_set',
      'valuation_config',
      'calibration_run_requested',
      'calibration_run',
      'calibration_universe_member_added',
      'calibration_universe_member_removed',
      'watchlist_monitor_alert_recorded',
      'holding_monitor_alert_recorded',
      'holding_shariah_grace_started',
      'holding_sell_review_drafted',
      'holding_closed',
      'watchlist_item_pruned',
      'position_post_mortem_recorded',
      'forecast_recorded',
      'forecast_resolved',
      'admit_judgment_recorded',
      'sizing_recommendation_recorded',
      'research_case_archived',
      'research_case_re_review_recorded',
      'price_snapshot_recorded',
    ])
  })

  it('freezes the research_case_archived contract as the user-authored append-only archive (hide, never mutate)', () => {
    // Option-b append-only archive: a stale run is HIDDEN from the active views via this event while staying
    // in the ledger (the case still projects, marked archived). Mirrors the superseded pattern; user-authored.
    expect(contract('research_case_archived')).toMatchObject({
      aggregate_type: 'research_case',
      actor_type: 'user',
      projection_owner: 'discovery',
      payload_fields: ['research_case_id', 'archived_at', 'reason'],
    })
  })

  it('freezes the re-review contract as a provider OBSERVATION diff — never a verdict, never an auto-action', () => {
    // The re-review compares the filings that appeared SINCE the decision against the RECORDED thesis and
    // records a DIFF (INTACT|WEAKENED|BROKEN|UNVERIFIED, fail-closed). It never transitions the case and
    // never re-verdicts; the full re-verdict remains the human-initiated v2 supersession re-run.
    expect(contract('research_case_re_review_recorded')).toMatchObject({
      aggregate_type: 'research_case',
      actor_type: 'provider',
      actor_types: ['provider', 'worker'],
      projection_owner: 'portfolio',
      payload_fields: [
        're_review_id',
        'research_case_id',
        'ticker',
        'assessment',
        'trigger_assessments',
        'changed_dimensions',
        'weakened_dimension',
        'broken_claim',
        'narrative',
        'prior_thesis_summary',
        'new_filings',
        'skipped_filings',
        'prior_corpus_size',
        'checked_at',
        're_review_ungrounded',
        'ungrounded_reason',
        'reviewed_by_actor_type',
        'reviewed_by_actor_id',
      ],
    })
  })

  it('freezes the admit-judgment contract (Task 4.2c) as an agent OBSERVATION, never an auto-admit', () => {
    // The recommendation is a provider-authored OBSERVATION on the research case — it does NOT transition
    // the name to watched (the human still admits via the watchlist_draft confirm with a signed thesis).
    expect(contract('admit_judgment_recorded')).toMatchObject({
      aggregate_type: 'research_case',
      actor_type: 'provider',
      actor_types: ['provider', 'worker'],
      projection_owner: 'discovery',
      payload_fields: [
        'admit_judgment_id',
        'research_case_id',
        'ticker',
        'uncertainty',
        'permanent_loss_risk',
        'impairment_bear_case',
        'impairment_call',
        'admittable',
        'reason',
        'buy_below',
        'cheapness',
        'uncited_refs',
        'is_observation',
        'is_recommendation',
      ],
    })
  })

  it('freezes the sizing-recommendation contract (Phase 5 S7) as an agent OBSERVATION, never an auto-open', () => {
    // The sizing recommendation is a provider-authored OBSERVATION on the research case — it does NOT open
    // the holding (the human still signs the buy via the holding-open transition).
    expect(contract('sizing_recommendation_recorded')).toMatchObject({
      aggregate_type: 'research_case',
      actor_type: 'provider',
      actor_types: ['provider', 'worker'],
      projection_owner: 'discovery',
      payload_fields: [
        'sizing_recommendation_id',
        'research_case_id',
        'ticker',
        'status',
        'conviction_factor',
        'target_weight',
        'sizeable_value',
        'binding_constraint',
        'worst_case',
        'ladder',
        'caveats',
        'reason',
        'expected_savings_return',
        'is_observation',
        'is_recommendation',
      ],
    })
  })

  it('freezes the Module 10 post-mortem + forecast-calibration contracts as harness-arithmetic, never auto-trade', () => {
    expect(contract('position_post_mortem_recorded')).toMatchObject({
      aggregate_type: 'holding',
      actor_type: 'worker',
      actor_types: ['user', 'worker'],
      projection_owner: 'portfolio',
      payload_fields: [
        'post_mortem_id',
        'holding_id',
        'research_case_id',
        'ticker',
        'moat_class',
        'holding_period_days',
        'total_realized_pl',
        'mos_protection',
        'credited_g_vs_actual',
        'most_wrong_lane',
        'is_observation',
        'message',
      ],
    })
    expect(contract('forecast_recorded')).toMatchObject({
      aggregate_type: 'research_case',
      actor_type: 'provider',
      projection_owner: 'portfolio',
      payload_fields: ['forecast_id', 'research_case_id', 'ticker', 'lane', 'claim', 'p', 'resolves_on'],
    })
    expect(contract('forecast_resolved')).toMatchObject({
      aggregate_type: 'research_case',
      actor_type: 'worker',
      actor_types: ['user', 'worker'],
      projection_owner: 'portfolio',
      payload_fields: [
        'resolution_id',
        'forecast_id',
        'research_case_id',
        'ticker',
        'lane',
        'p',
        'outcome',
        'brier_score',
        'resolved_on',
      ],
    })
  })

  it('freezes the lifecycle-monitor (Module 6/7) observation + draft contracts as worker-authored, never auto-trade', () => {
    expect(contract('watchlist_monitor_alert_recorded')).toMatchObject({
      aggregate_type: 'watchlist_item',
      actor_type: 'worker',
      projection_owner: 'portfolio',
    })
    expect(contract('holding_monitor_alert_recorded')).toMatchObject({
      aggregate_type: 'holding',
      actor_type: 'worker',
      projection_owner: 'portfolio',
    })
    // position-sizing-spec lot-tag fields are frozen onto the tranche-alert payload (§2/§3/§4/§5.5).
    expect(contract('holding_monitor_alert_recorded')?.payload_fields).toEqual(
      expect.arrayContaining([
        'ladder_id',
        'tranche_id',
        'trigger_type',
        'buy_price_version',
        'deployed_pct',
        'target_weight',
        'tranche_blocked',
        'tranche_block_reason',
      ]),
    )
    expect(contract('holding_shariah_grace_started')).toMatchObject({
      aggregate_type: 'holding',
      actor_type: 'worker',
      projection_owner: 'portfolio',
    })
    expect(contract('holding_sell_review_drafted')).toMatchObject({
      aggregate_type: 'holding',
      actor_type: 'worker',
      actor_types: ['provider', 'worker'],
      projection_owner: 'portfolio',
      payload_fields: [
        'sell_review_id',
        'holding_id',
        'research_case_id',
        'ticker',
        'reason_code',
        'detail',
        'reasons',
        'weakest_reason',
        'weakest_reason_note',
        'is_execution',
        'is_recommendation',
        'requires_user_authoring',
        'deferred_detection_note',
        'message',
        // Phase 6 S8a — the on-demand sell-decision recommendation, carried additively.
        'decision_status',
        'trigger',
        'impairment_call',
        'minimum_hold_decision',
        'frozen_oe_ps',
        'frozen_reference_fair_value',
        'worst_case',
        'bias_caveats',
        'requires_human_signoff',
        'sell_review_draft',
        'is_observation',
      ],
    })
  })

  it('freezes the holding_closed contract (Phase 6 S7) as the irreversible HUMAN-authored exit execution', () => {
    // The close is the mirror of holding_opened: human-authored only, an execution (not a draft/observation),
    // gated by requires_user_authoring. exit_provenance:'sold' keeps the nameLifecycle/purification folds green.
    expect(contract('holding_closed')).toMatchObject({
      aggregate_type: 'holding',
      actor_type: 'user',
      projection_owner: 'portfolio',
      payload_fields: [
        'holding_id',
        'closed_at',
        'exit_price_per_share',
        'reason_code',
        'exit_provenance',
        'is_execution',
        'requires_user_authoring',
        'message',
      ],
    })
  })

  it('freezes the watchlist_item_pruned contract (Phase 6 S9) as the HUMAN-authored watched-name prune', () => {
    // The prune is the softer mirror of holding_closed: human-authored only, an execution (not a draft/
    // observation), gated by requires_user_authoring. It removes a falsified watched name from the watchlist.
    expect(contract('watchlist_item_pruned')).toMatchObject({
      aggregate_type: 'watchlist_item',
      actor_type: 'user',
      projection_owner: 'portfolio',
      payload_fields: [
        'watchlist_item_id',
        'ticker',
        'research_case_id',
        'pruned_at',
        'reason',
        'is_execution',
        'requires_user_authoring',
        'message',
      ],
    })
  })

  it('assigns each frozen event to a stable aggregate, actor, and projection owner', () => {
    expect(contract('discovery_candidate_discovered')).toMatchObject({
      aggregate_type: 'discovery_candidate',
      actor_type: 'provider',
      actor_types: ['provider', 'worker'],
      projection_owner: 'discovery',
      payload_fields: [
        'candidate_id',
        'ticker',
        'company_name',
        'market',
        'strategy_id',
        'strategy_version',
        'discovery_source',
        'source_ids',
        'discovered_at',
        'status',
        'dedupe_key',
        'discovery_metadata',
      ],
    })
    expect(contract('discovery_candidate_queued_for_quick_screen')).toMatchObject({ aggregate_type: 'discovery_candidate', actor_type: 'system', projection_owner: 'discovery' })
    expect(contract('discovery_candidate_rejected')).toMatchObject({ aggregate_type: 'discovery_candidate', actor_type: 'user', projection_owner: 'discovery' })
    expect(contract('discovery_candidate_promoted_to_research_case')).toMatchObject({ aggregate_type: 'discovery_candidate', actor_type: 'user', projection_owner: 'discovery' })
    expect(contract('queued_for_deep_dive')).toMatchObject({
      aggregate_type: 'research_case',
      actor_type: 'system',
      projection_owner: 'discovery',
      payload_fields: ['research_case_id', 'queue_id', 'candidate_id', 'strategy_id', 'strategy_version', 'source_ids'],
    })
    expect(contract('deep_dive_started')).toMatchObject({
      aggregate_type: 'research_case',
      actor_type: 'worker',
      projection_owner: 'discovery',
      payload_fields: ['research_case_id', 'deep_dive_id', 'candidate_id', 'strategy_id', 'strategy_version', 'specialist_lanes', 'source_ids'],
    })
    expect(contract('specialist_finding_recorded')).toMatchObject({
      aggregate_type: 'research_case',
      actor_type: 'provider',
      projection_owner: 'discovery',
      payload_fields: [
        'research_case_id',
        'finding_id',
        'deep_dive_id',
        'candidate_id',
        'strategy_id',
        'strategy_version',
        'specialist_lane',
        'finding_summary',
        'source_ids',
        'confidence',
        'caveats',
        'provider_run_id',
      ],
    })
    expect(contract('deep_dive_synthesis_drafted')).toMatchObject({
      aggregate_type: 'research_case',
      actor_type: 'system',
      projection_owner: 'discovery',
      payload_fields: [
        'research_case_id',
        'synthesis_id',
        'deep_dive_id',
        'candidate_id',
        'strategy_id',
        'strategy_version',
        'synthesis_summary',
        'specialist_finding_ids',
        'source_ids',
        'confidence',
        'caveats',
        'provider_run_id',
      ],
    })
    expect(contract('deep_dive_completed')).toMatchObject({
      aggregate_type: 'research_case',
      actor_type: 'system',
      projection_owner: 'discovery',
      payload_fields: [
        'research_case_id',
        'completion_id',
        'deep_dive_id',
        'candidate_id',
        'synthesis_id',
        'strategy_id',
        'strategy_version',
        'source_ids',
        'confidence',
        'caveats',
        'provider_run_id',
      ],
    })
    expect(contract('holding_valuation_recorded')).toMatchObject({
      aggregate_type: 'holding',
      actor_type: 'worker',
      actor_types: ['user', 'worker'],
      projection_owner: 'accounting',
      payload_fields: [
        'snapshot_id',
        'holding_id',
        'price_per_share',
        'shares',
        'market_value',
        'currency',
        'valued_at',
        'valuation_source',
        'price_checked_at',
        'confidence',
        'caveat',
        'missing_data',
        'valued_by_actor_type',
        'valued_by_actor_id',
      ],
    })
    expect(contract('scheduled_task_run_started')).toMatchObject({ aggregate_type: 'scheduled_task', actor_type: 'worker', projection_owner: 'worker_status' })
    expect(contract('provider_run_completed')).toMatchObject({ aggregate_type: 'provider_run', actor_type: 'provider', projection_owner: 'provider_status' })
    expect(contract('certification_report_recorded')).toMatchObject({ aggregate_type: 'provider_run', actor_type: 'worker', projection_owner: 'provider_status' })
    expect(contract('shariah_evaluation_recorded')).toMatchObject({ aggregate_type: 'holding', actor_type: 'provider', projection_owner: 'shariah_status' })
    expect(contract('shariah_gate_decision_recorded')).toMatchObject({
      aggregate_type: 'decision',
      actor_type: 'system',
      projection_owner: 'shariah_status',
      payload_fields: [
        'gate_decision_id',
        'target_transition',
        'target_id',
        'research_case_id',
        'status',
        'allowed',
        'reasons',
        'required_source_ids',
        'missing_evidence',
        'conditional_allowed',
      ],
    })
    expect(contract('purification_payment_recorded')).toMatchObject({ aggregate_type: 'purification_entry', actor_type: 'user', projection_owner: 'purification' })
    expect(contract('accounting_snapshot_recorded')).toMatchObject({ aggregate_type: 'accounting_snapshot', actor_type: 'worker', projection_owner: 'accounting' })
    expect(contract('cash_deposited')).toMatchObject({ aggregate_type: 'cash_account', actor_type: 'user', projection_owner: 'accounting' })
    expect(contract('dividend_income_recorded')).toMatchObject({
      aggregate_type: 'cash_account',
      actor_type: 'user',
      projection_owner: 'accounting',
      payload_fields: ['dividend_id', 'holding_id', 'cash_account_id', 'amount', 'currency', 'received_at', 'taxable_status'],
    })
    expect(contract('fee_charged')).toMatchObject({
      aggregate_type: 'cash_account',
      actor_type: 'user',
      projection_owner: 'accounting',
      payload_fields: ['fee_id', 'cash_account_id', 'amount', 'currency', 'charged_at', 'fee_type'],
    })
    expect(contract('holding_realized_gain_loss_recorded')).toMatchObject({
      aggregate_type: 'holding',
      actor_type: 'user',
      projection_owner: 'accounting',
      payload_fields: ['realized_gain_loss_id', 'holding_id', 'amount', 'currency', 'realized_at'],
    })
    expect(contract('accounting_snapshot_recorded')?.payload_fields).toEqual([
      'snapshot_id',
      'period_start',
      'period_end',
      'nav',
      'current_value',
      'unrealized_gain_loss',
      'realized_gain_loss',
      'cash_balance',
      'deposits',
      'withdrawals',
      'dividends',
      'fees',
      'net_cash_flow',
      'audit_event_ids',
      'source_ids',
      'missing_data_warnings',
      'currency',
    ])
  })

  it('freezes the calibration contracts as deliberate, audit-owned, observation-only (never auto-tune)', () => {
    expect(contract('calibration_run_requested')).toMatchObject({
      aggregate_type: 'strategy',
      actor_type: 'user',
      projection_owner: 'audit',
      payload_fields: ['calibration_run_id', 'strategy_id', 'universe_version', 'requested_by'],
    })
    expect(contract('calibration_run')).toMatchObject({
      aggregate_type: 'strategy',
      actor_type: 'user',
      actor_types: ['user', 'worker'],
      projection_owner: 'audit',
      payload_fields: ['params_version', 'params', 'universe_version', 'universe', 'summaries', 'coverage', 'target'],
    })
  })

  it('freezes the user-authored calibration-universe curation contracts (direct, reversible, audit-owned)', () => {
    expect(contract('calibration_universe_member_added')).toMatchObject({
      aggregate_type: 'strategy',
      actor_type: 'user',
      projection_owner: 'audit',
      payload_fields: ['ticker', 'company', 'market'],
    })
    expect(contract('calibration_universe_member_removed')).toMatchObject({
      aggregate_type: 'strategy',
      actor_type: 'user',
      projection_owner: 'audit',
      payload_fields: ['ticker'],
    })
  })

  it('includes research run queue event types', () => {
    expect(domainEventContracts.map((entry) => entry.event_type)).toContain('research_run_requested')
    expect(domainEventContracts.map((entry) => entry.event_type)).toContain('research_run_claimed')
    expect(domainEventContracts.map((entry) => entry.event_type)).toContain('research_run_failed')
    expect(domainEventContracts.map((entry) => entry.event_type)).toContain('deep_dive_approval_pending')
    expect(domainEventContracts.map((entry) => entry.event_type)).toContain('deep_dive_run_requested')
  })

  it('defines route/page ownership for downstream UI lanes without requiring implementation yet', () => {
    expect(domainProjectionContracts).toEqual([
      { projection_owner: 'discovery', package_owner: '@owlfolio/ledger', route_owner: '/research/discovery' },
      { projection_owner: 'shariah_status', package_owner: '@owlfolio/ledger', route_owner: '/shariah' },
      { projection_owner: 'purification', package_owner: '@owlfolio/ledger', route_owner: '/purification' },
      { projection_owner: 'accounting', package_owner: '@owlfolio/ledger', route_owner: '/accounting' },
      { projection_owner: 'provider_status', package_owner: '@owlfolio/providers', route_owner: '/providers' },
      { projection_owner: 'audit', package_owner: '@owlfolio/ledger', route_owner: '/audit' },
      { projection_owner: 'worker_status', package_owner: '@owlfolio/ledger', route_owner: '/worker' },
      { projection_owner: 'portfolio', package_owner: '@owlfolio/ledger', route_owner: '/portfolio' },
    ])
  })
})
