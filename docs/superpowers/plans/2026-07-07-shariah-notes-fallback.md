# Shariah notes-fallback (inject filing excerpts) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Shariah pass quantify impermissible income for filers that disclose it only in the 10-K text (SPGI/COST-class), on the default no-tools provider, by harness-reading the income-bearing sections, keyword-excerpting the disclosures, and injecting them into the prompt.

**Architecture:** Two pure helpers (`extractImpermissibleIncomeExcerpts`, `buildShariahIncomeBlock`) + wiring into `runShariahReasoningPass`: it reads sections 8+7 via the existing `readGroundedSource` (deterministic, no tool loop), excerpts the interest/investment/dividend-income lines, builds a grounding block (XBRL lines + text excerpts), and appends it to the prompt unconditional on tools. Fail-closed unchanged.

**Tech Stack:** TypeScript, pnpm workspace, vitest. Changes in `packages/workflow/src/shariahReasoningPass.ts` (+ its test) and one call-site line in `researchSwarm.ts`.

**Run from the worktree root:** `/home/hermes_agent/code/owlfolio/.worktrees/shariah-notes`
Test form: `NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm exec vitest run <path>`

---

## File Structure

- **Modify** `packages/workflow/src/shariahReasoningPass.ts` — add `extractImpermissibleIncomeExcerpts`, `buildShariahIncomeBlock`, the `impermissibleIncomeLines` arg, the read+excerpt+inject wiring, and the prompt sentence.
- **Modify** `packages/workflow/src/researchSwarm.ts` — thread `impermissibleIncomeLines` from `fundamentals.latest_annual` at the `runShariahReasoningPass` call (~line 1688).
- **Modify** `packages/workflow/src/__tests__/shariahReasoningPass.test.ts` (or create if absent) — tests.

**Verified facts:**
- `readGroundedSource(sourceId, corpus: ReadonlyMap<string, CapturedSource>, opts: { section?; offset?; limit?; lane? }, deps?: GroundingDeps): Promise<ReadSourceResult>` (sourceRead.ts:46). `ReadSourceResult` = `{ ok: true; text: string; ... } | { ok: false; reason; ... }`. `limit` caps chars (default 8000).
- `runShariahReasoningPass(provider, args: RunShariahReasoningPassArgs, deps: { ground?; grounding?; readCorpus? })` (shariahReasoningPass.ts:127). It builds the prompt at `prompt: buildShariahReasoningPrompt(args)` inside `runValidatedAgent` (~line 171).
- `RunShariahReasoningPassArgs` (shariahReasoningPass.ts:44): `research_case_id, ticker, model_id, laneDigest, corpusSourceIds, preVerifiedSourceIds`.
- `ImpermissibleIncomeLine` (secEdgar.ts:86): `{ concept: string; label: string; amount_musd: number }`.
- Call site: `researchSwarm.ts:1688` `runShariahReasoningPass(shariahPassRuntime.provider, { ...args }, { ..., readCorpus: accumulated })`. `fundamentals` (from `resolveFundamentals`, line 1007) is in scope there.

---

## Task 1: `extractImpermissibleIncomeExcerpts` (pure)

**Files:** Modify `shariahReasoningPass.ts`; Test `__tests__/shariahReasoningPass.test.ts`.

- [ ] **Step 1: Failing test** (add/import into the shariah test file):
```ts
import { extractImpermissibleIncomeExcerpts } from '../shariahReasoningPass'

describe('extractImpermissibleIncomeExcerpts', () => {
  it('captures a window around an income keyword that has a dollar figure', () => {
    const out = extractImpermissibleIncomeExcerpts('...blah... Interest income was $128 million in fiscal 2025, up from ...more...')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatch(/interest income/i)
    expect(out[0]).toMatch(/\$128 million/)
  })
  it('drops keyword mentions with no dollar figure', () => {
    expect(extractImpermissibleIncomeExcerpts('We earn interest income on our cash balances (see note 4).')).toEqual([])
  })
  it('returns [] for irrelevant/empty text and caps the number of windows', () => {
    expect(extractImpermissibleIncomeExcerpts('the quick brown fox')).toEqual([])
    const many = Array.from({ length: 30 }, (_v, i) => `dividend income of $${i} million`).join(' ; ')
    expect(extractImpermissibleIncomeExcerpts(many).length).toBeLessThanOrEqual(8)
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (not exported).

- [ ] **Step 3: Implement** in `shariahReasoningPass.ts`:
```ts
/**
 * Extract bounded excerpts around interest/investment/dividend-income mentions that carry a $ figure — the
 * grounding the no-tools model needs to quantify impermissible income when XBRL doesn't tag it. Pure,
 * deterministic, bounded output. Returns [] when nothing qualifies.
 */
