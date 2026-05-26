# Owlfolio v0.2 Foundation + Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the smallest working TypeScript v0.2 vertical slice: local Next.js app, SQLite-backed append-only ledger, deterministic mocked provider, Buffett-Munger demo research case, gate/status display, and user-confirmed watchlist draft promotion.

**Architecture:** Implement the ledger, strategy contract, provider contract, and workflow projection first, then build the UI on top. The vertical slice uses a mocked provider and seeded demo data so the app is useful before real provider certification begins.

**Tech Stack:** TypeScript, pnpm workspace, Next.js, React, Zod, Vitest, Playwright, SQLite via a small ledger adapter.

---

## Scope

This plan implements Milestone 0 and Milestone 1 from the v0.2 design spec.

It does not implement:

- real Claude/OpenAI providers
- full research automation
- full monthly accounting workflow
- full purification workflow
- Python import/migration
- desktop packaging
- broker integration

## File structure

Create or replace the repository root TypeScript workspace on the `v02-typescript-rewrite` branch.

```text
package.json
pnpm-workspace.yaml
tsconfig.base.json
vitest.config.ts
playwright.config.ts
apps/
  web/
    package.json
    next.config.mjs
    tsconfig.json
    src/app/layout.tsx
    src/app/page.tsx
    src/app/onboarding/page.tsx
    src/app/research/[caseId]/page.tsx
    src/app/watchlist/page.tsx
    src/components/CommandCenter.tsx
    src/components/ResearchCasePanel.tsx
    src/components/StatusBadge.tsx
    src/lib/demo.ts
  worker/
    package.json
    tsconfig.json
    src/index.ts
packages/
  shared/
    package.json
    src/ids.ts
    src/time.ts
  ledger/
    package.json
    src/eventEnvelope.ts
    src/eventStore.ts
    src/memoryStore.ts
    src/projections/researchCaseProjection.ts
    src/projections/watchlistProjection.ts
    src/demoSeed.ts
    src/__tests__/eventStore.test.ts
    src/__tests__/replay.test.ts
    src/__tests__/idempotency.test.ts
  strategies/
    package.json
    src/strategyContract.ts
    src/buffettMunger.ts
    src/evaluateGates.ts
    src/__tests__/buffettMunger.test.ts
  providers/
    package.json
    src/providerContract.ts
    src/mockProvider.ts
    src/runProviderTask.ts
    src/__tests__/mockProvider.test.ts
  workflow/
    package.json
    src/researchWorkflow.ts
    src/watchlistWorkflow.ts
    src/__tests__/verticalSlice.test.ts
```

## Task 1: Workspace skeleton

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `apps/web/package.json`
- Create: `apps/worker/package.json`
- Create: `packages/*/package.json`

- [ ] **Step 1: Create workspace manifests**

Create root `package.json` with scripts:

```json
{
  "name": "owlfolio-v02",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "pnpm --filter @owlfolio/web dev",
    "worker": "pnpm --filter @owlfolio/worker dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "latest",
    "@types/node": "latest",
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
pnpm install
```

Expected: lockfile is created and install exits 0.

- [ ] **Step 3: Commit workspace skeleton**

Run:

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.config.ts apps packages pnpm-lock.yaml
git commit -m "chore: create v0.2 typescript workspace"
```

## Task 2: Ledger event contract and in-memory store

**Files:**
- Create: `packages/ledger/src/eventEnvelope.ts`
- Create: `packages/ledger/src/eventStore.ts`
- Test: `packages/ledger/src/__tests__/eventStore.test.ts`

- [ ] **Step 1: Write failing tests for append-only/idempotent events**

Create `packages/ledger/src/__tests__/eventStore.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '../eventStore'
import type { LedgerEventEnvelope } from '../eventEnvelope'

type ResearchPayload = { ticker: string; strategy_id: string }

function researchCaseEvent(overrides: Partial<LedgerEventEnvelope<ResearchPayload>> = {}): LedgerEventEnvelope<ResearchPayload> {
  return {
    event_id: 'evt_research_created_1',
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: 'rc_cost_001',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { ticker: 'COST', strategy_id: 'buffett-munger' },
    source_ids: [],
    created_at: '2026-05-27T00:00:00.000Z',
    schema_version: 1,
    ...overrides,
  }
}

