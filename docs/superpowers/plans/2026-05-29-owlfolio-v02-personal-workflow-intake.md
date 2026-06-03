# Owlfolio v0.2 Personal Workflow Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the personal-local command-center dead end with a real first-step workflow so a user can create their first research case in the durable personal ledger and open it in the browser.

**Architecture:** Reuse the existing ledger projections and `@owlfolio/workflow` research-case event writer instead of inventing a second web-only persistence path. Add a small web workflow helper that resolves the active ledger from onboarding config, writes `research_case_created` events for personal-local mode, and loads research/watchlist pages from either the demo ledger or the personal ledger.

**Tech Stack:** Next.js App Router, React server/client components, TypeScript, Vitest, Playwright, workspace packages `@owlfolio/ledger`, `@owlfolio/shared`, and `@owlfolio/workflow`.

---

## File structure

- Modify: `packages/workflow/package.json` — export stable entrypoints for the web app.
- Create: `packages/workflow/src/index.ts` — barrel export for research/watchlist workflow helpers.
- Create: `apps/web/src/lib/workflow.ts` — active-ledger resolver, personal-local research-case creation, mode-aware loaders.
- Create: `apps/web/src/lib/__tests__/workflow.test.ts` — red/green coverage for personal-local workflow creation and mode-aware loading.
- Modify: `apps/web/src/lib/demo.ts` — command-center actions become mode-aware and point to real workflow routes.
- Modify: `apps/web/src/components/ResearchCasePanel.tsx` — accept generic app research cases instead of demo-only naming.
- Modify: `apps/web/src/components/WatchlistPanel.tsx` — accept generic app watchlist items and neutral copy.
- Create: `apps/web/src/app/research/new/ResearchIntakeForm.tsx` — client form for ticker/company input.
- Create: `apps/web/src/app/research/new/page.tsx` — personal-local first-research-case page.
- Create: `apps/web/src/app/api/research/start/route.ts` — POST endpoint to append `research_case_created` into the active personal ledger.
- Modify: `apps/web/src/app/research/[caseId]/page.tsx` — load from the active ledger in both demo and personal-local modes.
- Modify: `apps/web/src/app/watchlist/page.tsx` — load watchlist drafts from the active ledger in both demo and personal-local modes.
- Modify: `apps/web/src/components/__tests__/CommandCenter.test.tsx` — red/green for personal-local CTA wiring.
- Modify: `apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx` — red/green for generic workflow page copy and empty personal-local watchlist state.
- Create: `apps/web/e2e/personal-workflow-intake.spec.ts` — browser verification for onboarding → command center → create research case.

## Task 1: Add a mode-aware workflow helper and package exports

**Files:**
- Modify: `packages/workflow/package.json`
- Create: `packages/workflow/src/index.ts`
- Create: `apps/web/src/lib/workflow.ts`
- Create: `apps/web/src/lib/__tests__/workflow.test.ts`

- [ ] **Step 1: Write the failing workflow-helper tests**

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import { defaultPersonalLocalAppConfig } from '@owlfolio/shared'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createPersonalResearchCase,
  getAppResearchCaseFromStore,
  getAppWatchlistItemsFromStore,
  resolveActiveWorkflowMode,
} from '../workflow'

describe('workflow helpers', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  it('creates the first personal-local research case in the configured durable ledger', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'owlfolio-workflow-'))
    dirs.push(projectDir)

    const ledgerPath = join(projectDir, 'data', 'personal-ledger.sqlite')
    const created = await createPersonalResearchCase(
      {
        config: {
          ...defaultPersonalLocalAppConfig(),
          initialized_at: '2026-05-29T12:00:00.000Z',
          ledger_path: ledgerPath,
        },
        is_initialized: true,
      },
      { ticker: 'MSFT', company_id: 'company_msft' },
    )

    const store = new SQLiteEventStore(ledgerPath)
    try {
      const researchCase = await getAppResearchCaseFromStore(store, 'personal-local', created.research_case_id)
      expect(researchCase).toMatchObject({
        ticker: 'MSFT',
        company_id: 'company_msft',
        stage: 'created',
        next_required_action: 'Start Buffett-Munger research for MSFT',
      })
    } finally {
      store.close()
    }
  })

  it('returns an empty watchlist for a newly initialized personal ledger', async () => {
    const store = new SQLiteEventStore()
    try {
      await expect(getAppWatchlistItemsFromStore(store, 'personal-local')).resolves.toEqual([])
    } finally {
      store.close()
    }
  })

  it('keeps demo mode routed through the seeded demo loaders', () => {
    expect(resolveActiveWorkflowMode({ mode: 'demo' })).toBe('demo')
    expect(resolveActiveWorkflowMode({ mode: 'personal-local' })).toBe('personal-local')
  })
})
```

- [ ] **Step 2: Run the targeted workflow-helper test and verify RED**

Run:
```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/workflow.test.ts
```

Expected: FAIL because `../workflow` does not exist yet.

- [ ] **Step 3: Add stable workflow exports for the web app**

`packages/workflow/package.json`
```json
{
  "name": "@owlfolio/workflow",
  "private": true,
  "type": "module",
  "scripts": {
    "lint": "node -e \"console.log('Lint not configured yet for @owlfolio/workflow')\"",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@owlfolio/ledger": "workspace:*",
    "@owlfolio/providers": "workspace:*"
  },
  "exports": {
    ".": "./src/index.ts",
    "./researchWorkflow": "./src/researchWorkflow.ts",
    "./watchlistWorkflow": "./src/watchlistWorkflow.ts"
  }
}
```

`packages/workflow/src/index.ts`
```ts
export * from './researchWorkflow'
export * from './watchlistWorkflow'
```

- [ ] **Step 4: Implement the minimal workflow helper**

`apps/web/src/lib/workflow.ts`
```ts
import { notFound } from 'next/navigation'

