# Owlfolio v0.2 Watchlist Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a personal-local user review a durable watchlist draft, explicitly confirm it, and see Command Center move from pending user action to confirmed watchlist monitoring.

**Architecture:** Add a narrow user-owned `watchlist_draft_confirmed` event instead of mutating prior events or adding a second store. The workflow package appends the confirmation event, ledger projections fold it into watchlist/research/command-center state, and the web app exposes a POST route plus a personal-local-only confirmation form on the watchlist page. Demo mode may show status but must not expose durable write actions.

**Tech Stack:** TypeScript, Next.js App Router, React server components via `createElement`, SQLite event store, Vitest, Playwright.

---

## File structure

- Modify: `packages/workflow/src/watchlistWorkflow.ts` — add `approveWatchlistDraft()` command that appends `watchlist_draft_confirmed` with user actor, causation, correlation, and idempotency.
- Modify: `packages/workflow/src/__tests__/verticalSlice.test.ts` — prove a draft can be confirmed and no provider actor creates/approves watchlist state.
- Modify: `packages/ledger/src/projections/watchlistProjection.ts` — fold `watchlist_draft_confirmed` into `user_approved: true`, confirmation actor fields, and updated timestamp.
- Modify: `packages/ledger/src/projections/researchCaseProjection.ts` — add `watchlist_confirmed` as the research-case stage reached after confirmation.
- Modify: `packages/ledger/src/projections/commandCenterProjection.ts` — count pending drafts separately from confirmed watchlist items and prioritize the next action accurately.
- Modify: `packages/ledger/src/__tests__/commandCenterProjection.test.ts` — cover both pending-draft and post-confirmation summaries.
- Modify: `apps/web/src/lib/workflow.ts` — add `confirmPersonalWatchlistDraft()` helper that opens the configured personal ledger, validates the watchlist item exists, and appends the confirmation through the workflow command.
- Modify: `apps/web/src/lib/__tests__/workflow.test.ts` — cover promotion followed by confirmation in an isolated personal-local ledger.
- Create: `apps/web/src/app/api/watchlist/[watchlistItemId]/confirm/route.ts` — POST route that confirms a draft and redirects to `/watchlist`.
- Modify: `apps/web/src/app/watchlist/page.tsx` — pass workflow mode into `WatchlistPanel`.
- Modify: `apps/web/src/components/WatchlistPanel.tsx` — render a personal-local-only confirmation form for unapproved drafts and no form for demo/confirmed items.
- Modify: `apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx` — component coverage for draft and confirmed watchlist rendering.
- Modify: `apps/web/e2e/personal-workflow-intake.spec.ts` — browser flow: create case → promote to watchlist draft → confirm draft → see confirmed status and Command Center pending count clear.

## Task 1: Add the confirmation event and projections

**Files:**
- Modify: `packages/workflow/src/watchlistWorkflow.ts`
- Modify: `packages/workflow/src/__tests__/verticalSlice.test.ts`
- Modify: `packages/ledger/src/projections/watchlistProjection.ts`
- Modify: `packages/ledger/src/projections/researchCaseProjection.ts`
- Modify: `packages/ledger/src/projections/commandCenterProjection.ts`
- Modify: `packages/ledger/src/__tests__/commandCenterProjection.test.ts`

- [ ] **Step 1: Write failing workflow/projection tests**

In `packages/workflow/src/__tests__/verticalSlice.test.ts`, import the wished-for `approveWatchlistDraft` and extend the vertical slice test after `confirmWatchlistDraft()`:

```ts
const confirmed = await approveWatchlistDraft(store, {
  watchlist_item_id: 'watch_cost_001',
  research_case_id: researchCase.research_case_id,
  causation_id: 'watch_cost_001',
  actor_id: 'user_local',
  idempotency_key: 'watchlist:watch_cost_001:confirm:v1',
})
```

Assert:

```ts
expect(confirmed).toMatchObject({
  watchlist_item_id: 'watch_cost_001',
  research_case_id: 'rc_cost_001',
  user_approved: true,
  confirmed_by_actor_type: 'user',
  confirmed_by_actor_id: 'user_local',
})
expect(projectedCases[0]).toMatchObject({ research_case_id: 'rc_cost_001', stage: 'watchlist_confirmed', user_approved: true })
expect(projectedWatchlist[0]).toMatchObject({ watchlist_item_id: 'watch_cost_001', user_approved: true, confirmed_by_actor_id: 'user_local' })
expect(events.some((event) => event.actor_type === 'provider' && event.event_type.startsWith('watchlist_'))).toBe(false)
```

In `packages/ledger/src/__tests__/commandCenterProjection.test.ts`, add a `confirmedEvents` array with an appended `watchlist_draft_confirmed` event:

