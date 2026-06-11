// Position-sizing & tranche engine (position-sizing-spec §2–§5).
//
// Pure + deterministic: callers inject the current price, the holding's chosen ladder + filled tranches,
// and the research case's buy price / version / staleness / thesis-break status. No live fetch here.
//
// Principle (spec preamble): "tranches buy information, not just price." A lower price is information; so
// is time plus a clean thesis re-check (time-completion, §4). Sizing is advisory and capital-driven — the
// engine emits OBSERVATIONS/DRAFTS only; the human authors every fill (spec §5.4).
//
// CONFIG-DRIVEN (acceptance #7): every number — ladder fractions, trigger multipliers, the regime
// threshold, time_completion_months — is read from SIZING_PARAMS. Nothing is hardcoded here.
//
// SLEEVES DEFERRED (spec §6, owner directive): the 15% cap is enforced PER NAME for the single strategy.
// `sleeve_id` is a defaulted seam so the sleeve-preset hook is not designed out; no sleeve handling is
// built.
//
// TEMPERATURE DEFERRED: suggestLadder takes an OPTIONAL temperature and defaults to the configured
// default ladder when absent. The human-confirmed-then-immutable SELECTION mechanism is built now; only
// the temperature INPUT is hooked/defaulted until the Marks overlay lands.

import {
  SIZING_PARAMS,
  TRANCHE_TRIGGER_MULTIPLIER,
  type LadderId,
  type SizingParams,
} from '@owlfolio/strategies/sizingParams'

/** The default sleeve id for the single Buffett-Munger strategy (sleeve seam; not multi-sleeve). */
export const MAIN_SLEEVE_ID = 'buffett-munger'

