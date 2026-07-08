# Slice B — IFRS/20-F Shariah currency normalization — design

## Context

Foreign private issuers (20-F/IFRS filers like Novo Nordisk, NVO) can't get a Shariah verdict today. The
cause is **not** extraction — `fetchCompanyFundamentals` already extracts NVO's IFRS fundamentals correctly
(revenue, debt, cash, shares, net income) and the NVO fixture test passes (`secEdgar.test.ts:297`). The
cause is a **currency mismatch** in the Shariah ratio computation:

- Fundamentals are in the filer's **reporting currency** (DKK for NVO) — `AnnualFacts.currency` carries it
  (`secEdgar.ts:40`), detected correctly (`detectCurrency`, `secEdgar.ts:832`). The `*_musd` field names are
  historically misleading: for a non-USD filer they hold reporting-currency millions, not USD.
- `market_cap` is in **USD** — `fetchAverageMarketCap` returns `price × diluted_shares` with a `currency`
  field (`marketData.ts:379-411`), USD for NVO's US-listed ADR.
- `computeShariahFinancialRatios` (`shariahFinancialRatios.ts`) computes `debt/market_cap` and
  `cash/market_cap`. With debt/cash in DKK and market_cap in USD, these come out ~10× nonsense. (Note:
  `impermissible_income/revenue` is already correct — both DKK.)

Scope A (us-gaap concepts) + C (notes fallback) fixed the domestic Shariah gate. B extends it to foreign
filers with the **smallest change that makes the ratios currency-consistent**.

## Decision (from brainstorming)

The three AAOIFI ratios are **dimensionless**, and the only mismatched input is the single `market_cap`
number. So rather than convert the whole fundamentals set to USD, **convert the one number the other way** —
`market_cap` → the fundamentals' reporting currency — at the Shariah call site. Minimal, localized, and it
makes all three ratios consistent.

- **Keyless FX** via the same Yahoo source the prices use (no new API key).
- **Spot rate** (current), not fiscal-year-end aligned — the ratios are point-in-time and `market_cap`
  already uses a trailing average, so a spot rate is consistent enough.
- **Shariah-scoped.** Foreign-filer *valuation* (fair value in DKK vs a USD ADR price) stays out of scope —
  it's a separate concern from the Shariah gate and gets its own later slice.

## Architecture

### 1. FX helper — new keyless Yahoo fetch (`marketData.ts`)

`fetchFxRateToUsd(currency: string, deps?: MarketDataDeps): Promise<number | undefined>`
- Returns the multiplier that converts **1 unit of `currency` → USD** (e.g. DKK→USD ≈ 0.145).
- `currency === 'USD'` → returns `1` without a fetch.
- Otherwise fetches the Yahoo chart for the FX pair symbol `${currency}USD=X` (e.g. `DKKUSD=X`), reusing the
  existing keyless chart pattern (`YahooPriceSource`, `marketData.ts:82`) — the same SSRF guard
  (`assertPublicHttpUrl`), timeout, and `parseYahooChart` meta read (`regularMarketPrice`).
- Cached per-currency for the process (mirror the existing quote caching if present).
- **Fail-closed:** any error / unavailable / non-finite → `undefined`.

### 2. Convert market_cap at the Shariah call site (`researchSwarm.ts`, ~line 2767)

Before `computeShariahFinancialRatios`, when the fundamentals' currency differs from the market_cap's
currency (i.e. `la.currency !== marketCapCurrency`, which for the alpha means `la.currency !== 'USD'`):
- Fetch `rate = fetchFxRateToUsd(la.currency)` (DKK→USD multiplier).
- Convert `market_cap` (USD) into the reporting currency: `market_cap_local = market_cap_usd / rate`.
- Pass `market_cap_local` to `computeShariahFinancialRatios` so debt/cash (DKK) ÷ market_cap (DKK) are
  consistent. `total_revenue` + `impermissible_income` are already in the reporting currency — unchanged.
- **Fail-closed:** `rate === undefined` → do NOT convert and do NOT pass a mismatched market_cap; leave the
  Shariah verdict UNDETERMINED (the existing not-computable path), exactly as today. Never compute a ratio
  from mixed currencies.

A small pure helper keeps this testable: `marketCapInReportingCurrency(marketCapUsd, reportingCurrency,
rate): number | undefined` — returns `marketCapUsd` when reporting currency is USD, `marketCapUsd / rate`
when a finite positive rate is given, `undefined` otherwise.

### 3. Minor IFRS concept-map gaps (`secEdgar.ts:1151-1203`, only if trivial)

- `impermissibleIncome.dividend` / `.combined` for `ifrs-full` are empty; add the standard IFRS
  dividend/investment-income concepts if present in NVO-class filings (mirrors A). If no clean IFRS concept
  exists, leave empty — the notes-fallback (C) already covers text disclosure, and this is not required for
  NVO's Shariah verdict.
