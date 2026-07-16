# The 13F discovery page (owner-approved design, 2026-07-16)

Branch `discovery-13f-page` off merged main. Reframe /discovery as THE 13F page: a summary of what
it is, the tracked value superinvestors, their portfolios, latest buys, and latest sells — an IDEA
SOURCE feeding the research funnel, never a copy signal.

## Grounding (what exists)

`discovery13f.ts` already: harvests 13F-HR quarters per curated manager (holdings + prior_holdings),
detects BUY signals (CLUSTER_BUY ≥2 managers initiating / NEW_POSITION / MEANINGFUL_ADD >25% share
growth, conviction = % of book), Shariah sector pre-filter, CUSIP→ticker resolution, and persists
`discovery_candidate_discovered` events → the triage funnel. Gaps: NO sell-side detection, NO
persisted quarter snapshots (manager cards impossible), page has no identity.

## Honesty rails (owner + house style)

- Every figure labeled with "as of <report date> · filed <filing date>" (the ~45-day lag).
- Long US equities only; no cost basis, no intra-quarter timing, no shorts/international.
- Dormant filers labeled per-manager (Pabrai: below the threshold since 2012 — never shown as live).
- No performance numbers. No auto-promotion — admission stays human-authored.
- Prices stay off this page (13F values are the filing's own $ values).

## Slices

- **S1 — Sell-side + quarter persistence (packages/workflow).**
  `detectManagerSells(quarter)` → EXIT (prior>0, now absent) / MEANINGFUL_TRIM (shares drop >25% —
  the buy threshold mirrored). New event `discovery_13f_quarter_recorded` per manager+period
  (idempotency `13f-quarter:{cik}:{period}`): manager, cik, period, filed date, total value,
  position count, TOP 15 holdings (cusip/issuer/ticker/value/shares/pct + QoQ chip NEW/ADD/TRIM/
  UNCHANGED), and the full sells list (exits + trims with prior/current shares + resolved tickers,
  unresolved flagged). Emitted by runDiscovery13f alongside candidates.
- **S2 — Projection + the held/watched cross-reference.**
  `discovery13fProjection`: manager quarters (latest per manager) + the aggregated latest-quarter
  sells. monitorAlertProjection: a superinvestor EXIT/TRIM of a ticker you HOLD or WATCH raises an
  attention alert on the boards ("Li Lu exited COST — review your thesis"), cleared per quarter key.
- **S3 — The page.** /discovery rebuilt: (1) summary header + honesty rails; (2) BUYS board —
  latest-quarter signals aggregated (cluster > new > add), managers + conviction, funnel state
  (existing-dossier link or run-analysis action, the existing triage); (3) SELLS board — exits/trims
  aggregated, held/watched rows flagged; (4) MANAGER cards — compact expandable rows (the boards'
  idiom): name · latest quarter · filed date · positions · total value, expanding to top-10 holdings
  with weight + QoQ chips; dormant filers labeled.
- **S4 — Gates + docs.** Tests per slice; e2e smoke (page renders sections, honest empty states);
  README/Learn one-liners.