function round4(value: number): number {
  return Number(value.toFixed(4))
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// ---------------------------------------------------------------------------
// Ladder selection (spec §2) — suggested by temperature, human-confirmed, then immutable
// ---------------------------------------------------------------------------

/**
 * Suggest a ladder id from the regime temperature (spec §2). temperature ≥ threshold+1 → cold (the
 * dislocation 40/30/30 ladder earns its keep); temperature ≤ threshold → normal (60/40).
 *
 * TEMPERATURE IS DEFERRED: when no temperature is available (the Marks overlay has not landed) this
 * DEFAULTS to `params.default_ladder` (normal). This is the hook — wire the real temperature input here
 * once the overlay exists; the selection/confirmation/immutability mechanism below is already built.
 */
export function suggestLadder(temperature?: number, params: SizingParams = SIZING_PARAMS): LadderId {
  if (!isFiniteNumber(temperature)) {
    return params.default_ladder
  }
  return temperature > params.regime_temperature_threshold ? 'cold' : 'normal'
}

/**
 * Confirm a ladder for a position at T1 (spec §2). The selection is suggested by the harness and
 * CONFIRMED by the human in the T1 ledger entry; thereafter it is IMMUTABLE for the position (no
 * mid-position ladder switching). A position therefore CARRIES its confirmed ladder id; subsequent
 * evaluations must pass that same id back in — never re-derive it from a (possibly changed) temperature.
 *
 * If a position already carries a confirmed ladder, this returns it unchanged (immutability guard);
 * otherwise it returns the human-confirmed choice (defaulting to the temperature suggestion).
 */
export function confirmLadderForPosition(args: {
  /** The ladder already fixed on the position, if any (immutable once set). */
  existing_ladder_id?: LadderId
  /** The human-confirmed selection at T1 (defaults to the temperature suggestion). */
  confirmed_ladder_id?: LadderId
  temperature?: number
  params?: SizingParams
}): { ladder_id: LadderId; immutable: true; reason: string } {
  const params = args.params ?? SIZING_PARAMS
  if (args.existing_ladder_id !== undefined) {
    return {
      ladder_id: args.existing_ladder_id,
      immutable: true,
      reason: 'position already carries a confirmed ladder — immutable (no mid-position switching)',
    }
  }
  const chosen = args.confirmed_ladder_id ?? suggestLadder(args.temperature, params)
  return {
    ladder_id: chosen,
    immutable: true,
    reason: 'ladder confirmed at T1 — fixed for this position thereafter',
  }
}

// ---------------------------------------------------------------------------
// Tranche levels (spec §2 + §3 re-anchoring)
// ---------------------------------------------------------------------------

export type TrancheLevel = {
  id: string
  fraction: number
  /** The price at/below which this rung's PRICE trigger fires (buy × trigger multiplier). */
  trigger_price: number
  /** The buy-price version this level was computed against (spec §3). */
  buy_price_version: string
}

/**
 * Compute the price level for each rung of a ladder against a buy price (spec §2). T1 at buy, T2 at
 * buy×0.90, T3 at buy×0.80 — all multipliers read from config. Every level is tagged with the
 * buy_price_version so a ledger alert records the version it was computed against (spec §3).
 */
export function computeTrancheLevels(
  buyPrice: number,
  ladderId: LadderId,
  buyPriceVersion: string,
  params: SizingParams = SIZING_PARAMS,
): TrancheLevel[] {
  const ladder = params.ladders[ladderId]
  return ladder.rungs.map((rung) => ({
    id: rung.id,
    fraction: rung.fraction,
    trigger_price: round4(buyPrice * TRANCHE_TRIGGER_MULTIPLIER[rung.trigger]),
    buy_price_version: buyPriceVersion,
  }))
}

/**
 * Re-anchoring (spec §3): every thesis re-check recomputes FV/buy. ALL UNTRIGGERED tranche levels
 * re-anchor to the new buy price immediately; the old price path is irrelevant. Filled tranches are not
 * re-anchored (they are done). Returns the re-anchored untriggered levels tagged with the NEW
 * buy_price_version. The caller resets the time-completion clock on a re-anchor (spec §4).
 */
export function reanchorTrancheLevels(args: {
  new_buy_price: number
  ladder_id: LadderId
  new_buy_price_version: string
  filled_tranche_ids: readonly string[]
  params?: SizingParams
}): TrancheLevel[] {
  const params = args.params ?? SIZING_PARAMS
  const filled = new Set(args.filled_tranche_ids)
  return computeTrancheLevels(args.new_buy_price, args.ladder_id, args.new_buy_price_version, params)
    .filter((level) => !filled.has(level.id))
}

// ---------------------------------------------------------------------------
// Deployment tracking (spec §5.5) — deployed % vs target; report, never nag
// ---------------------------------------------------------------------------

/**
 * Deployed fraction of the target position (spec §5.5): sum of the FILLED rungs' fractions vs 1.0. The
 * harness REPORTS this; it never nags. Unknown rung ids are ignored (defensive).
 */
export function computeDeployedPct(
  ladderId: LadderId,
  filledTrancheIds: readonly string[],
  params: SizingParams = SIZING_PARAMS,
): number {
  const filled = new Set(filledTrancheIds)
  const deployed = params.ladders[ladderId].rungs
    .filter((rung) => filled.has(rung.id))
    .reduce((sum, rung) => sum + rung.fraction, 0)
  return round4(deployed)
}

// ---------------------------------------------------------------------------
// The tranche-alert decision (spec §2 price trigger + §4 time-completion + §5 discipline)
// ---------------------------------------------------------------------------

export type TrancheTriggerType = 'price' | 'time_completion'

export type SizingTrancheBlockReason =
  | 'thesis_break_unresolved'
  | 'stale_case'
  | 'per_name_cap_reached'

export type SizingCaseStatus = {
  /** The current (re-anchored) buy price per share. */
  buy_price: number
  /** The version label of the current buy price (spec §3 — recorded on every alert). */
  buy_price_version: string
  /** True when ANY thesis-break trigger is unresolved (spec §5.1 — blocks T2/T3 regardless of price). */
  thesis_break_unresolved: boolean
  /** True when the case is stale (>12mo / pre-annual-report) — forces a re-run first (spec §5.3). */
  stale: boolean
  /** Reason text for staleness (surfaced in the block log). */
  stale_reason?: string
  /** True when the most recent SCHEDULED thesis re-check is clean (gates time-completion, spec §4). */
  recheck_clean: boolean
}

export type SizingPositionStatus = {
  /** The position's confirmed, immutable ladder id (spec §2). */
  ladder_id: LadderId
  /** Tranche ids already filled (so a filled rung does not re-fire; anchors deployment + clock). */
  filled_tranche_ids: readonly string[]
  /**
   * Months since the LAST tranche fill (or since the last re-anchor — whichever resets the clock most
   * recently, spec §4). Drives time-completion. Undefined → time-completion not evaluated.
   */
  months_since_last_fill?: number
  /** Current position weight as a fraction of investable capital (spec §1 §5 per-name cap check). */
  current_weight?: number
}

export type SizingTrancheAlert = {
  /** True when an alert fires (a DRAFT/observation; the human authors the fill). */
  alert: boolean
  /** The rung this alert is for (the next untriggered rung), when one fired. */
  tranche_id?: string
  /** Why it fired: a price trigger or time-completion (spec §2/§4). */
  trigger_type?: TrancheTriggerType
  /** The buy-price version the alert was computed against (spec §3). */
  buy_price_version: string
  /** The trigger price level for the rung (re-anchored). */
  trigger_price?: number
  ladder_id: LadderId
  /** Deployed fraction of target (spec §5.5) — reported, never a nag. */
  deployed_pct: number
  /** True when the alert was suppressed; `block_reason` says why (spec §5.1/§5.3 + cap). */
  blocked: boolean
  block_reason?: SizingTrancheBlockReason
  /** True when the case must be re-run before any tranche alert is valid (spec §5.3). */
  rerun_needed: boolean
  /** Always a draft/observation — never an execution or auto-fill (spec §5.4). */
  is_observation: true
  is_recommendation: false
  message: string
}

const THESIS_GATE_NOTE =
  'thesis re-check FIRST, then deploy — never mechanical averaging-down. This alert is a DRAFT; the human authors the fill with lot tags (tranche_id, trigger_type, buy_price_version).'

/**
 * The core tranche-alert decision (spec §2 + §4 + §5). Determines whether the NEXT untriggered rung
 * should raise a DRAFT tranche alert, by price (≤ the re-anchored level) or by time-completion (≥
 * time_completion_months at/below buy + a clean re-check), subject to the discipline gates:
 *
 *   §5.1 thesis-break unresolved → BLOCKED regardless of price.
 *   §5.3 stale case (>12mo / pre-annual) → BLOCKED, re-run forced first.
 *   §1/§5  per-name cap (15%) reached → cap-review flag (no further tranche; sleeves deferred → per name).
 *   §5.4  every alert is a DRAFT/observation; the human authors the fill.
 *   §5.5  deployed % vs target is always reported (never a nag).
 *
 * Re-anchoring (§3) is the caller's responsibility: pass the CURRENT (already re-anchored) buy price +
 * version in `caseStatus`; the levels are computed against it here and the version is recorded on the
 * alert. The time-completion clock reset (on fill / on re-anchor) is reflected in
 * `position.months_since_last_fill`.
 */
export function evaluateSizingTranche(args: {
  case_status: SizingCaseStatus
  position: SizingPositionStatus
  current_price: number
  /** Subject labels for the message (optional). */
  ticker?: string
  holding_id?: string
  /** Sleeve seam (spec §6) — defaults to the single main strategy; no multi-sleeve handling. */
  sleeve_id?: string
  params?: SizingParams
}): SizingTrancheAlert {
  const params = args.params ?? SIZING_PARAMS
  const { case_status: cs, position: pos } = args
  const label = args.ticker ?? args.holding_id ?? 'position'
  const deployedPct = computeDeployedPct(pos.ladder_id, pos.filled_tranche_ids, params)

  const base = {
    ladder_id: pos.ladder_id,
    buy_price_version: cs.buy_price_version,
    deployed_pct: deployedPct,
    is_observation: true as const,
    is_recommendation: false as const,
  }

  // The next untriggered rung (after T1 — T1 is the entry, handled by the buy-window/entry path, not a
  // pullback-review tranche). Rungs are config-ordered; the first non-filled rung whose trigger is NOT
  // `buy` is the next candidate.
  const filled = new Set(pos.filled_tranche_ids)
  const levels = computeTrancheLevels(cs.buy_price, pos.ladder_id, cs.buy_price_version, params)
  const ladderRungs = params.ladders[pos.ladder_id].rungs
  const nextRung = ladderRungs.find((rung) => rung.trigger !== 'buy' && !filled.has(rung.id))

  if (nextRung === undefined) {
    return {
      ...base,
      alert: false,
      blocked: false,
      rerun_needed: false,
      message: `${label}: no untriggered tranche remaining (deployed ${Math.round(deployedPct * 100)}% of target). Observation only.`,
    }
  }
  const nextLevel = levels.find((level) => level.id === nextRung.id)
  const triggerPrice = nextLevel?.trigger_price

  // §5.1 thesis-break unresolved → BLOCKED regardless of price (no exceptions).
  if (cs.thesis_break_unresolved) {
    return {
      ...base,
      alert: false,
      tranche_id: nextRung.id,
      ...(triggerPrice === undefined ? {} : { trigger_price: triggerPrice }),
      blocked: true,
      block_reason: 'thesis_break_unresolved',
      rerun_needed: false,
      message: `${label}: ${nextRung.id} tranche BLOCKED — an unresolved thesis-break trigger blocks all further tranches regardless of price (spec §5.1). Logged, no alert.`,
    }
  }

  // §5.3 stale case → BLOCKED, re-run forced first.
  if (cs.stale) {
    return {
      ...base,
      alert: false,
      tranche_id: nextRung.id,
      ...(triggerPrice === undefined ? {} : { trigger_price: triggerPrice }),
      blocked: true,
      block_reason: 'stale_case',
      rerun_needed: true,
      message: `${label}: ${nextRung.id} tranche BLOCKED — ${cs.stale_reason ?? 'stale case'}; re-run forced before any tranche alert (spec §5.3). No alert until re-run.`,
    }
  }

  // §1/§5 per-name cap (15%) — sleeves deferred → per name, no cross-sleeve aggregation.
  if (isFiniteNumber(pos.current_weight) && pos.current_weight >= params.per_name_cap) {
    return {
      ...base,
      alert: false,
      tranche_id: nextRung.id,
      ...(triggerPrice === undefined ? {} : { trigger_price: triggerPrice }),
      blocked: true,
      block_reason: 'per_name_cap_reached',
      rerun_needed: false,
      message: `${label}: ${nextRung.id} tranche flagged for CAP-REVIEW — position is at/over the ${Math.round(params.per_name_cap * 100)}% per-name cap (${Math.round(pos.current_weight * 100)}%); no further tranche (sleeves deferred — per-name cap). Observation only.`,
    }
  }

  // Price trigger (spec §2): current price ≤ the re-anchored level.
  const priceTriggered = isFiniteNumber(triggerPrice)
    && isFiniteNumber(args.current_price)
    && args.current_price > 0
    && args.current_price <= triggerPrice

  // Time-completion (spec §4): price has been at/below the (re-anchored) buy price for ≥ N months since
  // the last fill/re-anchor AND the most recent scheduled re-check is clean. The per-ladder override
  // wins over the default. Time-completion substitutes ONLY for the price trigger — the thesis re-check
  // (above gates) is never bypassed.
  const monthsThreshold = params.ladders[pos.ladder_id].time_completion_months ?? params.time_completion_months
  const atOrBelowBuy = isFiniteNumber(args.current_price) && args.current_price > 0 && args.current_price <= cs.buy_price
  const timeTriggered = !priceTriggered
    && atOrBelowBuy
    && cs.recheck_clean
    && isFiniteNumber(pos.months_since_last_fill)
    && pos.months_since_last_fill >= monthsThreshold

  if (!priceTriggered && !timeTriggered) {
    return {
      ...base,
      alert: false,
      tranche_id: nextRung.id,
      ...(triggerPrice === undefined ? {} : { trigger_price: triggerPrice }),
      blocked: false,
      rerun_needed: false,
      message: `${label}: ${nextRung.id} not triggered — price ${args.current_price} above the ${triggerPrice} level and time-completion not met. Observation only.`,
    }
  }

  const triggerType: TrancheTriggerType = priceTriggered ? 'price' : 'time_completion'
  return {
    ...base,
    alert: true,
    tranche_id: nextRung.id,
    trigger_type: triggerType,
    ...(triggerPrice === undefined ? {} : { trigger_price: triggerPrice }),
    blocked: false,
    rerun_needed: false,
    message: triggerType === 'time_completion'
      ? `${label}: ${nextRung.id} tranche DRAFT (trigger=time_completion) — price has held at/below buy for ≥${monthsThreshold} months on a clean re-check; fires at the prevailing price ${args.current_price}. ${THESIS_GATE_NOTE} Deployed ${Math.round(deployedPct * 100)}% of target.`
      : `${label}: ${nextRung.id} tranche DRAFT (trigger=price) — price ${args.current_price} reached the ${triggerPrice} level (buy_price_version ${cs.buy_price_version}). ${THESIS_GATE_NOTE} Deployed ${Math.round(deployedPct * 100)}% of target.`,
  }
}
