# Shariah impermissible-income concept coverage (us-gaap) — design

## Context

The Shariah gate computes an AAOIFI compliance verdict + purification % deterministically
(`computeShariahFinancialRatios`), but it fail-closes to **UNDETERMINED** when *impermissible income*
can't be quantified. Across a 37-analysis sample, **~40% of completed analyses are UNDETERMINED** (11 of
28 non-empty). Root cause, confirmed against live SEC data:

- Impermissible income has two sources, reconciled in `researchSwarm.ts:2708-2718`: the model Shariah pass
  (returns `null` for nearly every filer — no company labels an "impermissible income" line) and a
  **deterministic XBRL fallback** (`impermissibleIncomeLinesFor`, `secEdgar.ts:1294`). When both are
  absent → UNDETERMINED.
- The XBRL fallback searches a **narrow concept set** (`secEdgar.ts:1123`): `InvestmentIncomeInterest`,
  `InvestmentIncomeDividend`, `InvestmentIncomeInterestAndDividend`, `InterestAndDividendIncomeOperating`.
- Common filers tag one of these and resolve (KO, PEP, V, MSFT, MCO → CONDITIONAL/COMPLIANT). But a large
  minority tag interest/investment income under **other gross-income concepts** that aren't searched:

  | Filer | XBRL concept actually used | Searched today? |
  |---|---|---|
  | SPGI | `InvestmentIncomeNet` | no |
  | GOOGL | `InterestIncomeOther` | no |
  | COST | `InvestmentIncomeNonoperating` | no |
  | V | `InterestAndDividendIncomeSecurities` (also resolves via combined) | no |

This is a **us-gaap concept-coverage gap**. Broadening the searched set — carefully — resolves these.

## Scope

**This slice (A):** broaden the **us-gaap** impermissible-income concept set so 10-K filers that tag
interest/investment/dividend income under the additional gross-income concepts resolve accurately.