export function extractImpermissibleIncomeExcerpts(
  filingText: string,
  opts: { maxWindows?: number; windowChars?: number; maxTotalChars?: number } = {},
): string[] {
  const maxWindows = opts.maxWindows ?? 8
  const windowChars = opts.windowChars ?? 200
  const maxTotal = opts.maxTotalChars ?? 2_000
  const keyword = /(interest income|investment income|dividend income)/gi
  const hasDollar = /\$\s?\d|\b\d[\d,]*(?:\.\d+)?\s*(million|billion|thousand)\b/i
  const chosen: Array<{ start: number; text: string }> = []
  let m: RegExpExecArray | null
  while ((m = keyword.exec(filingText)) !== null) {
    const half = Math.floor(windowChars / 2)
    const start = Math.max(0, m.index - half)
    const end = Math.min(filingText.length, m.index + m[0].length + half)
    const text = filingText.slice(start, end).replace(/\s+/g, ' ').trim()
    if (!hasDollar.test(text)) continue
    if (chosen.some((c) => Math.abs(c.start - start) < windowChars)) continue // dedupe overlapping
    chosen.push({ start, text })
    if (chosen.length >= maxWindows) break
  }
  const out: string[] = []
  let total = 0
  for (const c of chosen) {
    if (total + c.text.length > maxTotal) break
    out.push(c.text)
    total += c.text.length
  }
  return out
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(workflow): extractImpermissibleIncomeExcerpts helper`

---

## Task 2: `buildShariahIncomeBlock` (pure)

**Files:** Modify `shariahReasoningPass.ts`; Test the same test file.

- [ ] **Step 1: Failing test:**
```ts
import { buildShariahIncomeBlock } from '../shariahReasoningPass'

describe('buildShariahIncomeBlock', () => {
  it('includes XBRL lines when present', () => {
    const b = buildShariahIncomeBlock([{ concept: 'InterestIncomeOther', label: 'interest income (other)', amount_musd: 4337 }], [])
    expect(b).toMatch(/interest income \(other\) 4337/)
  })
  it('includes text excerpts when XBRL is absent', () => {
    const b = buildShariahIncomeBlock(undefined, ['Interest income was $128 million'])
    expect(b).toMatch(/\$128 million/)
    expect(b).toMatch(/IMPERMISSIBLE-INCOME/)
  })
  it('returns undefined when there is neither', () => {
    expect(buildShariahIncomeBlock(undefined, [])).toBeUndefined()
    expect(buildShariahIncomeBlock([], [])).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** (import `ImpermissibleIncomeLine` from `'./secEdgar'` at the top):
```ts
export function buildShariahIncomeBlock(
  lines: ImpermissibleIncomeLine[] | undefined,
  excerpts: string[],
): string | undefined {
  const hasLines = lines !== undefined && lines.length > 0
  if (!hasLines && excerpts.length === 0) return undefined
  let block =
    `\n\nHARNESS IMPERMISSIBLE-INCOME GROUNDING (quantify impermissible_income from THIS — interest income on `
    + `cash + dividend/investment income + prohibited-segment revenue, in $M; null ONLY if genuinely not `
    + `disclosed here):\n`
  if (hasLines) {
    block += `XBRL-tagged lines ($millions): ${lines!.map((l) => `${l.label} ${l.amount_musd}`).join('; ')}.\n`
  }
  if (excerpts.length > 0) {
    block += `Disclosures extracted from the verified primary filing text:\n`
      + excerpts.map((e) => `  - "${e}"`).join('\n') + '\n'
  }
  return block
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(workflow): buildShariahIncomeBlock (XBRL lines + filing-text excerpts)`

---

## Task 3: Wire the read + inject into `runShariahReasoningPass`

**Files:** Modify `shariahReasoningPass.ts` + `researchSwarm.ts`; Test `__tests__/shariahReasoningPass.test.ts`.

- [ ] **Step 1: Add the arg + prompt sentence.**
  - In `RunShariahReasoningPassArgs` (shariahReasoningPass.ts:44) add:
    ```ts
    /** XBRL-tagged impermissible-income lines from fundamentals.latest_annual (may be absent). */
    impermissibleIncomeLines?: ImpermissibleIncomeLine[]
    ```
  - In `buildShariahReasoningPrompt`, after the "READ THE FILING (SPGI-class quantification)" paragraph, add a sentence:
    ```ts
    + `If a "HARNESS IMPERMISSIBLE-INCOME GROUNDING" block appears below, the harness has already extracted `
    + `the XBRL lines and/or the income-statement/notes disclosures for you — quantify impermissible_income `
    + `directly from that block (you do NOT need tools). read_source is still available if your provider `
    + `supports the tool loop.\n\n`
    ```

- [ ] **Step 2: Read sections + build + inject** — in `runShariahReasoningPass`, BEFORE the `runValidatedAgent` call, compute the income block; then append it to the prompt. Import `readGroundedSource` from `'./sourceRead'`.
```ts
  // Harness-read the income-bearing sections (deterministic, works on no-tools providers) so the model can
  // quantify impermissible income when XBRL doesn't tag it and it can't call read_source itself.
  const incomeExcerpts: string[] = []
  const primaryId = args.preVerifiedSourceIds.find((id) => id.trim().length > 0)
  if (primaryId !== undefined && deps.readCorpus !== undefined) {
    for (const section of ['8', '7']) {
      try {
        const res = await readGroundedSource(primaryId, deps.readCorpus, { section, limit: 40_000 }, deps.grounding)
        if (res.ok) incomeExcerpts.push(...extractImpermissibleIncomeExcerpts(res.text))
      } catch { /* fail-closed: no excerpt from this section */ }
    }
  }
  const incomeBlock = buildShariahIncomeBlock(args.impermissibleIncomeLines, incomeExcerpts)
```
Then change the `prompt:` line inside `runValidatedAgent` from `prompt: buildShariahReasoningPrompt(args),` to:
```ts
        prompt: buildShariahReasoningPrompt(args) + (incomeBlock ?? ''),
```

- [ ] **Step 3: Thread the XBRL lines at the call site** — `researchSwarm.ts:~1688`, add to the args object passed to `runShariahReasoningPass`:
```ts
      ...(fundamentals?.latest_annual?.impermissible_income_lines === undefined
        ? {}
        : { impermissibleIncomeLines: fundamentals.latest_annual.impermissible_income_lines }),
```

- [ ] **Step 4: Test the wiring** — add a test that a no-tools run injects the block. READ the existing `shariahReasoningPass.test.ts` for the fake-provider + fake-grounding harness (mirror it). The test: a fake `Provider` whose `structured` CAPTURES the prompt and returns a valid `ShariahReasoningAgentSchema` object; a `readCorpus` with one primary source; a fake `grounding` (deps.grounding) whose content read returns filing text containing `"Interest income was $128 million"`; call `runShariahReasoningPass(fakeProvider, { ...args, preVerifiedSourceIds: [primaryId] }, { grounding, readCorpus })`; assert the captured prompt CONTAINS `HARNESS IMPERMISSIBLE-INCOME GROUNDING` and `$128 million`. If the existing test harness makes capturing the prompt impractical, instead assert `runShariahReasoningPass` returns `status: 'ok'` with the numeric `impermissible_income` the fake provider emitted (proving the pass runs end-to-end with the new wiring), and rely on the Task 1/2 unit tests + the live check for the excerpt/injection proof. Do NOT leave the wiring untested — pick whichever assertion the harness supports.

- [ ] **Step 5: Verify** — `corepack pnpm exec vitest run packages/workflow/src/__tests__/shariahReasoningPass.test.ts` green; broad `corepack pnpm exec vitest run packages/workflow` green; `corepack pnpm --filter @owlfolio/workflow exec tsc --noEmit -p tsconfig.json` clean; `corepack pnpm --filter @owlfolio/workflow lint` clean.
- [ ] **Step 6: Commit** `feat(workflow): Shariah pass reads + injects filing income disclosures (no-tools fallback)`

---

## Verification (final)

- `corepack pnpm typecheck` + `lint` clean; full unit suite green.
- **Live** (the real end-to-end proof): re-run SPGI and COST on a sandbox with the default no-tools GLM provider and confirm the Shariah verdict computes (no longer UNDETERMINED) with a purification % grounded in the filing's disclosed interest income. Measure the hit rate — a filer that buries the disclosure beyond the read window may still be UNDETERMINED (honest/fail-closed); note it if so.
