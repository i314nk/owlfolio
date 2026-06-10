import type { LedgerEventEnvelope } from '../eventEnvelope'

// Projection over `forecast_recorded` + `forecast_resolved` events
// (judgment-objectivity-layer Mechanism 4). Lists the falsifiable forecasts
// attached to cases and aggregates the resolved ones into a per-lane calibration
// curve (mean Brier, empirical frequency, overconfidence). This is the read-side
// SCAFFOLD that accrues from day one; the >=30-resolved shading is wired into
// Synthesis by the judgment spec later. The Brier/aggregation arithmetic mirrors
// @owlfolio/workflow/forecastCalibration but is inlined here so the ledger layer
// keeps no dependency on the workflow package.

/** Resolved-count threshold before calibration shading activates (scaffold hook). */
export const CALIBRATION_SHADING_MIN_RESOLVED = 30

export type ForecastProjection = {
  forecast_id: string
  research_case_id?: string
  ticker?: string
  lane?: string
  claim?: string
  p?: number
  resolves_on?: string
  recorded_at: string
  resolved: boolean
  outcome?: boolean
  brier_score?: number
  resolved_on?: string
  resolved_at?: string
}

export type ForecastCalibrationCurvePoint = {
  stated_p_bucket: number
  count: number
  empirical_frequency: number
}

export type ForecastLaneCalibration = {
  lane: string
  resolved_count: number
  mean_brier: number
  mean_stated_p: number
  empirical_frequency: number
  overconfident: boolean
  calibration_curve: ForecastCalibrationCurvePoint[]
}

export type ForecastCalibrationProjection = {
  total_resolved: number
  shading_active: boolean
  lanes: ForecastLaneCalibration[]
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

function clampProbability(p: number): number {
  if (!Number.isFinite(p)) return 0.5
  if (p < 0) return 0
  if (p > 1) return 1
  return p
}

function brier(p: number, outcome: boolean): number {
  return (clampProbability(p) - (outcome ? 1 : 0)) ** 2
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits))
}

function bucketFor(p: number): number {
  return Number((Math.round(clampProbability(p) * 10) / 10).toFixed(1))
}

export function projectForecasts(events: LedgerEventEnvelope<unknown>[]): ForecastProjection[] {
  const forecasts = new Map<string, ForecastProjection>()

  for (const event of events) {
    if (!isRecord(event.payload)) continue

    if (event.event_type === 'forecast_recorded') {
      const forecastId = getString(event.payload, 'forecast_id')
      if (forecastId === undefined) continue
      const projected: ForecastProjection = {
        forecast_id: forecastId,
        recorded_at: event.created_at,
        resolved: false,
      }
      const researchCaseId = getString(event.payload, 'research_case_id') ?? event.aggregate_id
      projected.research_case_id = researchCaseId
      const ticker = getString(event.payload, 'ticker')
      if (ticker !== undefined) projected.ticker = ticker
      const lane = getString(event.payload, 'lane')
      if (lane !== undefined) projected.lane = lane
      const claim = getString(event.payload, 'claim')
      if (claim !== undefined) projected.claim = claim
      const p = getNumber(event.payload, 'p')
      if (p !== undefined) projected.p = p
      const resolvesOn = getString(event.payload, 'resolves_on')
      if (resolvesOn !== undefined) projected.resolves_on = resolvesOn
      // Preserve a resolution already applied (out-of-order replay).
      const existing = forecasts.get(forecastId)
      if (existing?.resolved) {
        projected.resolved = true
        if (existing.outcome !== undefined) projected.outcome = existing.outcome
        if (existing.brier_score !== undefined) projected.brier_score = existing.brier_score
        if (existing.resolved_on !== undefined) projected.resolved_on = existing.resolved_on
        if (existing.resolved_at !== undefined) projected.resolved_at = existing.resolved_at
      }
      forecasts.set(forecastId, projected)
      continue
    }

    if (event.event_type === 'forecast_resolved') {
      const forecastId = getString(event.payload, 'forecast_id')
      if (forecastId === undefined) continue
      const outcome = getBoolean(event.payload, 'outcome')
      const p = getNumber(event.payload, 'p')
      const existing = forecasts.get(forecastId) ?? {
        forecast_id: forecastId,
        recorded_at: event.created_at,
        resolved: false,
      }
      existing.resolved = true
      if (outcome !== undefined) existing.outcome = outcome
      if (existing.lane === undefined) {
        const lane = getString(event.payload, 'lane')
        if (lane !== undefined) existing.lane = lane
      }
      if (existing.p === undefined && p !== undefined) existing.p = p
      const recordedBrier = getNumber(event.payload, 'brier_score')
      const effectiveP = p ?? existing.p
      if (recordedBrier !== undefined) {
        existing.brier_score = recordedBrier
      } else if (outcome !== undefined && effectiveP !== undefined) {
        existing.brier_score = round(brier(effectiveP, outcome))
      }
      const resolvedOn = getString(event.payload, 'resolved_on')
      if (resolvedOn !== undefined) existing.resolved_on = resolvedOn
      existing.resolved_at = event.created_at
      const researchCaseId = getString(event.payload, 'research_case_id')
      if (existing.research_case_id === undefined && researchCaseId !== undefined) existing.research_case_id = researchCaseId
      forecasts.set(forecastId, existing)
    }
  }

  return [...forecasts.values()]
}

export function projectForecastCalibration(events: LedgerEventEnvelope<unknown>[]): ForecastCalibrationProjection {
  const resolved = projectForecasts(events).filter(
    (forecast): forecast is ForecastProjection & { lane: string; p: number; outcome: boolean } =>
      forecast.resolved && forecast.lane !== undefined && forecast.p !== undefined && forecast.outcome !== undefined,
  )

  const byLane = new Map<string, { p: number; outcome: boolean }[]>()
  for (const forecast of resolved) {
    const list = byLane.get(forecast.lane) ?? []
    list.push({ p: forecast.p, outcome: forecast.outcome })
    byLane.set(forecast.lane, list)
  }

  const lanes: ForecastLaneCalibration[] = []
  for (const [lane, items] of byLane.entries()) {
    const briers = items.map((item) => brier(item.p, item.outcome))
    const meanBrier = briers.reduce((sum, value) => sum + value, 0) / briers.length
    const meanStatedP = items.reduce((sum, item) => sum + clampProbability(item.p), 0) / items.length
    const empirical = items.reduce((sum, item) => sum + (item.outcome ? 1 : 0), 0) / items.length

    const buckets = new Map<number, { count: number; trueCount: number }>()
    for (const item of items) {
      const bucket = bucketFor(item.p)
      const entry = buckets.get(bucket) ?? { count: 0, trueCount: 0 }
      entry.count += 1
      if (item.outcome) entry.trueCount += 1
      buckets.set(bucket, entry)
    }

    lanes.push({
      lane,
      resolved_count: items.length,
      mean_brier: round(meanBrier),
      mean_stated_p: round(meanStatedP),
      empirical_frequency: round(empirical),
      overconfident: meanStatedP - empirical > 0.05,
      calibration_curve: [...buckets.entries()]
        .sort(([left], [right]) => left - right)
        .map(([bucket, entry]) => ({
          stated_p_bucket: bucket,
          count: entry.count,
          empirical_frequency: round(entry.trueCount / entry.count),
        })),
    })
  }

  return {
    total_resolved: resolved.length,
    shading_active: resolved.length >= CALIBRATION_SHADING_MIN_RESOLVED,
    lanes: lanes.sort((left, right) => left.lane.localeCompare(right.lane)),
  }
}
