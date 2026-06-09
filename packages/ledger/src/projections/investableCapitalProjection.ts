import type { LedgerEventEnvelope } from '../eventEnvelope'

export type InvestableCapitalSnapshot = {
  amount: number
  currency: string
  as_of: string
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
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Projects the latest user-authored investable_capital_set event.
 * Returns the most recent snapshot by created_at, or undefined if no event exists.
 * Multiple events → latest created_at wins (last-write-wins; user may update their capital figure).
 */
export function projectInvestableCapital(events: LedgerEventEnvelope<unknown>[]): InvestableCapitalSnapshot | undefined {
  let latest: { snapshot: InvestableCapitalSnapshot; created_at: string } | undefined = undefined

  for (const event of events) {
    if (event.event_type !== 'investable_capital_set') {
      continue
    }
    if (!isRecord(event.payload)) {
      continue
    }

    const amount = getNumber(event.payload, 'amount')
    const currency = getString(event.payload, 'currency')
    const as_of = getString(event.payload, 'as_of')

    if (amount === undefined || currency === undefined || as_of === undefined) {
      continue
    }

    if (latest === undefined || event.created_at > latest.created_at) {
      latest = {
        snapshot: { amount, currency, as_of },
        created_at: event.created_at,
      }
    }
  }

  return latest?.snapshot
}