describe('InMemoryEventStore', () => {
  it('appends and reads immutable event envelopes', async () => {
    const store = new InMemoryEventStore()
    const event = researchCaseEvent()

    const appended = await store.append(event)

    expect(appended).toEqual(event)
    expect(await store.list()).toEqual([event])
    expect(await store.listByAggregate('research_case', 'rc_cost_001')).toEqual([event])
  })

  it('deduplicates repeated appends with the same idempotency key', async () => {
    const store = new InMemoryEventStore()
    const first = researchCaseEvent({
      event_id: 'evt_first',
      idempotency_key: 'research-case:COST:buffett-munger',
    })
    const duplicate = researchCaseEvent({
      event_id: 'evt_duplicate',
      idempotency_key: 'research-case:COST:buffett-munger',
      payload: { ticker: 'COST', strategy_id: 'changed' },
    })

    const appendedFirst = await store.append(first)
    const appendedDuplicate = await store.append(duplicate)

    expect(appendedDuplicate).toEqual(appendedFirst)
    expect(await store.list()).toHaveLength(1)
    expect((await store.list())[0]?.event_id).toBe('evt_first')
  })

  it('exposes no update or delete mutation API', () => {
    const store = new InMemoryEventStore()
    expect('update' in store).toBe(false)
    expect('delete' in store).toBe(false)
    expect('remove' in store).toBe(false)
  })
})
```

Run:

```bash
pnpm test packages/ledger/src/__tests__/eventStore.test.ts
```

Expected: FAIL because files do not exist.

- [ ] **Step 2: Implement minimal event envelope and store**

Define the envelope exactly as in the design spec:

```ts
export type ActorType = 'user' | 'system' | 'provider' | 'worker'
export type AggregateType =
  | 'strategy'
  | 'company'
  | 'research_case'
  | 'watchlist_item'
  | 'holding'
  | 'decision'
  | 'accounting_snapshot'
  | 'purification_entry'
  | 'provider_run'
  | 'scheduled_task'

export type LedgerEventEnvelope<TPayload> = {
  event_id: string
  event_type: string
  aggregate_type: AggregateType
  aggregate_id: string
  causation_id?: string
  correlation_id?: string
  idempotency_key?: string
  actor_type: ActorType
  actor_id?: string
  payload: TPayload
  source_ids: string[]
  created_at: string
  schema_version: number
}
```

Implement `InMemoryEventStore` with:

- `append(event)`
- `list()`
- `listByAggregate(type, id)`
- idempotency-key dedupe

- [ ] **Step 3: Verify tests pass**

Run:

```bash
pnpm test packages/ledger/src/__tests__/eventStore.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit ledger contract**

```bash
git add packages/ledger
git commit -m "feat(ledger): define append-only event contract"
```

## Task 3: Research case and watchlist projections

**Files:**
- Create: `packages/ledger/src/projections/researchCaseProjection.ts`
- Create: `packages/ledger/src/projections/watchlistProjection.ts`
- Test: `packages/ledger/src/__tests__/replay.test.ts`
- Test: `packages/ledger/src/__tests__/idempotency.test.ts`

- [ ] **Step 1: Write replay tests**

