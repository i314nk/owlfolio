# Discovery (on-demand) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dedicated `/discovery` page that runs the 13F discovery harvest on demand (async worker spawn) and lets the user triage candidates — accept for screening, promote to a research case, or reject.

**Architecture:** A web route spawns the existing `discovery_13f` worker task (mirroring the research-run spawn, with the opt-in env flag set). Three thin routes wire the existing `discoveryCandidateWorkflow` accept/reject/promote functions. A `/discovery` page reads `projectDiscoveryCandidates` (triage inbox, grouped by status) + `projectScheduledTasks` (run-bar status). `/pipeline` is untouched.

**Tech Stack:** TypeScript, pnpm workspace, vitest, Next.js App Router, SQLite event store, React `createElement`.

**Run from the worktree root:** `/home/hermes_agent/code/owlfolio/.worktrees/discovery`
Test form: `NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm exec vitest run <path>`

---

## File Structure

- **Modify** `apps/web/src/lib/workflow.ts` — add `defaultSpawnDiscoveryWorker`, `enqueueDiscoveryRun`, a private `personalLocalStore` helper, and `acceptDiscoveryCandidate` / `rejectDiscoveryCandidate` / `promoteDiscoveryCandidate` web wrappers.
- **Create** `apps/web/src/app/api/discovery/run/route.ts` (+ `.test.ts`)
- **Create** `apps/web/src/app/api/discovery/candidates/[id]/accept/route.ts` (+ `.test.ts`)
- **Create** `apps/web/src/app/api/discovery/candidates/[id]/reject/route.ts`
- **Create** `apps/web/src/app/api/discovery/candidates/[id]/promote/route.ts`
- **Create** `apps/web/src/app/discovery/page.tsx`
- **Create** `apps/web/src/components/DiscoveryPanel.tsx`
- **Create** `apps/web/src/components/RunDiscoveryButton.tsx` (+ `.test.tsx`)
- **Create** `apps/web/src/components/DiscoveryCandidateActions.tsx` (+ `.test.tsx`)

**Key facts (verified):**
- `discoveryCandidateWorkflow` fns take `store: EventStore<LedgerEventEnvelope<unknown>>` (pass a `SQLiteEventStore`). Guards: `queueDiscoveryCandidateForQuickScreen` requires status `discovered`; `rejectDiscoveryCandidate` requires `discovered`|`queued_for_quick_screen`; `promoteDiscoveryCandidateToResearchCase` requires `queued_for_quick_screen` and creates the research case internally (caller supplies `research_case_id`).
- Candidate statuses: `discovered | duplicate | queued_for_quick_screen | rejected | promoted_to_research_case`.
- `projectScheduledTasks(events)` → find `t.task_kind === 'discovery_13f'`; `last_run_status: 'never_run'|'running'|'completed'|'failed'`, `last_result_summary`, `last_started_at`.
- The worker task `discovery_13f` is selected by `--task-kind discovery_13f` and `enabled` only when `OWLFOLIO_DISCOVERY_13F_ENABLED === '1'`.

---

## Task 1: Run lib — `enqueueDiscoveryRun` + `defaultSpawnDiscoveryWorker`

**Files:** Modify `apps/web/src/lib/workflow.ts`; Test `apps/web/src/lib/__tests__/enqueueDiscoveryRun.test.ts`.

