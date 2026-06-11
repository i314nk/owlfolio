# Operational Exercise Findings — first real-instance run (2026-06-12)

First time Owlfolio's **real local instance** was operationally exercised end-to-end: expand the
calibration universe, run the go-live calibration **measurement**, run one **live** research case through
the real product path, and run the real worker monitor ticks. No new features. Everything landed in the
owner's **real** local ledgers under `data/`.

- **Config:** `data/app-config.json` — mode `personal-local`, provider `openai` (Codex CLI v0.137.0,
  `~/.codex/auth.json`), strategy `buffett-munger`, Shariah AAOIFI.
- **Ledger used by both web + worker:** `data/personal-ledger.sqlite` (the worker resolves
  `config.ledger_path` when `OWLFOLIO_LEDGER_PATH` is unset — same store as the web app; verified, no
  split-store finding). `data/source-ledger/` for source bundles.
- **Env for the exercise:** `OWLFOLIO_PROJECT_DIR=$PWD`, `OWLFOLIO_APP_CONFIG_PATH=$PWD/data/app-config.json`,
  and (for the worker) the real `data/personal-ledger.sqlite` + `data/source-ledger`.
- **Human-transition discipline:** verified clean. The final ledger contains **no** `watchlist_draft_created/confirmed`,
  `holding_opened`, `purification_payment`, or `valuation_config` event. Only drafts, observations, and
  reversible universe curation were authored. The ADBE `decision_drafted` (WATCH) is a draft awaiting the owner.

## TL;DR

The plumbing ran clean against the real instance. The **live ADBE research case is genuinely
investment-grade** — the judgment layer (anchor/rubric arbitration, base-rate burden, red-team → synthesis
downgrade) engaged exactly as designed and produced a defensible WATCH. The **calibration measurement
surfaced a real signal-tuning question for the owner**: with the current frozen params, **zero** names
signalled BUY in either pre-stated must-signal window (2020 COVID crash, 2022–23 drawdown); the only two
BUY episodes across 10 resolved names are outside the target windows. One real **bug** found
(`watchlist_monitor` fails closed on an empty watchlist when a non-scheduled-certified provider is
configured) and two smaller data findings (NVO DKK/USD mismatch — expected; GOOGL only 16 months of EDGAR
history — anomaly).

---

## Step 1 — Calibration universe expansion (owner-directed curation)

Appended 8 user-authored `calibration_universe_member_added` events (via the real
`addCalibrationUniverseMember` lib the `/api/calibration/universe/add` route uses): MSFT, GOOGL, ADBE, MCD,
NKE, JNJ, UNH, MA (all `market: US`).

- Projected universe version: **`calibration-universe-2026-06-2+8`**
- **Active (11):** CPRT, FDS, NVO + MSFT, GOOGL, ADBE, MCD, NKE, JNJ, UNH, MA
- **Deferred (4):** TABREED, DEWA, EMPOWER, TALABAT (non-SEC DFM/ADX filers — unchanged)

Matches the expected 11 active / 4 deferred. Reversible (each is a user-authored add; a `member_removed`
tombstones it).

## Step 2 — Go-live calibration MEASUREMENT (`calibration_run`)

Enqueued `calibration_run_requested` (`cal_1781217461265`) via the real `enqueueCalibrationRun`, then ran
the worker `process_calibration_queue` task **once** against the real config. Live EDGAR fundamentals +
10yr month-end Yahoo prices.

- **Wall time: ~16s.** processed=1, failed=0.
- Recorded event: `evt_calibration_run_cal_1781217461265`, params version `valuation-2026-06-recalibration-1`,
  universe version `calibration-universe-2026-06-2+8`.
- **Coverage: 10 EDGAR-resolved, 0 local-manual, 4 deferred, 1 unresolved.**

### Signal log (per active name)

