# On-demand price check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user refresh live prices for their watchlist + open holdings on demand, persist each price, surface current price / distance-to-buy / NAV with an "as of" stamp, and light up buy-zone signals — via one shared operation the scheduler will later reuse.

**Architecture:** A single idempotent `runPriceRefresh(store, deps)` in `@owlfolio/workflow` resolves the union of tracked tickers, fetches each via the existing injectable `resolveCurrentPrice`, and emits a new per-ticker `price_snapshot_recorded` event (+ reuses `watchlist_monitor_alert_recorded` on a buy-window signal and `holding_valuation_recorded` for NAV). A thin `refreshPrices(state)` web wrapper opens the ledger and calls it; `POST /api/prices/refresh` + a `RefreshPricesButton` trigger it. A new `projectLatestPriceSnapshots` projection feeds the current price into `enrichWatchlistItemsWithVerdict`.

**Tech Stack:** TypeScript, pnpm workspace, vitest, Next.js App Router, SQLite event store, React `createElement` (repo convention).

**Run all commands from the worktree root:** `/home/hermes_agent/code/owlfolio/.worktrees/price-check`
Test command form: `NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm exec vitest run <path>`

---

## File Structure

- **Create** `packages/ledger/src/projections/priceSnapshotProjection.ts` — `projectLatestPriceSnapshots(events)` → newest price per ticker.
- **Create** `packages/ledger/src/__tests__/priceSnapshotProjection.test.ts`
- **Modify** `packages/ledger/src/domainEventContracts.ts` — register `price_snapshot_recorded`.
- **Create** `packages/workflow/src/priceRefresh.ts` — `runPriceRefresh` shared op + `PriceRefreshResult` + `RunPriceRefreshDeps`.
- **Create** `packages/workflow/src/__tests__/priceRefresh.test.ts`
- **Modify** `packages/workflow/src/index.ts` — export `priceRefresh` (add to `package.json` exports too).
- **Modify** `apps/web/src/lib/workflow.ts` — add `refreshPrices(state, deps?)`; extend `enrichWatchlistItemsWithVerdict` to take snapshots; wire in `loadPersonalWatchlist`.
- **Create** `apps/web/src/app/api/prices/refresh/route.ts` — `POST`.
- **Create** `apps/web/src/app/api/prices/refresh/route.test.ts`
- **Create** `apps/web/src/components/RefreshPricesButton.tsx` (mirror `ReReviewButton.tsx`).
- **Modify** `apps/web/src/app/watchlist/page.tsx`, `apps/web/src/app/portfolio/page.tsx` — mount the button.
- **Modify** `apps/web/src/components/WatchlistPanel.tsx` — render current price + "as of" from `verdict`.

---

## Task 1: Register the `price_snapshot_recorded` event type

**Files:**
- Modify: `packages/ledger/src/domainEventContracts.ts` (add to `domainEventTypes` array ~line 81; add contract entry to `domainEventContracts` array)

- [ ] **Step 1: Write the failing test**

Create `packages/ledger/src/__tests__/priceSnapshotContract.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { domainEventTypes, domainEventContracts } from '../domainEventContracts'

describe('price_snapshot_recorded contract', () => {
  it('is a registered domain event type', () => {
    expect(domainEventTypes).toContain('price_snapshot_recorded')
  })
  it('has a contract with the price-snapshot payload fields', () => {
    const c = domainEventContracts.find((e) => e.event_type === 'price_snapshot_recorded')
    expect(c).toBeDefined()
    expect(c?.aggregate_type).toBe('portfolio')
    expect(c?.payload_fields).toEqual(
      expect.arrayContaining(['snapshot_id', 'ticker', 'price_per_share', 'currency', 'as_of', 'source', 'checked_at']),
    )
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`toContain 'price_snapshot_recorded'` fails):
`NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm exec vitest run packages/ledger/src/__tests__/priceSnapshotContract.test.ts`

- [ ] **Step 3: Implement** — in `domainEventContracts.ts`, add `'price_snapshot_recorded',` to the `domainEventTypes` array (after the last entry), and append this contract to the `domainEventContracts` array (mirrors the `holding_valuation_recorded` entry format):
```ts
  {
    event_type: 'price_snapshot_recorded',
    aggregate_type: 'portfolio',
    actor_type: 'worker',
    actor_types: ['user', 'worker'],
    projection_owner: 'portfolio',
    payload_fields: ['snapshot_id', 'ticker', 'price_per_share', 'currency', 'as_of', 'source', 'checked_at'],
  },
