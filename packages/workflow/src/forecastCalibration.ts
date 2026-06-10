// Pure, deterministic falsifiable-forecast calibration scaffold
// (judgment-objectivity-layer-spec Mechanism 4).
//
// A completed research case carries 2-3 falsifiable forecasts, each a claim with
// a stated probability `p` and a `resolves_on` marker (e.g. "FY2028 annual
// report"). When the annual report lands, the human/worker resolves the forecast
// true/false and the harness computes a Brier score `(p - outcome)^2`.
//
// This module is the ARITHMETIC + the SCAFFOLD: the Brier resolver, the per-lane
// calibration curve, and the >=30-resolved shading threshold + hook. It accrues
// from day one. The judgment-objectivity spec later WIRES the shaded weighting
// into Synthesis (treat an overconfident lane's stated 80% as 70%); that usage is
// deliberately NOT done here.

/** A falsifiable forecast attached to a completed case. */
export type CaseForecast = {
  /** Stable id within the case (for resolution + dedupe). */
  forecast_id: string
  /** The falsifiable claim, e.g. "ROIC > 15% in FY2027 and FY2028". */
  claim: string
  /** Stated probability the claim resolves true, in [0, 1]. */
  p: number
  /** Resolution marker, e.g. "FY2028 annual report". */
  resolves_on: string
  /** Which deep-dive lane authored the forecast (MOAT, VALUATION, ...). */
  lane: string
}

/** A resolved forecast: stated probability + the realized true/false outcome. */
export type ResolvedForecast = {
  lane: string
  p: number
  outcome: boolean
  /** Optional provenance for projection joins. */
  forecast_id?: string
  research_case_id?: string
  resolved_on?: string
}

/**
 * Number of resolved forecasts before calibration shading activates. Below this
 * the sample is too small to trust; at/above it the judgment spec MAY shade an
 * overconfident lane's stated probabilities down in Synthesis weighting.
 */
export const CALIBRATION_SHADING_MIN_RESOLVED = 30

function clampProbability(p: number): number {
  if (!Number.isFinite(p)) return 0.5
  if (p < 0) return 0
  if (p > 1) return 1
  return p
}

/** Brier score for a single resolved forecast: (p - outcome)^2, lower is better. */
export function brierScore(p: number, outcome: boolean): number {
  const probability = clampProbability(p)
  const realized = outcome ? 1 : 0
  return (probability - realized) ** 2
}

/**
 * Shading-activation hook. The judgment-objectivity spec wires the shaded
 * weighting into Synthesis; here we only expose the deterministic threshold test
 * so the rest of the system can be built (and tested) against a stable contract.
 */
export function shouldActivateShading(resolvedCount: number): boolean {
  return resolvedCount >= CALIBRATION_SHADING_MIN_RESOLVED
}

export type CalibrationCurvePoint = {
  /** Stated-probability bucket centre (rounded to the nearest 0.1). */
  stated_p_bucket: number
  /** Resolved forecasts in this bucket. */
  count: number
  /** Empirical frequency of `outcome === true` within the bucket. */
  empirical_frequency: number
}

export type LaneCalibration = {
  lane: string
  resolved_count: number
  /** Mean Brier score across the lane's resolved forecasts (lower is better). */
  mean_brier: number
  /** Mean stated probability across the lane's resolved forecasts. */
  mean_stated_p: number
  /** Empirical frequency of true outcomes across the lane. */
  empirical_frequency: number
  /** True when mean stated p materially exceeds empirical frequency. */
  overconfident: boolean
  /** Bucketed stated-p → empirical-frequency curve. */
  calibration_curve: CalibrationCurvePoint[]
  /** Scaffold flag: whether the lane has enough data for shading to activate. */
  shading_active: boolean
}

function bucketFor(p: number): number {
  // Round to the nearest 0.1 bucket; keep it numerically clean.
  return Number((Math.round(clampProbability(p) * 10) / 10).toFixed(1))
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits))
}

/**
 * Per-lane calibration: for each lane, the resolved forecasts, mean Brier, the
 * empirical true-frequency, an overconfidence flag, and a stated-p→empirical
 * calibration curve. Deterministic aggregation only — no model.
 */
export function computeLaneCalibration(resolved: ResolvedForecast[]): LaneCalibration[] {
  const byLane = new Map<string, ResolvedForecast[]>()
  for (const forecast of resolved) {
    if (!Number.isFinite(forecast.p)) continue
    const list = byLane.get(forecast.lane) ?? []
    list.push(forecast)
    byLane.set(forecast.lane, list)
  }

  const lanes: LaneCalibration[] = []
  for (const [lane, forecasts] of byLane.entries()) {
    const briers = forecasts.map((forecast) => brierScore(forecast.p, forecast.outcome))
    const statedPs = forecasts.map((forecast) => clampProbability(forecast.p))
    const empirical = mean(forecasts.map((forecast) => (forecast.outcome ? 1 : 0)))
    const meanStatedP = mean(statedPs)

    const buckets = new Map<number, { count: number; trueCount: number }>()
    for (const forecast of forecasts) {
      const bucket = bucketFor(forecast.p)
      const entry = buckets.get(bucket) ?? { count: 0, trueCount: 0 }
      entry.count += 1
      if (forecast.outcome) entry.trueCount += 1
      buckets.set(bucket, entry)
    }

    const calibrationCurve: CalibrationCurvePoint[] = [...buckets.entries()]
      .sort(([left], [right]) => left - right)
      .map(([bucket, entry]) => ({
        stated_p_bucket: bucket,
        count: entry.count,
        empirical_frequency: round(entry.trueCount / entry.count),
      }))

    lanes.push({
      lane,
      resolved_count: forecasts.length,
      mean_brier: round(mean(briers)),
      mean_stated_p: round(meanStatedP),
      empirical_frequency: round(empirical),
      // Overconfident when the lane claims more confidence than it earns. A small
      // tolerance avoids flagging noise; the shaded WEIGHTING is the judgment
      // spec's job and only after shading_active.
      overconfident: meanStatedP - empirical > 0.05,
      calibration_curve: calibrationCurve,
      shading_active: shouldActivateShading(forecasts.length),
    })
  }

  return lanes.sort((left, right) => left.lane.localeCompare(right.lane))
}
