# Calibration parameter-sweep — evidence for the go-live tune/freeze decision

**Date:** 2026-06-12
**Scope:** READ-ONLY parameter-sweep analysis. No valuation params were edited, no config-change
events were written, no code was committed except this document.
**Anchors:** recorded calibration run `cal_1781217461265` (`data/personal-ledger.sqlite`,
params `valuation-2026-06-recalibration-1`, universe `calibration-universe-2026-06-2+8`);
`valuation-recalibration-spec.md` §3.1 target, §3.3 tuning order, §3.4 anti-drift rule.

---

## TL;DR (the decision)

**Do NOT tune-and-freeze off this sweep. The backtest's fundamentals are contaminated by
share-count split/units discontinuities, and the recorded BUY signals — both in
`cal_1781217461265` and in every param set below — are predominantly data artifacts, not
valuation signals.** Once the contaminated names are excluded, **no parameter set within the
spec's allowed knobs (MOS → terminal g → horizon; never the 10% discount, never the growth-band
caps) produces a single BUY across the clean quality-compounders** — not even the most generous
allowed set (MOS 10%, terminal 2.5%, horizon 15). The honest reading is **§3.3's tuning order
cannot satisfy §3.1's target on this universe with this data.** The next step is a data fix
(split-adjust the share series), not a parameter change.

This is the §3.4 distinction in practice: calibration tunes to a target on *trustworthy*
evidence before deployment. The evidence here is not yet trustworthy, so freezing a looser
parameter set "because the must-windows finally fired" would be loosening against an artifact —
exactly what §3.4 forbids.

---

## 1. Universe coverage (this run)

Live EDGAR + Yahoo fetches, 120 month-end prices each, deterministic.

| Name | Moat / runway | Resolved | Note |
|---|---|---|---|
| CPRT | wide / proven | ✅ EDGAR USD | share series has split/units jumps (see §4) |
| FDS | wide / limited | ✅ EDGAR USD | clean share series |
| MSFT | wide / proven | ✅ EDGAR USD | clean share series |
| GOOGL | wide / proven | ✅ EDGAR USD | 20:1 split landed in wrong FY vs price (§4) |
| ADBE | wide / proven | ✅ EDGAR USD | clean share series |
| MA | wide / proven | ✅ EDGAR USD | 10:1 split jump (§4) |
| MCD | wide / limited | ✅ EDGAR USD | **fy2021+ diluted_shares ≈ 0 — units bug (§4)** |
| NKE | wide / limited | ✅ EDGAR USD | two 2:1 split jumps (§4) |
| JNJ | wide / limited | ✅ EDGAR USD | clean share series |
| UNH | wide / limited | ✅ EDGAR USD | clean share series |
| **NVO** | wide / proven | ❌ **skipped** | DKK fundamentals vs USD ADR price — currency mismatch, fail-closed (matches `cal_1781217461265` coverage). Would need `NOVO-B.CO` (DKK) price; out of scope for this read-only sweep. |

10 of 11 active names resolve; NVO is honestly unresolvable in this rig. The 4 GCC names
(TABREED/DEWA/EMPOWER/TALABAT) are `deferred` non-SEC filers, as in the recorded run.

---

## 2. The sweep (spec §3.3 order) — full universe, AS-RUN

Each set sweeps the **wide tier** (the universe is all-wide). Discount (10%) and FV cap (18×)
held constant per §3.3. "b/yr" = total BUY **episodes** ÷ 10 yrs across the universe. "2020"/"2022"
= # names firing in each must-signal window. "2021f" = # names firing in the must-not 2021 window.
Implied trigger multiple = buy_price ÷ OE for the representative name (most-recent as-of filing).

