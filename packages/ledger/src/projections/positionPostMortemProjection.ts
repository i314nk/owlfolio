import type { LedgerEventEnvelope } from '../eventEnvelope'

// Projection over `position_post_mortem_recorded` events (lifecycle-spec-v3
// Module 10). One latest post-mortem per holding, locking the deterministic
// predicted-vs-realized arithmetic into the position record. Read-only; the
// arithmetic is computed in @owlfolio/workflow/postMortem and stored verbatim.

export type PostMortemMosProtectionProjection = {
  entry_discount_to_fv?: number
  required_mos?: number
  held?: boolean
  realized_low_discount_to_fv?: number
  note?: string
}

export type PostMortemCreditedGProjection = {
  computable: boolean
  predicted_g?: number
  actual_g?: number
  over_credited?: boolean
  reason?: string
}

export type PostMortemMostWrongLaneProjection = {
  basis?: string
  lane?: string
  brier?: number
  note?: string
}

export type PositionPostMortemProjection = {
  post_mortem_id: string
  holding_id: string
  research_case_id?: string
  ticker?: string
  moat_class?: string
  holding_period_days?: number
  total_realized_pl?: number
  mos_protection: PostMortemMosProtectionProjection
  credited_g_vs_actual: PostMortemCreditedGProjection
  most_wrong_lane: PostMortemMostWrongLaneProjection
  recorded_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function getNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key]
  return typeof value === 'boolean' ? value : undefined
}

function projectMos(value: unknown): PostMortemMosProtectionProjection {
  if (!isRecord(value)) return {}
  const projected: PostMortemMosProtectionProjection = {}
  const entryDiscount = getNumber(value, 'entry_discount_to_fv')
  if (entryDiscount !== undefined) projected.entry_discount_to_fv = entryDiscount
  const requiredMos = getNumber(value, 'required_mos')
  if (requiredMos !== undefined) projected.required_mos = requiredMos
  const held = getBoolean(value, 'held')
  if (held !== undefined) projected.held = held
  const realizedLow = getNumber(value, 'realized_low_discount_to_fv')
  if (realizedLow !== undefined) projected.realized_low_discount_to_fv = realizedLow
  const note = getString(value, 'note')
  if (note !== undefined) projected.note = note
  return projected
}

function projectCreditedG(value: unknown): PostMortemCreditedGProjection {
  if (!isRecord(value)) return { computable: false }
  const projected: PostMortemCreditedGProjection = { computable: getBoolean(value, 'computable') ?? false }
  const predictedG = getNumber(value, 'predicted_g')
  if (predictedG !== undefined) projected.predicted_g = predictedG
  const actualG = getNumber(value, 'actual_g')
  if (actualG !== undefined) projected.actual_g = actualG
  const overCredited = getBoolean(value, 'over_credited')
  if (overCredited !== undefined) projected.over_credited = overCredited
  const reason = getString(value, 'reason')
  if (reason !== undefined) projected.reason = reason
  return projected
}

function projectMostWrongLane(value: unknown): PostMortemMostWrongLaneProjection {
  if (!isRecord(value)) return {}
  const projected: PostMortemMostWrongLaneProjection = {}
  const basis = getString(value, 'basis')
  if (basis !== undefined) projected.basis = basis
  const lane = getString(value, 'lane')
  if (lane !== undefined) projected.lane = lane
  const brier = getNumber(value, 'brier')
  if (brier !== undefined) projected.brier = brier
  const note = getString(value, 'note')
  if (note !== undefined) projected.note = note
  return projected
}

export function projectPositionPostMortems(events: LedgerEventEnvelope<unknown>[]): PositionPostMortemProjection[] {
  const byHolding = new Map<string, PositionPostMortemProjection>()

  for (const event of events) {
    if (event.event_type !== 'position_post_mortem_recorded' || !isRecord(event.payload)) {
      continue
    }
    const holdingId = getString(event.payload, 'holding_id') ?? event.aggregate_id
    const existing = byHolding.get(holdingId)
    if (existing !== undefined && existing.recorded_at > event.created_at) {
      continue
    }

    const projected: PositionPostMortemProjection = {
      post_mortem_id: getString(event.payload, 'post_mortem_id') ?? event.event_id,
      holding_id: holdingId,
      mos_protection: projectMos(event.payload['mos_protection']),
      credited_g_vs_actual: projectCreditedG(event.payload['credited_g_vs_actual']),
      most_wrong_lane: projectMostWrongLane(event.payload['most_wrong_lane']),
      recorded_at: event.created_at,
    }
    const researchCaseId = getString(event.payload, 'research_case_id')
    if (researchCaseId !== undefined) projected.research_case_id = researchCaseId
    const ticker = getString(event.payload, 'ticker')
    if (ticker !== undefined) projected.ticker = ticker
    const moatClass = getString(event.payload, 'moat_class')
    if (moatClass !== undefined) projected.moat_class = moatClass
    const holdingPeriodDays = getNumber(event.payload, 'holding_period_days')
    if (holdingPeriodDays !== undefined) projected.holding_period_days = holdingPeriodDays
    const totalRealizedPl = getNumber(event.payload, 'total_realized_pl')
    if (totalRealizedPl !== undefined) projected.total_realized_pl = totalRealizedPl

    byHolding.set(holdingId, projected)
  }

  return [...byHolding.values()]
}

/** Returns the latest post-mortem for a holding, or undefined. */
export function findPostMortemForHolding(
  events: LedgerEventEnvelope<unknown>[],
  holdingId: string,
): PositionPostMortemProjection | undefined {
  return projectPositionPostMortems(events).find((entry) => entry.holding_id === holdingId)
}

/** Returns the latest post-mortem for a research case, or undefined. */
export function findPostMortemForResearchCase(
  events: LedgerEventEnvelope<unknown>[],
  researchCaseId: string,
): PositionPostMortemProjection | undefined {
  return projectPositionPostMortems(events).find((entry) => entry.research_case_id === researchCaseId)
}