```ts
const confirmedEvents: LedgerEventEnvelope<unknown>[] = [
  ...events,
  {
    event_id: 'evt_watchlist_confirmed',
    event_type: 'watchlist_draft_confirmed',
    aggregate_type: 'watchlist_item',
    aggregate_id: 'wl_cost_001',
    causation_id: 'evt_watchlist',
    correlation_id: 'rc_cost_001',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: {
      watchlist_item_id: 'wl_cost_001',
      research_case_id: 'rc_cost_001',
      user_approved: true,
      confirmed_by_actor_type: 'user',
      confirmed_by_actor_id: 'user_local',
    },
    source_ids: [],
    created_at: '2026-05-28T00:15:00.000Z',
    schema_version: 1,
  },
]
```

Assert the summary after confirmation has `watchlist_drafts: 0`, `confirmed_watchlist_items: 1`, `pending_user_actions: 0`, and next action `Monitor confirmed watchlist items for buy-zone and thesis updates`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
corepack pnpm test -- --run packages/workflow/src/__tests__/verticalSlice.test.ts packages/ledger/src/__tests__/commandCenterProjection.test.ts
```

Expected: FAIL because `approveWatchlistDraft` is not exported and command-center counts do not include confirmed watchlist items.

- [ ] **Step 3: Implement the minimal workflow command and projection updates**

Add to `packages/workflow/src/watchlistWorkflow.ts`:

```ts
export type WatchlistDraftConfirmedPayload = {
  watchlist_item_id: string
  research_case_id: string
  user_approved: true
  confirmed_by_actor_type: ActorType
  confirmed_by_actor_id: string
}

export type WatchlistDraftConfirmed = LedgerEventEnvelope<WatchlistDraftConfirmedPayload> & WatchlistDraftConfirmedPayload

export type ApproveWatchlistDraftCommand = {
  watchlist_item_id: string
  research_case_id: string
  causation_id: string
  actor_id: string
  idempotency_key?: string
}

export async function approveWatchlistDraft(
  store: WatchlistEventStore,
  command: ApproveWatchlistDraftCommand,
): Promise<WatchlistDraftConfirmed> {
  const payload: WatchlistDraftConfirmedPayload = {
    watchlist_item_id: command.watchlist_item_id,
    research_case_id: command.research_case_id,
    user_approved: true,
    confirmed_by_actor_type: 'user',
    confirmed_by_actor_id: command.actor_id,
  }

  const event: LedgerEventEnvelope<WatchlistDraftConfirmedPayload> = {
    event_id: `evt_watchlist_draft_confirmed_${command.watchlist_item_id}`,
    event_type: 'watchlist_draft_confirmed',
    aggregate_type: 'watchlist_item',
    aggregate_id: command.watchlist_item_id,
    causation_id: command.causation_id,
    correlation_id: command.research_case_id,
    actor_type: 'user',
    actor_id: command.actor_id,
    payload,
    source_ids: [],
    created_at: nowIso(),
    schema_version: 1,
    ...(command.idempotency_key === undefined ? {} : { idempotency_key: command.idempotency_key }),
  }

  const storedEvent = await store.append(event as LedgerEventEnvelope<unknown>)
  return mergeEventPayload(storedEvent as LedgerEventEnvelope<WatchlistDraftConfirmedPayload>)
}
```

Update `projectWatchlist()` to process both `watchlist_draft_created` and `watchlist_draft_confirmed`; confirmation should set `user_approved = true`, `confirmed_by_actor_type`, and `confirmed_by_actor_id` while preserving ticker/strategy/thesis from the original draft.

Update `ResearchCaseStage` to include `watchlist_confirmed`, and handle `watchlist_draft_confirmed` by setting the case stage to `watchlist_confirmed` and `user_approved = true`.

Update `CommandCenterSummary.pipeline_counts` to include `confirmed_watchlist_items`. Set `watchlist_drafts` to only unapproved drafts, `pending_user_actions` to unapproved drafts, and choose next action in this order:
1. pending draft exists → `Review <ticker/company/id> watchlist draft and confirm it`
2. confirmed watchlist item exists → `Monitor confirmed watchlist items for buy-zone and thesis updates`
3. otherwise latest research case next-required-action or demo fallback.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
corepack pnpm test -- --run packages/workflow/src/__tests__/verticalSlice.test.ts packages/ledger/src/__tests__/commandCenterProjection.test.ts
```

Expected: PASS.

## Task 2: Add personal-local web helper, route, and UI action

**Files:**
- Modify: `apps/web/src/lib/workflow.ts`
- Modify: `apps/web/src/lib/__tests__/workflow.test.ts`
- Create: `apps/web/src/app/api/watchlist/[watchlistItemId]/confirm/route.ts`
- Modify: `apps/web/src/app/watchlist/page.tsx`
- Modify: `apps/web/src/components/WatchlistPanel.tsx`
- Modify: `apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx`

- [ ] **Step 1: Write failing web tests**

In `apps/web/src/lib/__tests__/workflow.test.ts`, extend the watchlist promotion test:

```ts
const confirmed = await confirmPersonalWatchlistDraft(state, promoted.watchlist_item_id)
expect(confirmed).toMatchObject({
  watchlist_item_id: promoted.watchlist_item_id,
  research_case_id: created.research_case_id,
  user_approved: true,
  confirmed_by_actor_id: 'user_local',
})
const confirmedItems = await getAppWatchlistItemsFromStore(store, 'personal-local')
expect(confirmedItems[0]).toMatchObject({
  watchlist_item_id: promoted.watchlist_item_id,
  user_approved: true,
  confirmed_by_actor_id: 'user_local',
})
```

