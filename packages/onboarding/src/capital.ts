// Investable-capital ledger primitive. A small, agnostic helper that appends a user-authored
// `investable_capital_set` event to a given store — the second half of the onboarding gate
// (the first being a connected frontier LLM). Mirrors the event shape the web `setInvestableCapital`
// (apps/web/src/lib/workflow.ts) writes, but takes an EventStore directly so the CLI can reuse it
// without pulling in the 2000-line web workflow module. projectInvestableCapital reads it back.
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import type { EventStore } from '@owlfolio/ledger/eventStore'

export type RecordInvestableCapitalInput = {
  amount: number
  /** ISO currency code; defaults to USD. Normalized to upper-case. */
  currency?: string
  /** ISO timestamp; defaults to now. Used for created_at, payload.as_of, and idempotency. */
  as_of?: string
}

export async function recordInvestableCapitalEvent(
  store: EventStore,
  input: RecordInvestableCapitalInput,
): Promise<LedgerEventEnvelope<unknown>> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Investable capital amount must be greater than zero')
  }

  const currency = (input.currency ?? 'USD').trim().toUpperCase()
  const asOf = input.as_of ?? new Date().toISOString()

  return store.append({
    event_id: `evt_investable_capital_set_${asOf}`,
    event_type: 'investable_capital_set',
    aggregate_type: 'portfolio',
    aggregate_id: 'portfolio_local',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: {
      amount: input.amount,
      currency,
      as_of: asOf,
    },
    source_ids: [],
    created_at: asOf,
    schema_version: 1,
    idempotency_key: `investable-capital-set:${asOf}`,
  })
}