| Ticker | Coverage | Months | Buy months | Buys/yr | BUY episodes | 2020-03..05 must-signal | 2022-09..2023-01 must-signal | 2021 must-NOT |
|--------|----------|--------|-----------|---------|--------------|:-:|:-:|:-:|
| CPRT | edgar USD | 120 | 15 | 1.51 | 1 → **2016-07** | ✗ (not signalled) | ✗ | ✓ clean |
| FDS  | edgar USD | 120 | 0 | 0.00 | 0 | ✗ | ✗ | ✓ |
| MSFT | edgar USD | 120 | 0 | 0.00 | 0 | ✗ | ✗ | ✓ |
| GOOGL| edgar USD | **16** | 0 | 0.00 | 0 | ✗ (not covered) | ✗ (not covered) | ✓ (not covered) |
| ADBE | edgar USD | 120 | 0 | 0.00 | 0 | ✗ | ✗ | ✓ |
| MCD  | edgar USD | 120 | 28 | 2.82 | 1 → **2024-03** | ✗ | ✗ | ✓ |
| NKE  | edgar USD | 120 | 0 | 0.00 | 0 | ✗ | ✗ | ✓ |
| JNJ  | edgar USD | 120 | 0 | 0.00 | 0 | ✗ | ✗ | ✓ |
| UNH  | edgar USD | 120 | 0 | 0.00 | 0 | ✗ | ✗ | ✓ |
| MA   | edgar USD | 120 | 0 | 0.00 | 0 | ✗ | ✗ | ✓ |
| NVO  | **unresolved** | — | — | — | — | — | — | — |

Deployment ratios: the only two episodes (CPRT, MCD) each fired at `cold=1.00`, `normal=1.00` (1 episode each).

### Target comparison (§3.1 pre-stated target: 1–3 buys/yr)

- **Aggregate:** 2 BUY episodes total across the 10 resolved names; sum of per-name buys/yr = 4.32; avg ≈ 0.43/name/yr.
  Most names sit at 0.00 buys/yr; CPRT (1.51) and MCD (2.82) are the only signalling names, both **within**
  the 1–3 band individually.
- **must-signal 2020-03..2020-05 — FAILED for ALL covered names.** Zero names signalled BUY in the COVID crash window.
- **must-signal 2022-09..2023-01 — FAILED for ALL covered names.** Zero names signalled BUY.
- **must-NOT-signal 2021 — PASSED for all** (no false positives in the frothy year). Good news, but it is
  consistent with a calibration that is simply too tight to fire.
- The two real episodes (CPRT 2016-07, MCD 2024-03) are **outside** all three target windows.

**Interpretation (measurement only — no param touched):** the current frozen params are **too conservative
to fire in the canonical drawdowns** the target was written around. This is exactly the input the §3.4
tune/freeze decision is supposed to consume. The decision is the owner's; this report is the evidence.

## Step 3 — One LIVE research case through the real product path: **ADBE**

Enqueued `research_run_requested` via the real `enqueueResearchRun` (web path; provider readiness gate
**passed** for Codex — no onboarding-gate refusal at the worker-feed path, because `process_research_queue`
runs the swarm directly and investable-capital only affects dossier position-sizing, not run admission),
then ran the worker `process_research_queue` **once**. Real Codex, real grounding.

- Research case: `rc_adbe_1781217552471`. **Wall time: 610s (~10.2 min).** processed=1, failed=0.
- **Lane completeness:** quick_screen → queued_for_deep_dive → deep_dive_started → 7× specialist_finding →
  deep_dive_synthesis (29 sources) → deep_dive_completed → buffett_munger_analysis_drafted → decision_drafted.
  All lanes produced verified sources; no fail-closed abort.

### Verdict + judgment-layer engagement

- **Decision / verdict: WATCH** (verdict_state WATCH). **Shariah: CONDITIONAL.**
- **Valuation:** moat **wide** (gate passed), runway **limited**, discount rate 10% (untouched), growth_rate
  0.02 (capped), ROIC 0.62, owner-earnings/share $12.31, **fair value $152.31/sh**, MoS 25% → **buy price $114.24/sh**,
  implied multiple ~12.4×. Bridge = SEC EDGAR FY2025 10-K (`sec_edgar_10k_0000796343_fy2025`).
