// Config-change ledger event for the valuation parameters.
//
// valuation-recalibration-spec §1 ("Config changes are logged ledger events") + acceptance test #5
// ("Config change writes a ledger event"). When the versioned VALUATION_PARAMS change, the diff is
// recorded as an append-only `valuation_config` event so the parameter history is auditable and the
// anti-drift rule (spec §3.4) is enforceable. This is the pure event-construction helper; persisting
// it uses the normal EventStore.append path.

import type { ValuationParams } from './valuationParams'

export const VALUATION_CONFIG_EVENT_TYPE = 'valuation_config' as const

/** A single changed parameter in a config diff: dotted path + previous/next values. */
export type ValuationParamChange = {
  /** Dotted path into the params object, e.g. 'margin_of_safety_by_moat.monopoly'. */
  path: string
  previous: unknown
  next: unknown
}

export type ValuationConfigEventPayload = {
  previous_version: string
  new_version: string
  /** Only the parameters that actually changed (empty when versions differ but values match). */
  changes: ValuationParamChange[]
}

/** Minimal envelope shape (mirrors @owlfolio/ledger LedgerEventEnvelope without importing it). */
export type ValuationConfigEvent = {
  event_id: string
  event_type: typeof VALUATION_CONFIG_EVENT_TYPE
  aggregate_type: 'strategy'
  aggregate_id: string
  actor_type: 'user'
  actor_id?: string
  payload: ValuationConfigEventPayload
  source_ids: string[]
  created_at: string
  schema_version: number
}

/** Recursively flatten a params object to dotted-path → primitive value entries. */
function flatten(value: unknown, prefix: string, out: Map<string, unknown>): void {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, prefix === '' ? key : `${prefix}.${key}`, out)
    }
    return
  }
  out.set(prefix, value)
}

/**
 * Compute the ordered list of changed parameters between two versioned configs. The `version` field
 * itself is excluded (it is carried separately as previous_version/new_version). Order is stable
 * (sorted by path) so the diff is deterministic for tests + audit.
 */
export function diffValuationParams(
  previous: ValuationParams,
  next: ValuationParams,
): ValuationParamChange[] {
  const prevFlat = new Map<string, unknown>()
  const nextFlat = new Map<string, unknown>()
  flatten(previous, '', prevFlat)
  flatten(next, '', nextFlat)

  const paths = new Set<string>([...prevFlat.keys(), ...nextFlat.keys()])
  paths.delete('version')

  const changes: ValuationParamChange[] = []
  for (const path of [...paths].sort()) {
    const before = prevFlat.get(path)
    const after = nextFlat.get(path)
    if (!Object.is(before, after)) {
      changes.push({ path, previous: before, next: after })
    }
  }
  return changes
}

/**
 * A DELIBERATE, human-confirmed config-change DRAFT (valuation-recalibration-spec §3.4 anti-drift). This is
 * the gated param-change path — NOT a casual tune knob. Changing parameters post-go-live is permitted ONLY
 * at the annual system review, ONLY with a backtest re-run attached, ONLY against the same pre-stated
 * target; "it's been quiet lately" is never grounds. So this builder:
 *   - computes the diff (the caller does not hand-assert it),
 *   - REQUIRES a calibration_run event id (the attached backtest precondition — fail-closed if missing),
 *   - REFUSES to touch the constitutional 10% discount rate (spec §3.3),
 *   - REFUSES a no-op,
 *   - returns a `status: 'draft'` proposal that `requires_user_confirmation` and is `auto_applied: false`.
 * Confirming the draft (a separate user action) is what writes the `valuation_config` event via
 * `buildValuationConfigEvent`. The draft itself never mutates VALUATION_PARAMS.
 */
export type ValuationConfigChangeDraft = {
  proposal_id: string
  strategy_id: string
  previous_version: string
  new_version: string
  changes: ValuationParamChange[]
  /** The attached backtest (calibration_run event id) — the anti-drift precondition. */
  calibration_run_event_id: string
  status: 'draft'
  requires_user_confirmation: true
  auto_applied: false
  rationale?: string
  anti_drift_note: string
  actor_id?: string
  created_at: string
}

const ANTI_DRIFT_NOTE =
  'Parameters are frozen after go-live. A change is permitted ONLY at the annual system review, ONLY with the backtest re-run attached, ONLY against the same pre-stated target. "It has been quiet lately" is never grounds. This is a draft — confirming it is a separate, human-authored, logged transition.'

export function buildValuationConfigChangeDraft(args: {
  proposal_id: string
  strategy_id: string
  previous: ValuationParams
  next: ValuationParams
  /** The calibration_run ledger event id whose backtest justifies this change (required, §3.4). */
  calibration_run_event_id: string
  rationale?: string
  actor_id?: string
  created_at?: string
}): ValuationConfigChangeDraft {
  if (args.calibration_run_event_id.trim().length === 0) {
    throw new Error('A calibration_run backtest must be attached to a parameter-change draft (anti-drift §3.4).')
  }
  const changes = diffValuationParams(args.previous, args.next)
  if (changes.length === 0) {
    throw new Error('No parameter changes to propose (the diff is empty).')
  }
  if (changes.some((change) => change.path === 'discount_rate')) {
    throw new Error('The 10% discount rate is constitutional — never touched by calibration (spec §3.3). Cannot propose a hurdle change.')
  }
  return {
    proposal_id: args.proposal_id,
    strategy_id: args.strategy_id,
    previous_version: args.previous.version,
    new_version: args.next.version,
    changes,
    calibration_run_event_id: args.calibration_run_event_id,
    status: 'draft',
    requires_user_confirmation: true,
    auto_applied: false,
    ...(args.rationale === undefined ? {} : { rationale: args.rationale }),
    anti_drift_note: ANTI_DRIFT_NOTE,
    ...(args.actor_id === undefined ? {} : { actor_id: args.actor_id }),
    created_at: args.created_at ?? new Date().toISOString(),
  }
}

/**
 * Build an append-only `valuation_config` ledger event from a config diff. Carries the previous/new
 * version and the changed-parameter list. Returns the event envelope; the caller appends it to the
 * EventStore. The aggregate is the strategy whose valuation policy changed.
 */
export function buildValuationConfigEvent(args: {
  event_id: string
  strategy_id: string
  previous: ValuationParams
  next: ValuationParams
  actor_id?: string
  source_ids?: string[]
  created_at?: string
}): ValuationConfigEvent {
  const changes = diffValuationParams(args.previous, args.next)
  return {
    event_id: args.event_id,
    event_type: VALUATION_CONFIG_EVENT_TYPE,
    aggregate_type: 'strategy',
    aggregate_id: args.strategy_id,
    actor_type: 'user',
    ...(args.actor_id === undefined ? {} : { actor_id: args.actor_id }),
    payload: {
      previous_version: args.previous.version,
      new_version: args.next.version,
      changes,
    },
    source_ids: args.source_ids ?? [],
    created_at: args.created_at ?? new Date().toISOString(),
    schema_version: 1,
  }
}