- `shortTermInvestments` for IFRS is empty; add the IFRS current-marketable-securities concept if a filer
  tags one. Optional — cash alone already computes a valid (slightly conservative) cash ratio.

These are additive and low-risk; if either has no clean concept, ship B without it (the currency fix is the
required part).

## Data flow

```
fetchCompanyFundamentals(NVO) ─▶ AnnualFacts (DKK: revenue/debt/cash, currency='DKK')   [already works]
fetchAverageMarketCap(NVO)    ─▶ { market_cap: USD millions, currency: 'USD' }           [already works]
                                        │
   la.currency !== 'USD' ──▶ fetchFxRateToUsd('DKK') ──▶ rate (DKK→USD)   [keyless Yahoo, fail-closed]
                                        │
   marketCapInReportingCurrency(market_cap_usd, 'DKK', rate) ──▶ market_cap in DKK
                                        ▼
   computeShariahFinancialRatios({ debt_DKK, cash_DKK, revenue_DKK, market_cap_DKK, impermissible_DKK })
                                        ▼
              verdict + purification %  (correct for foreign filers; UNDETERMINED if FX unavailable)
```

## Error handling / fail-closed

- FX unavailable / non-finite / ≤0 → no conversion, market_cap not passed mismatched → UNDETERMINED
  (existing not-computable contract). Never a garbage ratio.
- USD filers: `fetchFxRateToUsd('USD')` returns 1 with no network call → behavior byte-identical to today.
- The raw `fetchCompanyFundamentals` output is unchanged (still reporting currency) — the backtest's
  same-currency price contract (`secEdgar.ts:108-112`) is preserved; conversion is local to the swarm.

## Testing

- `fetchFxRateToUsd` — unit (fake fetch): `'USD'` → 1 with no fetch; `'DKK'` → parses the Yahoo
  `DKKUSD=X` chart meta into the rate; fetch error / missing meta / non-finite → `undefined`.
- `marketCapInReportingCurrency` — pure unit: USD passthrough; DKK divides by the rate; `undefined`/0/negative
  rate → `undefined`.
- Shariah wiring — with a DKK fundamentals fixture (NVO-class) + a USD market_cap + a stub FX rate → the
  ratios are computed on a consistent DKK basis (debt/market_cap is sane, not ~10×); with FX `undefined` →
  UNDETERMINED (fail-closed); a USD filer → unchanged (no FX fetch, same result as before).
- Live: NVO — Shariah verdict computes (no longer UNDETERMINED) with sane debt/cash ratios; spot-check the
  DKK→USD rate against a known value; confirm a us-gaap filer is unaffected.

## Verification

- `corepack pnpm typecheck` + `lint` clean; full unit suite green.
- Live: run/recompute NVO on a sandbox and confirm a computable Shariah verdict with plausible AAOIFI ratios
  (debt/market_cap in the low tens of %, not ~1000%). Confirm a us-gaap filer (e.g. KO) is byte-unchanged.

## Out of scope (deferred)

- **Foreign-filer valuation** (fair value in reporting currency vs USD ADR price) — its own later slice.
- **ADR share-ratio** correctness (non-1:1 ADRs) — a pre-existing market_cap concern independent of
  currency; NVO is 1:1.
- Historical/period-end-aligned FX (spot is sufficient for the point-in-time ratios).
- Any change to the AAOIFI thresholds or `computeShariahFinancialRatios` internals.

---

## Live verification (NVO, real DKK→USD rate)

Fetched the live keyless Yahoo rate `DKKUSD=X` = **0.1527** and computed NVO's AAOIFI ratios on its real
DKK fundamentals (revenue 309,064 / debt 130,958 / cash 26,464 DKK-millions) against a representative
~$350B USD market cap:

- **Converted (fixed):** market_cap → 2,292,076 DKK-M → **debt_ratio 5.7%**, cash_ratio 1.2% → **verdict PASS**.
- **Mixed (the pre-fix bug):** DKK debt ÷ USD market_cap → **debt_ratio 37.4%** — *above* the AAOIFI 33%
  threshold, i.e. NVO would have been **falsely FAILED** as non-compliant.

So B not only clears the UNDETERMINED — it corrects a false reject (NVO flips from a wrong FAIL to a correct
PASS). Keyless FX works end-to-end; the fix is live-verified.

**Follow-up (Minor, documented in code):** the spot-price market-cap fallback defaults `market_cap_currency`
to USD (it drops the quote currency), so a hypothetical foreign-*listed* ticker priced in its local currency
on the spot path would mis-convert. Unreachable for 20-F ADR filers (US-listed → USD-priced); noted at
researchSwarm.ts:2633 for future hardening.