- [ ] **Step 1: Failing test**
```ts
import { describe, expect, it, vi } from 'vitest'
import { enqueueDiscoveryRun } from '../workflow'
import { defaultUnconfiguredAppConfig, defaultPersonalLocalAppConfig } from '@owlfolio/shared'

const initState = { is_initialized: true, config: { ...defaultPersonalLocalAppConfig(), ledger_path: '/tmp/x.sqlite', source_ledger_path: '/tmp/src' } } as never

describe('enqueueDiscoveryRun', () => {
  it('spawns the discovery worker and returns started', async () => {
    const spawn = vi.fn()
    const res = await enqueueDiscoveryRun(initState, { spawn })
    expect(res).toEqual({ started: true })
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0]![0]).toMatchObject({ ledgerPath: '/tmp/x.sqlite', sourceLedgerPath: '/tmp/src' })
  })
  it('throws when not personal-local initialized', async () => {
    const state = { is_initialized: false, config: defaultUnconfiguredAppConfig() } as never
    await expect(enqueueDiscoveryRun(state, { spawn: vi.fn() })).rejects.toThrow('Personal-local workflow is not initialized')
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`enqueueDiscoveryRun` not exported).

- [ ] **Step 3: Implement** in `apps/web/src/lib/workflow.ts` (near `defaultSpawnWorker`/`enqueueResearchRun`). `spawn` is already imported from `node:child_process`; `SpawnWorkerPaths`, `resolveAppConfigPath`, `resolveProviderCertificationReportDir`, `OnboardingState` already in scope.
```ts
function defaultSpawnDiscoveryWorker({ ledgerPath, sourceLedgerPath, appConfigPath, providerCertificationDir }: SpawnWorkerPaths): void {
  const child = spawn('corepack', ['pnpm', '--filter', '@owlfolio/worker', 'dev', '--', '--once', '--task-kind', 'discovery_13f'], {
    cwd: process.env.OWLFOLIO_PROJECT_DIR ?? process.cwd(),
    env: {
      ...process.env,
      OWLFOLIO_LEDGER_PATH: ledgerPath,
      OWLFOLIO_SOURCE_LEDGER_PATH: sourceLedgerPath,
      OWLFOLIO_PROJECT_DIR: process.env.OWLFOLIO_PROJECT_DIR ?? process.cwd(),
      OWLFOLIO_APP_CONFIG_PATH: appConfigPath,
      OWLFOLIO_DISCOVERY_13F_ENABLED: '1',
      ...(providerCertificationDir === undefined ? {} : { OWLFOLIO_PROVIDER_CERTIFICATION_DIR: providerCertificationDir }),
    },
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

export type EnqueueDiscoveryRunDeps = { spawn?: (paths: SpawnWorkerPaths) => void }

export async function enqueueDiscoveryRun(state: OnboardingState, deps: EnqueueDiscoveryRunDeps = {}): Promise<{ started: true }> {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined || state.config.source_ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }
  ;(deps.spawn ?? defaultSpawnDiscoveryWorker)({
    ledgerPath: state.config.ledger_path,
    sourceLedgerPath: state.config.source_ledger_path,
    appConfigPath: resolveAppConfigPath(),
    providerCertificationDir: resolveProviderCertificationReportDir(),
  })
  return { started: true }
}
```
(No request event is appended — the worker task runs `runDiscovery13f` directly and emits its own `scheduled_task_run_*` events. This differs from `enqueueResearchRun`, which needs a queue event.)

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(web): enqueueDiscoveryRun spawns discovery_13f worker`

---

## Task 2: `POST /api/discovery/run`

**Files:** Create `apps/web/src/app/api/discovery/run/route.ts` + `.test.ts`.

- [ ] **Step 1: Failing test** (mirror `api/prices/refresh/route.test.ts` harness — temp dir + app-config + env). Inject `deps.spawn`:
```ts
// setup: tempDir + appConfigPath + ledgerPath; process.env.OWLFOLIO_APP_CONFIG_PATH/OWLFOLIO_PROJECT_DIR set;
// write app-config: { ...defaultPersonalLocalAppConfig(), ledger_path, source_ledger_path: join(tempDir,'src'), initialized_at:'2026-01-01T00:00:00.000Z' }
import { POST } from './route'
it('spawns discovery and returns 202', async () => {
  const spawn = vi.fn()
  const res = await POST(new Request('http://localhost/api/discovery/run', { method: 'POST' }), { spawn } as never)
  expect(res.status).toBe(202)
  expect(await res.json()).toEqual({ started: true })
  expect(spawn).toHaveBeenCalledTimes(1)
})
it('returns 409 when unconfigured', async () => {
  process.env.OWLFOLIO_APP_CONFIG_PATH = join(tempDir, 'missing.json')
  const res = await POST(new Request('http://localhost/api/discovery/run', { method: 'POST' }), { spawn: vi.fn() } as never)
  expect(res.status).toBe(409)
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `route.ts`:
```ts
import { NextResponse } from 'next/server'
import { getOnboardingState } from '../../../../lib/onboarding'
import { enqueueDiscoveryRun, type EnqueueDiscoveryRunDeps } from '../../../../lib/workflow'

export async function POST(_request: Request, deps: EnqueueDiscoveryRunDeps = {}) {
  const state = await getOnboardingState()
  try {
    const result = await enqueueDiscoveryRun(state, deps)
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'discovery run failed'
    const status = message.startsWith('Personal-local workflow is not initialized') ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
```
(Verify relative depth `../../../../lib/...`: `app/api/discovery/run` → up 4 to `src`.)

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(web): POST /api/discovery/run`

---

## Task 3: Triage lib wrappers (accept / reject / promote)

**Files:** Modify `apps/web/src/lib/workflow.ts`; Test `apps/web/src/lib/__tests__/discoveryTriage.test.ts`.

Imports to add at top of workflow.ts (alias the workflow reject to avoid a name clash with the new web wrapper):
```ts
import {
  queueDiscoveryCandidateForQuickScreen,
  rejectDiscoveryCandidate as rejectDiscoveryCandidateEvent,
  promoteDiscoveryCandidateToResearchCase,
  discoverCandidate,
} from '@owlfolio/workflow/discoveryCandidateWorkflow'
```
(`projectDiscoveryCandidates` is already imported at workflow.ts:9. `SQLiteEventStore` already imported.)

- [ ] **Step 1: Failing test** — seed a `discovered` candidate with the workflow's own `discoverCandidate` (READ its `DiscoverCandidateCommand` shape at discoveryCandidateWorkflow.ts:57 and build a minimal valid command: candidate_id, ticker, company_name, market, strategy_id, discovery_source, dedupe_key, actor_id, causation_id, plus signal metadata). Then:
```ts
// helper: seed(store) → discoverCandidate(store, {...}) returning candidate_id
it('accept moves discovered → queued_for_quick_screen', async () => {
  /* seed, then */ await acceptDiscoveryCandidate(state, candidateId)
  const c = projectDiscoveryCandidates(await listStore()).find(x => x.candidate_id === candidateId)
  expect(c?.status).toBe('queued_for_quick_screen')
})
it('reject moves discovered → rejected', async () => {
  await rejectDiscoveryCandidate(state, candidateId, 'not a fit')
  expect(status(candidateId)).toBe('rejected')
})
it('promote requires queued first (throws from discovered)', async () => {
  await expect(promoteDiscoveryCandidate(state, candidateId)).rejects.toThrow(/queued for quick screen/i)
})
it('accept then promote → promoted + returns research_case_id + creates research case', async () => {
  await acceptDiscoveryCandidate(state, candidateId)
  const { research_case_id } = await promoteDiscoveryCandidate(state, candidateId)
  expect(research_case_id).toMatch(/^rc_/)
  expect(status(candidateId)).toBe('promoted_to_research_case')
  expect((await listStore()).some(e => e.event_type === 'research_case_created')).toBe(true)
})
```
(`state` = a personal-local OnboardingState whose `config.ledger_path` points at a temp SQLite file — mirror the route-test temp-ledger setup; `listStore()` opens the ledger and returns `store.list()`.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** in workflow.ts:
```ts
function personalLocalStore(state: OnboardingState): SQLiteEventStore {
  if (!state.is_initialized || state.config.mode !== 'personal-local' || state.config.ledger_path === undefined) {
    throw new Error('Personal-local workflow is not initialized')
  }
  return new SQLiteEventStore(state.config.ledger_path)
}

export async function acceptDiscoveryCandidate(state: OnboardingState, candidateId: string): Promise<void> {
  const store = personalLocalStore(state)
  try {
    await queueDiscoveryCandidateForQuickScreen(store, {
      candidate_id: candidateId,
      queue_id: `queue_${candidateId}_${Date.now()}`,
      causation_id: `web_triage_${candidateId}`,
      actor_id: 'user_local',
    })
  } finally { store.close() }
}

export async function rejectDiscoveryCandidate(state: OnboardingState, candidateId: string, reason: string): Promise<void> {
  const store = personalLocalStore(state)
  try {
    await rejectDiscoveryCandidateEvent(store, {
      candidate_id: candidateId,
      reason: reason.trim() || 'Rejected from discovery triage',
      causation_id: `web_triage_${candidateId}`,
      actor_id: 'user_local',
    })
  } finally { store.close() }
}

export async function promoteDiscoveryCandidate(state: OnboardingState, candidateId: string): Promise<{ research_case_id: string }> {
  const store = personalLocalStore(state)
  try {
    const candidate = projectDiscoveryCandidates(await store.list()).find((c) => c.candidate_id === candidateId)
    if (candidate === undefined) throw new Error(`Discovery candidate ${candidateId} not found`)
    const researchCaseId = `rc_${candidate.ticker.toLowerCase()}_${Date.now()}`
    await promoteDiscoveryCandidateToResearchCase(store, {
      candidate_id: candidateId,
      research_case_id: researchCaseId,
      causation_id: `web_triage_${candidateId}`,
      actor_id: 'user_local',
    })
    return { research_case_id: researchCaseId }
  } finally { store.close() }
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(web): discovery triage wrappers (accept/reject/promote)`

---

## Task 4: Triage routes (accept / reject / promote)

**Files:** Create the three `route.ts` under `apps/web/src/app/api/discovery/candidates/[id]/{accept,reject,promote}/`; Test `apps/web/src/app/api/discovery/candidates/route.test.ts` (one file exercising all three via direct POST import).

Mirror the dynamic-segment signature from `api/research/[caseId]/re-review/route.ts`: `POST(request, { params }: { params: Promise<{ id: string }> })`.

- [ ] **Step 1: Failing test** (temp ledger seeded with a discovered candidate; call each route's POST directly):
```ts
import { POST as accept } from './[id]/accept/route'
import { POST as reject } from './[id]/reject/route'
import { POST as promote } from './[id]/promote/route'
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
it('accept → 200 queued', async () => {
  const res = await accept(new Request('http://x', { method: 'POST' }), ctx(candidateId))
  expect(res.status).toBe(200)
  expect(status(candidateId)).toBe('queued_for_quick_screen')
})
it('promote before accept → 409', async () => {
  const res = await promote(new Request('http://x', { method: 'POST' }), ctx(candidateId))
  expect(res.status).toBe(409)
})
it('accept then promote → 200 with research_case_id', async () => {
  await accept(new Request('http://x', { method: 'POST' }), ctx(candidateId))
  const res = await promote(new Request('http://x', { method: 'POST' }), ctx(candidateId))
  expect(res.status).toBe(200)
  expect((await res.json()).research_case_id).toMatch(/^rc_/)
})
it('reject with reason → 200 rejected', async () => {
  const res = await reject(new Request('http://x', { method: 'POST', body: JSON.stringify({ reason: 'nope' }), headers: { 'content-type': 'application/json' } }), ctx(candidateId))
  expect(res.status).toBe(200)
  expect(status(candidateId)).toBe('rejected')
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** the three routes. Path depth from `app/api/discovery/candidates/[id]/accept` to `src/lib` is `../../../../../../lib` (6 up) — verify by counting.

`accept/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { getOnboardingState } from '../../../../../../lib/onboarding'
import { acceptDiscoveryCandidate } from '../../../../../../lib/workflow'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const state = await getOnboardingState()
  try {
    await acceptDiscoveryCandidate(state, id)
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'accept failed'
    const status = message.startsWith('Personal-local workflow is not initialized') ? 409 : /must be|not found|already/i.test(message) ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
```
`reject/route.ts` — same shape, but read `reason` from the body:
```ts
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const state = await getOnboardingState()
  let reason = ''
  try { const body = await request.json(); if (typeof body?.reason === 'string') reason = body.reason } catch { /* empty body ok */ }
  try {
    await rejectDiscoveryCandidate(state, id, reason)
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (error) { /* same 409/500 mapping as accept */ }
}
```
`promote/route.ts` — same shape, returns the id:
```ts
    const result = await promoteDiscoveryCandidate(state, id)
    return NextResponse.json(result, { status: 200 })
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(web): discovery triage routes (accept/reject/promote)`

---

## Task 5: `/discovery` page + panel + buttons

**Files:** Create `apps/web/src/app/discovery/page.tsx`, `apps/web/src/components/DiscoveryPanel.tsx`, `apps/web/src/components/RunDiscoveryButton.tsx` (+ test), `apps/web/src/components/DiscoveryCandidateActions.tsx` (+ test).

- [ ] **Step 1: Failing tests** — component render tests:
```ts
// RunDiscoveryButton.test.tsx
const html = renderToStaticMarkup(createElement(RunDiscoveryButton))
expect(html).toContain('data-testid="run-discovery"')
expect(html).toMatch(/run discovery/i)
// DiscoveryCandidateActions.test.tsx — buttons per status
const disc = renderToStaticMarkup(createElement(DiscoveryCandidateActions, { candidateId: 'c1', status: 'discovered' }))
expect(disc).toMatch(/accept for screening/i); expect(disc).toMatch(/reject/i)
const queued = renderToStaticMarkup(createElement(DiscoveryCandidateActions, { candidateId: 'c1', status: 'queued_for_quick_screen' }))
expect(queued).toMatch(/promote to research/i)
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.**
  - `RunDiscoveryButton.tsx`: copy `RefreshPricesButton.tsx` structure verbatim (`'use client'`, `createElement`, `useSafeRouter`, `deps?: { fetch, router }`), change: POST `/api/discovery/run`, `data-testid="run-discovery"`, label "Run discovery", success note "Discovery started — refreshing…" then `router.refresh()`.
  - `DiscoveryCandidateActions.tsx`: `'use client'`, props `{ candidateId: string; status: string; deps?: { fetch, router } }`. For `status==='discovered'` render **Accept for screening** (POST `/api/discovery/candidates/${candidateId}/accept`) + **Reject** (POST `.../reject` with a `{reason}` JSON body from a small inline text input, default `''`). For `status==='queued_for_quick_screen'` render **Promote to research case** (POST `.../promote`, on success `router.refresh()`; if the JSON has `research_case_id`, also navigate/link to `/research/${research_case_id}`) + **Reject**. Each button `data-testid` (`accept`/`reject`/`promote`), classes `owl-button owl-button-secondary owl-focusable`. Mirror `RefreshPricesButton`'s fetch+refresh+error handling.
  - `DiscoveryPanel.tsx` (server component, `createElement`): props `{ candidates: DiscoveryCandidateProjection[]; runStatus: { last_run_status: string; last_result_summary?: string; last_started_at?: string } | undefined }`. Render: a run bar (`RunDiscoveryButton` + a status line: "Running…" if `runStatus?.last_run_status === 'running'`, else `runStatus?.last_result_summary ?? 'Never run'`), then sections grouped by status (`discovered`, `queued_for_quick_screen`, then a collapsed `rejected`/`promoted_to_research_case` tail). Each discovered/queued card shows `candidate.ticker`, the signal from `extractDiscoverySignal(candidate.discovery_metadata)` (signal_type + contributing_managers joined), and `DiscoveryCandidateActions`. Import `extractDiscoverySignal` from `@owlfolio/ledger/projections/discoveryCandidateProjection`.
  - `page.tsx`: mirror `pipeline/page.tsx` shell (`getOnboardingState`, `isUnconfiguredForUser` → `UnconfiguredNotice feature="Discovery"`, else open `new SQLiteEventStore(state.config.ledger_path)` in try/finally). Compute `const events = await store.list()`, `candidates = projectDiscoveryCandidates(events)`, `runStatus = projectScheduledTasks(events).find(t => t.task_kind === 'discovery_13f')`. Render inside `<main className="owl-route-frame">` + the `owl-route-back-row` back link, then `<DiscoveryPanel candidates={candidates} runStatus={runStatus} />`. Import `projectScheduledTasks` from `@owlfolio/ledger/projections/scheduledTaskProjection`.

- [ ] **Step 4: Run — expect PASS** (component tests). Then broad `corepack pnpm exec vitest run apps/web` green, `corepack pnpm --filter @owlfolio/web exec tsc --noEmit -p tsconfig.json` clean, `corepack pnpm --filter @owlfolio/web lint` clean.

- [ ] **Step 5: Add a nav entry** — add a link to `/discovery` wherever `/pipeline` is linked from the command center/home (grep `href="/pipeline"` and add a sibling `href="/discovery"` labeled "Discovery"). Keep minimal.

- [ ] **Step 6: Commit** `feat(web): /discovery page — run trigger + candidate triage`

---

## Verification (final)

- `corepack pnpm typecheck` — clean
- `corepack pnpm lint` — clean
- `corepack pnpm test` — full suite green (new tests included)
- Manual (personal-local instance): open `/discovery` → **Run discovery** (run bar → "Running…") → after the live 13F harvest, candidates appear → **Accept** one → **Promote** it, follow the returned research-case link → **Reject** another. Confirm `/pipeline` still renders the same candidates read-only.
