# Shariah notes-fallback: inject filing excerpts for impermissible income (C) — design

## Context

The Shariah reasoning pass (`shariahReasoningPass.ts`) must quantify **impermissible income** (interest /
investment / dividend income) for the AAOIFI purification %. When XBRL doesn't tag it (SPGI/COST-class — the
number lives only in the 10-K notes text), the pass is prompted to call `read_source` to read the notes.
But on the default provider (GLM via OpenRouter), `runGroundedAgentWithTools` degrades to a plain
`provider.structured()` call (`groundedAgent.ts:388`) — `read_source` is **never available** — so the model
can't read the notes and returns `impermissible_income: null` → the Shariah verdict is **UNDETERMINED**.

Scope-A (merged, commit c0c05d2) broadened the us-gaap XBRL concepts and recovered the filers that disclose
gross interest income in *annual XBRL* (GOOGL-class). C recovers the remaining us-gaap filers whose interest
income is disclosed **only in the filing text** (SPGI/COST-class).

**The lever:** the Shariah pass already receives `readCorpus` (a `Map<source_id, CapturedSource>` of the
**already-fetched** primary-filing content, `researchSwarm.ts:1704`) — but that content is only wired to
`read_source`, so on the no-tools path it is never shown to the model. The **quick screen** solves the same
no-tools problem by *injecting* a filing block straight into the prompt (unconditional on tools,
`researchSwarm.ts:664` / `buildQuickScreenFilingBlock`) — but its block carries only XBRL financials, which
for SPGI/COST omit interest income. C mirrors that injection with the **filing text where interest income
lives**.

## Decision (from brainstorming)

- **Inject a targeted filing excerpt** into the Shariah prompt (not deterministic regex extraction, not a
  tool-capable role model). Reuses the proven quick-screen injection pattern; works on the default no-tools
  provider; keeps model judgment (robust to prose-format variation) while staying token-bounded.

## Architecture

### 1. Excerpting helper — new pure function (`shariahReasoningPass.ts` or a small sibling module)

`extractImpermissibleIncomeExcerpts(filingText: string, opts?: { maxWindows?: number; windowChars?: number }): string[]`
- Scan `filingText` (case-insensitive) for the keywords `interest income`, `investment income`,
  `dividend income`.
- For each match, capture a bounded window (default ~200 chars) around it, but keep the window ONLY if it
  contains a dollar figure (a `$`/number token) — so pure prose mentions without a number are dropped.
- Dedupe overlapping/duplicate windows; cap to `maxWindows` (default ~8) and a total-length budget so the
  injection stays cheap (~2k chars).
- Pure + deterministic; returns `[]` when nothing qualifies.

### 2. Shariah filing block — new builder (mirrors `buildQuickScreenFilingBlock`, `researchSwarmCompute.ts:745`)

`buildShariahIncomeBlock(fundamentals: Fundamentals | undefined, excerpts: string[]): string | undefined`
- When `fundamentals.latest_annual.impermissible_income_lines` is present, inject those itemized XBRL lines
  (concept + label + $M) — the deterministic figure the harness already has; the model confirms it.
- When XBRL lines are absent/empty, inject the text `excerpts` under a clear header: "HARNESS-EXTRACTED
  income disclosures from the verified primary filing — quantify impermissible income (interest income on
  cash + prohibited-segment revenue) from these; `null` only if genuinely not disclosed."
- Returns `undefined` when there is neither an XBRL line nor an excerpt (nothing to add).

### 3. Wire into the Shariah pass

- `runShariahReasoningPass` already gets `readCorpus` + the primary filing `source_id`
  (`preVerifiedSourceIds`). Pull that filing's text from `readCorpus.get(primarySourceId)` (the
  `CapturedSource` content). If that captured content does not include the financial-statements section, the
  harness pre-fetches / selects section 8 via the existing `filingSections` parse before excerpting.
- Also thread the `Fundamentals` object (or just its `latest_annual.impermissible_income_lines`) into the
  pass so the block can include the XBRL lines. (Today the pass does NOT receive `Fundamentals`.)
- Build the block and **append it to `buildShariahReasoningPrompt`**, unconditional on tool availability.
  Update the prompt text: "the harness has extracted the income-statement / interest-income lines below —
  quantify from them; `read_source` is ALSO available if your provider supports the tool loop" (tool-capable
  runs still read more; no-tools runs are no longer blind).

### 4. Fail-closed preserved

If XBRL is absent **and** no excerpt yields a figure the model can quantify → `impermissible_income: null` →
UNDETERMINED, exactly as today. C only gives the model *more grounding*; it never supplies a default number,
never overstates, never fabricates. The downstream reconciliation
(`effectiveImpermissibleIncome`, `researchSwarm.ts:2708-2718`) and `computeShariahFinancialRatios` are
unchanged.

