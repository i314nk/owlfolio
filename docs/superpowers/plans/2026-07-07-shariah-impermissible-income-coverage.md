# Shariah impermissible-income concept coverage (us-gaap) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Broaden the us-gaap impermissible-income XBRL concept set so 10-K filers that tag interest/investment income under other gross-income concepts (SPGI, GOOGL, COST, V) get an accurate Shariah verdict + purification instead of UNDETERMINED.

**Architecture:** Add the gross interest/investment/dividend-income concepts to the existing `impermissibleIncome` concept groups (and their labels) in `secEdgar.ts`. The extraction (`firstPopulatedByYearWithConcept` → `impermissibleIncomeLinesFor`) and downstream reconciliation are unchanged — new concepts inherit the existing interest→combined→dividend precedence. Deliberately exclude *nets* and *over-broad* concepts to preserve accuracy.

**Tech Stack:** TypeScript, pnpm workspace, vitest. Change is confined to `packages/workflow/src/secEdgar.ts` + its test.

**Run from the worktree root:** `/home/hermes_agent/code/owlfolio/.worktrees/shariah-income`
Test form: `NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm exec vitest run <path>`

---

## File Structure

- **Modify** `packages/workflow/src/secEdgar.ts` — the us-gaap `impermissibleIncome` concept map (~line 1122) + `IMPERMISSIBLE_INCOME_LABELS` (~line 1274) + the doc comment.
- **Modify** `packages/workflow/src/__tests__/secEdgar.test.ts` — add tests mirroring the existing `annualFacts`/`fakeFactsFetch` inline-companyfacts pattern (line 563).

