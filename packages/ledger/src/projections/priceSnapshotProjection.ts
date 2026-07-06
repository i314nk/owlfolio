import type { LedgerEventEnvelope } from '../eventEnvelope'

export type PriceSnapshot = { ticker: string; price_per_share: number; currency: string; as_of: string; source: string; checked_at: string }

function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null }

/** Newest price_snapshot_recorded per ticker. Events are applied in list order; last-writer-wins. */
export function projectLatestPriceSnapshots(events: LedgerEventEnvelope<unknown>[]): Map<string, PriceSnapshot> {
  const out = new Map<string, PriceSnapshot>()
  for (const event of events) {
    if (event.event_type !== 'price_snapshot_recorded') continue
    const p = event.payload
    if (!isRecord(p)) continue
    const ticker = typeof p['ticker'] === 'string' ? p['ticker'] : undefined
    const price = typeof p['price_per_share'] === 'number' ? p['price_per_share'] : undefined
    if (ticker === undefined || price === undefined) continue
    out.set(ticker, {
      ticker, price_per_share: price,
      currency: typeof p['currency'] === 'string' ? p['currency'] : 'USD',
      as_of: typeof p['as_of'] === 'string' ? p['as_of'] : event.created_at,
      source: typeof p['source'] === 'string' ? p['source'] : 'unknown',
      checked_at: typeof p['checked_at'] === 'string' ? p['checked_at'] : event.created_at,
    })
  }
  return out
}