- **Rubric / anchor arbitration worked as designed.** Moat: anchor tier `moderate` (computable M1=2 ROIC>15%
  10/10 yrs; M2=0 gross-margin not surfaced by the filing adapter), lane proposed `wide`, resolved `wide`;
  harness **overrode 4 uncited/over-claimed rows to 0** (M2–M5 violations recorded). Runway: lane proposed
  `proven`, **harness downgraded to `limited`** (anchor not computable — incremental ROIC undefined because
  change in invested capital non-positive; R2/R3 scored 0 for missing citations).
- **Base-rate burden:** `roic_gt_20_decade` met (3 structural evidences vs 2 required); 0 unmet.
- **Red-team → synthesis:** a **high-severity** bear objection (AI unbundling Adobe's creation moat;
  AI-inference cost in COGS; FTC subscription action; simultaneous CEO+CFO transition). Synthesis response
  mode = **`accepted_downgraded`**: removed clean wide-moat growth credit, downgraded growth underwriting
  from "wide-moat compounder credit" to "prove-it / high-single-digit base-case credit," kept SBC-adjusted
  owner earnings + an AI-disruption haircut. This is the correct, falsifiable, citation-bound behavior.
- **Shariah harness ratios:** debt 3.35%, cash+securities 3.56%, impermissible income 1.11% → **CONDITIONAL**,
  purification 1.11%; market cap $185.3B (`avg_36mo_x_diluted_shares`), FY2025 basis.
- **Degraded flags:** none fatal. One real data-adapter gap noted in the moat anchor: **gross margin is not
  surfaced by the EDGAR filing adapter** (M2 forced to 0 / "operating-margin band proxy"). That capped the
  computable moat sub-score at 2/4 and is the main reason the moat anchor read `moderate` rather than top-tier.
- **next_required_action:** "Hold for the dedicated follow-up call to formally resolve AI monetization
  durability, margin impact, and moat-decay evidence before upgrading to BUY."

The ADBE dossier is investment-grade and the judgment mechanisms (anchor arbitration, citation enforcement,
base-rate burden, red-team/synthesis downgrade) all fired correctly. This is the engine behaving as the
direction intended.

## Step 4 — Real worker monitor ticks (against the real personal ledger)

Seeded default scheduled tasks (`--define-defaults`, 9 `scheduled_task_defined` events, user-authored
`system-defaults`) then ran each monitor once. State is sparse (no confirmed watchlist/holdings yet).

| Tick | Result | Notes |
|------|--------|-------|
| `watchlist_monitor` | **FAILED (rc=1)** | Bug — see below. `scheduled_task_run_failed` recorded. |
| `holdings_monitor` | completed | 0 holdings → 0 alerts; advisory only, no action. |
| `shariah_rescreen` | completed | No Shariah-ratio source injected → fail-closed observation only. |
| `purification_projection` | completed | 0 obligations, 0 pending dividends, 0 exit finalizations; quarterly statement, no zakat. |
| `forecast_resolution` | completed | 0 forecasts due, 0 resolved; no outcome fabricated. |

Each completed tick appended 2 events (run_started + run_completed). No crash on sparse state for the four
that completed.

---

## Findings

### BUG-1 — `watchlist_monitor` fails closed on an EMPTY watchlist when the configured provider is not scheduled-certified
- **Severity:** medium (blocks the deterministic buy-window pass; surfaces as a hard task failure).
- **Symptom:** `watchlist_monitor` returned rc=1 with `Provider openai is not ready: OpenAI Codex CLI is not
  certified for scheduled workflows (personal_local_interactive)`, recording a `scheduled_task_run_failed`.
- **Root cause:** `runWatchlistMonitorTask` (`apps/worker/src/runtime.ts:911`) calls
  `assertProviderReadyForExecution(options.provider, options.provider_readiness)` **unconditionally** at the
  top of the `if (options.provider !== undefined)` block (≈`runtime.ts:927–928`), *before* iterating
  `confirmedWatchlistItems`. With **zero** confirmed items the provider would never actually be invoked, yet
  the assertion throws first — so the deterministic, provider-free buy-window pass (`runWatchlistBuyWindowPass`,
  ≈`runtime.ts:939`) never runs. The Codex CLI is `personal_local_interactive` (not
  `scheduled_workflow_supported`), so the readiness gate correctly reports not-ready for scheduled use — but
  the monitor should degrade to the observation-only deterministic pass instead of hard-failing when there is
  nothing for the provider to do.
