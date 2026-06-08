# Multi-Agent Grounded Research Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic single-call research path with a strategy-driven multi-agent swarm whose every cited source is fetched and verified by the harness, executed in the worker and triggered by the web.

**Architecture:** A new `researchSwarm.ts` orchestrator drives the existing discrete pipeline step functions in `strategyResearchPipeline.ts` — one provider ("agent") call per stage, with the deep dive fanning out concurrently across the strategy's specialist lanes. Each agent returns analysis + proposed citations; a new harness-side `sourceGrounding.ts` fetches and SHA-256-hashes each citation and keeps only verified sources, so fabricated/unfetchable sources can never be recorded as available. The web route enqueues a durable `research_run_requested` event and spawns a one-shot worker that runs the swarm; the UI renders progress from existing ledger projections. Research authors only drafts/observations, so the worker's dry-run safety boundary is untouched.

**Tech Stack:** TypeScript (pnpm workspaces), Node 22 global `fetch`, `zod` for structured-output schemas, `vitest` for unit tests, SQLite event store, Next.js (App Router) for the web route, the existing `@owlfolio/providers`/`@owlfolio/workflow`/`@owlfolio/ledger` packages.

**Conventions used below:**
- Run a single test file: `corepack pnpm exec vitest run <path>` (from repo root `/home/hermes_agent/code/owlfolio`).
- Full gate before finishing: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm lint`.
- Tests live in a sibling `__tests__/` dir next to the module (existing pattern).

---

## File Structure

**New files**
- `packages/workflow/src/sourceGrounding.ts` — harness-side fetch + SSRF guard + SHA-256 verification (Phase 1).
- `packages/workflow/src/__tests__/sourceGrounding.test.ts` — grounding unit tests.
- `packages/workflow/src/researchSwarm.ts` — the multi-agent orchestrator (Phase 2).
- `packages/workflow/src/__tests__/researchSwarm.test.ts` — orchestrator unit tests.
- `packages/ledger/src/projections/researchRunQueueProjection.ts` — pending-request projection (Phase 3).
- `packages/ledger/src/projections/__tests__/researchRunQueueProjection.test.ts`.
- `apps/worker/src/__tests__/processResearchQueue.test.ts` — worker task test (Phase 3).

**Modified files**
- `packages/workflow/src/index.ts` — export the new modules.
- `packages/workflow/package.json` — add `./sourceGrounding` and `./researchSwarm` subpath exports (match existing export style).
- `packages/ledger/src/domainEventContracts.ts` — add `research_run_requested` + `research_run_claimed` event types.
- `apps/worker/src/runtime.ts` — add `process_research_queue` task kind + handler.
- `apps/web/src/lib/workflow.ts:131-175` — `createPersonalResearchCase` becomes enqueue + spawn (no in-process run).
- `apps/web/src/app/api/research/start/route.ts` — return `202` with `research_case_id`.
- `packages/providers/src/certificationRunner.ts` — make `source-grounded-research-task` assert grounded sources (Phase 4).

**Retired**
- `packages/workflow/src/claudeResearchWorkflow.ts` `runClaudeBuffettMungerResearch` is replaced by the swarm. Keep the file's schemas/helpers that the swarm reuses; delete the monolithic `buildRequest` (`budget.max_tool_calls:0`) path once Task 7 lands.

---

## Phase 1 — Harness-side grounding

### Task 1: SSRF guard for source URLs

**Files:**
- Create: `packages/workflow/src/sourceGrounding.ts`
- Test: `packages/workflow/src/__tests__/sourceGrounding.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/workflow/src/__tests__/sourceGrounding.test.ts
import { describe, expect, it } from 'vitest'
import { assertPublicHttpUrl } from '../sourceGrounding'

