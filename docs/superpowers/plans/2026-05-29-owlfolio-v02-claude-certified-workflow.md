# Owlfolio v0.2 Claude-Certified Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the personal-local placeholder intake path with a real Claude-backed Buffett-Munger research run that creates a research case, executes structured analysis through Claude, persists source-ledger artifacts owned by Owlfolio, drafts a decision, and renders the resulting statuses in the existing research-case UI.

**Architecture:** Keep Owlfolio as workflow owner. The web route starts a personal-local workflow run, resolves the selected provider through `@owlfolio/providers`, invokes a Claude adapter non-interactively through the local Claude Code CLI, validates structured output in `@owlfolio/workflow`, persists source-ledger bundles under `source_ledger_path`, appends ledger events to SQLite, and projects the resulting state back into the existing command-center/research-case pages. Claude remains a reasoning backend; Owlfolio owns prompts, structured schema, source-ledger persistence, event emission, and decision-draft creation.

**Tech Stack:** TypeScript, pnpm workspace, Next.js App Router, React, SQLite, Vitest, Playwright, local Claude Code CLI.

---

## File structure

- Modify: `packages/providers/src/providerContract.ts` — allow provider errors/observability fields needed for real CLI runs if tests require it.
- Create: `packages/providers/src/claudeCliProvider.ts` — real Claude adapter using `claude -p` with structured JSON output.
- Create: `packages/providers/src/providerFactory.ts` — resolve `mock-provider` vs `claude` from app config/runtime.
- Create: `packages/providers/src/__tests__/claudeCliProvider.test.ts` — failing-first CLI/provider contract coverage.
- Modify: `packages/providers/src/index.ts` — export the Claude adapter/factory.
- Modify: `packages/providers/package.json` — export new modules if needed.
- Create: `packages/workflow/src/claudeResearchWorkflow.ts` — run one real Buffett-Munger workflow slice end-to-end.
- Create: `packages/workflow/src/__tests__/claudeResearchWorkflow.test.ts` — failing-first workflow/source-ledger coverage.
- Modify: `packages/workflow/src/index.ts` — export new workflow helpers.
- Modify: `packages/workflow/src/sourceLedger.ts` — add bundle-write helpers and source-ledger bundle shape.
- Modify: `apps/web/package.json` — add any newly imported workspace packages if needed.
- Modify: `apps/web/src/lib/workflow.ts` — replace create-only personal-local path with create + Claude analysis + decision draft orchestration.
- Modify: `apps/web/src/lib/__tests__/workflow.test.ts` — red/green for personal-local drafted-decision flow.
- Modify: `apps/web/src/app/api/research/start/route.ts` — return the created research case after the full workflow slice runs.
- Modify: `apps/web/src/components/ResearchCasePanel.tsx` — honest rendered state for created/running/completed draft statuses.
- Modify: `apps/web/e2e/personal-workflow-intake.spec.ts` — assert drafted analysis/decision instead of placeholder pending state.

## Task 1: Implement the real Claude provider adapter

**Files:**
- Create: `packages/providers/src/claudeCliProvider.ts`
- Create: `packages/providers/src/providerFactory.ts`
- Create: `packages/providers/src/__tests__/claudeCliProvider.test.ts`
- Modify: `packages/providers/src/index.ts`
- Modify: `packages/providers/package.json`

- [ ] **Step 1: Write failing Claude adapter tests first**

Add a provider test that covers:
- API-key mode via `ANTHROPIC_API_KEY`
- Claude subscription/CLI mode via installed `claude`
- structured JSON output via `--json-schema`
- helpful failure when the CLI exits non-zero or returns invalid JSON

Example test shape:

```ts
it('runs a structured Claude request through the CLI transport', async () => {
  const provider = new ClaudeCliProvider({
    env: { ANTHROPIC_API_KEY: 'test-key' },
    runCommand: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        investment_verdict: 'WATCH',
        strategy_compliance: 'CONDITIONAL',
        shariah_status: 'COMPLIANT',
        valuation_status: 'FAIR',
        next_required_action: 'Refresh valuation after the next filing.',
        source_records: [
          {
            source_id: 'src_msft_10k_2025',
            title: 'Microsoft 10-K FY2025',
            url: 'https://example.test/msft-10k',
            excerpt: 'Azure growth remained durable.',
          },
        ],
        decision_reason: 'High quality, but wait for better valuation.',
      }),
      stderr: '',
    }),
  })

  const result = await provider.structured(request, ClaudeResearchSchema)
  expect(result.investment_verdict).toBe('WATCH')
})
```

- [ ] **Step 2: Run the new provider tests and verify RED**

```bash
corepack pnpm test -- --run packages/providers/src/__tests__/claudeCliProvider.test.ts
```

Expected: FAIL because the adapter/factory do not exist yet.

- [ ] **Step 3: Implement the Claude CLI adapter**

Requirements:
- non-interactive `claude -p`
- JSON schema structured output for `structured()`
- support env injection for tests/runtime
- include `metadata`, `observations`, and useful provider failure messages
- do not let Claude own ledger writes or file writes

Add a provider factory that resolves:
- `mock-provider` -> `MockProvider`
- `claude` -> `ClaudeCliProvider`
- unknown provider -> throw

- [ ] **Step 4: Run focused provider tests and verify GREEN**

