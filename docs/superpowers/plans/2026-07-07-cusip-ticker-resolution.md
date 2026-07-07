# CUSIP-based ticker resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve 13F discovery candidates' tickers by CUSIP via OpenFIGI (keyless) before falling back to name-matching, raising the ~37% resolution rate and disambiguating share classes.

**Architecture:** Add a fail-closed, cached `fetchOpenFigiTickers(cusips)` that POSTs a batched CUSIP→ticker mapping to OpenFIGI's free keyless API. Wire it into `runDiscovery13f` as a per-run batch call up front, then resolve each candidate via a cascade: CUSIP → name-match → unresolved, recording provenance.

**Tech Stack:** TypeScript, pnpm workspace, vitest. All new code lives in `packages/workflow/src/discovery13f.ts`.

**Run from the worktree root:** `/home/hermes_agent/code/owlfolio/.worktrees/cusip-resolution`
Test form: `NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm exec vitest run <path>`

---

## File Structure

- **Modify** `packages/workflow/src/discovery13f.ts` — add `fetchOpenFigiTickers` + `cusipTickerCache` + `__resetCusipTickerCacheForTests`; add `fetchCusipTickers` to `RunDiscovery13fDeps`; replace the single name-match in `runDiscovery13f` with the batch + cascade.
- **Modify** `packages/workflow/src/__tests__/discovery13f.test.ts` — tests for the resolver + the cascade.

**Key existing facts (verified):**
- `Sec13fDeps = { fetchImpl?: typeof fetch; timeoutMs?: number; userAgent?: string }` (discovery13f.ts:35). `SEC_DEFAULT_TIMEOUT_MS`, `assertPublicHttpUrl` (imported from `./sourceGrounding`), and `fetchSecText` (the SSRF+timeout+injectable-fetch pattern) are all in the file.
- `resolveIssuerTicker(issuer, tickers): TickerResolution` where `TickerResolution = { ticker?; company_name; resolution: 'matched' | 'unresolved' }` (line 461) — UNCHANGED by this plan.
- The candidate loop (lines 633-666): resolves via `resolveIssuerTicker(signal.issuer, tickers)` (639), sets `ticker = resolved.ticker ?? UNRESOLVED:${signal.cusip}` (641), and records `ticker_resolution: resolved.resolution` in `discovery_metadata` (664). Each `signal` has `.cusip` and `.issuer`.
- `RunDiscovery13fDeps` (line 542) has `fetchManagerQuarters?`, `fetchCompanyTickers?`, `sec?: Sec13fDeps`, `test_mode?`, `now?`. `test_mode` guard at ~593 requires `fetchManagerQuarters` + `fetchCompanyTickers`.
- The projection's `extractDiscoverySignal` treats `ticker_resolution === 'unresolved'` as unresolved; any other value = resolved. So `'matched_by_cusip'` / `'matched_by_name'` both read as resolved.

---

## Task 1: `fetchOpenFigiTickers` — the CUSIP→ticker resolver

**Files:**
- Modify: `packages/workflow/src/discovery13f.ts`
- Test: `packages/workflow/src/__tests__/discovery13f.test.ts`

- [ ] **Step 1: Write the failing test** — add a new `describe` block to `discovery13f.test.ts`. Import `fetchOpenFigiTickers` and `__resetCusipTickerCacheForTests` from `../discovery13f`.

