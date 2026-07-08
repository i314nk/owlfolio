# IFRS/20-F Shariah currency normalization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Shariah ratios correct for foreign (IFRS/20-F) filers by converting `market_cap` into the filer's reporting currency at the Shariah call site, using a keyless Yahoo spot FX rate — fail-closed when the rate is unavailable.

**Architecture:** Two helpers in `marketData.ts` (`fetchFxRateToUsd` keyless Yahoo, `marketCapInReportingCurrency` pure) + wiring in `researchSwarm.ts` that, when the fundamentals' currency differs from the market_cap's currency, converts market_cap before `computeShariahFinancialRatios`. Extraction is already correct; nothing else changes.

**Tech Stack:** TypeScript, pnpm workspace, vitest.

**Run from the worktree root:** `/home/hermes_agent/code/owlfolio/.worktrees/shariah-ifrs`
Test form: `NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm exec vitest run <path>`

---

## File Structure

- **Modify** `packages/workflow/src/marketData.ts` — add `fetchFxRateToUsd` + `marketCapInReportingCurrency`.
- **Modify** `packages/workflow/src/researchSwarm.ts` — capture the market_cap currency; convert market_cap before the Shariah ratio call (~line 2762).
- **Test** `packages/workflow/src/__tests__/marketData.test.ts` (add; check it exists) + a Shariah-wiring assertion in the researchSwarm test suite.

**Verified facts:**
- `market_cap` set at `researchSwarm.ts:2604`: `const market_cap = avgMarketCap?.market_cap ?? spotMarketCap`. `avgMarketCap` is an `AverageMarketCapResult` with a `currency` field (`marketData.ts:406`, from `history.currency`, USD for US-listed ADRs). `fundamentals.latest_annual.currency` holds the reporting currency (e.g. `'DKK'`).
- Shariah ratio call: `researchSwarm.ts:~2762-2775` — inside `if (fundamentals?.latest_annual !== undefined && market_cap !== undefined && shariahJudgment !== undefined)`, calls `computeShariahFinancialRatios({ interest_bearing_debt: la.total_debt_musd, cash_and_securities: la.cash_and_securities_musd, total_revenue: la.revenue_musd, market_cap, impermissible_income: effectiveImpermissibleIncome })`.
- FX fetch pattern: `YahooPriceSource.getQuote` (`marketData.ts:85-122`) — URL `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`, SSRF guard, timeout, then `parseYahooChart(json, ticker)` → `{ available, price_per_share, currency }`. `MarketDataDeps` carries the injectable fetch + timeout.

---

## Task 1: `fetchFxRateToUsd` (keyless Yahoo)

**Files:** Modify `marketData.ts`; Test `__tests__/marketData.test.ts`.

- [ ] **Step 1: Write failing tests.** First READ `YahooPriceSource.getQuote` + the existing marketData tests to reuse their fake-fetch harness (how `MarketDataDeps` injects `fetchImpl`/`timeoutMs`). Then:
```ts
import { fetchFxRateToUsd } from '../marketData'

describe('fetchFxRateToUsd', () => {
  it('returns 1 for USD with no fetch', async () => {
    let called = false
    const rate = await fetchFxRateToUsd('USD', { fetchImpl: (async () => { called = true; return new Response('{}') }) as any })
    expect(rate).toBe(1)
    expect(called).toBe(false)
  })
  it('parses the DKKUSD=X chart meta into the rate', async () => {
    const body = JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 0.145, currency: 'USD', regularMarketTime: 1 } }] } })
    const rate = await fetchFxRateToUsd('DKK', { fetchImpl: (async () => new Response(body, { status: 200 })) as any })
    expect(rate).toBeCloseTo(0.145, 4)
  })
  it('returns undefined on fetch error / missing meta / non-finite', async () => {
    expect(await fetchFxRateToUsd('DKK', { fetchImpl: (async () => { throw new Error('net') }) as any })).toBeUndefined()
    expect(await fetchFxRateToUsd('DKK', { fetchImpl: (async () => new Response('{}', { status: 200 })) as any })).toBeUndefined()
  })
})
```
(Adjust the fake-fetch shape to match the existing marketData tests if they differ — mirror them exactly.)

- [ ] **Step 2: Run — expect FAIL** (not exported).