import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { projectResearchCaseTimeline } from '@owlfolio/ledger/projections/researchCaseTimelineProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import type { EventStore } from '@owlfolio/ledger/eventStore'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
import type { AppConfig } from '@owlfolio/shared'
import { createResearchCase } from '@owlfolio/workflow'

import type { DemoGateChecklistItem } from './demo'
import { getDemoResearchCaseFromStore, getDemoWatchlistItemsFromStore } from './demo'
import type { OnboardingState } from './onboarding'

export type WorkflowMode = AppConfig['mode']

export type AppResearchCase = {
  research_case_id: string
  company_id?: string
  ticker?: string
  strategy_id?: string
  stage: string
  investment_verdict?: string
  strategy_compliance?: string
  shariah_status?: string
  valuation_status?: string
  next_required_action?: string
  source_ids: string[]
  ledger_timeline: ReturnType<typeof projectResearchCaseTimeline>
  gate_checklist: DemoGateChecklistItem[]
}

export type AppWatchlistItem = Awaited<ReturnType<typeof getDemoWatchlistItemsFromStore>>[number]

const createdChecklist: DemoGateChecklistItem[] = [
  { label: 'Quality business', status: 'Pending', tone: 'neutral' },
  { label: 'Management alignment', status: 'Pending', tone: 'neutral' },
  { label: 'Margin of safety', status: 'Pending', tone: 'neutral' },
]

export function resolveActiveWorkflowMode(config: Pick<AppConfig, 'mode'>): WorkflowMode {
  return config.mode
}

export async function createPersonalResearchCase(
  state: OnboardingState,
  input: { ticker: string; company_id?: string },
) {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }

  const ticker = input.ticker.trim().toUpperCase()
  const companyId = input.company_id?.trim() || `company_${ticker.toLowerCase()}`
  const researchCaseId = `rc_${ticker.toLowerCase()}_${Date.now()}`
  const store = new SQLiteEventStore(state.config.ledger_path)
  try {
    return await createResearchCase(store, {
      research_case_id: researchCaseId,
      company_id: companyId,
      ticker,
      strategy_id: state.config.strategy_id,
      actor_id: 'user_local',
      idempotency_key: `personal:create:${ticker}:${researchCaseId}`,
    })
  } finally {
    store.close()
  }
}

export async function getAppResearchCaseFromStore(store: EventStore, mode: WorkflowMode, caseId: string): Promise<AppResearchCase> {
  if (mode === 'demo') {
    return getDemoResearchCaseFromStore(store, caseId)
  }

  const events = await store.list()
  const researchCase = projectResearchCases(events).find((candidate) => candidate.research_case_id === caseId)
  if (researchCase === undefined) {
    notFound()
  }

  return {
    ...researchCase,
    gate_checklist: createdChecklist,
    source_ids: [],
    ledger_timeline: projectResearchCaseTimeline(events, caseId),
    next_required_action: researchCase.next_required_action ?? `Start Buffett-Munger research for ${researchCase.ticker ?? caseId}`,
  }
}

export async function getAppWatchlistItemsFromStore(store: EventStore, mode: WorkflowMode): Promise<AppWatchlistItem[]> {
  if (mode === 'demo') {
    return getDemoWatchlistItemsFromStore(store)
  }

  return projectWatchlist(await store.list()).map((item) => ({ ...item }))
}
```

- [ ] **Step 5: Run the targeted workflow-helper test and verify GREEN**

Run:
```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/workflow.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the helper checkpoint**

```bash
git add packages/workflow/package.json packages/workflow/src/index.ts apps/web/src/lib/workflow.ts apps/web/src/lib/__tests__/workflow.test.ts
git commit -m "feat(web): add personal workflow intake helpers"
```

