# CUSIP-based ticker resolution for discovery — design

## Context

The 13F discovery engine resolves each holding's issuer to a ticker via `resolveIssuerTicker`
(`packages/workflow/src/discovery13f.ts`), which does an **exact normalized-name match** against SEC's
`company_tickers.json` (a CIK/name/ticker file with **no CUSIP**). Live testing showed only ~37% of
candidates resolve (11 of 30); the 19 unresolved were large **US-listed** companies (ADP, S&P Global,
Moody's, Alphabet, Macy's, Lennar), failing for two reasons:

1. **Abbreviated 13F names** don't equal SEC's full names ("AUTOMATIC DATA PROC" vs "…PROCESSING").
2. **Share-class ambiguity** — one normalized name maps to >1 ticker (Alphabet GOOG/GOOGL, Lennar
   LEN/LEN.B), so the matcher (which never guesses) returns unresolved.

13F holdings DO carry a **CUSIP** (unique per security *and* share class), which resolves both problems
directly — but SEC publishes no free CUSIP→ticker map. **OpenFIGI** (Bloomberg's open symbology service)
does, free and keyless at our volume.

## Decisions (from brainstorming)

- **Approach:** **OpenFIGI CUSIP→ticker, first; existing name-match as fallback; unresolved if both fail.**
  Authoritative CUSIP resolution fixes the abbreviation misses and disambiguates share classes precisely.
- **Keyless only.** No `OPENFIGI_API_KEY`. Keyless OpenFIGI allows 25 requests/min at 10 mapping jobs per
  request; ~40 CUSIPs/run is 4 chunked requests, well within the limit, and a module-level cache means
  repeat runs mostly don't re-hit it.
- **Fail-closed, never fabricate.** OpenFIGI unavailable/rate-limited/malformed → degrade to name-match,
  then unresolved. A discovery run NEVER fails because of OpenFIGI.

## Architecture

### 1. OpenFIGI resolver — `fetchOpenFigiTickers` (new, in `discovery13f.ts`)

`fetchOpenFigiTickers(cusips: string[], deps?: Sec13fDeps): Promise<Map<string, string>>` (cusip → ticker):
- De-duplicate + chunk the CUSIPs into batches of **10** (keyless job limit).
- Per chunk, `POST https://api.openfigi.com/v3/mapping` with body
  `[{ idType: 'ID_CUSIP', idValue: cusip, exchCode: 'US' }, …]` and `Content-Type: application/json`.
- Response is an array parallel to the jobs; for each, take `data[0].ticker` when present; skip entries
  carrying a `warning`/`error` or empty `data`. Map `cusip → ticker.toUpperCase()`.
- Mirror the SEC-fetch safety already in the file: injectable `deps.fetchImpl`, `assertPublicHttpUrl`
  (SSRF guard) on the URL, an `AbortController` timeout, single-shot per chunk, and **fail-closed** — any
  error (network, non-200, JSON parse, chunk failure) yields the partial map accumulated so far; never
  throws.
- Module-level `cusipTickerCache: Map<string, string>` (CUSIP→ticker is stable across runs) plus a
  `__resetCusipTickerCacheForTests()` hook, mirroring `companyTickersCache` /
  `__resetCompanyTickersCacheForTests`.

Injected as an optional `deps.fetchCusipTickers?: (cusips: string[]) => Promise<Map<string,string>>` on
`RunDiscovery13fDeps` (alongside `fetchManagerQuarters` / `fetchCompanyTickers`), so `test_mode` never
touches the network. Live default calls `fetchOpenFigiTickers`.

### 2. Resolution cascade (candidate-creation path)

`runDiscovery13f` currently resolves per surviving signal via `resolveIssuerTicker(signal.issuer, tickers)`.
Change to a cascade. **Batch first:** collect the distinct CUSIPs of the surviving signals and resolve them
in ONE `fetchCusipTickers` call (chunked internally) before the per-signal loop — one network round-trip,
not one per candidate. Then per signal:

1. **CUSIP → OpenFIGI**: if the batch map has `signal.cusip`, use that ticker →
   `resolution: 'matched_by_cusip'`.
2. **Name-match fallback**: else `resolveIssuerTicker(signal.issuer, tickers)`; on a match →
   `resolution: 'matched_by_name'` (preserves today's behavior when OpenFIGI is unavailable/unmapped).
3. **Unresolved**: else `resolution: 'unresolved'`, no ticker (unchanged "never fabricate").

Record the provenance in `discovery_metadata.ticker_resolution` so the UI/audit can show *how* a ticker was
resolved. (The existing `ticker_resolution: 'unresolved'` value stays; add `'matched_by_cusip'` /
`'matched_by_name'`. The dedupe key and candidate id remain cusip/period-based, unchanged.)

### 3. Data flow

```
surviving signals (each: cusip, issuer) ─┬─ distinct CUSIPs ─▶ fetchCusipTickers (OpenFIGI, chunks of 10, cached, fail-closed)
                                         │                        └─ Map<cusip, ticker>
                                         ▼
   per signal:  CUSIP hit? ── yes ─▶ ticker (matched_by_cusip)
                    │ no
                    └─▶ resolveIssuerTicker(issuer) ── match ─▶ ticker (matched_by_name)
                                                       └ none ─▶ unresolved (no ticker)
```

## Error handling

- OpenFIGI down / non-200 / rate-limited / malformed / chunk error → that chunk contributes nothing to the
  map; resolution degrades to name-match then unresolved. No run failure.
- SSRF guard (`assertPublicHttpUrl`) + `AbortController` timeout on the OpenFIGI URL, same as SEC fetches.
- Empty CUSIP list (no surviving signals) → no OpenFIGI call.
- A CUSIP that OpenFIGI maps to a non-US / no-ticker security → treated as a miss → name-match fallback.

## Testing

- `fetchOpenFigiTickers` — unit with injected `fetchImpl`: correct request body/URL/headers; parses
  `data[0].ticker`; skips `warning`/`error`/empty-`data` jobs; chunks >10 into multiple requests; fail-closed
  on non-200, network throw, and timeout (returns the partial/empty map, never throws); cache hit avoids a
  second fetch.
- Resolution cascade — CUSIP hit wins over name; name-match fallback used when the CUSIP map lacks the cusip;
  unresolved when both miss; two distinct share-class CUSIPs (GOOG 02079K107 vs GOOGL 02079K305) resolve to
  distinct tickers; provenance recorded correctly.
- `runDiscovery13f` (`test_mode`) — inject `fetchCusipTickers` returning a fixed map; assert candidates carry
  the CUSIP-resolved ticker + `ticker_resolution: 'matched_by_cusip'`, and that a cusip absent from the map
  falls back to name-match. No live network.
- Optional live smoke against real OpenFIGI for a few known CUSIPs (ADP 053015103, GOOG 02079K107,
  GOOGL 02079K305) — confirms real mappings + share-class disambiguation.

## Verification

- `corepack pnpm typecheck` + `lint` clean; full unit suite green including the new tests.
- Live: run discovery on a fresh sandbox and confirm resolution rate rises well above the ~37% baseline
  (ADP, S&P Global, Alphabet-both-classes, Lennar now resolve), with `matched_by_cusip` provenance, and that
  a simulated OpenFIGI outage still completes the run via name-match/unresolved.

## Out of scope (future)

- Retro-resolving candidates already discovered as UNRESOLVED (new runs resolve going forward; a one-off
  backfill could be a separate task).
- Non-US listings beyond OpenFIGI's US-exchange mapping.
- An OpenFIGI API key / higher-volume batching (keyless is sufficient at current scale).
- Quick-screen hardening (separate, queued follow-up — the research-swarm quick screen fails-closed on
  flaky model JSON; unrelated to ticker resolution).