- [ ] **Step 3: Implement** — mirror `getQuote`'s fetch/SSRF/timeout exactly, but build the FX symbol and reuse `parseYahooChart`:
```ts
/**
 * Keyless Yahoo FX: the multiplier converting 1 unit of `currency` to USD (e.g. DKK→USD ≈ 0.145). Returns 1
 * for USD without a fetch. Fail-closed: any error / missing meta / non-finite / non-positive → undefined.
 */
export async function fetchFxRateToUsd(currency: string, deps?: MarketDataDeps): Promise<number | undefined> {
  if (currency === 'USD') return 1
  const sym = `${currency}USD=X`
  const rawUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`
  try {
    // ... mirror getQuote: assertPublicHttpUrl(rawUrl), AbortController timeout (deps?.timeoutMs ?? YAHOO_DEFAULT_TIMEOUT_MS),
    //     fetch via deps?.fetchImpl ?? fetch, guard response.ok, json = await response.json() as YahooChartResponse ...
    const quote = parseYahooChart(json, sym)
    if (quote.available && Number.isFinite(quote.price_per_share) && quote.price_per_share > 0) return quote.price_per_share
    return undefined
  } catch {
    return undefined
  }
}
```
Fill the elided lines by copying `getQuote`'s exact fetch/guard structure. (Optional: add the same in-process cache `getQuote` uses, keyed by `currency`.)

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(workflow): fetchFxRateToUsd — keyless Yahoo FX rate`

---

## Task 2: `marketCapInReportingCurrency` (pure)

**Files:** Modify `marketData.ts`; Test `__tests__/marketData.test.ts`.

- [ ] **Step 1: Failing tests:**
```ts
import { marketCapInReportingCurrency } from '../marketData'

describe('marketCapInReportingCurrency', () => {
  it('passes USD market cap through unchanged when reporting currency is USD', () => {
    expect(marketCapInReportingCurrency(13000, 'USD', 1)).toBe(13000)
  })
  it('divides a USD market cap by the FX rate to get the reporting currency', () => {
    // 13000 USD-millions at DKK→USD 0.145 → ~89655 DKK-millions
    expect(marketCapInReportingCurrency(13000, 'DKK', 0.145)).toBeCloseTo(13000 / 0.145, 2)
  })
  it('returns undefined for a missing/zero/negative rate', () => {
    expect(marketCapInReportingCurrency(13000, 'DKK', undefined)).toBeUndefined()
    expect(marketCapInReportingCurrency(13000, 'DKK', 0)).toBeUndefined()
    expect(marketCapInReportingCurrency(13000, 'DKK', -1)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement:**
```ts
/**
 * Convert a USD market cap into `reportingCurrency` so it is dimensionally consistent with reporting-currency
 * fundamentals. `usdRate` is the currency→USD multiplier from fetchFxRateToUsd. USD passthrough; otherwise
 * divide by the rate. Returns undefined when the rate is missing/non-finite/≤0 (fail-closed).
 */
