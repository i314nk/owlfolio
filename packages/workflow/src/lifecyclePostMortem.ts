// Module 10 ledger event builders (deterministic). Pure functions that turn
// computed post-mortems + falsifiable forecasts + resolutions into append-ready
// ledger events. The harness computes the arithmetic; these stamp it into the
// ledger. Worker/exit flows call these; the swarm emit-wiring for forecasts is a
// small follow-up the judgment spec completes.

import type { ActorType, LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'

import { brierScore } from './forecastCalibration.js'
import { computePositionPostMortem, type PostMortemInput } from './postMortem.js'

export type BuildPostMortemEventInput = PostMortemInput & {
  ticker?: string
  actor_type?: ActorType
  actor_id?: string
  created_at: string
  post_mortem_id?: string
  causation_id?: string
}

export function buildPositionPostMortemEvent(input: BuildPostMortemEventInput): LedgerEventEnvelope<unknown> {
  const computed = computePositionPostMortem(input)
  const postMortemId = input.post_mortem_id ?? `pm_${input.holding_id}`
  return {
    event_id: `evt_${postMortemId}`,
    event_type: 'position_post_mortem_recorded',
    aggregate_type: 'holding',
    aggregate_id: input.holding_id,
    ...(input.causation_id === undefined ? {} : { causation_id: input.causation_id }),
    correlation_id: input.research_case_id,
    actor_type: input.actor_type ?? 'worker',
    ...(input.actor_id === undefined ? {} : { actor_id: input.actor_id }),
    payload: {
      post_mortem_id: postMortemId,
      holding_id: input.holding_id,
      research_case_id: input.research_case_id,
      ...(input.ticker === undefined ? {} : { ticker: input.ticker }),
      ...(computed.moat_class === undefined ? {} : { moat_class: computed.moat_class }),
      holding_period_days: computed.holding_period_days,
      total_realized_pl: computed.total_realized_pl,
      mos_protection: computed.mos_protection,
      credited_g_vs_actual: computed.credited_g_vs_actual,
      most_wrong_lane: computed.most_wrong_lane,
      is_observation: true,
      message: 'Deterministic exit post-mortem (predicted vs realized). Human may annotate; arithmetic is the harness’s.',
    },
    source_ids: [],
    created_at: input.created_at,
    schema_version: 1,
  }
}

export type BuildForecastRecordedInput = {
  forecast_id: string
  research_case_id: string
  ticker?: string
  lane: string
  claim: string
  p: number
  resolves_on: string
  actor_type?: ActorType
  actor_id?: string
  created_at: string
  causation_id?: string
}

export function buildForecastRecordedEvent(input: BuildForecastRecordedInput): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_forecast_${input.forecast_id}`,
    event_type: 'forecast_recorded',
    aggregate_type: 'research_case',
    aggregate_id: input.research_case_id,
    ...(input.causation_id === undefined ? {} : { causation_id: input.causation_id }),
    correlation_id: input.research_case_id,
    actor_type: input.actor_type ?? 'provider',
    ...(input.actor_id === undefined ? {} : { actor_id: input.actor_id }),
    payload: {
      forecast_id: input.forecast_id,
      research_case_id: input.research_case_id,
      ...(input.ticker === undefined ? {} : { ticker: input.ticker }),
      lane: input.lane,
      claim: input.claim,
      p: input.p,
      resolves_on: input.resolves_on,
    },
    source_ids: [],
    created_at: input.created_at,
    schema_version: 1,
  }
}

export type BuildForecastResolvedInput = {
  resolution_id: string
  forecast_id: string
  research_case_id: string
  ticker?: string
  lane: string
  p: number
  outcome: boolean
  resolved_on: string
  actor_type?: ActorType
  actor_id?: string
  created_at: string
  causation_id?: string
}

export function buildForecastResolvedEvent(input: BuildForecastResolvedInput): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_forecast_resolved_${input.resolution_id}`,
    event_type: 'forecast_resolved',
    aggregate_type: 'research_case',
    aggregate_id: input.research_case_id,
    ...(input.causation_id === undefined ? {} : { causation_id: input.causation_id }),
    correlation_id: input.research_case_id,
    actor_type: input.actor_type ?? 'worker',
    ...(input.actor_id === undefined ? {} : { actor_id: input.actor_id }),
    payload: {
      resolution_id: input.resolution_id,
      forecast_id: input.forecast_id,
      research_case_id: input.research_case_id,
      ...(input.ticker === undefined ? {} : { ticker: input.ticker }),
      lane: input.lane,
      p: input.p,
      outcome: input.outcome,
      brier_score: Number(brierScore(input.p, input.outcome).toFixed(6)),
      resolved_on: input.resolved_on,
    },
    source_ids: [],
    created_at: input.created_at,
    schema_version: 1,
  }
}
