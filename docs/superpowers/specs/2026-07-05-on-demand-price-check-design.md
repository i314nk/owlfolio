# On-demand price check (watchlist + portfolio) — design

## Context

A user tracking names on the watchlist and holdings in the portfolio needs to know **current prices**
without waiting on a background job — specifically: *did anything enter its buy-below zone?* and *what is
my portfolio worth right now?* Today neither page shows a live price:

- `enrichWatchlistItemsWithVerdict` (`apps/web/src/lib/workflow.ts`) *declares* `market_price_per_share`
  and `distance_to_buy_pct` on `AppWatchlistVerdict` but **never populates them** — "in the buy zone?" is
  answered only from the price frozen into the research case at analysis time.
- The only live price fetching happens inside **worker ticks** (`watchlist_monitor`,
  `portfolio_valuation_refresh`, `holdings_monitor`); there is **no web trigger** to run a check on demand.

The price primitive already exists: `resolveCurrentPrice` (`packages/workflow/src/marketData.ts`) — live
keyless Yahoo, injectable, SSRF-guarded, fail-closed. The buy-window logic exists as pure monitors
(`lifecycleMonitors.ts`: `evaluateWatchlistBuyWindow`) and in the worker's buy-window pass. So this feature
is mostly **exposing existing capability on demand + surfacing the current price**.

This is the first of several on-demand actions being built **before** the scheduler. The scheduler is a
thin cadence layer that will later fire these same operations — so every on-demand action is designed as a
single shared, idempotent function that the web route and the worker cadence task both call. That is the
central architectural constraint here.

## Decisions (from brainstorming)

- **Scope:** prices **+ buy-zone signals** — fetch current prices for watchlist + portfolio, persist
  snapshots, surface current price / distance-to-buy / NAV, AND run the buy-window pass so "entered buy
  zone" surfaces immediately. (Not the full monitor pass — no tranche/concentration/Shariah rescreen here.)
- **Run model:** **inline + shared operation.** Price refresh is fast (HTTP only, no LLM), so the web route
  runs it synchronously (~seconds) and returns fresh data. The worker cadence task calls the SAME function.
- **Refresh UX:** **manual button + "as of" stamp.** Pages render the last persisted snapshot with an
  "as of Xm ago" timestamp; a "Refresh prices" button re-fetches on click. No auto-fetch on load.
- **Event model:** a dedicated **`price_snapshot_recorded`** per-ticker event as the "current market price"
  read model, **plus** reusing the existing `holding_valuation_recorded` for holding NAV (already wired
  into accounting). A holding gets both from the same fetched price — two read models (current price vs NAV).

## Architecture

### 1. The shared operation — `runPriceRefresh` (`packages/workflow`)

`runPriceRefresh(store, deps): Promise<PriceRefreshResult>` where `deps` injects `priceSource`, `now`, and
optional filters. Steps:

1. Resolve the **union of tracked tickers**: confirmed/user-approved watchlist items (`projectWatchlist`)
   + open holdings (`projectHoldings`). Dedupe by ticker.
2. For each ticker, `resolveCurrentPrice(ticker, marketDataDeps, deps.priceSource)`. Fail-closed per
   ticker: an unavailable price skips that ticker (recorded in the result), never throws.
3. Emit **`price_snapshot_recorded`** `{ ticker, price_per_share, currency, as_of, source }` per resolved
   price.
4. **Watchlist** tickers: run `evaluateWatchlistBuyWindow` against the linked case's locked buy-below →
   emit `watchlist_monitor_alert_recorded` **only on a signal** (buy_window / suppressed), reusing the
   existing event + payload. No event when there's no signal.
5. **Holding** tickers: emit `holding_valuation_recorded` (`market_value = price × shares`,
   `valuation_source: 'yahoo'`), reusing the existing NAV snapshot.