| # | Param set (wide tier) | Episodes | b/yr | 2020 hits | 2022 hits | 2021 false | dep cold% | dep norm% | MSFT trig× | CPRT trig× |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A1 | MOS 25% (current) | 4 | 0.40 | 0 | 1 | 1 | 100 | 100 | 10.0 | 10.0 |
| A2 | MOS 20% | 5 | 0.50 | 1 | 2 | 1 | 90 | 93 | 10.6 | 10.6 |
| A3 | MOS 15% | 7 | 0.70 | 2 | 2 | 1 | 90 | 97 | 11.3 | 11.3 |
| A4 | MOS 10% | 10 | 1.00 | 2 | 2 | 2 | 97 | 100 | 11.9 | 11.9 |
| B1 | MOS 15% + term 2.0% | 9 | 0.90 | 2 | 2 | 2 | 93 | 98 | 11.6 | 11.6 |
| B2 | MOS 15% + term 2.5% | 12 | 1.20 | 2 | 2 | 2 | 97 | 100 | 12.0 | 12.0 |
| C1 | MOS 15% + term 2.5% + horizon 12 | 12 | 1.20 | 2 | 2 | 2 | 97 | 100 | 12.1 | 12.1 |
| C2 | MOS 15% + term 2.5% + horizon 15 | 11 | 1.10 | 2 | 2 | 2 | 98 | 100 | 12.2 | 12.2 |

**At face value, set A3 (MOS 15%, all else current) looks like the first to satisfy the target:**
2020✓, 2022✓, buys/yr 0.7 (low end of 1–3), with only a single 2021 fire. *But the next section
shows every one of those fires comes from a contaminated name, so this row is NOT a valid
recommendation.*

### Which names actually fire (the disqualifier)

Decomposing the episodes by name:

- **The only names that ever fire are CPRT, GOOGL, and MCD** — all three contaminated (§4).
- The "2020 hits" and "2022 hits" are **CPRT** (split-inconsistent OE across the 2:1 boundary)
  and **GOOGL** (20:1 split misalignment).
- The "2021 false fire" is **GOOGL's 2021-03 → 2023-02 continuous BUY run**, where the engine
  values a price of ~$100–145 against a buy price of **$295–406** because the as-of filing's
  diluted shares jumped ×19.67 between FY2019 and FY2020 while Yahoo's prices are split-adjusted.
- **MCD's 28-month "BUY episode" (2024-03 → 2026-06)** is a division-by-near-zero: fy2021+
  `diluted_shares_m ≈ 0` → OE_ps ≈ **$9.85 MILLION/share**, buy price **$109 million**, so MCD's
  ~$280 price is trivially "below buy" every month. Pure artifact.

**On the 5 split-clean names (FDS, MSFT, ADBE, JNJ, UNH), every param set — A1 through C2,
including the most generous MOS 10% / term 2.5% / horizon 15 — produces ZERO BUY episodes,
zero must-window hits, zero 2021 fires.** The clean signal log is silent everywhere.

---

## 3. 2020-trough gap diagnostic — "how far away were we?"

Trough = lowest month-end price in 2020-03..2020-05. Buy price shown under the **most generous
allowed set** (MOS 15% + terminal 2.5% + horizon 15, set C2) — i.e. the deepest the spec's knobs
can reach. "× OE" is the trough price as a multiple of as-of OE_ps. "MOS to fire" is the margin of
safety at which buy_price would equal the trough low (negative ⇒ the price never reached even the
*fair value*, let alone a discounted buy).

| Name | 2020 trough low | as ×OE | C2 buy (×OE) | MOS that would fire |
|---|---:|---:|---:|---:|
| UNH | $249 | 24.1× | $115 (11.1×) | −85% |
| FDS | $261 | 43.9× | $66 (11.1×) | −236% |
| MSFT | $158 | 55.6× | $35 (12.2×) | −288% |
| ADBE | $318 | 115.0× | $26 (9.2×) | −957% |
| JNJ | $131 | 133.3× | $9 (9.2×) | −1125% |

2022-trough (2022-09..2023-01), same set:

| Name | 2022 trough low | as ×OE | C2 buy (×OE) | MOS that would fire |
|---|---:|---:|---:|---:|
| JNJ | $163 | 24.8× | $61 (9.2×) | −128% |
| UNH | $499 | 35.0× | $158 (11.1×) | −168% |
| MSFT | $232 | 45.7× | $47 (9.2×) | −320% |
| FDS | $400 | 48.4× | $92 (11.1×) | −271% |
| ADBE | $275 | 53.6× | $63 (12.2×) | −274% |

**Reading:** even at COVID and 2022 crash lows, these quality compounders bottomed at **24×–133×
OE**, while the spec's buy band sits at **9×–12× OE**. The gap is a factor of **2× to 11×** — and
MOS alone (capped at making buy = FV, i.e. MOS 0%) cannot close it; the trough prices are above
*fair value*, not just above the discounted buy. So **MOS cannot honestly close this gap**; the
spec's §3.3 escalation to terminal g and horizon barely moves the buy multiple (10.0× → 12.2× for
MSFT across the entire ladder) and never closes a 2×–11× chasm.