## Task 2: Wire the command center and workflow pages to the active ledger

**Files:**
- Modify: `apps/web/src/lib/demo.ts`
- Modify: `apps/web/src/components/ResearchCasePanel.tsx`
- Modify: `apps/web/src/components/WatchlistPanel.tsx`
- Modify: `apps/web/src/app/research/[caseId]/page.tsx`
- Modify: `apps/web/src/app/watchlist/page.tsx`
- Modify: `apps/web/src/components/__tests__/CommandCenter.test.tsx`
- Modify: `apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx`

- [ ] **Step 1: Write the failing command-center and page tests**

Add assertions like:
```ts
expect(html).toContain('Create or import your first research case')
expect(html).toContain('href="/research/new"')
expect(html).toContain('Start first research case')
```

and
```ts
expect(html).toContain('No watchlist drafts yet')
expect(html).toContain('Personal local ledger watchlist state.')
```

- [ ] **Step 2: Run the targeted UI tests and verify RED**

Run:
```bash
corepack pnpm test -- --run apps/web/src/components/__tests__/CommandCenter.test.tsx apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx
```

Expected: FAIL because the personal-local CTA still points to `/onboarding` and the watchlist page copy is demo-specific.

- [ ] **Step 3: Make command-center actions honest for personal-local mode**

In `apps/web/src/lib/demo.ts`, change the initialized personal-local branch to:
```ts
primary_action: summary.pipeline_counts.research_cases === 0
  ? { href: '/research/new', label: 'Start first research case' }
  : { href: `/research/${summary.primary_research_case_id ?? ''}`, label: 'Open latest research case' },
secondary_action: { href: '/watchlist', label: 'Open watchlist drafts' },
```

Keep the existing onboarding CTA for uninitialized state.

- [ ] **Step 4: Make the research/watchlist components generic**

Update `ResearchCasePanel` and `WatchlistPanel` prop imports to use the new app-level types:
```ts
import type { AppResearchCase, AppWatchlistItem } from '../lib/workflow'
```

Also replace demo-specific copy with neutral copy:
```ts
'Ledger-backed workflow state for the current Owlfolio mode.'
'Personal local ledger watchlist state.'
```

Render an empty-state card when `items.length === 0`:
```ts
createElement('article', { style: cardStyle }, createElement('p', { style: { margin: 0, color: '#475569' } }, 'No watchlist drafts yet. Create a research case first.'))
```

- [ ] **Step 5: Load research/watchlist pages from the active ledger**

In `apps/web/src/app/research/[caseId]/page.tsx`:
```ts
import { getOnboardingState } from '../../../lib/onboarding'
import { getAppResearchCaseFromStore, resolveActiveWorkflowMode } from '../../../lib/workflow'
import { SQLiteEventStore } from '@owlfolio/ledger/sqliteEventStore'
```

Resolve the active store from onboarding state:
```ts
const state = await getOnboardingState()
const ledgerPath = state.config.mode === 'demo' ? resolveDemoLedgerPath() : state.config.ledger_path
if (ledgerPath === undefined) {
  notFound()
}
const store = new SQLiteEventStore(ledgerPath)
```

Then load the case through `getAppResearchCaseFromStore(store, resolveActiveWorkflowMode(state.config), caseId)`.

In `apps/web/src/app/watchlist/page.tsx`, do the symmetric `getAppWatchlistItemsFromStore(...)` load.

- [ ] **Step 6: Run the targeted UI tests and verify GREEN**

Run:
```bash
corepack pnpm test -- --run apps/web/src/components/__tests__/CommandCenter.test.tsx apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit the page-wiring checkpoint**

```bash
git add apps/web/src/lib/demo.ts apps/web/src/components/ResearchCasePanel.tsx apps/web/src/components/WatchlistPanel.tsx apps/web/src/app/research/[caseId]/page.tsx apps/web/src/app/watchlist/page.tsx apps/web/src/components/__tests__/CommandCenter.test.tsx apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx
git commit -m "feat(web): wire research workflow pages to active ledger"
```

## Task 3: Add a personal-local research intake route and browser flow

**Files:**
- Create: `apps/web/src/app/research/new/ResearchIntakeForm.tsx`
- Create: `apps/web/src/app/research/new/page.tsx`
- Create: `apps/web/src/app/api/research/start/route.ts`
- Create: `apps/web/e2e/personal-workflow-intake.spec.ts`

- [ ] **Step 1: Write the failing browser test first**

`apps/web/e2e/personal-workflow-intake.spec.ts`
```ts
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.post('/api/testing/reset')
})