**Idempotent** per `(ticker, date, source)` — a second refresh the same day is a no-op for snapshots/alerts
(mirrors the worker passes' existing idempotency). Returns `PriceRefreshResult`
`{ refreshed: string[], unavailable: string[], buy_zone_hits: string[] }`.

The existing worker `watchlist_monitor` / `portfolio_valuation_refresh` handlers are **refactored to call
`runPriceRefresh`** (or its per-name helpers) so the price-fetch + snapshot + buy-window logic lives in one
place. Their richer, non-price reviews (tranche/concentration in `holdings_monitor`) stay as-is.

### 2. Read model

- **`projectLatestPriceSnapshots(events)`** (`packages/ledger/src/projections`) → `Map<ticker, {
  price_per_share, currency, as_of, source }>` — the newest `price_snapshot_recorded` per ticker.
- **`enrichWatchlistItemsWithVerdict`** joins the latest snapshot: populates the currently-empty
  `market_price_per_share` and `distance_to_buy_pct` (= `(price − buy_below) / buy_below`), and an
  `as_of` for the "Xm ago" stamp. In-buy-zone becomes a live read (`price ≤ buy_below`) rather than the
  frozen case value.
- Portfolio NAV uses the latest holding valuation (already the mechanism); the per-holding current price +
  "as of" comes from the same snapshot join.

### 3. Web trigger + surfacing

- **`POST /api/prices/refresh`** → resolves onboarding state (personal-local), opens the ledger store,
  calls `runPriceRefresh` synchronously, returns `PriceRefreshResult`. Provider readiness is NOT required
  (price fetch is keyless). Test-mode-gated price source injection mirrors the research routes.
- A **"Refresh prices"** button (client component) on the **watchlist** and **portfolio** pages, both
  POSTing the same route; on success it calls `router.refresh()` and shows a brief summary (e.g. "Refreshed
  N names · 2 entered buy zone"). Both pages render the snapshot's **"as of Xm ago"**.

## Data flow

```
[watchlist page]                       [portfolio page]
  "Refresh prices" ──POST /api/prices/refresh── "Refresh prices"
                          │
                    runPriceRefresh(store, {priceSource})
                     ├─ resolveCurrentPrice per tracked ticker (Yahoo, fail-closed)
                     ├─ price_snapshot_recorded (per ticker)            ← current-price read model
                     ├─ watchlist_monitor_alert_recorded (on buy-window signal)
                     └─ holding_valuation_recorded (per holding, NAV)
                          │
        projectLatestPriceSnapshots ─┬─ enrichWatchlistItemsWithVerdict → current price + distance-to-buy
                                     └─ portfolio NAV + per-holding current price ("as of Xm ago")

(later) scheduler `price_refresh` cadence task ── calls the SAME runPriceRefresh daily
```

## Error handling

- Per-ticker fail-closed: an unavailable/timed-out price skips that ticker and lists it in
  `unavailable[]`; the operation and the other tickers proceed. `resolveCurrentPrice` never throws.
- No tracked names → empty result, no events, the button reports "nothing to refresh."
- The route wraps failures and returns a 500 with a message; the button surfaces it without breaking the page.
- Non-USD tickers use the existing symbol mapping (`.AE`/`.SR`/`.L`); ADX remains uncovered (documented limit).

## Testing

- `runPriceRefresh` — unit: fake `priceSource` + `InMemoryEventStore` seeded with a confirmed watchlist
  item (buy-below above/below the fake price) and an open holding; assert `price_snapshot_recorded` per
  ticker, a `watchlist_monitor_alert_recorded` only when price ≤ buy-below, a `holding_valuation_recorded`
  with `price × shares`, idempotency on a second same-day run, and an unavailable-price ticker skipped.
- `projectLatestPriceSnapshots` — projection test (newest-per-ticker, multiple snapshots).
- `enrichWatchlistItemsWithVerdict` — now populates `market_price_per_share` / `distance_to_buy_pct` from a
  seeded snapshot; distance math and in-buy-zone from live price.
- `POST /api/prices/refresh` — route test with injected price source + temp ledger (personal-local).
- e2e (optional, if cheap): intake → confirm watchlist → click "Refresh prices" → current price + "as of"
  visible. Uses the mock/deterministic price source in playwright mode.

## Verification

- `corepack pnpm typecheck` + `lint` clean; full unit suite green including the new tests.
- Manual: onboard a personal-local instance (OpenRouter), add a holding + a confirmed watchlist item, click
  "Refresh prices" on each page → snapshot persists, current price + distance-to-buy + NAV render with "as
  of", and a watchlist name whose price ≤ buy-below shows the buy-zone signal.

## Out of scope (future)

- The scheduler daemon and its cadence evaluation — the `price_refresh` cadence already exists in
  automation settings; the scheduler phase wires it to `runPriceRefresh` (daily). This spec makes that a
  one-line stitch.
- Auto-refresh-on-stale, tranche/concentration/Shariah rescreen on demand, ADX symbol coverage, and the
  watchlist/portfolio **visual polish** (a separate follow-up, best done once these pages carry live data).