```bash
corepack pnpm test -- --run packages/providers/src/__tests__/claudeCliProvider.test.ts packages/providers/src/__tests__/mockProvider.test.ts packages/providers/src/__tests__/providerContract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the provider adapter checkpoint**

```bash
git add packages/providers/src/claudeCliProvider.ts packages/providers/src/providerFactory.ts packages/providers/src/__tests__/claudeCliProvider.test.ts packages/providers/src/index.ts packages/providers/package.json
git commit -m "feat(providers): add Claude CLI adapter"
```

## Task 2: Implement the first real Claude research workflow slice

**Files:**
- Create: `packages/workflow/src/claudeResearchWorkflow.ts`
- Create: `packages/workflow/src/__tests__/claudeResearchWorkflow.test.ts`
- Modify: `packages/workflow/src/sourceLedger.ts`
- Modify: `packages/workflow/src/index.ts`

- [ ] **Step 1: Write failing workflow tests first**

Add a workflow test that proves Owlfolio:
- creates a research case
- asks Claude for structured Buffett-Munger output
- writes a source-ledger bundle under `source_ledger_path`
- appends `buffett_munger_analysis_drafted`
- appends `decision_drafted`
- keeps provider as actor only for provider-produced events

Expected output fields should include:
- `investment_verdict`
- `strategy_compliance`
- `shariah_status`
- `valuation_status`
- `next_required_action`
- `source_records`
- `decision_reason`

- [ ] **Step 2: Run the new workflow tests and verify RED**

```bash
corepack pnpm test -- --run packages/workflow/src/__tests__/claudeResearchWorkflow.test.ts
```

Expected: FAIL because the real workflow helper and source-ledger writer do not exist yet.

- [ ] **Step 3: Implement the workflow slice**

Create a workflow helper that:
1. accepts store, provider, source-ledger path, and research-case input
2. appends `research_case_created`
3. prompts Claude for one Buffett-Munger research output schema
4. converts source records into Owlfolio-owned `SourceLedgerRecord`s
5. writes a source-ledger bundle file under `source_ledger_path`
6. appends `buffett_munger_analysis_drafted`
7. appends `decision_drafted`

Keep this slice synchronous for now; do not add background execution yet.

- [ ] **Step 4: Run focused workflow tests and verify GREEN**

```bash
corepack pnpm test -- --run packages/workflow/src/__tests__/claudeResearchWorkflow.test.ts packages/workflow/src/__tests__/verticalSlice.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the workflow slice checkpoint**

```bash
git add packages/workflow/src/claudeResearchWorkflow.ts packages/workflow/src/__tests__/claudeResearchWorkflow.test.ts packages/workflow/src/sourceLedger.ts packages/workflow/src/index.ts
git commit -m "feat(workflow): run Claude Buffett-Munger slice"
```

## Task 3: Wire the real Claude slice into personal-local app flow

**Files:**
- Modify: `apps/web/src/lib/workflow.ts`
- Modify: `apps/web/src/lib/__tests__/workflow.test.ts`
- Modify: `apps/web/src/app/api/research/start/route.ts`
- Modify: `apps/web/src/components/ResearchCasePanel.tsx`
- Modify: `apps/web/e2e/personal-workflow-intake.spec.ts`

- [ ] **Step 1: Write/extend failing app-layer tests first**

Update tests so personal-local intake expects a drafted analysis/decision instead of a bare created case.

Assertions should move from:
- stage = `created`
- next action = `Start Buffett-Munger research ...`

to something like:
- stage = `decision_drafted`
- strategy/shariah/valuation statuses are populated
- next action reflects the Claude output
- research page shows verdict and completed draft state

- [ ] **Step 2: Run focused app-layer tests and verify RED**

```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/workflow.test.ts
corepack pnpm e2e --grep "personal-local mode can create the first research case"
```

Expected: FAIL because the app still only creates a research case.

- [ ] **Step 3: Implement the personal-local orchestration**

In `apps/web/src/lib/workflow.ts`:
- keep demo mode behavior unchanged
- for personal-local mode, resolve the provider from config/env
- run the new Claude research workflow helper
- return the created research case id

In `ResearchCasePanel.tsx`:
- make created vs completed-draft status obvious
- keep pending placeholders only when no analysis exists yet

- [ ] **Step 4: Run focused app tests and verify GREEN**

```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/workflow.test.ts
corepack pnpm e2e --grep "personal-local mode can create the first research case"
```

Expected: PASS.

- [ ] **Step 5: Commit the app integration checkpoint**

```bash
git add apps/web/src/lib/workflow.ts apps/web/src/lib/__tests__/workflow.test.ts apps/web/src/app/api/research/start/route.ts apps/web/src/components/ResearchCasePanel.tsx apps/web/e2e/personal-workflow-intake.spec.ts
git commit -m "feat(web): run real Claude research from personal-local intake"
```

## Task 4: Full verification

- [ ] **Step 1: Run focused milestone checks**

```bash
corepack pnpm test -- --run packages/providers/src/__tests__/claudeCliProvider.test.ts packages/workflow/src/__tests__/claudeResearchWorkflow.test.ts apps/web/src/lib/__tests__/workflow.test.ts
corepack pnpm e2e --grep "personal-local mode can create the first research case"
```

Expected: PASS.

- [ ] **Step 2: Run full workspace verification**

```bash
git diff --check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm e2e
NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build
```

Expected: every command exits 0.

- [ ] **Step 3: Commit the plan doc checkpoint**

```bash
git add docs/superpowers/plans/2026-05-29-owlfolio-v02-claude-certified-workflow.md
git commit -m "docs: add Claude-certified workflow plan"
```

## Self-review

- This plan deliberately chooses the smallest real Milestone 3 slice that removes the current placeholder assumption in personal-local mode.
- Claude remains a provider adapter, not the workflow owner.
- Source-ledger persistence is owned by Owlfolio and happens before/alongside event emission, not inside the provider.
- The plan does not claim full Milestone 3 completion yet; it implements the first real vertical slice toward the Milestone 3 exit criterion.
