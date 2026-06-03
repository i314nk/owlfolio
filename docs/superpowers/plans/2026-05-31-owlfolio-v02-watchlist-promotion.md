# Owlfolio v0.2 Watchlist Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the smallest personal-local Milestone 5 slice so a user can promote a drafted research decision into durable watchlist draft state from the research case page.

**Architecture:** Reuse the existing `confirmWatchlistDraft()` workflow helper and ledger projections instead of adding a second web-only persistence path. The web app will expose a narrow API action that validates the active personal-local ledger, derives the watchlist draft from the drafted research case, appends a user-owned `watchlist_draft_created` event, and redirects the browser to the watchlist page where the existing projection renders it.

**Tech Stack:** TypeScript, Next.js App Router, React server/client components, SQLite event store, Vitest, Playwright.

---

## File structure

- Modify: `apps/web/src/lib/workflow.ts` — add `promoteResearchCaseToWatchlist()` helper that opens the active personal ledger, validates a drafted decision exists, and calls `confirmWatchlistDraft()`.
- Modify: `apps/web/src/lib/__tests__/workflow.test.ts` — add failing-first coverage for promotion from a drafted personal-local research case to a watchlist draft.
- Create: `apps/web/src/app/api/research/[caseId]/watchlist/route.ts` — POST route that invokes the helper and redirects to `/watchlist`.
- Modify: `apps/web/src/components/ResearchCasePanel.tsx` — render a POST form/button only when a decision draft exists and the case has not already reached watchlist state.
- Modify: `apps/web/src/app/research/[caseId]/page.tsx` — pass the current mode into the panel so demo mode does not show the personal-local write action.
- Modify: `apps/web/e2e/personal-workflow-intake.spec.ts` — extend the existing personal-local browser smoke to promote the drafted decision and assert the watchlist page shows the new draft.

## Task 1: Add the personal-local promotion helper

**Files:**
- Modify: `apps/web/src/lib/workflow.ts`
- Modify: `apps/web/src/lib/__tests__/workflow.test.ts`

- [ ] **Step 1: Write the failing workflow-helper test**

Add a test that creates a personal-local research case with the mock provider, calls the wished-for `promoteResearchCaseToWatchlist()` helper, and asserts the watchlist projection contains the promoted item:

```ts
it('promotes a drafted personal-local decision into a watchlist draft', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-watchlist-promotion-'))
  dirs.push(projectDir)

  const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
  const sourceLedgerPath = join(projectDir, 'data', 'source-ledger')
  const state = {
    config: {
      ...defaultPersonalLocalAppConfig(),
      provider: {
        provider_id: 'mock-provider' as const,
        support_level: 'certified' as const,
        model_id: 'mock-buffett-munger-demo',
      },
      initialized_at: '2026-05-31T12:00:00.000Z',
      ledger_path: ledgerPath,
      source_ledger_path: sourceLedgerPath,
    },
    is_initialized: true,
  }

  const created = await createPersonalResearchCase(state, { ticker: 'MSFT', company_id: 'company_msft' })
  const promoted = await promoteResearchCaseToWatchlist(state, created.research_case_id)

  const store = new SQLiteEventStore(ledgerPath)
  try {
    expect(promoted).toMatchObject({
      research_case_id: created.research_case_id,
      ticker: 'MSFT',
      strategy_id: 'buffett-munger',
      user_approved: false,
      created_by_actor_type: 'user',
      created_by_actor_id: 'user_local',
    })
    expect(promoted.watchlist_item_id).toMatch(/^watch_msft_/)
    const watchlistItems = await getAppWatchlistItemsFromStore(store, 'personal-local')
    expect(watchlistItems).toHaveLength(1)
    expect(watchlistItems[0]).toMatchObject({
      watchlist_item_id: promoted.watchlist_item_id,
      research_case_id: created.research_case_id,
      thesis_summary: expect.stringMatching(/watch/i),
    })
  } finally {
    store.close()
  }
})
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/workflow.test.ts
```

Expected: FAIL because `promoteResearchCaseToWatchlist` is not exported yet.

- [ ] **Step 3: Implement the minimal helper**

In `apps/web/src/lib/workflow.ts`, import `confirmWatchlistDraft` from `@owlfolio/workflow`, then add a helper that:
1. requires initialized personal-local mode and `ledger_path`
2. loads the target case from `projectResearchCases(await store.list())`
3. rejects missing cases or cases without a drafted decision
4. creates a deterministic-ish watchlist id `watch_${ticker.toLowerCase()}_${Date.now()}`
5. passes the decision id from the projected case into `confirmWatchlistDraft()`
6. uses `decision:${caseId}:watchlist:v1` as the idempotency key

Implementation sketch:

```ts
export async function promoteResearchCaseToWatchlist(
  state: OnboardingState,
  researchCaseId: string,
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const researchCase = projectResearchCases(await store.list()).find((candidate) => candidate.research_case_id === researchCaseId)
    if (researchCase === undefined) {
      throw new Error(`Unknown research case: ${researchCaseId}`)
    }
    if (researchCase.decision === undefined) {
      throw new Error(`Research case is not ready for watchlist promotion: ${researchCaseId}`)
    }

    const ticker = researchCase.ticker ?? researchCase.company_id ?? researchCase.research_case_id
    const watchlistItemId = `watch_${ticker.toLowerCase()}_${Date.now()}`
    return await confirmWatchlistDraft(store, {
      watchlist_item_id: watchlistItemId,
      research_case_id: researchCase.research_case_id,
      decision_id: researchCase.decision_id,
      company_id: researchCase.company_id ?? `company_${ticker.toLowerCase()}`,
      ticker,
      strategy_id: researchCase.strategy_id ?? state.config.strategy_id,
      thesis_summary: researchCase.reason ?? researchCase.next_required_action ?? `Watch ${ticker} after drafted decision ${researchCase.decision}`,
      actor_id: 'user_local',
      idempotency_key: `decision:${researchCase.research_case_id}:watchlist:v1`,
    })
  } finally {
    store.close()
  }
}
```

If `ResearchCaseProjection` does not expose `decision_id`, extend the projection/test in the same RED/GREEN cycle so the helper can preserve causation.

- [ ] **Step 4: Run the workflow-helper test to verify GREEN**

Run:

```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/workflow.test.ts packages/workflow/src/__tests__/verticalSlice.test.ts
```

Expected: PASS.

## Task 2: Add the POST route and research-case action

**Files:**
- Create: `apps/web/src/app/api/research/[caseId]/watchlist/route.ts`
- Modify: `apps/web/src/components/ResearchCasePanel.tsx`
- Modify: `apps/web/src/app/research/[caseId]/page.tsx`
- Modify: `apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx`

- [ ] **Step 1: Write failing component/page coverage**

Extend `ResearchWorkflowPages.test.tsx` so a personal-local decision-drafted case renders a form posting to `/api/research/<caseId>/watchlist` with button text `Promote to watchlist`, and a demo-mode case does not render that POST action.

- [ ] **Step 2: Run the component test to verify RED**

Run:

```bash
corepack pnpm test -- --run apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx
```

Expected: FAIL because the action button/form is not rendered yet.

- [ ] **Step 3: Add the POST route**

Create `apps/web/src/app/api/research/[caseId]/watchlist/route.ts`:

```ts
import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { promoteResearchCaseToWatchlist } from '../../../../../lib/workflow'

export type PromoteToWatchlistRouteContext = {
  params: Promise<{ caseId: string }>
}

export async function POST(_request: Request, { params }: PromoteToWatchlistRouteContext) {
  const { caseId } = await params
  const state = await getOnboardingState()
  try {
    await promoteResearchCaseToWatchlist(state, caseId)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message.startsWith('Unknown research case:')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    throw error
  }

  redirect('/watchlist')
}
```

- [ ] **Step 4: Render the form in personal-local decision-drafted cases**

Extend `ResearchCasePanelProps` with `mode: WorkflowMode`, pass it from the page, and render:

```tsx
{mode === 'personal-local' && researchCase.stage === 'decision_drafted' ? (
  <form action={`/api/research/${researchCase.research_case_id}/watchlist`} method="post">
    <button type="submit">Promote to watchlist</button>
  </form>
) : null}
```

- [ ] **Step 5: Run component tests to verify GREEN**

Run:

```bash
corepack pnpm test -- --run apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx
```

Expected: PASS.

## Task 3: Extend browser smoke and verify the slice

**Files:**
- Modify: `apps/web/e2e/personal-workflow-intake.spec.ts`

- [ ] **Step 1: Write failing Playwright expectation**

After the existing research case assertions, click `Promote to watchlist`, assert URL `/watchlist`, and assert the page shows `MSFT`, `Draft — awaiting user confirmation`, and the research case id prefix.

- [ ] **Step 2: Run the e2e spec to verify RED or GREEN depending on Task 2 state**

Run:

```bash
corepack pnpm e2e --grep "personal-local mode can create the first research case"
```

Expected before Task 2 implementation: FAIL because the button does not exist. Expected after Task 2 implementation: PASS.

- [ ] **Step 3: Run focused verification**

Run:

```bash
git diff --check
corepack pnpm test -- --run apps/web/src/lib/__tests__/workflow.test.ts apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx packages/workflow/src/__tests__/verticalSlice.test.ts
corepack pnpm e2e --grep "personal-local mode can create the first research case"
```

Expected: every command exits 0.

- [ ] **Step 4: Run broader verification appropriate for this checkpoint**

Run:

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
```

Expected: every command exits 0. Run full `corepack pnpm e2e` and the web build if the focused browser smoke or typecheck touches route/build semantics unexpectedly.

## Self-review

- This plan advances Milestone 5 without broad holdings/accounting scope.
- It keeps provider execution separate from portfolio-state transitions; provider output drafts a decision, and the user action promotes it.
- It reuses the existing event store/projection path and preserves the audit trail through `causation_id`.
- It avoids demo-mode writes and does not touch `.live-openai-runtime/`.