Create `packages/ledger/src/__tests__/replay.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { LedgerEventEnvelope } from '../eventEnvelope'
import { projectResearchCases } from '../projections/researchCaseProjection'
import { projectWatchlist } from '../projections/watchlistProjection'

const events: LedgerEventEnvelope<unknown>[] = [
  {
    event_id: 'evt_001',
    event_type: 'research_case_created',
    aggregate_type: 'research_case',
    aggregate_id: 'rc_cost_001',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: { company_id: 'company_cost', ticker: 'COST', strategy_id: 'buffett-munger' },
    source_ids: [],
    created_at: '2026-05-27T00:00:00.000Z',
    schema_version: 1,
  },
  {
    event_id: 'evt_002',
    event_type: 'buffett_munger_analysis_drafted',
    aggregate_type: 'research_case',
    aggregate_id: 'rc_cost_001',
    actor_type: 'provider',
    actor_id: 'mock-provider',
    payload: {
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'COMPLIANT',
      valuation_status: 'FAIR',
      next_required_action: 'Confirm watchlist draft after user review',
    },
    source_ids: ['src_cost_10k_2025'],
    created_at: '2026-05-27T00:01:00.000Z',
    schema_version: 1,
  },
  {
    event_id: 'evt_003',
    event_type: 'decision_drafted',
    aggregate_type: 'decision',
    aggregate_id: 'decision_cost_watch_001',
    causation_id: 'evt_002',
    correlation_id: 'rc_cost_001',
    actor_type: 'system',
    payload: {
      research_case_id: 'rc_cost_001',
      decision: 'WATCH',
      user_approved: false,
      reason: 'High quality business, valuation not yet compelling enough for buy decision.',
    },
    source_ids: ['src_cost_10k_2025'],
    created_at: '2026-05-27T00:02:00.000Z',
    schema_version: 1,
  },
  {
    event_id: 'evt_004',
    event_type: 'watchlist_draft_created',
    aggregate_type: 'watchlist_item',
    aggregate_id: 'watch_cost_001',
    causation_id: 'evt_003',
    correlation_id: 'rc_cost_001',
    actor_type: 'user',
    actor_id: 'user_local',
    payload: {
      research_case_id: 'rc_cost_001',
      company_id: 'company_cost',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      user_approved: false,
      thesis_summary: 'Durable quality compounder; wait for better margin of safety.',
    },
    source_ids: ['src_cost_10k_2025'],
    created_at: '2026-05-27T00:03:00.000Z',
    schema_version: 1,
  },
]

describe('ledger replay projections', () => {
  it('rebuilds research and watchlist state from events only', () => {
    const researchCases = projectResearchCases(events)
    const watchlist = projectWatchlist(events)

    expect(researchCases).toHaveLength(1)
    expect(researchCases[0]).toMatchObject({
      research_case_id: 'rc_cost_001',
      stage: 'watchlist_draft',
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'COMPLIANT',
      valuation_status: 'FAIR',
    })

    expect(watchlist).toHaveLength(1)
    expect(watchlist[0]).toMatchObject({
      watchlist_item_id: 'watch_cost_001',
      research_case_id: 'rc_cost_001',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      user_approved: false,
    })
  })
})
```

Create `packages/ledger/src/__tests__/idempotency.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '../eventStore'

describe('ledger idempotency', () => {
  it('does not duplicate retried worker/provider events', async () => {
    const store = new InMemoryEventStore()
    const event = {
      event_id: 'evt_analysis_first',
      event_type: 'buffett_munger_analysis_drafted',
      aggregate_type: 'research_case' as const,
      aggregate_id: 'rc_cost_001',
      idempotency_key: 'provider-run:mock:rc_cost_001:v1',
      actor_type: 'provider' as const,
      actor_id: 'mock-provider',
      payload: { investment_verdict: 'WATCH' },
      source_ids: ['src_cost_10k_2025'],
      created_at: '2026-05-27T00:01:00.000Z',
      schema_version: 1,
    }

    await store.append(event)
    await store.append({ ...event, event_id: 'evt_analysis_retry' })

    expect(await store.list()).toHaveLength(1)
    expect((await store.list())[0]?.event_id).toBe('evt_analysis_first')
  })
})
```

- [ ] **Step 2: Implement projection functions**

Implement pure functions:

- `projectResearchCases(events)`
- `projectWatchlist(events)`

They must accept only event arrays and return derived current state.

- [ ] **Step 3: Verify replay and idempotency tests pass**

Run:

