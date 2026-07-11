import type { LedgerEventEnvelope } from '../eventEnvelope'

// ---------------------------------------------------------------------------------------------------
// B7 (Phase 4, book alignment): the PASSIVE SLEEVE projection — the recorded side of the book's
// step-2 foundation. Contributions are USER-AUTHORED `passive_contribution_recorded` events
// (append-only; a local record of a DCA purchase already made elsewhere — no broker, no execution).
// Rule 3 by construction: there is no withdrawal/sell event and the panel renders no sell
// affordance — a lifelong commitment has no exit button.
// ---------------------------------------------------------------------------------------------------

export type PassiveContributionProjection = {
  contribution_id: string
  /** The contributed amount (the user's account currency; display-only). */
  amount: number
  /** The date (YYYY-MM-DD) the contribution was made. */
  contributed_at: string
  /** What was bought (free text, e.g. an index fund name). */
  instrument?: string
  note?: string
}

export type PassiveSleeveProjection = {
  contributions: PassiveContributionProjection[]
  total_contributed: number
  /** Count of DISTINCT YYYY-MM months with at least one contribution (the consistency read, rule 2). */
  months_contributed: number
  last_contribution_at?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Fold passive_contribution_recorded events (chronological by contributed_at, newest last). */
export function projectPassiveSleeve(events: ReadonlyArray<LedgerEventEnvelope<unknown>>): PassiveSleeveProjection {
  const contributions: PassiveContributionProjection[] = []
  for (const event of events) {
    if (event.event_type !== 'passive_contribution_recorded') continue
    const p = event.payload
    if (!isRecord(p)) continue
    const contribution_id = typeof p['contribution_id'] === 'string' ? p['contribution_id'] : event.event_id
    const amount = typeof p['amount'] === 'number' && Number.isFinite(p['amount']) && p['amount'] > 0 ? p['amount'] : undefined
    const contributed_at = typeof p['contributed_at'] === 'string' && !Number.isNaN(Date.parse(p['contributed_at']))
      ? p['contributed_at'].slice(0, 10)
      : undefined
    if (amount === undefined || contributed_at === undefined) continue // malformed rows are skipped, never guessed
    contributions.push({
      contribution_id,
      amount,
      contributed_at,
      ...(typeof p['instrument'] === 'string' && p['instrument'].trim() !== '' ? { instrument: p['instrument'] } : {}),
      ...(typeof p['note'] === 'string' && p['note'].trim() !== '' ? { note: p['note'] } : {}),
    })
  }
  contributions.sort((a, b) => (a.contributed_at < b.contributed_at ? -1 : a.contributed_at > b.contributed_at ? 1 : 0))
  const total_contributed = contributions.reduce((sum, c) => sum + c.amount, 0)
  const months = new Set(contributions.map((c) => c.contributed_at.slice(0, 7)))
  const last = contributions[contributions.length - 1]
  return {
    contributions,
    total_contributed,
    months_contributed: months.size,
    ...(last !== undefined ? { last_contribution_at: last.contributed_at } : {}),
  }
}