Caveat on the magnitudes: some ×OE figures (JNJ 133×, ADBE 115× in 2020) are inflated by the
backtest's conservative OE approximations (`maintenance_capex = min(D&A, capex)`, ΔNWC = 0) plus
as-of filing lag, so treat them as directional. But even the *cleanest* case (UNH 2020 at 24× OE,
MOS −85%; JNJ 2022 at 25× OE, MOS −128%) is nowhere near the buy band. The conclusion is robust to
the approximation.

---

## 4. Root cause — the data, not the parameters

The backtest computes OE_ps = OE_total ÷ that filing's `diluted_shares_m`, then compares it to a
**Yahoo split-adjusted** price series. The EDGAR-derived diluted-share series is NOT split-adjusted
consistently with the price series, and carries outright units errors:

| Name | Discontinuity (consecutive-FY share ratio) | Effect |
|---|---|---|
| CPRT | fy2020→2021 ×4.03 (a 2:1 split); fy2012 = 0.13M (×987 next yr) | OE_ps / buy price jump discontinuously across the split → spurious near-trough BUY/no-BUY flips |
| GOOGL | fy2019→2020 ×19.67 (the 20:1 split, mis-dated vs price) | buy price $295–406 vs price ~$100 → 2-year spurious BUY run spanning 2021 |
| MA | fy2010→2011 ×9.80 (10:1 split) | split-boundary contamination |
| NKE | fy2010→2011 ×1.97, fy2013→2014 ×1.98 (2:1 splits) | split-boundary contamination |
| MCD | **fy2021+ `diluted_shares_m ≈ 0`** | OE_ps ≈ $9.85M/share, buy ≈ $109M → BUY every month 2024–2026 |

The rig already **fail-closes on currency mismatch** (NVO DKK-vs-USD) but has **no equivalent guard
for split/units consistency** between the fundamentals share count and the split-adjusted price
series. `ownerEarningsPerShare` rejects `shares <= 0` but not a tiny-but-positive count (MCD's
near-zero), and the as-of stepping silently crosses split boundaries.

**Therefore the sweep table in §2 measures the data bug, not the valuation policy.** Tuning
parameters to make the must-windows "pass" would be tuning to GOOGL's and CPRT's split artifacts.

---

## 5. Recommendation

**No parameter set is recommended. Do NOT freeze a tune off `cal_1781217461265` or this sweep.**

Two findings, in priority order:

1. **(Blocking) Fix the fundamentals/price split-and-units consistency before any calibration.**
   The share series must be split-adjusted to the same basis as the price series (or the price
   series must be raw/unadjusted to match raw shares), and the near-zero-share units bug (MCD,
   CPRT fy2012) must be rejected fail-closed (e.g. guard `diluted_shares_m` against an implausibly
   small absolute value, and assert no >1.5× single-year share discontinuity without a recorded
   split factor). Until then no BUY signal in this rig is trustworthy.

2. **(Structural, survives the fix) On split-clean names the spec's allowed knobs cannot reach the
   target.** FDS/MSFT/ADBE/JNJ/UNH never produce a BUY at any allowed set, because these
   compounders bottomed at 24×–133× OE even in 2020/2022 while the buy band is 9×–12× OE. This is
   the precise scenario the spec's own **WATCH-FAIR** band (§2) anticipates: "Wonderful at fair —
   human-discretion zone. No harness buy signal." It is *not* evidence to loosen MOS/terminal g/
   horizon. The honest options for the owner — to be decided deliberately, not by silence
   (§3.4) — are:
   - **(a) Accept near-silence as correct** for an all-mega-cap-quality universe and rely on
     WATCH-FAIR for human discretion; revisit only at annual review with the data fixed; **or**
   - **(b) Broaden the universe** toward the cheaper/smaller and GCC names the spec's reference
     set actually contemplates (Tabreed/DEWA/Empower/Talabat + ~20 gate-plausible names, §3.2) —
     these are far likelier to hit ≤12× OE at dislocations than US mega-cap quality; **or**
   - **(c) Re-examine the OE normalization** (the conservative `min(D&A,capex)` / ΔNWC=0 backtest
     defaults depress OE_ps and inflate the ×OE figures) — but per §1 that is an *input-honesty*
     change, not a §3.3 conservatism knob, and must be argued on accounting grounds, not to force
     signals.

   What is **forbidden** (§3.3, §3.4): touching the 10% discount or the growth-band caps; and
   loosening MOS/terminal/horizon merely because the must-windows are silent on contaminated data.