```ts
describe('fetchOpenFigiTickers', () => {
  beforeEach(() => __resetCusipTickerCacheForTests())

  function figiFetch(map: Record<string, string | null>): typeof fetch {
    return (async (_url: string, init?: RequestInit) => {
      const jobs = JSON.parse(String(init?.body)) as Array<{ idValue: string }>
      const body = jobs.map((j) => {
        const t = map[j.idValue.toUpperCase()]
        return t === null || t === undefined ? { warning: 'No identifier found.' } : { data: [{ ticker: t }] }
      })
      return { ok: true, json: async () => body } as Response
    }) as unknown as typeof fetch
  }

  it('maps CUSIP -> upper-cased ticker, skipping no-data/warning jobs', async () => {
    const out = await fetchOpenFigiTickers(['053015103', '02079K107', 'BADCUSIP00'], {
      fetchImpl: figiFetch({ '053015103': 'ADP', '02079K107': 'GOOG', BADCUSIP00: null }),
    })
    expect(out.get('053015103')).toBe('ADP')
    expect(out.get('02079K107')).toBe('GOOG')
    expect(out.has('BADCUSIP00')).toBe(false)
  })

  it('resolves distinct share-class CUSIPs to distinct tickers', async () => {
    const out = await fetchOpenFigiTickers(['02079K107', '02079K305'], {
      fetchImpl: figiFetch({ '02079K107': 'GOOG', '02079K305': 'GOOGL' }),
    })
    expect(out.get('02079K107')).toBe('GOOG')
    expect(out.get('02079K305')).toBe('GOOGL')
  })

  it('chunks >10 cusips into multiple requests', async () => {
    let calls = 0
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      calls += 1
      const jobs = JSON.parse(String(init?.body)) as Array<{ idValue: string }>
      return { ok: true, json: async () => jobs.map((j) => ({ data: [{ ticker: `T${j.idValue}` }] })) } as Response
    }) as unknown as typeof fetch
    const cusips = Array.from({ length: 23 }, (_v, i) => `CUSIP${i.toString().padStart(5, '0')}`)
    const out = await fetchOpenFigiTickers(cusips, { fetchImpl })
    expect(calls).toBe(3) // 10 + 10 + 3
    expect(out.size).toBe(23)
  })

  it('is fail-closed: a non-200 / throwing fetch yields an empty map, never throws', async () => {
    const bad = (async () => { throw new Error('network down') }) as unknown as typeof fetch
    await expect(fetchOpenFigiTickers(['053015103'], { fetchImpl: bad })).resolves.toEqual(new Map())
    const non200 = (async () => ({ ok: false } as Response)) as unknown as typeof fetch
    await expect(fetchOpenFigiTickers(['053015103'], { fetchImpl: non200 })).resolves.toEqual(new Map())
  })

  it('caches resolved cusips across calls (no second fetch)', async () => {
    let calls = 0
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      calls += 1
      const jobs = JSON.parse(String(init?.body)) as Array<{ idValue: string }>
      return { ok: true, json: async () => jobs.map(() => ({ data: [{ ticker: 'ADP' }] })) } as Response
    }) as unknown as typeof fetch
    await fetchOpenFigiTickers(['053015103'], { fetchImpl })
    await fetchOpenFigiTickers(['053015103'], { fetchImpl })
    expect(calls).toBe(1)
  })
})
```
(Add `beforeEach` to the vitest imports at the top of the test file if not already present.)

- [ ] **Step 2: Run — expect FAIL** (`fetchOpenFigiTickers`/`__resetCusipTickerCacheForTests` not exported).

