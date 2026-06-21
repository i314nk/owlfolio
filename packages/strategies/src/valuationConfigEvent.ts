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
  /** Dotted path into the params object, e.g. 'discount_rate' or 'single_growth_cap'. */
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