```bash
pnpm test packages/ledger/src/__tests__/replay.test.ts packages/ledger/src/__tests__/idempotency.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit projections**

```bash
git add packages/ledger
git commit -m "feat(ledger): add replayable research projections"
```

## Task 4: Buffett-Munger policy contract

**Files:**
- Create: `packages/strategies/src/strategyContract.ts`
- Create: `packages/strategies/src/buffettMunger.ts`
- Create: `packages/strategies/src/evaluateGates.ts`
- Test: `packages/strategies/src/__tests__/buffettMunger.test.ts`

- [ ] **Step 1: Write failing strategy tests**

Create `packages/strategies/src/__tests__/buffettMunger.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buffettMungerStrategy } from '../buffettMunger'
import { evaluateGates } from '../evaluateGates'

describe('Buffett-Munger certified strategy', () => {
  it('defines the certified core policy', () => {
    expect(buffettMungerStrategy.id).toBe('buffett-munger')
    expect(buffettMungerStrategy.certification_status).toBe('certified')
    expect(buffettMungerStrategy.shariah.required).toBe(true)
    expect(buffettMungerStrategy.research.required_specialists.map((s) => s.id)).toEqual([
      'moat',
      'financials',
      'risk',
      'management',
      'valuation',
      'synthesis',
    ])
    expect(buffettMungerStrategy.valuation.hurdle_rates).toEqual({
      inevitable: 0.12,
      monopoly: 0.13,
      wide_moat: 0.15,
    })
  })

  it('includes required blocking gates', () => {
    const blockingGateIds = buffettMungerStrategy.hard_gates
      .filter((gate) => gate.severity === 'blocking')
      .map((gate) => gate.id)

    expect(blockingGateIds).toEqual(
      expect.arrayContaining([
        'shariah_compliant_or_conditional',
        'positive_owner_earnings',
        'leverage_safe',
        'valuation_complete',
      ]),
    )
  })

  it('returns COMPLIANT only when blocking gates pass', () => {
    const result = evaluateGates(buffettMungerStrategy, {
      shariah_status: 'COMPLIANT',
      owner_earnings_positive: true,
      leverage_safe: true,
      valuation_complete: true,
      source_coverage_complete: true,
    })

    expect(result.status).toBe('COMPLIANT')
    expect(result.failed_gates).toEqual([])
    expect(result.unknown_gates).toEqual([])
  })

  it('returns CONDITIONAL when Shariah is conditional but allowed', () => {
    const result = evaluateGates(buffettMungerStrategy, {
      shariah_status: 'CONDITIONAL',
      owner_earnings_positive: true,
      leverage_safe: true,
      valuation_complete: true,
      source_coverage_complete: true,
    })

    expect(result.status).toBe('CONDITIONAL')
    expect(result.conditional_gates).toContain('shariah_compliant_or_conditional')
  })

  it('returns INSUFFICIENT_DATA when required facts are missing', () => {
    const result = evaluateGates(buffettMungerStrategy, {
      shariah_status: 'COMPLIANT',
      owner_earnings_positive: true,
    })

    expect(result.status).toBe('INSUFFICIENT_DATA')
    expect(result.unknown_gates).toEqual(expect.arrayContaining(['leverage_safe', 'valuation_complete']))
  })
})
```

- [ ] **Step 2: Implement strategy contract and Buffett-Munger policy**

Create Zod schemas for:

- strategy metadata
- specialist definitions
- hard gates
- valuation policy
- Shariah policy
- portfolio policy

Export `buffettMungerStrategy`.

- [ ] **Step 3: Implement gate evaluator**

Implement `evaluateGates(strategy, facts)` returning:

- `COMPLIANT`
- `CONDITIONAL`
- `NON_COMPLIANT`
- `INSUFFICIENT_DATA`

The alpha can use explicit demo facts rather than live financial data.

- [ ] **Step 4: Verify tests pass and commit**

```bash
pnpm test packages/strategies/src/__tests__/buffettMunger.test.ts
git add packages/strategies
git commit -m "feat(strategies): define certified buffett munger policy"
```

## Task 5: Provider contract and mocked provider

**Files:**
- Create: `packages/providers/src/providerContract.ts`
- Create: `packages/providers/src/mockProvider.ts`
- Create: `packages/providers/src/runProviderTask.ts`
- Test: `packages/providers/src/__tests__/mockProvider.test.ts`

- [ ] **Step 1: Write failing provider contract tests**

Create `packages/providers/src/__tests__/mockProvider.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { MockProvider } from '../mockProvider'
import { runProviderTask } from '../runProviderTask'