test('personal-local mode can create the first research case from the command center', async ({ page }) => {
  await page.goto('/onboarding')
  await page.getByLabel('Personal local mode').check()
  await page.getByRole('button', { name: 'Start workflow' }).click()

  await expect(page).toHaveURL('/')
  await page.getByRole('link', { name: 'Start first research case' }).click()
  await page.getByLabel('Ticker').fill('MSFT')
  await page.getByRole('button', { name: 'Create research case' }).click()

  await expect(page).toHaveURL(/\/research\/rc_msft_/)
  await expect(page.getByText('MSFT')).toBeVisible()
  await expect(page.getByText('created')).toBeVisible()
  await expect(page.getByText('Start Buffett-Munger research for MSFT')).toBeVisible()
})
```

- [ ] **Step 2: Run the new e2e spec and verify RED**

Run:
```bash
corepack pnpm e2e -- --grep "personal-local mode can create the first research case"
```

Expected: FAIL because `/research/new` and `/api/research/start` do not exist.

- [ ] **Step 3: Implement the intake page and API route**

`apps/web/src/app/research/new/page.tsx`
```ts
import { redirect } from 'next/navigation'

import { getOnboardingState } from '../../../lib/onboarding'
import { ResearchIntakeForm } from './ResearchIntakeForm'

export default async function ResearchIntakePage() {
  const state = await getOnboardingState()

  if (!state.is_initialized || state.config.mode !== 'personal-local') {
    redirect('/')
  }

  return <ResearchIntakeForm />
}
```

`apps/web/src/app/research/new/ResearchIntakeForm.tsx`
```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ResearchIntakeForm() {
  const [ticker, setTicker] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const router = useRouter()

  async function submit() {
    setIsSubmitting(true)
    setError(undefined)
    const response = await fetch('/api/research/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticker, company_id: companyId || undefined }),
    })

    const body = await response.json()
    if (!response.ok) {
      setError(body.error ?? 'Unable to create research case')
      setIsSubmitting(false)
      return
    }

    router.push(`/research/${body.research_case_id}`)
    router.refresh()
  }

  return (
    <main>
      {/* keep styles consistent with onboarding cards */}
      <label>
        Ticker
        <input aria-label="Ticker" value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} />
      </label>
      <label>
        Company ID (optional)
        <input aria-label="Company ID" value={companyId} onChange={(event) => setCompanyId(event.target.value)} />
      </label>
      {error === undefined ? null : <p>{error}</p>}
      <button type="button" disabled={isSubmitting} onClick={() => void submit()}>
        {isSubmitting ? 'Creating…' : 'Create research case'}
      </button>
    </main>
  )
}
```

`apps/web/src/app/api/research/start/route.ts`
```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getOnboardingState } from '../../../../lib/onboarding'
import { createPersonalResearchCase } from '../../../../lib/workflow'

const requestSchema = z.object({
  ticker: z.string().trim().min(1),
  company_id: z.string().trim().optional(),
})

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.parse(await request.json())
    const state = await getOnboardingState()
    const created = await createPersonalResearchCase(state, parsed)
    return NextResponse.json({ research_case_id: created.research_case_id }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 400 })
  }
}
```

- [ ] **Step 4: Run the targeted tests and verify GREEN**

Run:
```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/workflow.test.ts apps/web/src/components/__tests__/CommandCenter.test.tsx apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx
corepack pnpm e2e -- --grep "personal-local mode can create the first research case"
```

Expected: PASS.

- [ ] **Step 5: Commit the browser-intake checkpoint**

```bash
git add apps/web/src/app/research/new/ResearchIntakeForm.tsx apps/web/src/app/research/new/page.tsx apps/web/src/app/api/research/start/route.ts apps/web/e2e/personal-workflow-intake.spec.ts
git commit -m "feat(web): add personal research intake flow"
```

## Task 4: Full verification

**Files:**
- No new files; verify final tree.

- [ ] **Step 1: Run focused checks first**

```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/workflow.test.ts apps/web/src/components/__tests__/CommandCenter.test.tsx apps/web/src/components/__tests__/ResearchWorkflowPages.test.tsx
corepack pnpm e2e -- --grep "personal-local mode can create the first research case"
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

- [ ] **Step 3: Commit the final verification state**

```bash
git status --short
```

Expected: clean working tree except for intentional source edits already committed.

## Self-review

- Spec coverage: this plan closes the current personal-local dead end after onboarding by making the command center point to a real research-intake page, creating a durable `research_case_created` event, and loading research/watchlist pages from the active ledger rather than demo-only helpers.
- Placeholder scan: no TBD markers or “implement later” placeholders remain in task steps.
- Type consistency: the plan uses `WorkflowMode`, `AppResearchCase`, `AppWatchlistItem`, `createPersonalResearchCase`, and the existing `research_case_created` projection shape consistently across helper, page, and API tasks.
