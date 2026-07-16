# Superinvestors — 13F discovery

Status: shipped 2026-07-16 (PR #13 + same-day polish). Route `/discovery`, nav label
**Superinvestors** (WORKFLOW group, right after the Command Center). This document is the
what/why/who reference for the page and its machinery.

## What it is

A small set of concentrated, low-turnover value investors must disclose their US stock holdings
to the SEC every quarter on form 13F. The Superinvestors page harvests those filings for a
curated roster, snapshots each manager's latest book, and surfaces their latest buys and sells
as **research ideas**. It is the idea source at the top of the funnel:

```
Superinvestors (13F ideas) → screening triage → research case → watchlist → held thesis
```

Page sections:

1. **Summary + honesty rails** — what the page is and its hard limits (below).
2. **Manager actions matrix** — the heat map. One row per name a tracked manager acted on
   (names with the most manager action on top), one column per investor (initials; a visible
   legend spells them out). Cells: green `▲` new position / >25% add, red `▼` exit, amber `▼`
   >25% trim; a deeper color means a bigger share of that manager's book. A thin **YOURS**
   column flags your own names (`⚑` held, `⚐` watched). A row expands to per-manager detail
   lines and — for names with no home yet — the accept/reject triage actions.
3. **Manager portfolio cards** — per manager: book value, position count, "as of <report> ·
   filed <filed>" stamp, top-10 holdings with weights and quarter-over-quarter chips, and the
   quarter's sells. Dormant or lagging filers are labeled, never shown as a live current book.
4. **Screening / Resolved** — the existing human triage tail.

## Why it exists

- **Grounded idea flow.** Owner's Manual is a grounded research-and-decision system; ideas must come
  from verifiable primary sources. 13F filings are exactly that: SEC-hosted, deterministic to
  parse, replayable. No model judgment is involved in the harvest.
- **Cloning as a starting point, never a trade.** The Pabrai-style cloning insight is that
  great concentrated investors publish their highest-conviction ideas quarterly. Owner's Manual uses
  that as a *funnel input*: every candidate still passes the Shariah front gate, the circle of
  competence, the four-pillar deep dive, and a human-authored admission. Nothing is bought,
  promoted, or copied automatically.
- **The sell side is a thesis prompt.** A tracked manager exiting or meaningfully trimming a
  name the user holds or watches raises an attention observation on the boards ("review your
  own thesis") — new evidence to weigh, explicitly never a sell instruction.

## Who it tracks (owner-curated, 2026-07-16)

CIKs are confirmed live against `https://data.sec.gov/submissions/CIK{cik}.json` (name +
13F-HR present) before joining the roster — a CIK is never guessed. The roster lives in
`packages/workflow/src/discovery13f.ts` (`CLONER_LIST`); the page, matrix columns, and legend
derive from it.

| Investor | Firm | CIK | Why tracked |
| --- | --- | --- | --- |
| Warren Buffett | Berkshire Hathaway | 0001067983 | The foundation of the strategy; core-position maneuvers and cash build-ups. |
| Mohnish Pabrai | Pabrai Investment Funds | 0001173334 | Hyper-concentrated cloning and deep value. **Dormant filer**: latest 13F-HR is 2012 — below the reporting threshold since; labeled, never faked as live. |
| Michael Burry | Scion Asset Management | 0001649339 | Contrarian plays and high turnover. **Intermittent filer** (has deregistered/claimed exemptions); his card can lag a quarter or more and is stamped with its own period. |
| Li Lu | Himalaya Capital | 0001709323 | Deliberate long-term compounders across US and Chinese tech. |
| Seth Klarman | Baupost Group | 0001061768 | *Margin of Safety*; cash deployment into complex assets and tech at multi-billion scale. |
| Bill Ackman | Pershing Square | 0001336528 | A concentrated public fund of ~7–11 predictable US mega-caps. |
| Guy Spier | Aquamarine Capital | 0002104187 | The mathematical power of low turnover and extreme patience. |

Akre Capital and Giverny Capital were tracked briefly and removed 2026-07-16 (owner). Their
recorded quarter events remain in the ledger as audit history; the page filters display to the
live roster via the projection's CIK allowlist.

## Honesty rails (non-negotiable)

- Every figure is stamped **"as of <report date> · filed <filing date>"** — filings arrive up
  to 45 days after the quarter ends.
- Long US equities only: no cost basis, no shorts, no international sleeves, no intra-quarter
  timing, and the filing gives **no reasons** (a sell can be valuation, rebalancing, or
  redemptions).
- No performance numbers, no live prices (13F values are the filing's own dollar values).
- Unresolved CUSIP→ticker mappings render as `UNRESOLVED` — a ticker is never guessed.
- Dormant/lagging filers are labeled per manager; the "Lagging filers" note is recomputed from
  the harvested quarters on every render.
- **One home per name**: a held or watched name shows its flag and routes to the
  portfolio/watchlist — it is never offered admission triage again.
- No auto-promotion: admission into research stays human-authored.

## Mechanics (pointers)

- **Harvest** (`runDiscovery13f`, worker task `discovery_13f`, human-fired from the page):
  fetches each roster manager's latest 13F-HR + its prior quarter, diffs them, and appends —
  all observations, all idempotent:
  - `discovery_13f_quarter_recorded` (aggregate `discovery_quarter`, idempotency
    `13f-quarter:{cik}:{period}:v2`): manager, period, report/filed dates, book total,
    position count, top-15 holdings with QoQ chips, per-manager **buys**
    (`NEW_POSITION`/`MEANINGFUL_ADD` with %-of-book conviction) and **sells**
    (`EXIT`/`MEANINGFUL_TRIM` with the unwound prior conviction). The 25% add threshold is
    mirrored on the trim side.
  - `discovery_candidate_discovered` for buy signals (cluster buys rank above single new
    positions above meaningful adds), after the Shariah sector pre-filter.
- **Read model** (`projectDiscovery13f`, packages/ledger): latest quarter per manager +
  the cross-manager sells aggregation; accepts a `ciks` allowlist so display follows the live
  roster while removed managers' events stay as audit history.
- **Cross-reference alert** (`projectMonitorAlerts`): a tracked manager's EXIT/TRIM of a HELD
  or WATCHED ticker raises a `superinvestor_exit` attention observation, keyed per
  manager-quarter (a re-harvest never duplicates), pointing at the page.
- **UI** (`DiscoveryPanel.tsx`): the matrix is built by the pure `buildActionMatrix(quarters)`;
  XML entities in issuer names are decoded at the parser AND the display title-caser (the
  `S&amp;P` dogfood find).

## From promotion to analysis (the two automation knobs)

A promoted candidate becomes a research case and, by default, **waits** for the user to start
the analysis. Two Settings → Automation knobs govern how far it proceeds on its own:

1. **Auto-run analysis on promotion** (`automation.discovery.auto_research`, default OFF):
   when ON, promoting a candidate immediately starts the research run (provider spend). The
   run always passes the cheap gates first — the Shariah front gate (when screening is on) and
   the circle of competence — so a failing name still dies early and cheaply. Rides the
   research-engine master switch; an auto-start failure never un-promotes the case (it just
   waits, and the error is surfaced).
2. **Deep-dive approval** (`automation.deep_dive_approval`, default `review`): once the cheap
   gates pass, `review` pauses the case at `awaiting_deep_dive_approval` for a human go-ahead
   before the expensive deep dive; `automatic` continues straight through.

So the fully-automatic path (auto_research ON + deep_dive_approval `automatic`) runs promotion
→ gates → deep dive → drafted verdict with no clicks — while the verdict itself remains a
DRAFT: watchlist admission, holding opens, and every other irreversible transition stay
human-authored regardless of these knobs.

## Boundaries

The page is an idea source and monitoring surface only. It never executes, recommends
execution, sizes a position, or advances workflow state; every transition out of it (accept
into screening, promote to research, prune, open, close) is human-authored. Copy on the page
says so explicitly: *"Nothing here is a buy or sell instruction."*