**Verified facts:**
- The us-gaap concept map (secEdgar.ts:1122): `impermissibleIncome: { interest: ['InvestmentIncomeInterest'], dividend: ['InvestmentIncomeDividend'], combined: ['InvestmentIncomeInterestAndDividend', 'InterestAndDividendIncomeOperating'] }`. (The IFRS map is separate, line 1137 — NOT touched; that's deferred scope B.)
- Extraction (secEdgar.ts:1448-1450): `firstPopulatedByYearWithConcept(facts, taxonomy, cm.impermissibleIncome.<group>)` returns, per year, the FIRST populated concept in the list — so **list order is the within-group precedence**.
- `impermissibleIncomeLinesFor` (secEdgar.ts:1294) applies cross-group precedence: pure `interest` (+ separate `dividend`) when present; else `combined`; else a lone `dividend`. New concepts inherit this — no double-count.
- `IMPERMISSIBLE_INCOME_LABELS` (secEdgar.ts:1274) maps each concept → human label (used on the itemized dossier line).
- Test helpers in secEdgar.test.ts: `annualFacts({ 2025: value })` builds an XBRL fact; `fakeFactsFetch(facts)` serves a synthetic companyfacts; `fetchCompanyFundamentals(cik, { fetchImpl })` runs the extraction; assert `f.latest_annual.impermissible_income_lines`.

---

## Task 1: Broaden the impermissible-income concept coverage

**Files:**
- Modify: `packages/workflow/src/secEdgar.ts`
- Test: `packages/workflow/src/__tests__/secEdgar.test.ts`

- [ ] **Step 1: Write the failing tests** — add three tests to `secEdgar.test.ts`, near the existing impermissible-income test (~line 593). They reuse `annualFacts` + `fakeFactsFetch` already in the file.

```ts
it('extracts impermissible income from the broadened gross-income concepts (SPGI/GOOGL/COST/V class)', async () => {
  for (const [concept, value] of [
    ['InvestmentIncomeNet', 30],                 // SPGI
    ['InterestIncomeOther', 12],                 // GOOGL
    ['InvestmentIncomeNonoperating', 8],         // COST
    ['InterestAndDividendIncomeSecurities', 15], // V
  ] as const) {
    const facts = {
      entityName: 'X',
      facts: { 'us-gaap': {
        NetIncomeLoss: annualFacts({ 2025: 100 }),
        Revenues: annualFacts({ 2025: 1000 }),
        [concept]: annualFacts({ 2025: value }),
      } },
    }
    const f = await fetchCompanyFundamentals('0000000001', { fetchImpl: fakeFactsFetch(facts) })
    expect(f?.latest_annual.impermissible_income_lines?.map((l) => [l.concept, l.amount_musd])).toEqual([[concept, value]])
    expect(f?.latest_annual.impermissible_income_lines?.every((l) => l.label.length > 0)).toBe(true)
  }
})

it('does NOT extract nets or over-broad income concepts (accuracy: never overstate purification)', async () => {
  for (const concept of [
    'InterestIncomeExpenseNet', 'InterestIncomeExpenseNonoperatingNet',
    'InterestAndOtherIncome', 'OtherIncome', 'OtherNonoperatingIncomeExpense',
  ]) {
    const facts = {
      entityName: 'X',
      facts: { 'us-gaap': {
        NetIncomeLoss: annualFacts({ 2025: 100 }),
        Revenues: annualFacts({ 2025: 1000 }),
        [concept]: annualFacts({ 2025: 50 }),
      } },
    }
    const f = await fetchCompanyFundamentals('0000000001', { fetchImpl: fakeFactsFetch(facts) })
    expect(f?.latest_annual.impermissible_income_lines).toBeUndefined()
  }
})

it('prefers the pure interest concept over the broadened combined concepts (no double-count)', async () => {
  const facts = {
    entityName: 'X',
    facts: { 'us-gaap': {
      NetIncomeLoss: annualFacts({ 2025: 100 }),
      Revenues: annualFacts({ 2025: 1000 }),
      InvestmentIncomeInterest: annualFacts({ 2025: 30 }),
      InvestmentIncomeNet: annualFacts({ 2025: 45 }), // combined group — must NOT stack on top of interest
    } },
  }
  const f = await fetchCompanyFundamentals('0000000001', { fetchImpl: fakeFactsFetch(facts) })
  expect(f?.latest_annual.impermissible_income_lines?.map((l) => l.concept)).toEqual(['InvestmentIncomeInterest'])
})
```

- [ ] **Step 2: Run — expect FAIL** (the new concepts aren't in the map yet, so `impermissible_income_lines` is undefined for them):
`NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm exec vitest run packages/workflow/src/__tests__/secEdgar.test.ts`

- [ ] **Step 3: Add the concepts** — in `secEdgar.ts`, replace the `impermissibleIncome` group (line ~1122):
```ts
  impermissibleIncome: {
    interest: ['InvestmentIncomeInterest', 'InterestIncomeOther'],
    dividend: ['InvestmentIncomeDividend'],
    combined: [
      'InvestmentIncomeInterestAndDividend',
      'InterestAndDividendIncomeOperating',
      'InterestAndDividendIncomeSecurities',
      'InvestmentIncomeNet',
      'InvestmentIncomeNonoperating',
    ],
  },
```
And update the comment above it to document the exclusions:
```ts
  // Impermissible-income components: pure interest (+ separate dividend) itemized when tagged; the combined
  // interest-and-dividend / net-investment-income variants are used ONLY when the pure concept is absent
  // (already contain dividends → conservative overcount, never double-stacked). List order = within-group
  // precedence. Broadened beyond bank-style tags so non-financial filers resolve (SPGI InvestmentIncomeNet,
  // GOOGL InterestIncomeOther, COST InvestmentIncomeNonoperating, V InterestAndDividendIncomeSecurities).
  // DELIBERATELY EXCLUDED for accuracy: NETS (InterestIncomeExpenseNet / *Net — income minus interest
  // expense, can be negative → understates), and OVER-BROAD concepts (InterestAndOtherIncome / OtherIncome /
  // OtherNonoperatingIncomeExpense — blend permissible income → would overstate purification / falsely FAIL).
```

- [ ] **Step 4: Add the labels** — in `IMPERMISSIBLE_INCOME_LABELS` (line ~1274), add:
```ts
  InterestIncomeOther: 'interest income (other)',
  InterestAndDividendIncomeSecurities: 'interest and dividend income (securities)',
  InvestmentIncomeNet: 'net investment income',
  InvestmentIncomeNonoperating: 'nonoperating investment income',
```

- [ ] **Step 5: Run — expect PASS** (all three new tests + the existing impermissible-income test):
`NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm exec vitest run packages/workflow/src/__tests__/secEdgar.test.ts`

- [ ] **Step 6: Verify broad** — `corepack pnpm exec vitest run packages/workflow` green; `corepack pnpm --filter @owlfolio/workflow exec tsc --noEmit -p tsconfig.json` clean; `corepack pnpm --filter @owlfolio/workflow lint` clean.

- [ ] **Step 7: Commit** `feat(workflow): broaden us-gaap impermissible-income concept coverage for Shariah`

---

## Verification (final)

- `corepack pnpm typecheck` + `lint` clean; full unit suite green.
- **Live**: fetch real companyfacts for SPGI (CIK 64040), GOOGL (1652044), COST (909832) via `fetchCompanyFundamentals` (or recompute a research case) and confirm `impermissible_income_lines` is now populated (SPGI→`InvestmentIncomeNet`, GOOGL→`InterestIncomeOther`, COST→`InvestmentIncomeNonoperating`), so the Shariah verdict computes a real purification % instead of UNDETERMINED. Confirm V still resolves and a us-gaap filer whose only income tag is an excluded/broad concept stays UNDETERMINED (NVO/IFRS also stays UNDETERMINED — deferred to scope B).