- [ ] **Step 3: Implement** in `discovery13f.ts` (place near `fetchCompanyTickersDefault`, after line ~540):
```ts
const OPENFIGI_MAPPING_URL = 'https://api.openfigi.com/v3/mapping'
const OPENFIGI_CHUNK_SIZE = 10 // keyless job limit per request

let cusipTickerCache: Map<string, string> | undefined

/** Test-only hook to reset the module-level CUSIP->ticker cache. */
export function __resetCusipTickerCacheForTests(): void {
  cusipTickerCache = undefined
}

/**
 * Resolve CUSIP -> US ticker via OpenFIGI's free KEYLESS mapping API (10 jobs/request). Fail-closed: any
 * error (network, non-200, bad JSON, chunk failure) contributes nothing — the function returns the map of
 * whatever resolved and NEVER throws. Cached across runs (CUSIP->ticker is stable). Returns only the
 * requested cusips that resolved.
 */
export async function fetchOpenFigiTickers(cusips: string[], deps?: Sec13fDeps): Promise<Map<string, string>> {
  const cache = cusipTickerCache ?? (cusipTickerCache = new Map<string, string>())
  const requested = [...new Set(cusips.map((c) => c.toUpperCase()).filter((c) => c.length > 0))]
  const missing = requested.filter((c) => !cache.has(c))
  const fetchFn = deps?.fetchImpl ?? fetch
  const timeoutMs = deps?.timeoutMs ?? SEC_DEFAULT_TIMEOUT_MS

  for (let i = 0; i < missing.length; i += OPENFIGI_CHUNK_SIZE) {
    const chunk = missing.slice(i, i + OPENFIGI_CHUNK_SIZE)
    let url: URL
    try { url = assertPublicHttpUrl(OPENFIGI_MAPPING_URL) } catch { continue }
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, timeoutMs)
    try {
      const response = await fetchFn(url.toString(), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk.map((cusip) => ({ idType: 'ID_CUSIP', idValue: cusip, exchCode: 'US' }))),
      })
      if (!response.ok) continue
      const jobs = (await response.json()) as Array<{ data?: Array<{ ticker?: unknown }> }>
      if (!Array.isArray(jobs)) continue
      jobs.forEach((job, idx) => {
        const cusip = chunk[idx]
        const ticker = job?.data?.[0]?.ticker
        if (cusip !== undefined && typeof ticker === 'string' && ticker.length > 0) {
          cache.set(cusip, ticker.toUpperCase())
        }
      })
    } catch {
      continue
    } finally {
      clearTimeout(timer)
    }
  }

  const out = new Map<string, string>()
  for (const cusip of requested) {
    const ticker = cache.get(cusip)
    if (ticker !== undefined) out.set(cusip, ticker)
  }
  return out
}
```

- [ ] **Step 4: Run — expect PASS** (5 tests). Also `corepack pnpm --filter @owlfolio/workflow exec tsc --noEmit -p tsconfig.json` clean.
- [ ] **Step 5: Commit** `feat(workflow): fetchOpenFigiTickers — keyless CUSIP→ticker resolver`

---

## Task 2: Wire the CUSIP cascade into `runDiscovery13f`

**Files:**
- Modify: `packages/workflow/src/discovery13f.ts` (`RunDiscovery13fDeps` + the candidate loop)
- Test: `packages/workflow/src/__tests__/discovery13f.test.ts`

- [ ] **Step 1: Add the dep** — in `RunDiscovery13fDeps` (line ~542), add:
```ts
  /** CUSIP -> ticker resolver (defaults to keyless OpenFIGI live; injected in tests). */
  fetchCusipTickers?: (cusips: string[]) => Promise<Map<string, string>>
```