---

## 6. Exact next step for the owner

This analysis is observation-only; it writes no config and no `calibration_run`. The owner's next
deliberate action, when ready, is a **config-change draft** that records the decision and its
evidence, then a freeze — but **only after the §5(1) data fix**, because re-running the calibration
on corrected fundamentals may change everything. A draft skeleton (do not apply until the data is
fixed and a fresh `calibration_run` is recorded):

```
valuation_config change (DRAFT — blocked on data fix):
  cites: cal_1781217461265  (baseline: 2 BUY episodes, both artifacts; 0/10 must-window real fires)
         docs/superpowers/dogfood/2026-06-12-calibration-param-sweep.md  (this analysis)
  decision: <chosen path 5(a) accept-silence / 5(b) broaden-universe / 5(c) OE-normalization>
  params: <unchanged from valuation-2026-06-recalibration-1, OR the new frozen set>
  precondition: a NEW calibration_run on split-adjusted, units-validated fundamentals
                with ≥1 REAL (non-artifact) fire in each must-signal window and 0 real 2021 fires.
  then: freeze (§3.4 — no further change until annual review with backtest re-run attached).
```

**The single most important sentence for the owner:** the current "2 buys" in
`cal_1781217461265` and every "fix" the parameter knobs appear to offer are produced by
stock-split/units errors in the share data — fix the data first; do not tune parameters to chase
those artifacts.

---

*Method note: all numbers above come from the pure `runValuationBacktest` engine
(`packages/workflow/src/backtest.ts`) over live-fetched EDGAR fundamentals + Yahoo 10-yr month-end
prices, cached once per name and swept across param sets by cloning the Buffett-Munger strategy
contract's wide-tier MOS/terminal/horizon (discount and FV cap held constant). Throwaway sweep
scripts were used and deleted; no source under `packages/` or `apps/` was modified.*

---

## 7. Re-measurement (post split-fix) — 2026-06-12

The §5(1) blocking data fix is now implemented and the calibration was re-run on corrected,
split-consistent fundamentals. **No parameter was changed** (still
`valuation-2026-06-recalibration-1`); only the share-basis data path was repaired.

### What was fixed (code)