**Explicitly deferred (own follow-ups):**
- **B — IFRS / 20-F extraction.** Foreign private issuers (NVO) get **no financials at all** today (the
  harness's `ifrs-full` extraction is incomplete — empty valuation, not just Shariah), so their Shariah
  verdict can't compute regardless. Making 20-F filers work is a broader IFRS-extraction effort that also
  fixes valuation; it will *then* unblock 20-F Shariah.
- **C — model read-the-filing fallback on no-tools providers.** The Shariah pass is prompted to `read_source`
  the 10-K notes when XBRL misses the number, but the OpenRouter/GLM provider runs no-tools/degraded and
  can't call it → returns null. Fixing this (inject the filing text, or a tool-capable role model) is a
  separate reliability piece; it would recover the residual truly-ambiguous us-gaap filers A leaves
  UNDETERMINED.

## Decisions (from brainstorming)

- **Precise, not aggressive.** Add only concepts that are genuinely *gross interest / investment / dividend
  income*. Do NOT add concepts that blend permissible income (they would misclassify permissible income as
  impermissible → overstate purification / falsely FAIL a clean company). A filer whose *only* income tag is
  an ambiguous/broad one stays UNDETERMINED — the honest answer, recovered later by C.
- **Preserve the existing conservative reconciliation** (`researchSwarm.ts:2717` "max wins, err high") and
  the interest→combined→dividend **precedence** (no double-counting overlapping tags).

## Architecture

### 1. Broaden the concept groups (`secEdgar.ts`, the `impermissibleIncome` concept map ~line 1122)

Add these **gross-income** concepts to the existing groups (keeping precedence order — most-specific first):

- **interest** (pure interest, itemized alongside a separate dividend line):
  `InvestmentIncomeInterest` (existing), **`InterestIncomeOther`** (GOOGL).
- **combined** (interest+dividend / net investment income — used only when a pure-interest tag is absent, so
  no double-count): `InvestmentIncomeInterestAndDividend`, `InterestAndDividendIncomeOperating` (existing),
  **`InterestAndDividendIncomeSecurities`** (V), **`InvestmentIncomeNet`** (SPGI), **`InvestmentIncomeNonoperating`** (COST).
- **dividend**: `InvestmentIncomeDividend` (existing) — unchanged.

**Explicitly NOT added (with reasons, documented in a code comment):**
- `InterestIncomeExpenseNet`, `InterestIncomeExpenseNonoperatingNet` — *nets* (interest income minus
  interest expense; SPGI's is −$71M). A net understates or negates impermissible income.
- `InterestAndOtherIncome`, `OtherIncome`, `OtherNonoperatingIncomeExpense` — *too broad*; they blend
  permissible operating/other income with interest, so counting them overstates purification.

### 2. Extraction + precedence (unchanged mechanics)

`impermissibleIncomeLinesFor` already applies precedence: pure `interest` (+ separate `dividend`) when
present; else `combined`; else a lone `dividend`. The new concepts slot into their groups and inherit that
precedence, so a filer tagging both `InvestmentIncomeInterest` and `InvestmentIncomeNet` uses the pure
interest line, never both. The downstream reconciliation (`effectiveImpermissibleIncome`) and
`computeShariahFinancialRatios` are untouched.

## Data flow

```
companyfacts (us-gaap) ──▶ XBRL concept extraction (BROADENED group lists)
   ▶ impermissibleIncomeLinesFor(fy, interest, dividend, combined)  ── precedence, no double-count
   ▶ fundamentals.latest_annual.impermissible_income_lines
        │  (model pass returns null → falls back to the XBRL total; researchSwarm.ts:2708-2718)
        ▼
   effectiveImpermissibleIncome ──▶ computeShariahFinancialRatios(debt, cash, revenue, market_cap, impermissible)
        ▶ verdict PASS / CONDITIONAL / FAIL + purification_pct   (no longer UNDETERMINED for these filers)
```

## Error handling

- A filer that tags none of the (broadened) gross-income concepts → no line extracted → stays UNDETERMINED
  (honest; recovered later by C/B). Accuracy is never traded for a fabricated number.
- Nets / broad concepts are never read, so purification is never overstated by misclassifying permissible
  income.
- No change to the fail-closed-UNDETERMINED contract for genuinely-unquantifiable filers.

## Testing

- Unit (`secEdgar` XBRL extraction): given companyfacts tagging each new concept (`InvestmentIncomeNet`,
  `InterestIncomeOther`, `InvestmentIncomeNonoperating`, `InterestAndDividendIncomeSecurities`) →
  `impermissible_income_lines` is populated with that amount + label. Given ONLY an excluded concept
  (`InterestIncomeExpenseNet`, `OtherIncome`) → NOT extracted (still empty). Precedence: a filer tagging
  both a pure-interest concept and `InvestmentIncomeNet` → uses interest once, no double-count.
- Live verification (recompute or re-run against real companyfacts): SPGI, GOOGL, COST → now produce a
  computable Shariah verdict with a real purification %; V still resolves; a us-gaap filer with only broad
  income tags stays UNDETERMINED; NVO (IFRS) stays UNDETERMINED (deferred to B).

## Verification

- `corepack pnpm typecheck` + `lint` clean; full unit suite green.
- Re-run the affected tickers on a sandbox and confirm the UNDETERMINED rate drops from ~40% toward the
  IFRS/broad-only floor, with accurate (not inflated) purification percentages.

## Out of scope (queued)

- **B: IFRS / 20-F financial extraction** (unblocks 20-F valuation *and* Shariah).
- **C: model read-the-filing fallback on no-tools providers** (recovers residual ambiguous us-gaap filers).
- Any change to the AAOIFI thresholds, the reconciliation logic, or the model Shariah pass prompt.

---

## Live-verification correction (post-implementation)

A live run against real SEC **annual** facts corrected the impact claims above (the pre-implementation
survey mistakenly read non-annual values):

- **GOOGL resolves** — it tags `InterestIncomeOther` ($4,337M) in its annual 10-K. This is the real, common
  win: A recovers filers that disclose gross interest/investment income under the broadened concepts *in
  their annual XBRL*.
- **SPGI does NOT resolve via A** — its annual 10-K has **no gross interest-*income* concept at all** (only
  interest *expense* and a net `InterestIncomeExpenseNet`, which we correctly exclude). Its interest income
  is disclosed only in the 10-K notes text → it needs **C** (model reads the notes), or stays UNDETERMINED.
- **COST does NOT resolve via A** — its recent annual interest income sits inside `InterestAndOtherIncome`
  (the broad concept we correctly exclude for accuracy) → also needs **C**.

**Corrected scope of A:** it accurately recovers the *gross-annual-concept* filers (GOOGL-class), not the
*notes-only* filers (SPGI/COST-class, which need C) or IFRS filers (need B). The added concepts are all
valid and accuracy-preserving; A is a correct incremental improvement, and it makes **C the priority** for
the remaining UNDETERMINED us-gaap filers whose interest income lives only in the filing text.