- [ ] **Step 2: Write the failing test** — add to `discovery13f.test.ts`. Reuse the existing `deps` fixture that drives `runDiscovery13f` in test_mode (it injects `fetchManagerQuarters` + `fetchCompanyTickers`; grep the file for how COST/MSFT are produced). Add a test that injects `fetchCusipTickers`:
The fixture's surviving CUSIPs are **COST `22160K105`** and **MSFT `594918104`** (confirmed in the test file). A `matched_by_cusip` provenance can only be set on the CUSIP path, so asserting it proves CUSIP precedence over name-match (which would set `matched_by_name`).
```ts
it('resolves ticker by CUSIP (OpenFIGI) ahead of name-match, recording provenance', async () => {
  __resetCompanyTickersCacheForTests()
  const { store } = makeMemoryStore()
  const cusipMap = new Map<string, string>([['22160K105', 'COST'], ['594918104', 'MSFT']])
  await runDiscovery13f(store, { ...deps, test_mode: true, fetchCusipTickers: async () => cusipMap })
  const candidates = projectDiscoveryCandidates(await store.list())
  const cost = candidates.find((c) => c.ticker === 'COST')
  expect(cost?.discovery_metadata?.['ticker_resolution']).toBe('matched_by_cusip')
})

it('falls back to name-match when the CUSIP map lacks the cusip', async () => {
  __resetCompanyTickersCacheForTests()
  const { store } = makeMemoryStore()
  await runDiscovery13f(store, { ...deps, test_mode: true, fetchCusipTickers: async () => new Map() })
  const candidates = projectDiscoveryCandidates(await store.list())
  const cost = candidates.find((c) => c.ticker === 'COST')
  expect(cost).toBeDefined() // still resolved via name-match
  expect(cost?.discovery_metadata?.['ticker_resolution']).toBe('matched_by_name')
})
```
(`__resetCompanyTickersCacheForTests` is already exported/used in this file. If `discovery_metadata` isn't typed with an index signature on `DiscoveryCandidateProjection`, read it as `(cost?.discovery_metadata as Record<string, unknown> | undefined)?.['ticker_resolution']`.)

- [ ] **Step 3: Run — expect FAIL** (provenance is currently `'matched'`, and no CUSIP resolution happens).

- [ ] **Step 4: Implement the cascade** in `runDiscovery13f`. After `result.sector_excluded = excludedCusips.size` (line 628) and before the `for (const signal of signals)` loop, add the batch resolve:
```ts
  const resolveCusips = deps.fetchCusipTickers
    ?? (deps.test_mode === true ? async () => new Map<string, string>() : (cs: string[]) => fetchOpenFigiTickers(cs, deps.sec))
  const cusipTickerMap = await resolveCusips(
    signals.filter((s) => !excludedCusips.has(s.cusip)).map((s) => s.cusip.toUpperCase()),
  )
```
(The `test_mode` default is an empty map so EXISTING tests — which don't inject `fetchCusipTickers` — keep their current name-match behavior and never hit the network.)

Then replace the resolution lines 639-641:
```ts
    const resolved = resolveIssuerTicker(signal.issuer, tickers)
    if (resolved.resolution === 'unresolved') result.unresolved += 1
    const ticker = resolved.ticker ?? `UNRESOLVED:${signal.cusip}`
```
with the cascade:
```ts
    const cusipTicker = cusipTickerMap.get(signal.cusip.toUpperCase())
    let ticker: string
    let tickerResolution: 'matched_by_cusip' | 'matched_by_name' | 'unresolved'
    if (cusipTicker !== undefined) {
      ticker = cusipTicker.toUpperCase()
      tickerResolution = 'matched_by_cusip'
    } else {
      const resolved = resolveIssuerTicker(signal.issuer, tickers)
      if (resolved.resolution === 'matched' && resolved.ticker !== undefined) {
        ticker = resolved.ticker
        tickerResolution = 'matched_by_name'
      } else {
        ticker = `UNRESOLVED:${signal.cusip}`
        tickerResolution = 'unresolved'
        result.unresolved += 1
      }
    }
```
And change the metadata field (line 664) from `ticker_resolution: resolved.resolution` to `ticker_resolution: tickerResolution`.

- [ ] **Step 5: Run — expect PASS.** Then run the FULL discovery test file: `corepack pnpm exec vitest run packages/workflow/src/__tests__/discovery13f.test.ts`. Some existing tests assert `ticker_resolution: 'matched'` — update those assertions to `'matched_by_name'` (the name-match path now records provenance). Do NOT change any `'unresolved'` assertion (that value is unchanged).

- [ ] **Step 6: Verify** — `corepack pnpm --filter @owlfolio/workflow exec tsc --noEmit -p tsconfig.json` clean; `corepack pnpm --filter @owlfolio/workflow lint` clean; broad `corepack pnpm exec vitest run packages/workflow` green (watch `discoveryCandidateWorkflow.test.ts` + the projection tests — they should be unaffected since `'matched_by_*'` still reads as resolved).
- [ ] **Step 7: Commit** `feat(workflow): resolve discovery tickers by CUSIP (OpenFIGI) before name-match`

---

## Verification (final)

- `corepack pnpm typecheck` + `lint` clean; full unit suite green.
- Live smoke: from a fresh sandbox, run discovery and confirm the resolution rate rises well above ~37% (ADP, S&P Global, both Alphabet classes, Lennar resolve with `matched_by_cusip`); simulate an OpenFIGI outage (inject a throwing `fetchCusipTickers` or block the host) and confirm the run still completes via name-match/unresolved.
- Optional live OpenFIGI check outside the suite for CUSIPs 053015103 (ADP), 02079K107 (GOOG), 02079K305 (GOOGL).