## Data flow

```
readCorpus[primary 10-K].content ─▶ (section-8 text) ─▶ extractImpermissibleIncomeExcerpts()  ── keyword windows w/ $ figures
fundamentals.latest_annual.impermissible_income_lines ─┐
                                                       ▼
                              buildShariahIncomeBlock(fundamentals, excerpts)  ── XBRL lines and/or text excerpts
                                                       ▼
                     appended to buildShariahReasoningPrompt (unconditional on tools)
                                                       ▼
   no-tools model quantifies impermissible_income from injected text ─▶ effectiveImpermissibleIncome
                                                       ▼
        computeShariahFinancialRatios ─▶ verdict + purification %  (no longer UNDETERMINED for notes-only filers)
```

## Error handling

- No fetched filing content for the primary source / empty text → no excerpts; block falls back to XBRL
  lines only (or `undefined`) → behavior unchanged (UNDETERMINED if XBRL also absent).
- Excerpter never throws (pure string ops; bounded output).
- The keyword windows may include interest *expense* text; the prompt already directs the model to quantify
  interest *income* only — the model discriminates. (Excerpts are grounding, not an asserted total.)

## Testing

- `extractImpermissibleIncomeExcerpts` — unit: "Interest income was $128 million…" → one window containing
  the figure; a mention with no dollar figure → dropped; multiple/overlapping matches → deduped + capped to
  the window/length budget; empty/irrelevant text → `[]`.
- `buildShariahIncomeBlock` — includes XBRL lines when present; includes excerpts when XBRL absent; returns
  `undefined` when neither.
- `runShariahReasoningPass` end-to-end with a **no-tools** fake provider + a `readCorpus` filing text
  disclosing interest income → the pass returns a numeric `impermissible_income` (not null); with no
  disclosure and no XBRL → stays null (fail-closed); with XBRL already present → unchanged (no regression).
- Live: recompute SPGI / COST → impermissible income now quantified from the notes text → a computable
  Shariah verdict + purification % instead of UNDETERMINED.

## Verification

- `corepack pnpm typecheck` + `lint` clean; full unit suite green.
- Live: re-run SPGI and COST on a sandbox with the default (no-tools GLM) provider and confirm the Shariah
  verdict computes (no longer UNDETERMINED), with a purification % grounded in the filing's disclosed
  interest income.

## Out of scope (queued)

- **B: IFRS / 20-F extraction** — foreign filers have no us-gaap facts and a different filing structure;
  separate effort.
- Changing the AAOIFI thresholds, the reconciliation logic, or the model/provider role configuration.
- Quick-screen hardening (separate, lower-priority reliability item).

---

## Mechanism correction (pre-implementation)

`readCorpus`'s `CapturedSource` holds only a short `excerpt`, NOT the full filing text — so the excerpt
source is **not** `readCorpus` content. Corrected mechanism: the harness reads the filing sections itself
via the existing **`readGroundedSource(sourceId, corpus, { section, limit }, deps.grounding)`**
(`sourceRead.ts:46`) — it re-fetches + hash-verifies the primary filing and extracts a 10-K Item's text,
deterministically, with NO model/tool loop. So on the no-tools path the harness reads **section 8**
(financial statements + notes) and **section 7** (MD&A) with a raised char limit, runs
`extractImpermissibleIncomeExcerpts` over that text, and injects. Everything else in the design stands.

**Honest coverage caveat:** section 8 is large and the read is char-bounded; a filer that discloses its
interest income beyond the read window stays UNDETERMINED (fail-closed, honest — not a wrong number). The
live SPGI/COST check measures the real hit rate. The Shariah pass gains a new arg
`impermissibleIncomeLines?: ImpermissibleIncomeLine[]` (threaded from `fundamentals.latest_annual`) so the
injected block carries the XBRL lines when present.

---

## Live verification (SPGI + COST, real 10-Ks)

Ran the section-read + excerpter against SPGI's and COST's live 10-K filings. Result:
- **COST recovers** — Item 7 discloses `Interest income $469 …` → excerpt captured.
- **SPGI recovers (after a fix)** — its net interest income (`$46 million`) sits ~99k chars into Item 8,
  BEYOND the original `limit: 40_000` read window, so the first check returned 0 excerpts. Raising the read
  to the **full section** (`limit: 1_000_000`; the excerpter output stays bounded ~2k) recovers it. Both
  filers now yield a quantifiable disclosure for the no-tools model.

The live check both confirmed C works and caught the 40k-truncation limitation — fixed before merge.