```

- [ ] **Step 4: Run it — expect PASS.**

- [ ] **Step 5: Commit**
```bash
git add packages/ledger/src/domainEventContracts.ts packages/ledger/src/__tests__/priceSnapshotContract.test.ts
git commit -m "feat(ledger): register price_snapshot_recorded event contract"
```

---

## Task 2: `projectLatestPriceSnapshots` projection

**Files:**
- Create: `packages/ledger/src/projections/priceSnapshotProjection.ts`
- Test: `packages/ledger/src/__tests__/priceSnapshotProjection.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from 'vitest'
import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectLatestPriceSnapshots } from '../projections/priceSnapshotProjection'

function snap(ticker: string, price: number, created_at: string): LedgerEventEnvelope<unknown> {
  return {
    event_id: `evt_price_snapshot_recorded_psnap_${ticker}_${created_at}`,
    event_type: 'price_snapshot_recorded',
    aggregate_type: 'portfolio',
    aggregate_id: ticker,
    actor_type: 'worker',
    payload: { snapshot_id: `psnap_${ticker}_${created_at}`, ticker, price_per_share: price, currency: 'USD', as_of: created_at, source: 'yahoo', checked_at: created_at },
    source_ids: [],
    created_at,
    schema_version: 1,
  }
}

describe('projectLatestPriceSnapshots', () => {
  it('returns the newest snapshot per ticker', () => {
    const map = projectLatestPriceSnapshots([
      snap('MSFT', 400, '2026-07-01T00:00:00.000Z'),
      snap('MSFT', 420, '2026-07-05T00:00:00.000Z'),
      snap('AAPL', 200, '2026-07-05T00:00:00.000Z'),
    ])
    expect(map.get('MSFT')?.price_per_share).toBe(420)
    expect(map.get('AAPL')?.price_per_share).toBe(200)
    expect(map.get('MSFT')?.as_of).toBe('2026-07-05T00:00:00.000Z')
  })
  it('ignores non-snapshot events and returns empty for none', () => {
    expect(projectLatestPriceSnapshots([]).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (module not found).

- [ ] **Step 3: Implement** `priceSnapshotProjection.ts`:
```ts
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
      ticker,
      price_per_share: price,
      currency: typeof p['currency'] === 'string' ? p['currency'] : 'USD',
      as_of: typeof p['as_of'] === 'string' ? p['as_of'] : event.created_at,
      source: typeof p['source'] === 'string' ? p['source'] : 'unknown',
      checked_at: typeof p['checked_at'] === 'string' ? p['checked_at'] : event.created_at,
    })
  }
  return out
}
```

- [ ] **Step 4: Run it — expect PASS.**
- [ ] **Step 5: Commit** `feat(ledger): projectLatestPriceSnapshots (newest price per ticker)`

---

## Task 3a: `runPriceRefresh` core — snapshots per tracked ticker

**Files:**
- Create: `packages/workflow/src/priceRefresh.ts`
- Test: `packages/workflow/src/__tests__/priceRefresh.test.ts`

Uses: `resolveCurrentPrice`/`PriceSource`/`PriceQuote` (`marketData.ts`), `projectWatchlist` (`@owlfolio/ledger/projections/watchlistProjection`), `projectHoldings` (`@owlfolio/ledger/projections/holdingProjection`), `InMemoryEventStore`.

- [ ] **Step 1: Write the failing test** (fake price source; a confirmed watchlist item for MSFT + an open holding for AAPL):
```ts
import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import type { PriceSource, PriceQuote, PriceQuoteSymbol } from '../marketData'
import { runPriceRefresh } from '../priceRefresh'
import { seedConfirmedWatchlistItem, seedOpenHolding } from './priceRefreshFixtures' // create below

function fakeSource(prices: Record<string, number>): PriceSource {
  return { id: 'fake', async getQuote(s: PriceQuoteSymbol): Promise<PriceQuote> {
    const p = prices[s.ticker]
    return p === undefined ? { available: false, reason: 'no fixture', source: 'fake' }
      : { available: true, price_per_share: p, currency: 'USD', as_of: '2026-07-05T00:00:00.000Z', source: 'fake' }
  } }
}
const NOW = () => new Date('2026-07-05T12:00:00.000Z')

describe('runPriceRefresh — snapshots', () => {
  it('emits a price_snapshot_recorded per tracked ticker and reports refreshed/unavailable', async () => {
    const store = new InMemoryEventStore()
    await seedConfirmedWatchlistItem(store, { ticker: 'MSFT', buy_below: 300 })
    await seedOpenHolding(store, { ticker: 'AAPL', shares: 10 })
    const result = await runPriceRefresh(store, { priceSource: fakeSource({ MSFT: 420 }), now: NOW })
    const snaps = (await store.list()).filter((e) => e.event_type === 'price_snapshot_recorded')
    expect(snaps.map((e) => (e.payload as { ticker: string }).ticker).sort()).toEqual(['MSFT'])
    expect(result.refreshed).toEqual(['MSFT'])
    expect(result.unavailable).toEqual(['AAPL'])
  })
})
```
Create `packages/workflow/src/__tests__/priceRefreshFixtures.ts` with `seedConfirmedWatchlistItem(store, {ticker, buy_below})` (append `research_case_created` + `buffett_munger_analysis_drafted` with `valuation.buy_price_per_share` + `watchlist_draft_created` + `watchlist_draft_confirmed`) and `seedOpenHolding(store, {ticker, shares})` (append the events `projectHoldings` needs for one open holding). Mirror existing seed helpers in `packages/ledger/src/__tests__/replay.test.ts` and `holdingProjection.test.ts` for exact event shapes.

- [ ] **Step 2: Run it — expect FAIL** (module not found).

- [ ] **Step 3: Implement** `priceRefresh.ts` (core only — snapshots):
```ts
import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { projectHoldings } from '@owlfolio/ledger/projections/holdingProjection'
import { resolveCurrentPrice, defaultPriceSource, type PriceSource } from './marketData'

const PRICE_REFRESH_ACTOR_ID = 'price_refresh'

export type RunPriceRefreshDeps = { priceSource?: PriceSource; now?: () => Date }
export type PriceRefreshResult = { refreshed: string[]; unavailable: string[]; buy_zone_hits: string[] }

export async function runPriceRefresh(
  store: EventStore<LedgerEventEnvelope<unknown>>,
  deps: RunPriceRefreshDeps = {},
): Promise<PriceRefreshResult> {
  const events = await store.list()
  const watchlist = projectWatchlist(events).filter((w) => w.user_approved === true)
  const holdings = projectHoldings(events)
  const tickers = [...new Set([
    ...watchlist.map((w) => w.ticker).filter((t): t is string => typeof t === 'string' && t.length > 0),
    ...holdings.map((h) => h.ticker).filter((t): t is string => typeof t === 'string' && t.length > 0),
  ])]
  const source = deps.priceSource ?? defaultPriceSource
  const now = deps.now?.() ?? new Date()
  const checkedAt = now.toISOString()
  const asOfDate = checkedAt.slice(0, 10)
  const result: PriceRefreshResult = { refreshed: [], unavailable: [], buy_zone_hits: [] }

  for (const ticker of tickers) {
    const quote = await resolveCurrentPrice({ ticker }, undefined, source)
    if (!quote.available) { result.unavailable.push(ticker); continue }
    result.refreshed.push(ticker)
    const snapshotId = `psnap_${ticker}_${asOfDate}_${quote.source}`
    await store.append({
      event_id: `evt_price_snapshot_recorded_${snapshotId}`,
      event_type: 'price_snapshot_recorded',
      aggregate_type: 'portfolio',
      aggregate_id: ticker,
      idempotency_key: `price-snapshot:${ticker}:${asOfDate}:${quote.source}`,
      actor_type: 'worker',
      actor_id: PRICE_REFRESH_ACTOR_ID,
      payload: { snapshot_id: snapshotId, ticker, price_per_share: quote.price_per_share, currency: quote.currency, as_of: quote.as_of, source: quote.source, checked_at: checkedAt },
      source_ids: [`${quote.source}:${ticker}:${quote.as_of}`],
      created_at: checkedAt,
      schema_version: 1,
    } as LedgerEventEnvelope<unknown>)
    // Task 3b/3c extend the loop here.
  }
  return result
}
```

- [ ] **Step 4: Run it — expect PASS.**
- [ ] **Step 5: Commit** `feat(workflow): runPriceRefresh core — price snapshots for tracked tickers`

---

## Task 3b: `runPriceRefresh` — watchlist buy-window alerts

**Files:** Modify `packages/workflow/src/priceRefresh.ts`; Modify test.

Uses `evaluateWatchlistBuyWindow(researchCase, { current_price, now })` (`lifecycleMonitors.ts`) + `projectResearchCases` for `valuation.buy_price_per_share`.

- [ ] **Step 1: Add failing test** to `priceRefresh.test.ts`:
```ts
it('emits a watchlist buy-window alert and marks buy_zone_hits when price <= buy-below', async () => {
  const store = new InMemoryEventStore()
  await seedConfirmedWatchlistItem(store, { ticker: 'MSFT', buy_below: 500 })
  const result = await runPriceRefresh(store, { priceSource: fakeSource({ MSFT: 420 }), now: NOW })
  const alerts = (await store.list()).filter((e) => e.event_type === 'watchlist_monitor_alert_recorded')
  expect(alerts).toHaveLength(1)
  expect((alerts[0]!.payload as { buy_window_alert: boolean }).buy_window_alert).toBe(true)
  expect(result.buy_zone_hits).toEqual(['MSFT'])
})
it('emits no alert when price is above buy-below', async () => {
  const store = new InMemoryEventStore()
  await seedConfirmedWatchlistItem(store, { ticker: 'MSFT', buy_below: 300 })
  await runPriceRefresh(store, { priceSource: fakeSource({ MSFT: 420 }), now: NOW })
  expect((await store.list()).filter((e) => e.event_type === 'watchlist_monitor_alert_recorded')).toHaveLength(0)
})
```

- [ ] **Step 2: Run — expect FAIL** (no alert emitted).

- [ ] **Step 3: Implement** — inside the ticker loop (where the comment is), after the snapshot append, add: build `MonitorResearchCaseInput` from the linked case, run `evaluateWatchlistBuyWindow`, and on `buy_window_alert || suppressed || rerun_needed` append `watchlist_monitor_alert_recorded` (payload mirrors runtime.ts:1136-1165 exactly — `alert_id`, `watchlist_item_id`, `research_case_id`, `ticker`, `alert_kind` (`'buy_window'` when alert else `'buy_window_suppressed'`/`'no_signal'`), `buy_window_alert`, `suppressed`, optional `suppression_reason`, `rerun_needed`, optional `discount_to_buy_pct`, `case_age_months: result.freshness.age_months`, `is_observation: true`, `is_recommendation: false`, `message`). `alert_id = wmon_${watchlist_item_id}_${asOfDate.replace(/[^0-9]/g,'')}`, `idempotency_key = watchlist-monitor-alert:${alert_id}:${quote.source}`. Push ticker to `buy_zone_hits` when `buy_window_alert`. Get `buy_price_per_share` from `projectResearchCases(events)` → linked case `.valuation?.buy_price_per_share ?? .valuation?.proposed_buy_below`. (Compute `projectResearchCases` once before the loop.)

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(workflow): runPriceRefresh — watchlist buy-window alerts`

---

## Task 3c: `runPriceRefresh` — holding NAV valuation

**Files:** Modify `priceRefresh.ts`; Modify test.

- [ ] **Step 1: Add failing test:**
```ts
it('emits holding_valuation_recorded (price x shares) for open holdings', async () => {
  const store = new InMemoryEventStore()
  await seedOpenHolding(store, { ticker: 'AAPL', shares: 10 })
  await runPriceRefresh(store, { priceSource: fakeSource({ AAPL: 200 }), now: NOW })
  const vals = (await store.list()).filter((e) => e.event_type === 'holding_valuation_recorded')
  expect(vals).toHaveLength(1)
  expect((vals[0]!.payload as { market_value: number }).market_value).toBe(2000)
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — in the loop, for each holding whose ticker matches, append `holding_valuation_recorded` mirroring runtime.ts:1962-1991 (`snapshot_id = hval_${holding_id}_${asOfDate}`, `market_value = round(quote.price_per_share * holding.shares)`, `valuation_source: quote.source`, `idempotency_key: holding-valuation:${holding_id}:${asOfDate}:${quote.source}`, `confidence:'market'`, `caveat:'Live market price'`, `missing_data:[]`, `valued_by_actor_type:'worker'`, `valued_by_actor_id: PRICE_REFRESH_ACTOR_ID`). Round with `Math.round(x*100)/100`.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Add `priceRefresh` to package exports** — in `packages/workflow/package.json` `exports`, add `"./priceRefresh": "./src/priceRefresh.ts"`; in `packages/workflow/src/index.ts` add `export * from './priceRefresh'`.
- [ ] **Step 6: Commit** `feat(workflow): runPriceRefresh — holding NAV valuation + export`

---

## Task 4: `refreshPrices` web wrapper + `POST /api/prices/refresh`

**Files:**
- Modify: `apps/web/src/lib/workflow.ts` (add `refreshPrices`)
- Create: `apps/web/src/app/api/prices/refresh/route.ts`
- Test: `apps/web/src/app/api/prices/refresh/route.test.ts`

- [ ] **Step 1: Write the failing route test** (mirror `api/research/[caseId]/re-review/route.test.ts` harness: temp dir, app-config, SQLiteEventStore, inject a fake price source via route `deps`):
```ts
// seed a confirmed MSFT watchlist item at buy_below 500; POST with an injected fake source returning 420
const res = await POST(new Request('http://localhost/api/prices/refresh', { method: 'POST' }),
  { priceSource: fakeSource({ MSFT: 420 }) } as never)
expect(res.status).toBe(200)
const body = await res.json()
expect(body.refreshed).toContain('MSFT')
expect(body.buy_zone_hits).toContain('MSFT')
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `refreshPrices` in `apps/web/src/lib/workflow.ts` (mirror the state-guard + store pattern used by `promoteResearchCaseToWatchlist`):
```ts
import { runPriceRefresh, type PriceRefreshResult, type RunPriceRefreshDeps } from '@owlfolio/workflow/priceRefresh'
// ...
export async function refreshPrices(state: OnboardingState, deps: RunPriceRefreshDeps = {}): Promise<PriceRefreshResult> {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }
  const store = new SQLiteEventStore(state.config.ledger_path)
  try { return await runPriceRefresh(store, deps) } finally { store.close() }
}
```
Implement `route.ts` (JSON style, test-injectable deps like the re-review route):
```ts
import { NextResponse } from 'next/server'
import { getOnboardingState } from '../../../../lib/onboarding'
import { refreshPrices } from '../../../../lib/workflow'
import type { RunPriceRefreshDeps } from '@owlfolio/workflow/priceRefresh'

export async function POST(_request: Request, deps: RunPriceRefreshDeps = {}) {
  const state = await getOnboardingState()
  try {
    const result = await refreshPrices(state, deps)
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'price refresh failed'
    const status = message.startsWith('Personal-local workflow is not initialized') ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(web): refreshPrices + POST /api/prices/refresh`

---

## Task 5: Populate current price + distance-to-buy on the watchlist

**Files:** Modify `apps/web/src/lib/workflow.ts` (`enrichWatchlistItemsWithVerdict` signature + `loadPersonalWatchlist`... actually `loadPersonalWatchlist` lives in `apps/web/src/app/watchlist/page.tsx`).

- [ ] **Step 1: Add failing test** to the existing `apps/web/src/lib/__tests__/workflow.test.ts` (or a new file): seed items + cases + a `snapshots` map; assert the verdict now carries `market_price_per_share` and `distance_to_buy_pct`:
```ts
const snapshots = new Map([['MSFT', { ticker: 'MSFT', price_per_share: 420, currency: 'USD', as_of: '2026-07-05T00:00:00.000Z', source: 'yahoo', checked_at: '2026-07-05T00:00:00.000Z' }]])
const [enriched] = enrichWatchlistItemsWithVerdict([msftItem], [msftCase /* buy_below 500 */], new Date('2026-07-05T00:00:00.000Z'), snapshots)
expect(enriched.verdict?.market_price_per_share).toBe(420)
expect(enriched.verdict?.distance_to_buy_pct).toBeCloseTo(((420 - 500) / 500) * 100) // -16
expect(enriched.verdict?.in_buy_zone).toBe(true) // 420 <= 500 live
```

- [ ] **Step 2: Run — expect FAIL** (undefined fields).

- [ ] **Step 3: Implement** — add an optional 4th param to `enrichWatchlistItemsWithVerdict`:
```ts
export function enrichWatchlistItemsWithVerdict(
  items: AppWatchlistItem[],
  cases: ResearchCaseProjection[],
  now: Date = new Date(),
  snapshots: Map<string, { price_per_share: number; as_of: string }> = new Map(),
): AppWatchlistItem[] {
```
Inside the `.map`, after `buyBelow` is known and `verdict` built, if `item.ticker` has a snapshot, set `verdict.market_price_per_share = snap.price_per_share`, `verdict.distance_to_buy_pct = ((snap.price_per_share - buyBelow) / buyBelow) * 100`, `verdict.in_buy_zone = snap.price_per_share <= buyBelow` (override the frozen value with the live read), and add `verdict.price_as_of = snap.as_of` (add `price_as_of?: string` to `AppWatchlistVerdict`).

- [ ] **Step 4: Wire the snapshot into `loadPersonalWatchlist`** (`apps/web/src/app/watchlist/page.tsx`): import `projectLatestPriceSnapshots` from `@owlfolio/ledger/projections/priceSnapshotProjection`, compute it from `events`, and pass to `enrichWatchlistItemsWithVerdict(items, projectResearchCases(events), new Date(), projectLatestPriceSnapshots(events))`.

- [ ] **Step 5: Run — expect PASS.**
- [ ] **Step 6: Commit** `feat(web): watchlist verdict shows live current price + distance-to-buy`

---

## Task 6: `RefreshPricesButton` + page wiring + "as of" display

**Files:**
- Create: `apps/web/src/components/RefreshPricesButton.tsx` (mirror `ReReviewButton.tsx`)
- Modify: `apps/web/src/app/watchlist/page.tsx`, `apps/web/src/app/portfolio/page.tsx` (mount the button in the `owl-route-back-row`)
- Modify: `apps/web/src/components/WatchlistPanel.tsx` (render `verdict.market_price_per_share` + "as of" when present)

- [ ] **Step 1: Write the failing component test** `apps/web/src/components/__tests__/RefreshPricesButton.test.tsx` (renderToStaticMarkup; assert a button with the label + `data-testid="refresh-prices"` renders):
```ts
const html = renderToStaticMarkup(createElement(RefreshPricesButton, {}))
expect(html).toContain('data-testid="refresh-prices"')
expect(html).toMatch(/refresh prices/i)
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `RefreshPricesButton.tsx` copied from `ReReviewButton.tsx`'s structure: `'use client'`, `useState`, `useSafeRouter`, a submit handler that `POST`s `/api/prices/refresh` and on success calls `router.refresh()` and sets a note (`Refreshed N · M entered buy zone`). Button classes `owl-button owl-button-secondary owl-focusable`, `data-testid="refresh-prices"`, label "Refresh prices".

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Mount + as-of display** — add `createElement(RefreshPricesButton)` into the back-row of both pages. In `WatchlistPanel.tsx`, where a card renders the verdict, when `verdict.market_price_per_share !== undefined` render e.g. `Price $X · Ym ago` from `verdict.price_as_of`. Portfolio already carries `latest_valuation_at` on holdings — render "as of" there if not already.

- [ ] **Step 6: Run the web unit suite** to confirm nothing regressed:
`NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm exec vitest run apps/web`

- [ ] **Step 7: Commit** `feat(web): RefreshPricesButton on watchlist + portfolio, current-price "as of"`

---

## Task 7 (deferrable): point the worker at `runPriceRefresh`

> Optional consolidation for the scheduler phase. The on-demand feature is complete without it; the worker still refreshes prices via its own handlers. Do this only if you want the single-code-path guarantee now.

**Files:** Modify `apps/worker/src/runtime.ts` — have `runPortfolioValuationRefreshTask` delegate its price→`holding_valuation_recorded` loop to `runPriceRefresh` (holdings-only mode) rather than its inline loop. Leave `runWatchlistBuyWindowPass` for a later, dedicated pass (it carries provider-gated per-item runs).

- [ ] Add a `RunPriceRefreshDeps` option to scope to holdings-only (e.g. `{ include?: 'all' | 'holdings' | 'watchlist' }`) if delegating; TDD the worker task against a fake source; keep the existing idempotency keys identical so no double-emit. Commit.

---

## Verification (final)

- `NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm typecheck` — clean
- `NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm lint` — clean
- `NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm test` — full suite green (new tests included)
- Manual: personal-local instance, add a holding + a confirmed watchlist item whose buy-below ≥ market, click "Refresh prices" on each page → snapshot persists, current price + distance-to-buy + NAV render with "as of", and the below-buy name shows the buy-zone signal.