const AnalysisSchema = z.object({
  investment_verdict: z.enum(['BUY', 'WATCH', 'PASS', 'RESEARCH_MORE']),
  strategy_compliance: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'INSUFFICIENT_DATA']),
  shariah_status: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'UNKNOWN']),
  valuation_status: z.enum(['ATTRACTIVE', 'FAIR', 'EXPENSIVE', 'INSUFFICIENT_DATA']),
  next_required_action: z.string().min(1),
  source_ids: z.array(z.string()).min(1),
})

describe('MockProvider', () => {
  it('returns structured Buffett-Munger analysis matching schema', async () => {
    const provider = new MockProvider()

    const result = await provider.structured({
      run_id: 'run_mock_cost_001',
      model_id: 'mock-research-v1',
      prompt: 'Analyze COST with Buffett-Munger policy',
      timeout_ms: 1000,
      budget: { max_tool_calls: 2, max_tokens: 2000 },
      tool_allowlist: ['source.fetch'],
    }, AnalysisSchema)

    expect(result).toMatchObject({
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'COMPLIANT',
    })
    expect(result.source_ids).toContain('src_cost_10k_2025')
  })

  it('records provider run metadata and tool allowlist', async () => {
    const provider = new MockProvider()
    const run = await runProviderTask(provider, {
      run_id: 'run_metadata_001',
      model_id: 'mock-research-v1',
      prompt: 'Use allowed tools only',
      timeout_ms: 1000,
      budget: { max_tool_calls: 1, max_tokens: 500 },
      tool_allowlist: ['source.fetch'],
    })

    expect(run.metadata).toMatchObject({
      provider_id: 'mock-provider',
      model_id: 'mock-research-v1',
      timeout_ms: 1000,
      tool_allowlist: ['source.fetch'],
    })
    expect(run.ledger_events_written).toBe(0)
  })

  it('fails safely when structured output violates schema', async () => {
    const provider = new MockProvider({ mode: 'invalid-json' })

    await expect(provider.structured({
      run_id: 'run_invalid_001',
      model_id: 'mock-research-v1',
      prompt: 'Return invalid result',
      timeout_ms: 1000,
      budget: { max_tool_calls: 0, max_tokens: 500 },
      tool_allowlist: [],
    }, AnalysisSchema)).rejects.toThrow(/structured output validation failed/i)
  })
})
```

- [ ] **Step 2: Implement provider interface**

Define methods:

- `complete(request)`
- `structured(request, schema)`
- `runWithTools(request)`

Provider outputs must not write ledger events directly.

- [ ] **Step 3: Implement mocked Buffett-Munger provider output**

Return a deterministic canned analysis for one demo company with:

- investment verdict: WATCH
- strategy compliance: CONDITIONAL
- Shariah status: COMPLIANT
- valuation status: EXPENSIVE or FAIR
- next required action
- source IDs

- [ ] **Step 4: Verify tests pass and commit**

```bash
pnpm test packages/providers/src/__tests__/mockProvider.test.ts
git add packages/providers
git commit -m "feat(providers): add mocked provider contract"
```

## Task 6: Vertical research workflow

**Files:**
- Create: `packages/workflow/src/researchWorkflow.ts`
- Create: `packages/workflow/src/watchlistWorkflow.ts`
- Test: `packages/workflow/src/__tests__/verticalSlice.test.ts`

- [ ] **Step 1: Write failing vertical slice test**

Create `packages/workflow/src/__tests__/verticalSlice.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { projectResearchCases } from '@owlfolio/ledger/projections/researchCaseProjection'
import { projectWatchlist } from '@owlfolio/ledger/projections/watchlistProjection'
import { MockProvider } from '@owlfolio/providers/mockProvider'
import { createResearchCase, runDemoBuffettMungerAnalysis, draftDecision } from '../researchWorkflow'
import { confirmWatchlistDraft } from '../watchlistWorkflow'