- **Suggested fix (not applied — code changes out of scope):** only assert provider readiness when there is at
  least one confirmed watchlist item to run the provider against (move the assert inside the loop / guard it on
  `confirmedWatchlistItems.length > 0`), so an empty or provider-incompatible config still completes the
  deterministic buy-window pass as an observation-only tick.
- **Real-world impact:** on this instance, with the default `openai`/Codex provider, the daily
  watchlist_monitor will fail every tick until either a watchlist item exists *and* a scheduled-certified
  provider is configured — even though the deterministic buy-window logic needs no provider.

### FINDING-2 — NVO unresolved: DKK fundamentals vs USD price (currency mismatch) — EXPECTED / WORKING-AS-DESIGNED
- NVO resolved EDGAR fundamentals in **DKK** but the price series came back in **USD** (the US-listed ADR),
  so the backtest fail-closed rather than mixing currencies: *"currency mismatch: fundamentals in DKK but
  price in USD — supply a local-listing price or local-manual fundamentals in a matching currency."* This is
  the honest, anticipated outcome. Resolving NVO would need a DKK-listed price path or matching-currency
  local-manual fundamentals.

### FINDING-3 — GOOGL only 16 months of EDGAR history (data anomaly)
- GOOGL is a US 10-K filer yet its backtest covered only **16 months** (vs 120 for the other US names), so
  all three sanity windows were `covered:false`. Worth a look at the EDGAR fundamentals adapter's GOOGL
  resolution (CIK / class-share / XBRL concept selection) — it did not fail-close (status resolved_edgar) but
  the series is far shorter than expected, which silently excludes GOOGL from the must-signal windows.

### FINDING-4 — EDGAR filing adapter does not surface gross margin (moat-anchor cap)
- In the ADBE judgment anchor, moat row **M2 (operating-margin band)** fell back to a proxy because *"gross
  margin not surfaced by the filing adapter,"* capping the computable moat sub-score at 2/4 and the anchor
  tier at `moderate`. Not fatal (the lane still resolved wide with cited evidence), but it systematically
  weakens moat anchors for margin-driven franchises. Candidate data-adapter enhancement.

### Friction / ergonomics
- Inline `tsx -e` cannot use top-level await (CJS eval); ad-hoc inspection needs a temp script file.
- Worker `process_research_queue` / `process_calibration_queue` are correct, gate-free queue paths — good for
  this exercise, but note they bypass the web onboarding gate by design (the gate lives in the web API/UI
  layer, not the worker queue handler).

---

## Decisions now the owner's

1. **ADBE → watchlist?** The live case drafted **WATCH** (Shariah CONDITIONAL, FV $152.31, buy $114.24,
   moat wide / runway limited, AI-monetization risk unresolved). Confirming it to the watchlist is a
   user-authored transition — not taken here. `next_required_action` asks to resolve AI monetization
   durability before any BUY upgrade.
2. **Tune or freeze the calibration params?** The measurement shows the current frozen params signalled in
   **neither** must-signal window (0/10 names in both 2020 and 2022–23) while correctly staying silent in
   2021. If the owner believes the params should fire in those drawdowns, this is the evidence to justify a
   §3.4 valuation-config change DRAFT (which must cite `evt_calibration_run_cal_1781217461265`); if the owner
   prefers the current conservatism, freeze as-is. Either way it is the owner's call — no param was touched.
3. **Set investable capital?** No `investable_capital_set` event exists on this instance, so dossier
   position-sizing is advisory-only/unsized. If the owner wants sized tranches, record investable capital via
   the existing user-authored `setInvestableCapital` path.
4. **Triage BUG-1** (watchlist_monitor hard-fails on empty watchlist with Codex) — decide whether to fix the
   provider-readiness guard so the daily monitor degrades to the deterministic observation-only pass.
5. **NVO / GOOGL coverage** — decide whether NVO is worth a matching-currency price path and whether the
   GOOGL 16-month EDGAR truncation warrants an adapter fix (it currently silently shrinks GOOGL's backtest).
