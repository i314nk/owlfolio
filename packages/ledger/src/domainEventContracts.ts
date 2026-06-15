import type { ActorType, AggregateType } from './eventEnvelope'

export type DomainProjectionOwner =
  | 'discovery'
  | 'shariah_status'
  | 'purification'
  | 'accounting'
  | 'provider_status'
  | 'audit'
  | 'worker_status'
  | 'portfolio'

export type DomainEventContract = {
  event_type: DomainEventType
  aggregate_type: AggregateType
  actor_type: ActorType
  actor_types?: readonly ActorType[]
  projection_owner: DomainProjectionOwner
  payload_fields: readonly string[]
}

export type DomainProjectionContract = {
  projection_owner: DomainProjectionOwner
  package_owner: '@owlfolio/ledger' | '@owlfolio/providers'
  route_owner: string
}

export const domainEventTypes = [
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
  'position_post_mortem_recorded',
  'forecast_recorded',
  'forecast_resolved',
  'admit_judgment_recorded',
] as const

export type DomainEventType = (typeof domainEventTypes)[number]

export const domainEventContracts: readonly DomainEventContract[] = [
  {
    event_type: 'discovery_candidate_discovered',
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
      // Optional structured provenance for non-mock discovery sources (e.g. source:'13f_clone' carries
      // signal_type / contributing_managers / conviction_pct / ticker_resolution). Absent for
      // strategy-screen / user-submitted candidates.
      'discovery_metadata',
    ],
  },
  {
    event_type: 'discovery_candidate_queued_for_quick_screen',
    aggregate_type: 'discovery_candidate',
    actor_type: 'system',
    projection_owner: 'discovery',
    payload_fields: ['candidate_id', 'queue_id', 'status'],
  },
  {
    event_type: 'discovery_candidate_rejected',
    aggregate_type: 'discovery_candidate',
    actor_type: 'user',
    projection_owner: 'discovery',
    payload_fields: ['candidate_id', 'reason', 'status'],
  },
  {
    event_type: 'discovery_candidate_promoted_to_research_case',
    aggregate_type: 'discovery_candidate',
    actor_type: 'user',
    projection_owner: 'discovery',
    payload_fields: ['candidate_id', 'research_case_id', 'research_case_event_id', 'status'],
  },
  {
    event_type: 'queued_for_deep_dive',
    aggregate_type: 'research_case',
    actor_type: 'system',
    projection_owner: 'discovery',
    payload_fields: ['research_case_id', 'queue_id', 'candidate_id', 'strategy_id', 'strategy_version', 'source_ids'],
  },
  {
    event_type: 'deep_dive_started',
    aggregate_type: 'research_case',
    actor_type: 'worker',
    projection_owner: 'discovery',
    payload_fields: ['research_case_id', 'deep_dive_id', 'candidate_id', 'strategy_id', 'strategy_version', 'specialist_lanes', 'source_ids'],
  },
  {
    event_type: 'specialist_finding_recorded',
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
  },
  {
    event_type: 'deep_dive_synthesis_drafted',
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
  },
  {
    event_type: 'deep_dive_completed',
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
  },
  {
    event_type: 'holding_valuation_recorded',
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
  },
  {
    event_type: 'scheduled_task_defined',
    aggregate_type: 'scheduled_task',
    actor_type: 'user',
    projection_owner: 'worker_status',
    payload_fields: ['scheduled_task_id', 'task_kind', 'cadence', 'enabled'],
  },
  {
    event_type: 'scheduled_task_run_started',
    aggregate_type: 'scheduled_task',
    actor_type: 'worker',
    projection_owner: 'worker_status',
    payload_fields: ['scheduled_task_id', 'run_id', 'started_at'],
  },
  {
    event_type: 'scheduled_task_run_completed',
    aggregate_type: 'scheduled_task',
    actor_type: 'worker',
    projection_owner: 'worker_status',
    payload_fields: ['scheduled_task_id', 'run_id', 'completed_at', 'result_summary'],
  },
  {
    event_type: 'scheduled_task_run_failed',
    aggregate_type: 'scheduled_task',
    actor_type: 'worker',
    projection_owner: 'worker_status',
    payload_fields: ['scheduled_task_id', 'run_id', 'failed_at', 'error_summary'],
  },
  {
    event_type: 'provider_run_started',
    aggregate_type: 'provider_run',
    actor_type: 'worker',
    projection_owner: 'provider_status',
    payload_fields: ['provider_run_id', 'provider_id', 'model_id', 'task_kind', 'started_at'],
  },
  {
    event_type: 'provider_run_completed',
    aggregate_type: 'provider_run',
    actor_type: 'provider',
    projection_owner: 'provider_status',
    payload_fields: ['provider_run_id', 'provider_id', 'model_id', 'completed_at', 'finish_reason'],
  },
  {
    event_type: 'provider_run_failed',
    aggregate_type: 'provider_run',
    actor_type: 'provider',
    projection_owner: 'provider_status',
    payload_fields: ['provider_run_id', 'provider_id', 'model_id', 'failed_at', 'error_summary'],
  },
  {
    event_type: 'certification_report_recorded',
    aggregate_type: 'provider_run',
    actor_type: 'worker',
    projection_owner: 'provider_status',
    payload_fields: ['certification_report_id', 'provider_id', 'support_level', 'generated_at', 'cases'],
  },
  {
    event_type: 'shariah_evaluation_recorded',
    aggregate_type: 'holding',
    actor_type: 'provider',
    projection_owner: 'shariah_status',
    payload_fields: ['evaluation_id', 'holding_id', 'status', 'policy_basis', 'source_ids'],
  },
  {
    event_type: 'shariah_status_changed',
    aggregate_type: 'holding',
    actor_type: 'user',
    projection_owner: 'shariah_status',
    payload_fields: ['holding_id', 'previous_status', 'new_status', 'changed_reason'],
  },
  {
    event_type: 'shariah_gate_decision_recorded',
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
  },
  {
    event_type: 'purification_obligation_recorded',
    aggregate_type: 'purification_entry',
    actor_type: 'worker',
    projection_owner: 'purification',
    payload_fields: ['obligation_id', 'holding_id', 'amount', 'currency', 'period_start', 'period_end'],
  },
  {
    event_type: 'purification_payment_recorded',
    aggregate_type: 'purification_entry',
    actor_type: 'user',
    projection_owner: 'purification',
    payload_fields: ['payment_id', 'obligation_id', 'amount', 'currency', 'paid_at', 'recipient'],
  },
  {
    event_type: 'accounting_snapshot_recorded',
    aggregate_type: 'accounting_snapshot',
    actor_type: 'worker',
    projection_owner: 'accounting',
    payload_fields: [
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
    ],
  },
  {
    event_type: 'cash_deposited',
    aggregate_type: 'cash_account',
    actor_type: 'user',
    projection_owner: 'accounting',
    payload_fields: ['cash_account_id', 'amount', 'currency', 'deposited_at'],
  },
  {
    event_type: 'cash_withdrawn',
    aggregate_type: 'cash_account',
    actor_type: 'user',
    projection_owner: 'accounting',
    payload_fields: ['cash_account_id', 'amount', 'currency', 'withdrawn_at'],
  },
  {
    event_type: 'dividend_income_recorded',
    aggregate_type: 'cash_account',
    actor_type: 'user',
    projection_owner: 'accounting',
    payload_fields: ['dividend_id', 'holding_id', 'cash_account_id', 'amount', 'currency', 'received_at', 'taxable_status'],
  },
  {
    event_type: 'fee_charged',
    aggregate_type: 'cash_account',
    actor_type: 'user',
    projection_owner: 'accounting',
    payload_fields: ['fee_id', 'cash_account_id', 'amount', 'currency', 'charged_at', 'fee_type'],
  },
  {
    event_type: 'holding_realized_gain_loss_recorded',
    aggregate_type: 'holding',
    actor_type: 'user',
    projection_owner: 'accounting',
    payload_fields: ['realized_gain_loss_id', 'holding_id', 'amount', 'currency', 'realized_at'],
  },
  {
    event_type: 'research_run_requested',
    aggregate_type: 'research_case',
    actor_type: 'user',
    projection_owner: 'worker_status',
    payload_fields: ['research_case_id', 'ticker', 'company_id', 'strategy_id', 'model_id', 'requested_by', 'decision_id'],
  },
  {
    event_type: 'research_run_claimed',
    aggregate_type: 'research_case',
    actor_type: 'worker',
    projection_owner: 'worker_status',
    payload_fields: ['research_case_id', 'run_id', 'claimed_at', 'worker_id'],
  },
  {
    event_type: 'research_run_failed',
    aggregate_type: 'research_case',
    actor_type: 'worker',
    projection_owner: 'worker_status',
    payload_fields: ['research_case_id', 'run_id', 'failed_at', 'error_summary'],
  },
  {
    event_type: 'deep_dive_approval_pending',
    aggregate_type: 'research_case',
    actor_type: 'system',
    projection_owner: 'worker_status',
    payload_fields: [
      'research_case_id',
      'ticker',
      'company_id',
      'quick_screen_source_ids',
      'quick_screen_event_id',
      'decision_id',
      'source_ledger_path',
      'strategy_id',
      'model_id',
    ],
  },
  {
    event_type: 'deep_dive_run_requested',
    aggregate_type: 'research_case',
    actor_type: 'user',
    projection_owner: 'worker_status',
    payload_fields: [
      'research_case_id',
      'ticker',
      'requested_by',
    ],
  },
  {
    event_type: 'investable_capital_set',
    aggregate_type: 'portfolio',
    actor_type: 'user',
    projection_owner: 'portfolio',
    payload_fields: ['amount', 'currency', 'as_of'],
  },
  {
    // Versioned valuation-parameter config change (valuation-recalibration-spec §1). Append-only audit
    // record of which valuation constants changed, enforcing the §3.4 anti-drift rule.
    event_type: 'valuation_config',
    aggregate_type: 'strategy',
    actor_type: 'user',
    projection_owner: 'audit',
    payload_fields: ['previous_version', 'new_version', 'changes'],
  },
  {
    // On-demand request to RUN a calibration backtest (valuation-recalibration-spec §3 — calibration is a
    // deliberate, enqueued action, NOT a default schedule). User-authored; the worker claims it, runs the
    // deterministic observation-only backtest over the user-curated universe, and records a calibration_run.
    event_type: 'calibration_run_requested',
    aggregate_type: 'strategy',
    actor_type: 'user',
    projection_owner: 'audit',
    payload_fields: ['calibration_run_id', 'strategy_id', 'universe_version', 'requested_by'],
  },
  {
    // Calibration backtest run (valuation-recalibration-spec §3.3): logs the calibration run as a ledger
    // artifact — the valuation_params version + values used, the universe version + name(s) backtested, the
    // signal-log summary (buys/yr, BUY episodes, sanity-window results, per-ladder deployment ratio), and
    // the non-US COVERAGE report (resolved_edgar / resolved_local_manual / unresolved). Append-only audit
    // record so the §3.4 anti-drift rule is enforceable (post-go-live param changes require a re-run).
    event_type: 'calibration_run',
    aggregate_type: 'strategy',
    actor_type: 'user',
    actor_types: ['user', 'worker'],
    projection_owner: 'audit',
    payload_fields: ['params_version', 'params', 'universe_version', 'universe', 'summaries', 'coverage', 'target'],
  },
  {
    // User ADDS a ticker to the calibration universe (valuation-recalibration-spec §3.1 — the universe is
    // USER-OWNED). Curation is REVERSIBLE list-editing, so this is a DIRECT user-authored event (the owner
    // is authoring by clicking — not the irreversible draft-for-confirmation pattern). The current universe
    // is projected from the seed config + these events; re-adding an active ticker is a no-op.
    event_type: 'calibration_universe_member_added',
    aggregate_type: 'strategy',
    actor_type: 'user',
    projection_owner: 'audit',
    payload_fields: ['ticker', 'company', 'market'],
  },
  {
    // User REMOVES a ticker from the calibration universe (tombstones it — a seed name is suppressed from the
    // projection until re-added). Direct user-authored, reversible. Owner: audit.
    event_type: 'calibration_universe_member_removed',
    aggregate_type: 'strategy',
    actor_type: 'user',
    projection_owner: 'audit',
    payload_fields: ['ticker'],
  },
  {
    // Watchlist Monitor (lifecycle-spec-v3 Module 6) observation: buy-window / staleness-suppression /
    // re-run-needed / quarterly Shariah re-screen. Worker-authored OBSERVATION — never a recommendation
    // to act and never a state advance. A BUY-WINDOW alert is only valid on a fresh, gate-clean case;
    // stale cheapness is suppressed (buy_window_alert=false, rerun_needed=true).
    event_type: 'watchlist_monitor_alert_recorded',
    aggregate_type: 'watchlist_item',
    actor_type: 'worker',
    projection_owner: 'portfolio',
    payload_fields: [
      'alert_id',
      'watchlist_item_id',
      'research_case_id',
      'ticker',
      'alert_kind',
      'buy_window_alert',
      'suppressed',
      'suppression_reason',
      'rerun_needed',
      'discount_to_buy_pct',
      'case_age_months',
      'shariah_verdict',
      'propose_removal',
      'is_observation',
      'is_recommendation',
      'message',
    ],
  },
  {
    // Holdings Monitor (lifecycle-spec-v3 Module 7) observation: tranche-review (thesis-gated) /
    // concentration trim-review / annual re-run flag / Shariah re-screen. Worker-authored OBSERVATION —
    // advisory only; never an auto-trade, auto-trim, or state advance.
    event_type: 'holding_monitor_alert_recorded',
    aggregate_type: 'holding',
    actor_type: 'worker',
    projection_owner: 'portfolio',
    payload_fields: [
      'alert_id',
      'holding_id',
      'research_case_id',
      'ticker',
      'alert_kind',
      'tranche_review_alert',
      'triggered_tranches',
      'thesis_gated_note',
      // position-sizing-spec lot-tag fields (§2 ladder, §3 re-anchoring version, §4 trigger type, §5.5
      // deployed %). Carried on the alert so the human's confirm event can record the lot tags
      // (tranche_id, trigger_type, buy_price_version). Advisory only — never an auto-fill.
      'ladder_id',
      'tranche_id',
      'trigger_type',
      'buy_price_version',
      'deployed_pct',
      'target_weight',
      'tranche_blocked',
      'tranche_block_reason',
      'trim_review_alert',
      'weight_pct',
      'rerun_needed',
      'case_age_months',
      'shariah_verdict',
      'is_observation',
      'is_recommendation',
      'message',
    ],
  },
  {
    // Holdings Monitor Shariah-breach grace clock start (lifecycle-spec-v3 Module 7 / AAOIFI practice).
    // Worker-authored OBSERVATION recording the 90-day grace deadline; the breach must be resolved or the
    // human authors a divest before the deadline. Not a state advance.
    event_type: 'holding_shariah_grace_started',
    aggregate_type: 'holding',
    actor_type: 'worker',
    projection_owner: 'portfolio',
    payload_fields: [
      'grace_id',
      'holding_id',
      'ticker',
      'started_at',
      'deadline',
      'grace_days',
      'shariah_verdict',
      'reason',
      'is_observation',
      'message',
    ],
  },
  {
    // SELL-REVIEW / DIVEST-REQUIRED draft scaffold (lifecycle-spec-v3 Module 7 sell discipline).
    // Worker-authored DRAFT — a human-authored-exit PROPOSAL, never an execution and never a
    // recommendation. requires_user_authoring=true gates the exit; the event-driven thesis-break trigger
    // DETECTION is the deferred T3 piece (deferred_detection_note carries the seam).
    event_type: 'holding_sell_review_drafted',
    aggregate_type: 'holding',
    actor_type: 'worker',
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
    ],
  },
  {
    // Exit post-mortem (lifecycle-spec-v3 Module 10 + strategy-additions-spec #5).
    // Deterministic predicted-vs-realized record locked into the position on EXIT:
    // MOS protection, credited-g vs actual, which lane was most wrong. Worker-authored
    // ARITHMETIC (the harness computes; a human may annotate). Feeds calibration.
    event_type: 'position_post_mortem_recorded',
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
  },
  {
    // Falsifiable forecast attached to a completed case (judgment-objectivity-layer
    // Mechanism 4). SCAFFOLD: the field exists + is storable from day one; the swarm
    // emit-wiring is a follow-up the judgment spec completes. A claim + stated p +
    // resolves_on + lane; resolves on annual reports.
    event_type: 'forecast_recorded',
    aggregate_type: 'research_case',
    actor_type: 'provider',
    actor_types: ['provider', 'system', 'user', 'worker'],
    projection_owner: 'portfolio',
    payload_fields: [
      'forecast_id',
      'research_case_id',
      'ticker',
      'lane',
      'claim',
      'p',
      'resolves_on',
    ],
  },
  {
    // Forecast resolution (judgment-objectivity-layer Mechanism 4). On the annual
    // report / re-run cadence the human/worker resolves a due forecast true/false and
    // the harness records the Brier score. Feeds the per-lane calibration curve; the
    // >=30-resolved shading is wired into Synthesis by the judgment spec later.
    event_type: 'forecast_resolved',
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
  },
  {
    // Admit-judgment recommendation (Phase 4, Task 4.2c). An agent-authored OBSERVATION computed FRESH
    // on-demand when the human opens the admit step for a deep-dive-complete, gate-passing candidate:
    // the independent impairment bear case + the two grounded risk fields (uncertainty / permanent-loss),
    // the deterministic impairment_call + admittable RECOMMENDATION flag, the buy-below carried from
    // Phase-1 valuation, and the cheapness summary (Phase-1 OE / EV). It does NOT admit anything — the
    // human still admits via the watchlist_draft confirm (signed thesis). Grounded/cite-checked; the
    // newest recorded recommendation wins (recomputed fresh each time the route is invoked).
    event_type: 'admit_judgment_recorded',
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
  },
] as const

export const domainProjectionContracts: readonly DomainProjectionContract[] = [
  { projection_owner: 'discovery', package_owner: '@owlfolio/ledger', route_owner: '/research/discovery' },
  { projection_owner: 'shariah_status', package_owner: '@owlfolio/ledger', route_owner: '/shariah' },
  { projection_owner: 'purification', package_owner: '@owlfolio/ledger', route_owner: '/purification' },
  { projection_owner: 'accounting', package_owner: '@owlfolio/ledger', route_owner: '/accounting' },
  { projection_owner: 'provider_status', package_owner: '@owlfolio/providers', route_owner: '/providers' },
  { projection_owner: 'audit', package_owner: '@owlfolio/ledger', route_owner: '/audit' },
  { projection_owner: 'worker_status', package_owner: '@owlfolio/ledger', route_owner: '/worker' },
  { projection_owner: 'portfolio', package_owner: '@owlfolio/ledger', route_owner: '/portfolio' },
]