describe('v0.2 vertical research workflow', () => {
  it('creates a Buffett-Munger research case and promotes it to a user-attributed watchlist draft', async () => {
    const store = new InMemoryEventStore()
    const provider = new MockProvider()

    const researchCase = await createResearchCase(store, {
      research_case_id: 'rc_cost_001',
      company_id: 'company_cost',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      actor_id: 'user_local',
    })

    const analysis = await runDemoBuffettMungerAnalysis(store, provider, {
      research_case_id: researchCase.research_case_id,
      company_id: 'company_cost',
      ticker: 'COST',
      idempotency_key: 'analysis:rc_cost_001:mock:v1',
    })

    const decision = await draftDecision(store, {
      research_case_id: researchCase.research_case_id,
      decision_id: 'decision_cost_watch_001',
      decision: analysis.investment_verdict,
      reason: 'Demo analysis says watch until margin of safety improves.',
      causation_id: analysis.event_id,
    })

    await confirmWatchlistDraft(store, {
      watchlist_item_id: 'watch_cost_001',
      research_case_id: researchCase.research_case_id,
      decision_id: decision.decision_id,
      company_id: 'company_cost',
      ticker: 'COST',
      strategy_id: 'buffett-munger',
      thesis_summary: 'Durable quality compounder; wait for better margin of safety.',
      actor_id: 'user_local',
    })

    const events = await store.list()
    const projectedCases = projectResearchCases(events)
    const projectedWatchlist = projectWatchlist(events)

    expect(projectedCases[0]).toMatchObject({
      research_case_id: 'rc_cost_001',
      stage: 'watchlist_draft',
      investment_verdict: 'WATCH',
      strategy_compliance: 'CONDITIONAL',
      shariah_status: 'COMPLIANT',
    })
    expect(projectedWatchlist[0]).toMatchObject({
      watchlist_item_id: 'watch_cost_001',
      user_approved: false,
      created_by_actor_type: 'user',
      created_by_actor_id: 'user_local',
    })
    expect(events.some((event) => event.actor_type === 'provider' && event.event_type === 'watchlist_draft_created')).toBe(false)
  })
})
```

- [ ] **Step 2: Implement workflow functions**

Functions:

- `createResearchCase(command)`
- `runDemoBuffettMungerAnalysis(command)`
- `draftDecision(command)`
- `confirmWatchlistDraft(command)`

All functions append events. None mutate projections directly.

- [ ] **Step 3: Verify tests pass and commit**

```bash
pnpm test packages/workflow/src/__tests__/verticalSlice.test.ts
git add packages/workflow
git commit -m "feat(workflow): add buffett munger vertical slice"
```

## Task 7: Next.js command center UI

**Files:**
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/components/CommandCenter.tsx`
- Create: `apps/web/src/components/StatusBadge.tsx`
- Create: `apps/web/src/lib/demo.ts`

- [ ] **Step 1: Create app shell**

Implement a local dashboard that renders:

- product name
- setup status
- provider status: Mock provider / demo mode
- strategy: Buffett-Munger certified
- pipeline counts
- next recommended action

- [ ] **Step 2: Wire demo projection into the dashboard**

Use deterministic demo data from `apps/web/src/lib/demo.ts` and projections from `packages/ledger`.

- [ ] **Step 3: Run app**

```bash
pnpm dev
```

Expected: app starts and prints a local URL. Opening the URL shows the command center.

- [ ] **Step 4: Commit UI shell**

```bash
git add apps/web
git commit -m "feat(web): add workflow command center"
```

## Task 8: Research case and watchlist pages

**Files:**
- Create: `apps/web/src/app/research/[caseId]/page.tsx`
- Create: `apps/web/src/app/watchlist/page.tsx`
- Create: `apps/web/src/components/ResearchCasePanel.tsx`

- [ ] **Step 1: Add research case page**

Display:

- company/ticker
- workflow stage
- investment verdict
- strategy compliance
- Shariah status
- valuation status
- gate checklist
- source IDs
- next required action