export function marketCapInReportingCurrency(
  marketCapUsd: number,
  reportingCurrency: string,
  usdRate: number | undefined,
): number | undefined {
  if (reportingCurrency === 'USD') return marketCapUsd
  if (usdRate === undefined || !Number.isFinite(usdRate) || usdRate <= 0) return undefined
  return marketCapUsd / usdRate
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(workflow): marketCapInReportingCurrency helper`

---

## Task 3: Wire currency conversion into the Shariah ratio call

**Files:** Modify `researchSwarm.ts`; Test the researchSwarm test suite.

- [ ] **Step 1: Capture the market_cap currency** near `researchSwarm.ts:2604`. After `const market_cap = avgMarketCap?.market_cap ?? spotMarketCap`, add (using the spot quote's currency if the avg path was not taken — confirm the spot variable's shape while reading; default to `'USD'` when unknown):
```ts
  const market_cap_currency: string = avgMarketCap?.currency ?? 'USD'
```

- [ ] **Step 2: Import the helpers** at the top of `researchSwarm.ts` (extend the existing `./marketData` import):
```ts
import { fetchFxRateToUsd, marketCapInReportingCurrency, fetchAverageMarketCap, resolveCurrentPrice, type AverageMarketCapResult, type MarketDataDeps, type PriceQuote } from './marketData'
```

- [ ] **Step 3: Convert before the ratio call.** At the Shariah block (~line 2762), inside the existing `if (fundamentals?.latest_annual !== undefined && market_cap !== undefined && shariahJudgment !== undefined)`, before `computeShariahFinancialRatios`, compute the currency-consistent market cap:
```ts
    const la = fundamentals.latest_annual
    // Currency-normalize: fundamentals are in the filer's reporting currency (e.g. DKK for a 20-F filer) but
    // market_cap is in the market_cap currency (USD for a US-listed ADR). The AAOIFI ratios are dimensionless,
    // so convert the ONE mismatched number — market_cap — into the reporting currency. Fail-closed: if the
    // currencies differ and we cannot get a rate, leave the verdict UNDETERMINED rather than mix currencies.
    let market_cap_for_ratios: number | undefined = market_cap
    if (la.currency !== market_cap_currency) {
      const usdRate = market_cap_currency === 'USD' ? await fetchFxRateToUsd(la.currency, deps.marketData) : undefined
      market_cap_for_ratios = usdRate === undefined ? undefined : marketCapInReportingCurrency(market_cap, la.currency, usdRate)
    }
```
Then change the ratio call to use `market_cap_for_ratios`, and guard the fail-closed case. Replace the `computeShariahFinancialRatios({ ... market_cap, ... })` call so it only runs when `market_cap_for_ratios !== undefined`:
```ts
    const ratios = market_cap_for_ratios === undefined
      ? { computable: false as const, reason: 'currency_conversion_unavailable' }
      : computeShariahFinancialRatios({
          interest_bearing_debt: la.total_debt_musd,
          cash_and_securities: la.cash_and_securities_musd,
          total_revenue: la.revenue_musd,
          market_cap: market_cap_for_ratios,
          impermissible_income: effectiveImpermissibleIncome,
        })
```
(Confirm `deps.marketData` is the right injectable MarketDataDeps at this scope; if the swarm uses a different deps field for market data, use that. If none is threaded here, call `fetchFxRateToUsd(la.currency)` with no deps — the live path uses the default fetch.) Confirm the existing `if (ratios.computable) { ... }` branch below still type-checks with the added `{ computable: false, reason }` shape (mirror the shape `computeShariahFinancialRatios` returns for its not-computable case).

- [ ] **Step 4: Test the wiring.** In the researchSwarm test suite (find the existing Shariah-ratio test that drives `computeShariahFinancialRatios` via a fundamentals + market_cap fixture — READ it and mirror), add:
  - A DKK fundamentals fixture (NVO-class: `currency: 'DKK'`, debt/cash/revenue in DKK) + a USD `market_cap` + a stub `fetchFxRateToUsd` (inject via deps, or a test that stubs the FX call) returning a known rate → assert the resulting `debt_ratio` is sane (matches `debt_dkk / (market_cap_usd / rate)`), NOT the ~10× mismatched value.
  - FX `undefined` (currencies differ, no rate) → the Shariah ratios are not-computable (verdict UNDETERMINED), and no mixed-currency ratio is produced.
  - A USD filer (`currency: 'USD'`) → no FX fetch, ratios unchanged vs today.
  If stubbing the FX fetch through the swarm's deps is impractical, factor the conversion so the test can drive `marketCapInReportingCurrency` + the guard directly, and cover the end-to-end with the live NVO check. Do NOT leave the wiring untested — say which approach you used.

- [ ] **Step 5: Verify** — `corepack pnpm exec vitest run packages/workflow` green; `corepack pnpm --filter @owlfolio/workflow exec tsc --noEmit -p tsconfig.json` clean; `corepack pnpm --filter @owlfolio/workflow lint` clean.
- [ ] **Step 6: Commit** `feat(workflow): convert market_cap to reporting currency for foreign-filer Shariah ratios`

---

## Verification (final)

- `corepack pnpm typecheck` + `lint` clean; full unit suite green.
- **Live**: recompute NVO — a computable Shariah verdict with plausible AAOIFI ratios (debt/market_cap in the low tens of %, not ~1000%); spot-check the DKK→USD rate against a known value; confirm a us-gaap filer (KO) is unchanged (no FX fetch, identical ratios).

## Out of scope (deferred, per spec)

- IFRS concept-map gaps (`shortTermInvestments`, dividend income) — optional follow-up; not required for NVO's verdict.
- Foreign-filer valuation (fair value vs USD ADR price); ADR non-1:1 share ratios; period-end-aligned FX.