describe('assertPublicHttpUrl', () => {
  it('accepts public https urls', () => {
    expect(assertPublicHttpUrl('https://www.sec.gov/cgi-bin/browse-edgar').hostname).toBe('www.sec.gov')
  })

  it('rejects non-http protocols', () => {
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow(/protocol/i)
    expect(() => assertPublicHttpUrl('ftp://example.com')).toThrow(/protocol/i)
  })

  it('rejects localhost, loopback, link-local and private ranges', () => {
    for (const url of [
      'http://localhost/x',
      'http://127.0.0.1/x',
      'http://0.0.0.0/x',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.5/x',
      'http://192.168.1.1/x',
      'http://172.16.0.1/x',
    ]) {
      expect(() => assertPublicHttpUrl(url), url).toThrow(/not allowed|private|loopback/i)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run packages/workflow/src/__tests__/sourceGrounding.test.ts`
Expected: FAIL — `assertPublicHttpUrl` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/workflow/src/sourceGrounding.ts
const PRIVATE_V4 = [
  /^127\./, /^10\./, /^192\.168\./, /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./, /^0\./,
]

export function assertPublicHttpUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid source URL: ${rawUrl}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Source URL protocol not allowed: ${url.protocol}`)
  }
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) {
    throw new Error(`Source URL host not allowed (loopback): ${host}`)
  }
  if (PRIVATE_V4.some((re) => re.test(host))) {
    throw new Error(`Source URL host not allowed (private): ${host}`)
  }
  return url
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm exec vitest run packages/workflow/src/__tests__/sourceGrounding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow/src/sourceGrounding.ts packages/workflow/src/__tests__/sourceGrounding.test.ts
git commit -m "feat(workflow): add SSRF guard for source grounding URLs"
```

### Task 2: Fetch + hash a single proposed source (fail-closed)

**Files:**
- Modify: `packages/workflow/src/sourceGrounding.ts`
- Test: `packages/workflow/src/__tests__/sourceGrounding.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to sourceGrounding.test.ts
import { fetchAndCaptureSource, type ProposedSource } from '../sourceGrounding'

const proposed = (over: Partial<ProposedSource> = {}): ProposedSource => ({
  source_id: 'msft_10k', title: 'MSFT 10-K', url: 'https://www.sec.gov/msft-10k',
  excerpt: 'claimed excerpt', ...over,
})

function fakeFetch(body: string, status = 200): typeof fetch {
  return (async () => new Response(body, { status })) as unknown as typeof fetch
}

describe('fetchAndCaptureSource', () => {
  it('marks available with a sha256 hash when fetch succeeds', async () => {
    const out = await fetchAndCaptureSource(proposed(), { fetchImpl: fakeFetch('annual report body text') })
    expect(out.availability).toBe('available')
    expect(out.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(out.http_status).toBe(200)
  })

  it('marks unavailable (no hash) on non-2xx', async () => {
    const out = await fetchAndCaptureSource(proposed(), { fetchImpl: fakeFetch('not found', 404) })
    expect(out.availability).toBe('unavailable')
    expect(out.content_hash).toBeUndefined()
  })

  it('marks unavailable on network error instead of throwing', async () => {
    const throwing = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const out = await fetchAndCaptureSource(proposed(), { fetchImpl: throwing })
    expect(out.availability).toBe('unavailable')
  })

  it('marks unavailable for a disallowed (private) url without fetching', async () => {
    let called = false
    const spy = (async () => { called = true; return new Response('x') }) as unknown as typeof fetch
    const out = await fetchAndCaptureSource(proposed({ url: 'http://169.254.169.254/' }), { fetchImpl: spy })
    expect(out.availability).toBe('unavailable')
    expect(called).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run packages/workflow/src/__tests__/sourceGrounding.test.ts`
Expected: FAIL — `fetchAndCaptureSource` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to sourceGrounding.ts
import { createHash } from 'node:crypto'
import type { SourceLedgerAvailability } from './sourceLedger'

export type ProposedSource = {
  source_id: string
  title: string
  url: string
  excerpt: string
  citation_locator?: string
}

export type CapturedSource = {
  source_id: string
  title: string
  url: string
  excerpt: string
  content_hash?: string
  availability: SourceLedgerAvailability
  http_status?: number
  fetched_at: string
  citation_locator?: string
}

export type GroundingDeps = {
  fetchImpl?: typeof fetch
  now?: () => Date
  timeoutMs?: number
  maxExcerptChars?: number
  concurrency?: number
}

export async function fetchAndCaptureSource(
  source: ProposedSource,
  deps: GroundingDeps = {},
): Promise<CapturedSource> {
  const now = deps.now ?? (() => new Date())
  const fetchImpl = deps.fetchImpl ?? fetch
  const timeoutMs = deps.timeoutMs ?? 20_000
  const maxExcerpt = deps.maxExcerptChars ?? 600
  const base: CapturedSource = {
    source_id: source.source_id,
    title: source.title,
    url: source.url,
    excerpt: source.excerpt,
    availability: 'unavailable',
    fetched_at: now().toISOString(),
    ...(source.citation_locator === undefined ? {} : { citation_locator: source.citation_locator }),
  }
  try {
    assertPublicHttpUrl(source.url)
  } catch {
    return base
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(source.url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) {
      return { ...base, http_status: response.status }
    }
    const body = await response.text()
    const hash = createHash('sha256').update(body).digest('hex')
    return {
      ...base,
      availability: 'available',
      http_status: response.status,
      content_hash: `sha256:${hash}`,
      excerpt: body.replace(/\s+/g, ' ').trim().slice(0, maxExcerpt) || source.excerpt,
    }
  } catch {
    return base
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm exec vitest run packages/workflow/src/__tests__/sourceGrounding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow/src/sourceGrounding.ts packages/workflow/src/__tests__/sourceGrounding.test.ts
git commit -m "feat(workflow): fetch and sha256-verify a single proposed source, fail-closed"
```

### Task 3: Ground a list with concurrency + verified-id set

**Files:**
- Modify: `packages/workflow/src/sourceGrounding.ts`
- Test: `packages/workflow/src/__tests__/sourceGrounding.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to sourceGrounding.test.ts
import { groundProposedSources } from '../sourceGrounding'

describe('groundProposedSources', () => {
  it('returns verified ids only for fetched sources and captures all attempts', async () => {
    const fetchImpl = (async (input: string | URL) => {
      const u = String(input)
      return u.includes('good') ? new Response('real body') : new Response('x', { status: 500 })
    }) as unknown as typeof fetch
    const result = await groundProposedSources(
      [
        proposed({ source_id: 'a', url: 'https://example.com/good' }),
        proposed({ source_id: 'b', url: 'https://example.com/bad' }),
      ],
      { fetchImpl, concurrency: 2 },
    )
    expect(result.verified_ids).toEqual(['a'])
    expect(result.captured).toHaveLength(2)
    expect(result.captured.find((c) => c.source_id === 'b')?.availability).toBe('unavailable')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run packages/workflow/src/__tests__/sourceGrounding.test.ts`
Expected: FAIL — `groundProposedSources` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to sourceGrounding.ts
export type GroundingResult = {
  captured: CapturedSource[]
  verified_ids: string[]
}

export async function groundProposedSources(
  sources: ProposedSource[],
  deps: GroundingDeps = {},
): Promise<GroundingResult> {
  const concurrency = Math.max(1, deps.concurrency ?? 4)
  const captured: CapturedSource[] = new Array(sources.length)
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < sources.length) {
      const index = cursor++
      captured[index] = await fetchAndCaptureSource(sources[index], deps)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker))
  return {
    captured,
    verified_ids: captured.filter((c) => c.availability === 'available').map((c) => c.source_id),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm exec vitest run packages/workflow/src/__tests__/sourceGrounding.test.ts`
Expected: PASS (all grounding tests).

- [ ] **Step 5: Export and commit**

Add to `packages/workflow/src/index.ts`: `export * from './sourceGrounding'`. Add a `./sourceGrounding` entry to `packages/workflow/package.json` exports mirroring the existing `./sourceLedger` entry.

```bash
git add packages/workflow/src/sourceGrounding.ts packages/workflow/src/__tests__/sourceGrounding.test.ts packages/workflow/src/index.ts packages/workflow/package.json
git commit -m "feat(workflow): ground proposed sources with concurrency and verified-id set"
```

---

## Phase 2 — Swarm orchestrator

The orchestrator reuses these existing functions (do not reimplement): `createResearchCase`, `draftDecision` (from `./researchWorkflow`); `draftQuickScreen`, `queueDeepDive`, `startDeepDive`, `recordSpecialistFinding`, `draftDeepDiveSynthesis`, `completeDeepDive`, `buffettMungerDeepDiveLanes` (from `./strategyResearchPipeline`); `ingestManualSourceBundle` (from `./sourceLedger`); `groundProposedSources` (from `./sourceGrounding`). Their signatures are fixed by Phase 1 and the existing modules.

### Task 4: Agent schemas + a single grounded agent step

**Files:**
- Create: `packages/workflow/src/researchSwarm.ts`
- Test: `packages/workflow/src/__tests__/researchSwarm.test.ts`

- [ ] **Step 1: Write the failing test** (uses a fake `Provider.structured` and injected grounder)

```ts
// packages/workflow/src/__tests__/researchSwarm.test.ts
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { runGroundedAgent, ProposedSourcesSchema } from '../researchSwarm'

function fakeProvider(payload: unknown) {
  return {
    provider_id: 'fake',
    capabilities: {} as never,
    complete: vi.fn(),
    runWithTools: vi.fn(),
    structured: vi.fn(async () => payload),
  }
}

describe('runGroundedAgent', () => {
  it('returns analysis plus only verified source ids', async () => {
    const schema = z.object({ summary: z.string(), proposed_sources: ProposedSourcesSchema })
    const provider = fakeProvider({
      summary: 'hi',
      proposed_sources: [
        { source_id: 'ok', title: 'T', url: 'https://example.com/ok', excerpt: 'e' },
        { source_id: 'bad', title: 'T', url: 'https://example.com/bad', excerpt: 'e' },
      ],
    })
    const ground = vi.fn(async () => ({
      captured: [
        { source_id: 'ok', title: 'T', url: 'https://example.com/ok', excerpt: 'e', availability: 'available', fetched_at: 'x', content_hash: 'sha256:1' },
        { source_id: 'bad', title: 'T', url: 'https://example.com/bad', excerpt: 'e', availability: 'unavailable', fetched_at: 'x' },
      ],
      verified_ids: ['ok'],
    }))
    const out = await runGroundedAgent(provider as never, {
      run_id: 'r1', model_id: 'm', prompt: 'p', timeout_ms: 1000,
    }, schema, { ground })
    expect(out.analysis.summary).toBe('hi')
    expect(out.verified_ids).toEqual(['ok'])
    expect(out.captured).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run packages/workflow/src/__tests__/researchSwarm.test.ts`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/workflow/src/researchSwarm.ts
import { z, type ZodType } from 'zod'
import type { Provider } from '@owlfolio/providers'
import { groundProposedSources, type CapturedSource, type GroundingDeps } from './sourceGrounding'

export const ProposedSourceSchema = z.object({
  source_id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  excerpt: z.string().min(1),
  citation_locator: z.string().optional(),
})
export const ProposedSourcesSchema = z.array(ProposedSourceSchema).min(1)

type GroundFn = (sources: z.infer<typeof ProposedSourcesSchema>, deps?: GroundingDeps) => Promise<{
  captured: CapturedSource[]
  verified_ids: string[]
}>

export type GroundedAgentRequest = {
  run_id: string
  model_id: string
  prompt: string
  timeout_ms: number
}

export type GroundedAgentResult<T> = {
  analysis: T & { proposed_sources: z.infer<typeof ProposedSourcesSchema> }
  captured: CapturedSource[]
  verified_ids: string[]
}

export async function runGroundedAgent<T extends { proposed_sources: z.infer<typeof ProposedSourcesSchema> }>(
  provider: Provider,
  request: GroundedAgentRequest,
  schema: ZodType<T>,
  deps: { ground?: GroundFn; grounding?: GroundingDeps } = {},
): Promise<GroundedAgentResult<T>> {
  const ground = deps.ground ?? groundProposedSources
  const analysis = await provider.structured(
    {
      run_id: request.run_id,
      model_id: request.model_id,
      task_kind: 'structured-output',
      prompt: request.prompt,
      timeout_ms: request.timeout_ms,
      budget: { max_tool_calls: 0, max_tokens: 8_000 },
      tool_allowlist: [],
      response_format: { kind: 'json-schema', schema_name: 'GroundedAgent' },
    },
    schema,
  )
  const { captured, verified_ids } = await ground(analysis.proposed_sources, deps.grounding)
  return { analysis, captured, verified_ids }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm exec vitest run packages/workflow/src/__tests__/researchSwarm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow/src/researchSwarm.ts packages/workflow/src/__tests__/researchSwarm.test.ts
git commit -m "feat(workflow): grounded agent step (structured call + harness verification)"
```

### Task 5: Concurrent lane swarm with partial-failure tolerance

**Files:**
- Modify: `packages/workflow/src/researchSwarm.ts`
- Test: `packages/workflow/src/__tests__/researchSwarm.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to researchSwarm.test.ts
import { runLaneSwarm } from '../researchSwarm'

describe('runLaneSwarm', () => {
  it('runs every lane and marks a thrown lane incomplete instead of failing the swarm', async () => {
    const runLane = vi.fn(async (lane: string) => {
      if (lane === 'risks') throw new Error('lane boom')
      return { lane, finding_summary: `${lane} ok`, confidence: 'medium' as const, caveats: [], verified_ids: [lane] }
    })
    const results = await runLaneSwarm(['moat', 'risks', 'valuation'], runLane, { concurrency: 2 })
    expect(results).toHaveLength(3)
    expect(results.find((r) => r.lane === 'risks')?.status).toBe('incomplete')
    expect(results.find((r) => r.lane === 'moat')?.status).toBe('complete')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run packages/workflow/src/__tests__/researchSwarm.test.ts`
Expected: FAIL — `runLaneSwarm` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to researchSwarm.ts
export type LaneOutcome = {
  lane: string
  finding_summary: string
  confidence: 'low' | 'medium' | 'high'
  caveats: string[]
  verified_ids: string[]
}

export type LaneSwarmResult = LaneOutcome & { status: 'complete' | 'incomplete' }

export async function runLaneSwarm(
  lanes: readonly string[],
  runLane: (lane: string) => Promise<LaneOutcome>,
  opts: { concurrency?: number } = {},
): Promise<LaneSwarmResult[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 4)
  const results: LaneSwarmResult[] = new Array(lanes.length)
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < lanes.length) {
      const index = cursor++
      const lane = lanes[index]
      try {
        results[index] = { ...(await runLane(lane)), status: 'complete' }
      } catch (error) {
        results[index] = {
          lane,
          finding_summary: `${lane} lane did not complete: ${(error as Error).message}. Verify before any user decision.`,
          confidence: 'low',
          caveats: ['Lane incomplete — not investment-grade; re-run before relying on it.'],
          verified_ids: [],
          status: 'incomplete',
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, lanes.length) }, worker))
  return results
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm exec vitest run packages/workflow/src/__tests__/researchSwarm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workflow/src/researchSwarm.ts packages/workflow/src/__tests__/researchSwarm.test.ts
git commit -m "feat(workflow): concurrent lane swarm with partial-failure tolerance"
```

### Task 6: Full orchestrator `runStrategyResearchSwarm`

**Files:**
- Modify: `packages/workflow/src/researchSwarm.ts`
- Test: `packages/workflow/src/__tests__/researchSwarm.test.ts`

This wires the stages together over the existing pipeline functions. Per-stage lane prompts are derived from the strategy lanes. Sources are accumulated and the consolidated bundle is written once via `ingestManualSourceBundle` (URL kind, availability + content_hash from grounding) to avoid the per-call overwrite of the bundle file.

- [ ] **Step 1: Write the failing test** (uses `InMemoryEventStore` + `MockProvider` + injected grounder that verifies everything)

```ts
// append to researchSwarm.test.ts
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { MockProvider } from '@owlfolio/providers'
import { runStrategyResearchSwarm } from '../researchSwarm'

describe('runStrategyResearchSwarm', () => {
  it('drives quick screen, a per-lane swarm, synthesis and a grounded decision', async () => {
    const store = new InMemoryEventStore()
    const provider = new MockProvider()
    const ground = async (sources: { source_id: string }[]) => ({
      captured: sources.map((s) => ({
        source_id: s.source_id, title: 't', url: 'https://example.com/x', excerpt: 'e',
        availability: 'available' as const, fetched_at: 'x', content_hash: 'sha256:1',
      })),
      verified_ids: sources.map((s) => s.source_id),
    })
    const result = await runStrategyResearchSwarm(store, provider, {
      research_case_id: 'rc_test', company_id: 'company_test', ticker: 'TEST',
      strategy_id: 'buffett-munger', actor_id: 'user_local',
      idempotency_key: 'k', model_id: 'mock', decision_id: 'decision_test',
      source_ledger_path: '/tmp/owlfolio-swarm-test-sources',
    }, { ground, laneConcurrency: 3 })

    const events = await store.list()
    const types = events.map((e) => e.event_type)
    expect(types).toContain('research_case_created')
    expect(types).toContain('quick_screen_drafted')
    expect(types.filter((t) => t === 'specialist_finding_recorded').length).toBeGreaterThanOrEqual(7)
    expect(types).toContain('deep_dive_synthesis_drafted')
    expect(types).toContain('decision_drafted')
    expect(result.decision).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm exec vitest run packages/workflow/src/__tests__/researchSwarm.test.ts`
Expected: FAIL — `runStrategyResearchSwarm` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to researchSwarm.ts
import type { EventStore } from '@owlfolio/ledger/eventStore'
import type { LedgerEventEnvelope } from '@owlfolio/ledger/eventEnvelope'
import { createResearchCase, draftDecision } from './researchWorkflow'
import {
  buffettMungerDeepDiveLanes, draftQuickScreen, queueDeepDive, startDeepDive,
  recordSpecialistFinding, draftDeepDiveSynthesis, completeDeepDive,
} from './strategyResearchPipeline'
import { ingestManualSourceBundle } from './sourceLedger'

type SwarmStore = EventStore<LedgerEventEnvelope<unknown>>

export type RunStrategyResearchSwarmCommand = {
  research_case_id: string
  company_id: string
  ticker: string
  strategy_id: string
  strategy_version?: string
  actor_id: string
  idempotency_key: string
  model_id: string
  decision_id: string
  source_ledger_path: string
}

function seg(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

const QuickScreenAgentSchema = z.object({
  summary: z.string().min(1),
  business_quality: z.string().min(1),
  moat: z.string().min(1),
  management_capital_allocation: z.string().min(1),
  financial_quality: z.string().min(1),
  valuation_sanity: z.string().min(1),
  shariah_status: z.enum(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT', 'PENDING']),
  red_flags: z.array(z.string().min(1)).min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  caveats: z.array(z.string().min(1)).min(1),
  screening_result: z.enum(['pass', 'reject', 'needs_data', 'deep_dive_candidate']),
  proposed_sources: ProposedSourcesSchema,
})

const LaneAgentSchema = z.object({
  finding_summary: z.string().min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  caveats: z.array(z.string().min(1)).min(1),
  proposed_sources: ProposedSourcesSchema,
})

const DecisionAgentSchema = z.object({
  investment_verdict: z.enum(['BUY', 'WATCH', 'PASS', 'RESEARCH_MORE']),
  decision_reason: z.string().min(1),
  thesis_summary: z.string().min(1),
  evidence_summary: z.string().min(1),
  valuation_rationale: z.string().min(1),
  shariah_rationale: z.string().min(1),
  synthesis_summary: z.string().min(1),
  risks: z.array(z.string().min(1)).min(1),
  open_questions: z.array(z.string().min(1)).min(1),
  proposed_sources: ProposedSourcesSchema,
})

export async function runStrategyResearchSwarm(
  store: SwarmStore,
  provider: Provider,
  command: RunStrategyResearchSwarmCommand,
  deps: { ground?: GroundFn; grounding?: GroundingDeps; laneConcurrency?: number } = {},
) {
  const strategyRef = { strategy_id: command.strategy_id, strategy_version: command.strategy_version ?? 'draft' }
  const accumulated = new Map<string, CapturedSource>()
  const remember = (captured: CapturedSource[]) => captured.forEach((c) => accumulated.set(c.source_id, c))

  const researchCase = await createResearchCase(store, command as never)

  // Quick screen agent
  const qs = await runGroundedAgent(provider, {
    run_id: `run_${command.research_case_id}_quick_screen`, model_id: command.model_id,
    prompt: `You are the Buffett-Munger quick-screen agent for ${command.ticker} (${command.company_id}). `
      + `Assess business quality, moat, management/capital allocation, financial quality, Shariah/data availability, red flags, and a deep-dive recommendation. `
      + `Gather your own primary/secondary sources and return them in proposed_sources with real URLs.`,
    timeout_ms: 180_000,
  }, QuickScreenAgentSchema, deps)
  remember(qs.captured)
  const quickScreen = await draftQuickScreen(store, {
    research_case_id: command.research_case_id, quick_screen_id: `quick_${seg(command.research_case_id)}`,
    company_id: command.company_id, ticker: command.ticker, ...strategyRef,
    screening_result: qs.analysis.screening_result, summary: qs.analysis.summary,
    business_quality: qs.analysis.business_quality, moat: qs.analysis.moat,
    management_capital_allocation: qs.analysis.management_capital_allocation,
    financial_quality: qs.analysis.financial_quality, valuation_sanity: qs.analysis.valuation_sanity,
    shariah_status: qs.analysis.shariah_status, red_flags: qs.analysis.red_flags,
    confidence: qs.analysis.confidence, caveats: qs.analysis.caveats,
    source_ids: qs.verified_ids, actor_id: provider.provider_id,
    idempotency_key: `quick-screen:${command.research_case_id}:v1`,
  })

  const lanes = buffettMungerDeepDiveLanes
  const queued = await queueDeepDive(store, {
    research_case_id: command.research_case_id, queue_id: `queue_${seg(command.research_case_id)}`,
    ...strategyRef, source_ids: qs.verified_ids, causation_id: quickScreen.event_id,
    actor_id: 'research_workflow', idempotency_key: `deep-dive-queue:${command.research_case_id}:v1`,
  })
  const started = await startDeepDive(store, {
    research_case_id: command.research_case_id, deep_dive_id: `deep_${seg(command.research_case_id)}`,
    ...strategyRef, specialist_lanes: lanes, source_ids: qs.verified_ids, causation_id: queued.event_id,
    actor_id: 'research_workflow', idempotency_key: `deep-dive-start:${command.research_case_id}:v1`,
  })

  const laneResults = await runLaneSwarm(lanes, async (lane) => {
    const agent = await runGroundedAgent(provider, {
      run_id: `run_${command.research_case_id}_${seg(lane)}`, model_id: command.model_id,
      prompt: `You are the Buffett-Munger ${lane} specialist agent for ${command.ticker}. `
        + `Produce a source-backed finding for the ${lane} lane only. Gather your own sources; return them in proposed_sources with real URLs.`,
      timeout_ms: 180_000,
    }, LaneAgentSchema, deps)
    remember(agent.captured)
    return {
      lane, finding_summary: agent.analysis.finding_summary,
      confidence: agent.analysis.confidence, caveats: agent.analysis.caveats,
      verified_ids: agent.verified_ids,
    }
  }, { concurrency: deps.laneConcurrency ?? 4 })

  const findings = []
  for (const lane of laneResults) {
    findings.push(await recordSpecialistFinding(store, {
      research_case_id: command.research_case_id,
      finding_id: `finding_${seg(command.research_case_id)}_${seg(lane.lane)}`,
      deep_dive_id: started.deep_dive_id, ...strategyRef, specialist_lane: lane.lane,
      finding_summary: lane.finding_summary, confidence: lane.confidence,
      caveats: lane.status === 'incomplete' ? [...lane.caveats, 'status:incomplete'] : lane.caveats,
      source_ids: lane.verified_ids, causation_id: started.event_id, actor_id: provider.provider_id,
      idempotency_key: `specialist-finding:${command.research_case_id}:${lane.lane}:v1`,
    }))
  }

  // Decision/synthesis agent (also grounded)
  const dec = await runGroundedAgent(provider, {
    run_id: `run_${command.research_case_id}_synthesis`, model_id: command.model_id,
    prompt: `You are the Buffett-Munger synthesis+decision agent for ${command.ticker}. `
      + `Using the lane findings, produce a verdict, thesis, evidence, valuation rationale, Shariah rationale, risks, open questions, and a synthesis summary. `
      + `Cite sources in proposed_sources with real URLs.`,
    timeout_ms: 180_000,
  }, DecisionAgentSchema, deps)
  remember(dec.captured)
  const allVerified = [...new Set([...findings.flatMap((f) => f.payload.source_ids), ...dec.verified_ids, ...qs.verified_ids])]

  const synthesis = await draftDeepDiveSynthesis(store, {
    research_case_id: command.research_case_id, synthesis_id: `synthesis_${seg(command.research_case_id)}`,
    deep_dive_id: started.deep_dive_id, ...strategyRef, synthesis_summary: dec.analysis.synthesis_summary,
    confidence: 'medium', caveats: dec.analysis.open_questions, source_ids: allVerified,
    specialist_finding_ids: findings.map((f) => f.finding_id),
    causation_id: findings.at(-1)?.event_id ?? started.event_id, actor_id: 'research_workflow',
    idempotency_key: `deep-dive-synthesis:${command.research_case_id}:v1`,
  })
  const completed = await completeDeepDive(store, {
    research_case_id: command.research_case_id, completion_id: `complete_${seg(command.research_case_id)}`,
    deep_dive_id: started.deep_dive_id, ...strategyRef, synthesis_id: synthesis.synthesis_id,
    confidence: 'medium', caveats: dec.analysis.open_questions, source_ids: allVerified,
    causation_id: synthesis.event_id, actor_id: 'research_workflow',
    idempotency_key: `deep-dive-complete:${command.research_case_id}:v1`,
  })
  const decision = await draftDecision(store, {
    research_case_id: command.research_case_id, decision_id: command.decision_id,
    decision: dec.analysis.investment_verdict, reason: dec.analysis.decision_reason,
    thesis_summary: dec.analysis.thesis_summary, evidence_summary: dec.analysis.evidence_summary,
    valuation_rationale: dec.analysis.valuation_rationale, shariah_rationale: dec.analysis.shariah_rationale,
    risks: dec.analysis.risks, open_questions: dec.analysis.open_questions,
    causation_id: completed.event_id, source_ids: allVerified,
    idempotency_key: `decision:${command.research_case_id}:v1`,
  } as never)

  // Persist ONE consolidated grounded bundle (provenance + availability + hash)
  const captured = [...accumulated.values()]
  if (captured.length > 0) {
    await ingestManualSourceBundle({
      source_ledger_path: command.source_ledger_path, research_case_id: command.research_case_id,
      ticker: command.ticker, strategy_id: command.strategy_id, provider_id: provider.provider_id,
      proposed_by_actor_type: 'provider', proposed_by_actor_id: provider.provider_id,
      ingested_by_actor_type: 'system', ingested_by_actor_id: 'research_workflow',
      sources: captured.map((c) => ({
        source_id: c.source_id, kind: 'url', title: c.title, url: c.url, excerpt: c.excerpt,
        availability: c.availability,
        ...(c.content_hash === undefined ? {} : { content_hash: c.content_hash }),
        metadata: { research_case_id: command.research_case_id, http_status: c.http_status ?? null },
      })),
    })
  }

  return { research_case: researchCase, quick_screen: quickScreen, deep_dive: { queued, started, findings, synthesis, completed }, decision }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm exec vitest run packages/workflow/src/__tests__/researchSwarm.test.ts`
Expected: PASS. If `createResearchCase`/`draftDecision` command typing rejects the `as never` casts, replace them with the exact field shapes from `claudeResearchWorkflow.ts:245` and `:419-435` (same call sites this orchestrator mirrors).

- [ ] **Step 5: Add export + commit**

Add `export * from './researchSwarm'` to `packages/workflow/src/index.ts` and a `./researchSwarm` export entry in `packages/workflow/package.json`.

```bash
git add packages/workflow/src/researchSwarm.ts packages/workflow/src/__tests__/researchSwarm.test.ts packages/workflow/src/index.ts packages/workflow/package.json
git commit -m "feat(workflow): multi-agent grounded research swarm orchestrator"
```

### Task 7: Add a grounding-enforcement test, then retire the monolith

**Files:**
- Modify: `packages/workflow/src/__tests__/researchSwarm.test.ts`
- Modify: `packages/workflow/src/claudeResearchWorkflow.ts`
- Modify: `apps/web/src/lib/workflow.ts`

- [ ] **Step 1: Write the failing test (grounding invariant)**

```ts
// append to researchSwarm.test.ts
it('drops unverified citations so findings only carry grounded source ids', async () => {
  const store = new InMemoryEventStore()
  const provider = new MockProvider()
  const ground = async (sources: { source_id: string }[]) => ({
    captured: sources.map((s, i) => ({
      source_id: s.source_id, title: 't', url: 'https://example.com/x', excerpt: 'e',
      availability: (i === 0 ? 'available' : 'unavailable') as 'available' | 'unavailable',
      fetched_at: 'x', ...(i === 0 ? { content_hash: 'sha256:1' } : {}),
    })),
    verified_ids: sources.length > 0 ? [sources[0].source_id] : [],
  })
  await runStrategyResearchSwarm(store, provider, {
    research_case_id: 'rc_g', company_id: 'c', ticker: 'G', strategy_id: 'buffett-munger',
    actor_id: 'user_local', idempotency_key: 'k', model_id: 'mock', decision_id: 'd_g',
    source_ledger_path: '/tmp/owlfolio-swarm-grounding',
  }, { ground })
  const findings = (await store.list()).filter((e) => e.event_type === 'specialist_finding_recorded')
  for (const f of findings) {
    expect((f.source_ids ?? []).length).toBeLessThanOrEqual(1)
  }
})
```

- [ ] **Step 2: Run to verify it passes (behavior already implemented in Task 6)**

Run: `corepack pnpm exec vitest run packages/workflow/src/__tests__/researchSwarm.test.ts`
Expected: PASS — confirms only verified ids are attached.

- [ ] **Step 3: Repoint the web workflow to the swarm**

In `apps/web/src/lib/workflow.ts`, change `createPersonalResearchCase` (currently calls `runClaudeBuffettMungerResearch` at line 157) to call `runStrategyResearchSwarm` with the same command fields it already builds (`research_case_id`, `company_id`, `ticker`, `strategy_id`, `actor_id: 'user_local'`, `model_id: resolveModelIdForProvider(state.config)`, `decision_id`, `source_ledger_path`, `idempotency_key`). (This call site is replaced entirely in Phase 3 — this step only keeps the app compiling against the new function.)

- [ ] **Step 4: Delete the monolithic path**

Remove `runClaudeBuffettMungerResearch` and its `buildRequest` (`budget.max_tool_calls:0`) from `claudeResearchWorkflow.ts`. Keep any helper still imported elsewhere; run `corepack pnpm typecheck` and resolve unused-import errors.

- [ ] **Step 5: Run gate + commit**

Run: `corepack pnpm typecheck && corepack pnpm exec vitest run packages/workflow`
Expected: PASS.

```bash
git add packages/workflow/src apps/web/src/lib/workflow.ts
git commit -m "refactor(workflow): replace monolithic research with grounded swarm; retire single-call path"
```

---

## Phase 3 — Worker execution, web-triggered

### Task 8: Add research-queue event types

**Files:**
- Modify: `packages/ledger/src/domainEventContracts.ts`
- Test: `packages/ledger/src/__tests__/domainEventContracts.test.ts` (existing; extend)

- [ ] **Step 1: Write the failing test**

```ts
// add to the existing domainEventContracts test
import { domainEventTypes } from '../domainEventContracts'
it('includes research run queue event types', () => {
  expect(domainEventTypes).toContain('research_run_requested')
  expect(domainEventTypes).toContain('research_run_claimed')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm exec vitest run packages/ledger/src/__tests__/domainEventContracts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the event types**

Add `'research_run_requested'` and `'research_run_claimed'` to the `domainEventTypes` constant and (matching the existing pattern in the file) register them under the `research_case` aggregate with their payload field contracts: `research_run_requested` → `{ research_case_id, ticker, company_id, strategy_id, model_id, requested_by, decision_id }`; `research_run_claimed` → `{ research_case_id, run_id, claimed_at, worker_id }`.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm exec vitest run packages/ledger/src/__tests__/domainEventContracts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ledger/src/domainEventContracts.ts packages/ledger/src/__tests__/domainEventContracts.test.ts
git commit -m "feat(ledger): add research_run_requested/claimed event types"
```

### Task 9: Pending-research-queue projection

**Files:**
- Create: `packages/ledger/src/projections/researchRunQueueProjection.ts`
- Test: `packages/ledger/src/projections/__tests__/researchRunQueueProjection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { projectPendingResearchRuns } from '../researchRunQueueProjection'
import type { LedgerEventEnvelope } from '../../eventEnvelope'

const evt = (over: Partial<LedgerEventEnvelope<Record<string, unknown>>>): LedgerEventEnvelope<Record<string, unknown>> => ({
  event_id: 'e', event_type: 'research_run_requested', aggregate_type: 'research_case',
  aggregate_id: 'rc1', actor_type: 'user', payload: { research_case_id: 'rc1', ticker: 'T' },
  source_ids: [], created_at: '2026-06-08T00:00:00Z', schema_version: 1, ...over,
}) as LedgerEventEnvelope<Record<string, unknown>>

describe('projectPendingResearchRuns', () => {
  it('returns requested runs that have not been claimed', () => {
    const pending = projectPendingResearchRuns([evt({})])
    expect(pending.map((p) => p.research_case_id)).toEqual(['rc1'])
  })
  it('excludes runs already claimed', () => {
    const pending = projectPendingResearchRuns([
      evt({ event_id: 'e1' }),
      evt({ event_id: 'e2', event_type: 'research_run_claimed', payload: { research_case_id: 'rc1', run_id: 'r' } }),
    ])
    expect(pending).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm exec vitest run packages/ledger/src/projections/__tests__/researchRunQueueProjection.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the projection**

```ts
// packages/ledger/src/projections/researchRunQueueProjection.ts
import type { LedgerEventEnvelope } from '../eventEnvelope'

export type PendingResearchRun = {
  research_case_id: string
  ticker: string
  company_id?: string
  strategy_id?: string
  model_id?: string
  decision_id?: string
  requested_event_id: string
}

export function projectPendingResearchRuns(
  events: LedgerEventEnvelope<Record<string, unknown>>[],
): PendingResearchRun[] {
  const claimed = new Set<string>()
  for (const e of events) {
    if (e.event_type === 'research_run_claimed') {
      claimed.add(String((e.payload as Record<string, unknown>).research_case_id ?? e.aggregate_id))
    }
  }
  const pending: PendingResearchRun[] = []
  for (const e of events) {
    if (e.event_type !== 'research_run_requested') continue
    const p = e.payload as Record<string, unknown>
    const id = String(p.research_case_id ?? e.aggregate_id)
    if (claimed.has(id)) continue
    pending.push({
      research_case_id: id,
      ticker: String(p.ticker ?? ''),
      company_id: p.company_id === undefined ? undefined : String(p.company_id),
      strategy_id: p.strategy_id === undefined ? undefined : String(p.strategy_id),
      model_id: p.model_id === undefined ? undefined : String(p.model_id),
      decision_id: p.decision_id === undefined ? undefined : String(p.decision_id),
      requested_event_id: e.event_id,
    })
  }
  return pending
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm exec vitest run packages/ledger/src/projections/__tests__/researchRunQueueProjection.test.ts`
Expected: PASS.

- [ ] **Step 5: Export + commit**

Add the projection to `packages/ledger`'s projection exports (match how `accountingProjection` is exported in `package.json` + index).

```bash
git add packages/ledger/src/projections/researchRunQueueProjection.ts packages/ledger/src/projections/__tests__/researchRunQueueProjection.test.ts packages/ledger/src/index.ts packages/ledger/package.json
git commit -m "feat(ledger): pending research-run queue projection"
```

### Task 10: Worker `process_research_queue` task

**Files:**
- Modify: `apps/worker/src/runtime.ts`
- Test: `apps/worker/src/__tests__/processResearchQueue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { InMemoryEventStore } from '@owlfolio/ledger/eventStore'
import { MockProvider } from '@owlfolio/providers'
import { runProcessResearchQueueTask } from '../runtime'

describe('runProcessResearchQueueTask', () => {
  it('claims a pending request and runs the swarm to a decision', async () => {
    const store = new InMemoryEventStore()
    await store.append({
      event_id: 'evt_req_rc1', event_type: 'research_run_requested', aggregate_type: 'research_case',
      aggregate_id: 'rc1', actor_type: 'user', actor_id: 'user_local',
      payload: { research_case_id: 'rc1', ticker: 'TEST', company_id: 'company_test', strategy_id: 'buffett-munger', model_id: 'mock', decision_id: 'd1' },
      source_ids: [], created_at: '2026-06-08T00:00:00Z', schema_version: 1,
    } as never)

    const result = await runProcessResearchQueueTask(store, {
      provider: new MockProvider(),
      source_ledger_path: '/tmp/owlfolio-worker-research',
      ground: async (s: { source_id: string }[]) => ({
        captured: s.map((x) => ({ source_id: x.source_id, title: 't', url: 'https://example.com/x', excerpt: 'e', availability: 'available' as const, fetched_at: 'x', content_hash: 'sha256:1' })),
        verified_ids: s.map((x) => x.source_id),
      }),
    })

    const types = (await store.list()).map((e) => e.event_type)
    expect(types).toContain('research_run_claimed')
    expect(types).toContain('decision_drafted')
    expect(result.processed).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm exec vitest run apps/worker/src/__tests__/processResearchQueue.test.ts`
Expected: FAIL — `runProcessResearchQueueTask` not exported.

- [ ] **Step 3: Implement the handler in `runtime.ts`**

```ts
// add to apps/worker/src/runtime.ts
import { projectPendingResearchRuns } from '@owlfolio/ledger/researchRunQueueProjection'
import { runStrategyResearchSwarm } from '@owlfolio/workflow'

export async function runProcessResearchQueueTask(
  store: ResearchEventStore, // the same EventStore type runtime.ts already uses
  options: {
    provider: Provider
    source_ledger_path: string
    ground?: Parameters<typeof runStrategyResearchSwarm>[3] extends infer D ? (D extends { ground?: infer G } ? G : never) : never
    now?: () => Date
  },
): Promise<{ processed: number; summaries: string[] }> {
  const now = options.now ?? (() => new Date())
  const pending = projectPendingResearchRuns(await store.list() as never)
  const summaries: string[] = []
  for (const run of pending) {
    await store.append({
      event_id: `evt_research_run_claimed_${run.research_case_id}`,
      event_type: 'research_run_claimed', aggregate_type: 'research_case', aggregate_id: run.research_case_id,
      causation_id: run.requested_event_id, correlation_id: run.research_case_id,
      actor_type: 'worker', actor_id: 'owlfolio-worker',
      payload: { research_case_id: run.research_case_id, run_id: `run_${run.research_case_id}`, claimed_at: now().toISOString(), worker_id: 'owlfolio-worker' },
      source_ids: [], created_at: now().toISOString(), schema_version: 1,
      idempotency_key: `research-run-claim:${run.research_case_id}:v1`,
    } as never)
    await runStrategyResearchSwarm(store, options.provider, {
      research_case_id: run.research_case_id, company_id: run.company_id ?? `company_${run.ticker.toLowerCase()}`,
      ticker: run.ticker, strategy_id: run.strategy_id ?? 'buffett-munger', actor_id: 'user_local',
      idempotency_key: `swarm:${run.research_case_id}:v1`, model_id: run.model_id ?? 'mock',
      decision_id: run.decision_id ?? `decision_${run.research_case_id}`, source_ledger_path: options.source_ledger_path,
    }, options.ground === undefined ? {} : { ground: options.ground })
    summaries.push(`Processed research run ${run.research_case_id}`)
  }
  return { processed: pending.length, summaries }
}
```

Then register a `process_research_queue` case in `runTaskHandler` (the dispatch at `runtime.ts:960`) that calls `runProcessResearchQueueTask` with the resolved provider, ledger-derived `source_ledger_path`, and no `ground` override (defaults to the real fetcher). This task is **not** subject to the dry-run skip (it authors drafts only); gate it explicitly so the existing dry-run filter does not skip it.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm exec vitest run apps/worker/src/__tests__/processResearchQueue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/runtime.ts apps/worker/src/__tests__/processResearchQueue.test.ts
git commit -m "feat(worker): process_research_queue task runs the grounded swarm"
```

### Task 11: Web route enqueues + spawns worker, returns 202

**Files:**
- Modify: `apps/web/src/lib/workflow.ts` (`createPersonalResearchCase`)
- Modify: `apps/web/src/app/api/research/start/route.ts`
- Test: `apps/web/src/lib/__tests__/workflow.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/web/src/lib/__tests__/workflow.test.ts
it('enqueueResearchRun appends research_run_requested and returns the case id', async () => {
  // Arrange an initialized personal-local OnboardingState with a temp ledger path (follow existing test setup helpers in this file)
  const { research_case_id } = await enqueueResearchRun(state, { ticker: 'MSFT' }, { spawn: () => {} })
  const events = await new SQLiteEventStore(state.config.ledger_path).list()
  expect(events.some((e) => e.event_type === 'research_run_requested')).toBe(true)
  expect(research_case_id).toMatch(/^rc_msft_/)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm exec vitest run apps/web/src/lib/__tests__/workflow.test.ts`
Expected: FAIL — `enqueueResearchRun` not exported.

- [ ] **Step 3: Implement enqueue + spawn**

Replace the body of `createPersonalResearchCase` (`apps/web/src/lib/workflow.ts:131`) with an `enqueueResearchRun(state, input, deps?)` that: validates personal-local init (as today), derives `research_case_id`/`decision_id` (same `rc_${ticker}_${Date.now()}` pattern), opens the `SQLiteEventStore`, appends a `research_run_requested` event (payload: `research_case_id, ticker, company_id, strategy_id: state.config.strategy_id, model_id: resolveModelIdForProvider(state.config), requested_by: 'user_local', decision_id`), closes the store, then calls `deps.spawn ?? defaultSpawnWorker` which runs:

```ts
import { spawn } from 'node:child_process'
function defaultSpawnWorker(ledgerPath: string): void {
  const child = spawn('corepack', ['pnpm', '--filter', '@owlfolio/worker', 'dev', '--', '--once', '--task-kind', 'process_research_queue'], {
    cwd: process.env.OWLFOLIO_PROJECT_DIR ?? process.cwd(),
    env: { ...process.env, OWLFOLIO_LEDGER_PATH: ledgerPath },
    detached: true, stdio: 'ignore',
  })
  child.unref()
}
```

Return `{ research_case_id }`.

- [ ] **Step 4: Update the route to 202**

In `apps/web/src/app/api/research/start/route.ts`, keep the readiness gate, call `enqueueResearchRun(state, parsed)` instead of `createPersonalResearchCase`, and return `NextResponse.json({ research_case_id }, { status: 202 })`.

- [ ] **Step 5: Run gate + commit**

Run: `corepack pnpm exec vitest run apps/web/src/lib/__tests__/workflow.test.ts && corepack pnpm typecheck`
Expected: PASS.

```bash
git add apps/web/src/lib/workflow.ts apps/web/src/app/api/research/start/route.ts apps/web/src/lib/__tests__/workflow.test.ts
git commit -m "feat(web): research start enqueues a run and spawns the worker (202)"
```

---

## Phase 4 — Trust contract + certification

### Task 12: Source-grounded scenario asserts harness-verified sources

**Files:**
- Modify: `packages/providers/src/certificationRunner.ts`
- Test: `packages/providers/src/__tests__/certificationRunner.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
// add to certificationRunner.test.ts
it('source-grounded scenario fails when a cited source has no verified content hash', async () => {
  // Build a provider stub whose structured output cites a source with no fetchable content,
  // run only the 'source-grounded-research-task' scenario, and assert the case status is 'failed'
  const report = await runProviderCertification(stubProviderWithUngroundedCitation(), {
    scenario_ids: ['source-grounded-research-task'],
  })
  const sourceCase = report.cases.find((c) => c.scenario_id === 'source-grounded-research-task')
  expect(sourceCase?.status).toBe('failed')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm exec vitest run packages/providers/src/__tests__/certificationRunner.test.ts`
Expected: FAIL — the scenario currently passes on model-asserted citations.

- [ ] **Step 3: Implement the grounding assertion**

In the `source-grounded-research-task` scenario, after obtaining the structured result, run each cited source through `groundProposedSources` (import from `@owlfolio/workflow`) using the runner's injectable fetch (default real fetch; tests inject a stub). Mark the case `failed` unless every cited `source_id` appears in `verified_ids` with a `content_hash`. Record the verified/dropped counts in the case detail.

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm exec vitest run packages/providers/src/__tests__/certificationRunner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/certificationRunner.ts packages/providers/src/__tests__/certificationRunner.test.ts
git commit -m "feat(providers): source-grounded certification asserts harness-verified sources"
```

### Task 13: Re-certify Codex + update docs

**Files:**
- Modify (generated): `data/provider-certifications/openai.latest.json`
- Modify: `docs/architecture/owlfolio-v2-provider-model-support.md`

- [ ] **Step 1: Run the full gate**

Run:
```bash
corepack pnpm typecheck && corepack pnpm test && corepack pnpm lint
NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build
```
Expected: all PASS; only the documented NFT/import-trace warning.

- [ ] **Step 2: Re-run certification**

Run: `corepack pnpm certify:providers`
Then read `data/provider-certifications/openai.latest.json` and confirm the `source-grounded-research-task` case status and the overall support level reflect the grounded behavior.

- [ ] **Step 3: Update the support matrix**

Edit `docs/architecture/owlfolio-v2-provider-model-support.md` to describe the grounded source requirement and the swarm execution model, and the Codex result from Step 2. Do not claim a support level the latest report does not show.

- [ ] **Step 4: Commit**

```bash
git add data/provider-certifications/openai.latest.json docs/architecture/owlfolio-v2-provider-model-support.md
git commit -m "chore(providers): re-certify Codex against grounded research-trust contract"
```

---

## Self-Review

**Spec coverage**
- Multi-agent swarm → Tasks 4-6 (grounded agent, lane swarm, orchestrator). ✓
- Harness-side grounding / invariant → Tasks 1-3 + Task 7 grounding test. ✓
- Worker-driven, web-triggered → Tasks 8-11. ✓
- Trust contract + re-certify → Tasks 12-13. ✓
- Strategy-driven lanes → Task 6 (lanes from `buffettMungerDeepDiveLanes`; per-lane prompts). ✓
- Public-sources-only fetch posture → Task 1 SSRF guard + Task 2 fail-closed. ✓
- Observability hook for workstream F (per-lane status) → Task 5/6 emit `status:incomplete` caveat; richer event detail is workstream F's spec. ✓
- Accounting/purification untouched (deterministic) → no tasks modify those projections, by design. ✓

**Placeholder scan:** No `TODO`/`TBD`. Two integration call sites (`createResearchCase`, `draftDecision`) use `as never` with an explicit fallback instruction (Task 6 Step 4) pointing at the exact existing call shapes — acceptable because those signatures are owned by existing modules, not this plan.

**Type consistency:** `ProposedSource`/`CapturedSource`/`GroundingResult` defined in Tasks 1-3 are reused unchanged in Tasks 4-6, 10, 12. `runStrategyResearchSwarm` command shape in Task 6 matches the worker caller in Task 10 and the enqueue payload in Task 11.

## Notes for the executor

- Each task is independently committable and leaves the suite green.
- Phases 1-2 produce a tested swarm with zero web/worker changes; Phase 3 flips execution to worker+web; Phase 4 hardens certification.
- Do not commit runtime artifacts under `data/` except the intentionally-updated `*.latest.json` in Task 13.
- Do not push; do not mutate the Kanban board (project-agent owns it).