- **Split-consistency (fix B, the correct comparison).** The backtest compared EDGAR *as-reported*
  diluted shares against Yahoo *split-adjusted* prices. EDGAR's per-year share count is on the share
  basis **as of that filing's `filed` date** (a 10-K restates prior-year comparatives onto the
  filing-date basis after a split, but the older 10-Ks are never re-filed) — so a year's count is
  brought onto today's basis by multiplying by the product of every split that took effect **after**
  its `filed` date. `marketData.fetchSplitEvents` pulls Yahoo `events=splits`;
  `cumulativeSplitFactorAfter` builds the per-date factor; `backtest.adjustFundamentalsForSplits`
  applies it to `diluted_shares_m` (OE_total is a currency flow and is split-invariant). Verified
  live: GOOGL FY2019 698.6M ×20 → ~13,972M (≈ today's 12,230M basis, the residual being real
  buybacks); CPRT/NKE/MA likewise collapse onto a smooth buyback trajectory with the split jumps
  removed. Applied in BOTH historical-OE paths (the `backtestName` runner and
  `runCalibrationBacktest`); fail-open to the sanity guard when splits can't be fetched. The **live
  research path is unaffected and untouched** — it values latest-year shares against the current
  price, already the same (today's) basis.

- **Sanity guard (fix C, the honest always-on net).** `runValuationBacktest` now drops any fiscal
  year whose (split-adjusted) diluted-share count is an implausible units artifact (≥100× below the
  series median, or a buy price > $100k/share from a collapsed denominator) and records a visible
  `data_quality_notes` entry per dropped year, threaded into the `calibration_run`. It never emits the
  artifact BUY (e.g. CPRT fy2012 = 0.13M).

- **MCD share-resolution bug (root cause).** MCD's FY2023+ 10-Ks re-tag
  `WeightedAverageNumberOfDilutedSharesOutstanding` in **millions** (`val = 751.8`) for periods it
  previously tagged as the **absolute count** (`val = 751,800,000`) — a 1e6 scale discontinuity within
  the same concept+unit. "Latest filed wins" picked the mis-scaled `751.8`, which after `/1e6` became
  `diluted_shares_m ≈ 0.00075` → OE/sh ≈ $9.85M → buy ≈ $109M → BUY every month. Fixed in
  `secEdgar.normalizeShareScale`: anchor on the series median and rescale only gross (≥100×)
  power-of-ten outliers back onto the median scale (legitimate year-to-year drift, even across a
  750M–1,200M power-of-ten boundary, is untouched). Verified live: MCD now resolves a smooth
  1,211M → 716M buyback series, no near-zero years.

- **Pinned fixture tests (RED→GREEN, TDD).** `secEdgar.test.ts` — a power-of-ten share restatement is
  rescaled (2021→751.8M, 2022→741.3M, not 0.00075). `splitEvents.test.ts` — `parseYahooSplits` /
  `cumulativeSplitFactorAfter` (GOOGL pre-split date carries ×20, post-split ×1). `backtest.test.ts` —
  a synthetic 20:1 split mid-history puts OE/sh on the price basis and **removes a BUY that the
  unadjusted control still fires**; the C-guard drops a near-zero-share year visibly and emits no BUY.

### Re-measured calibration (`calibration-universe-2026-06-2+8`, params unchanged)

Live EDGAR + Yahoo, recorded as a new `calibration_run` in `data/personal-ledger.sqlite` via the
operational path (enqueue `calibration_run_requested` → worker `process_calibration_queue` once,
default live deps).

| Name | months | BUY episodes | buys/yr | 2020 must | 2022 must | 2021 must-not | notes |
|---|---:|---:|---:|:--:|:--:|:--:|---|
| CPRT | 120 | 0 | 0.00 | n | n | n (ok) | — |
| FDS | 120 | 0 | 0.00 | n | n | n (ok) | — |
| MSFT | 120 | 0 | 0.00 | n | n | n (ok) | — |
| GOOGL | 108 | 0 | 0.00 | n | n | **n (was a 2-yr spurious BUY incl. 2021)** | — |
| ADBE | 120 | 0 | 0.00 | n | n | n (ok) | — |
| MCD | 120 | 0 | 0.00 | n | n | **n (was a 28-mo $109M-buy artifact)** | — |
| NKE | 120 | 0 | 0.00 | n | n | n (ok) | — |
| JNJ | 120 | 0 | 0.00 | n | n | n (ok) | — |
| UNH | 120 | 0 | 0.00 | n | n | n (ok) | — |
| MA | 120 | 0 | 0.00 | n | n | n (ok) | — |

Coverage is unchanged from `cal_1781217461265`: **10 EDGAR-resolved, NVO unresolved (DKK-vs-USD
currency fail-close), 4 deferred** non-SEC names.

### The honest reading

**Every artifact BUY is gone, and the result is what §5(2) predicted: zero BUYs on the clean
universe.** The only names that ever fired (CPRT, GOOGL, MCD) fired solely because of the
split/units contamination; with that removed, no name in this all-mega-cap-quality universe reaches
the spec's 9×–12× OE buy band at any month 2016–2026 — consistent with §3's finding that these
compounders bottomed at 24×–133× OE even in the 2020/2022 dislocations. **This is the correct,
trustworthy evidence §3.4 required — and it confirms the structural conclusion, not a tuning
opportunity.** No parameter was changed; tuning MOS/terminal/horizon to manufacture a fire on this
universe would be loosening against an honest near-silence. The owner's deliberate next step is
unchanged from §5: choose path **5(a) accept-silence + WATCH-FAIR human discretion**, or **5(b)
broaden the universe** toward the cheaper/smaller and GCC names more likely to dislocate to ≤12× OE —
now decidable on clean data. The must-signal windows being silent is a property of *this universe*,
not of the (now-fixed) data.

*Verification: `vitest run packages/workflow packages/strategies apps/worker` → 648 passed; tsc
(workflow, strategies, worker, root) exit 0; `git diff --check` clean; no `.js` sibling imports.*