In `apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx`, add a component test that renders `WatchlistPanel` with one unapproved item in personal-local mode and expects:

```ts
expect(html).toContain('action="/api/watchlist/watch_msft_001/confirm"')
expect(html).toContain('method="post"')
expect(html).toContain('Confirm watchlist draft')
```

Then render the same item in demo mode and the confirmed version in personal-local mode; both must not contain the confirm action.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/workflow.test.ts apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx
```

Expected: FAIL because `confirmPersonalWatchlistDraft` and the confirmation form do not exist yet.

- [ ] **Step 3: Implement helper, route, and panel action**

In `apps/web/src/lib/workflow.ts`, import `approveWatchlistDraft` and add:

```ts
export async function confirmPersonalWatchlistDraft(
  state: OnboardingState,
  watchlistItemId: string,
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    const watchlistItem = projectWatchlist(await store.list()).find((candidate) => candidate.watchlist_item_id === watchlistItemId)
    if (watchlistItem === undefined) {
      throw new Error(`Unknown watchlist item: ${watchlistItemId}`)
    }

    return await approveWatchlistDraft(store, {
      watchlist_item_id: watchlistItem.watchlist_item_id,
      research_case_id: watchlistItem.research_case_id,
      causation_id: watchlistItem.watchlist_item_id,
      actor_id: 'user_local',
      idempotency_key: `watchlist:${watchlistItem.watchlist_item_id}:confirm:v1`,
    })
  } finally {
    store.close()
  }
}
```

Create `apps/web/src/app/api/watchlist/[watchlistItemId]/confirm/route.ts`:

```ts
import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'

import { getOnboardingState } from '../../../../../lib/onboarding'
import { confirmPersonalWatchlistDraft } from '../../../../../lib/workflow'

export type ConfirmWatchlistRouteContext = {
  params: Promise<{ watchlistItemId: string }>
}

export async function POST(_request: Request, { params }: ConfirmWatchlistRouteContext) {
  const { watchlistItemId } = await params
  const state = await getOnboardingState()

  try {
    await confirmPersonalWatchlistDraft(state, watchlistItemId)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Personal-local workflow is not initialized')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message.startsWith('Unknown watchlist item:')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    throw error
  }

  redirect('/watchlist')
}
```

Update `WatchlistPanelProps` with `mode?: WorkflowMode`, default to demo, and render a POST form for `mode === 'personal-local' && !item.user_approved`:

```tsx
<form action={`/api/watchlist/${item.watchlist_item_id}/confirm`} method="post">
  <button type="submit">Confirm watchlist draft</button>
</form>
```

Update `apps/web/src/app/watchlist/page.tsx` to pass `mode={state.config.mode}`.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/workflow.test.ts apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx
```

Expected: PASS.

## Task 3: Extend browser smoke and verify checkpoint

**Files:**
- Modify: `apps/web/e2e/personal-workflow-intake.spec.ts`
- Possibly modify: `apps/web/src/components/__tests__/CommandCenter.test.tsx` if command-center primary action text changes.

- [ ] **Step 1: Write failing Playwright expectation**

After promotion assertions, click `Confirm watchlist draft`, assert the watchlist item shows `User confirmed`, no longer shows the confirmation button, then return to `/` and assert the Command Center shows `Pending user actions` and a visible `0`, plus `Monitor confirmed watchlist items for buy-zone and thesis updates`.

- [ ] **Step 2: Run e2e to verify RED or GREEN depending on Task 2 state**

Run:

```bash
corepack pnpm e2e --grep "personal-local mode can create the first research case"
```

Expected before Task 2 implementation: FAIL because the confirmation button does not exist. Expected after Task 2 implementation: PASS.

- [ ] **Step 3: Run focused verification**

Run:

```bash
git diff --check
corepack pnpm test -- --run packages/workflow/src/__tests__/verticalSlice.test.ts packages/ledger/src/__tests__/commandCenterProjection.test.ts apps/web/src/lib/__tests__/workflow.test.ts apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx apps/web/src/components/__tests__/CommandCenter.test.tsx
corepack pnpm e2e --grep "personal-local mode can create the first research case"
```

Expected: every command exits 0.

- [ ] **Step 4: Run full verification for the checkpoint**

Run:

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm e2e
NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build
```

Expected: every command exits 0. Revert any generated `apps/web/next-env.d.ts` churn unless intentionally changed.

## Self-review

- This slice advances Milestone 5 without opening holdings, accounting, Shariah policy, worker automation, or provider execution scope.
- It keeps personal-local state durable and audit-friendly by appending a user-owned event.
- It does not add write actions in demo mode.
- It does not touch `.live-openai-runtime/`.
- The remaining next slice after this is likely the first holding/open-position transition or buy-zone/monitoring state, not broad refactoring.