- [ ] **Step 2: Add watchlist page**

Display draft watchlist item with:

- ticker
- strategy
- thesis summary
- buy-zone status if present
- user-confirmed/draft state

- [ ] **Step 3: Verify browser navigation**

Run:

```bash
pnpm dev
```

Expected: command center links to research case and watchlist pages.

- [ ] **Step 4: Commit pages**

```bash
git add apps/web
git commit -m "feat(web): show research case and watchlist workflow"
```

## Task 9: Onboarding/demo mode smoke test

**Files:**
- Create: `apps/web/src/app/onboarding/page.tsx`
- Create: `playwright.config.ts`
- Create: `apps/web/e2e/demo-mode.spec.ts`

- [ ] **Step 1: Add onboarding page**

The page must show:

- Demo mode option
- Personal local mode disabled or marked coming later
- Provider: Mock provider / demo mode
- Strategy: Buffett-Munger
- Shariah: enabled by default

- [ ] **Step 2: Add Playwright smoke test**

Create `apps/web/e2e/demo-mode.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('demo onboarding shows workflow command center and research statuses', async ({ page }) => {
  await page.goto('/onboarding')

  await expect(page.getByRole('heading', { name: /set up owlfolio/i })).toBeVisible()
  await expect(page.getByText(/demo mode/i)).toBeVisible()
  await expect(page.getByText(/mock provider/i)).toBeVisible()
  await expect(page.getByText(/buffett-munger/i)).toBeVisible()
  await expect(page.getByText(/shariah.*enabled/i)).toBeVisible()

  await page.getByRole('link', { name: /start demo/i }).click()

  await expect(page.getByRole('heading', { name: /command center/i })).toBeVisible()
  await expect(page.getByText(/provider.*mock provider/i)).toBeVisible()
  await expect(page.getByText(/strategy.*buffett-munger/i)).toBeVisible()
  await expect(page.getByText(/shariah.*enabled/i)).toBeVisible()

  await page.getByRole('link', { name: /view demo research case/i }).click()

  await expect(page.getByRole('heading', { name: /cost/i })).toBeVisible()
  await expect(page.getByText(/investment verdict.*watch/i)).toBeVisible()
  await expect(page.getByText(/strategy compliance.*conditional/i)).toBeVisible()
  await expect(page.getByText(/shariah status.*compliant/i)).toBeVisible()
  await expect(page.getByText(/valuation status/i)).toBeVisible()
})
```

- [ ] **Step 3: Run E2E test**

```bash
pnpm e2e
```

Expected: PASS.

- [ ] **Step 4: Commit onboarding smoke test**

```bash
git add apps/web playwright.config.ts
git commit -m "test(web): add demo onboarding smoke test"
```

## Task 10: Foundation verification

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-owlfolio-v02-typescript-design.md` only if implementation exposes necessary spec corrections
- Create: `docs/superpowers/plans/2026-05-27-owlfolio-v02-next-milestone.md` only after this vertical slice passes

- [ ] **Step 1: Run all checks**

```bash
pnpm typecheck
pnpm test
pnpm e2e
```

Expected: all pass.

- [ ] **Step 2: Verify safety invariants manually**

Confirm:

- mocked provider does not write ledger events directly
- watchlist promotion has user actor attribution
- no buy/sell decision can be marked user-approved by provider or worker
- demo mode works without credentials
- events replay into the same projection deterministically

- [ ] **Step 3: Commit verification docs if changed**

```bash
git status --short
git add docs apps packages package.json pnpm-lock.yaml
git commit -m "docs: record v0.2 vertical slice verification"
```

Only commit if verification updates docs or generated fixtures.

## Execution notes

- Use TDD for ledger, strategy, provider, and workflow packages.
- Keep UI thin until projections and workflow functions are stable.
- Do not implement real providers until the mocked provider contract and vertical slice pass.
- Do not create Kanban cards for broad provider/accounting/migration work until Milestone 1 is complete.
- If a task needs a design change, update the spec first, then implement.
