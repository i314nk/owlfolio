# Discovery (on-demand) — design

## Context

The harness has a deterministic 13F "clone" discovery engine that harvests recent 13F-HR filings from a
curated manager list and records surviving signals as discovery candidates. But there is **no way for a
user to run it or act on what it finds**:

- `runDiscovery13f(store, deps)` (`packages/workflow/src/discovery13f.ts`) exists and emits
  `discovery_candidate_discovered`, but only runs via the worker task `discovery_13f`, which is
  **opt-in / disabled by default** (`OWLFOLIO_DISCOVERY_13F_ENABLED === '1'`). There is no web trigger.
- The candidate advance operations exist as workflow functions
  (`packages/workflow/src/discoveryCandidateWorkflow.ts`: `queueDiscoveryCandidateForQuickScreen`,
  `rejectDiscoveryCandidate`, `promoteDiscoveryCandidateToResearchCase`) but **no web route calls them** —
  candidates cannot be advanced from the UI.
- `/pipeline` renders candidates **read-only**, as one stage in a whole-engine flow view.

This is the second on-demand action being built before the scheduler (after the price check). The engine
and the advance workflow already exist; this feature **exposes them as on-demand web actions on a
dedicated page**, so the eventual scheduler is a thin cadence layer over the same worker task.

## Decisions (from brainstorming)

- **Scope:** **run + triage + promote** — trigger a discovery run, view surfaced candidates, and act on
  them (accept for screening → promote to research case, or reject). Turning 13F signals into research
  cases is the point of discovery.
- **Run model:** **async worker spawn.** A discovery run is a slow multi-manager SEC harvest (not a fast
  quote), so the web route spawns the existing `discovery_13f` worker task (detached, like research runs);
  the page reflects run status from events. The scheduler will later fire the same task.
- **UI home:** a **dedicated `/discovery` page** (run trigger + triage inbox). `/pipeline` is left
  untouched as the read-only whole-engine flow monitor. The two share `projectDiscoveryCandidates` but view
  it through different lenses: `/discovery` is the **triage inbox** (candidates entering + being decided);
  `/pipeline` is the **flow monitor** (watch a promoted name travel through deep-dive to decision).
- **Triage = the honest two-step state machine.** The engine enforces
  `discovered → queued_for_quick_screen → promoted_to_research_case`; the buttons follow it rather than
  hiding it. No one-click accept+promote shortcut in v1.

## Architecture

### 1. The `/discovery` page (`apps/web/src/app/discovery/page.tsx` + a panel component)

Server-rendered, three parts:

- **Run bar:** a `RunDiscoveryButton` (client) + last-run status read from `projectScheduledTasks`
  (the `discovery_13f` task's latest run): "Running…" between `scheduled_task_run_started` and
  `_completed`, else "Last run: N candidates · M sector-excluded · <relative time>" from the run's
  `result_summary`/counts.
- **Triage inbox:** candidates from `projectDiscoveryCandidates`, grouped by status. Each `discovered` /
  `queued_for_quick_screen` card shows ticker, signal (`extractDiscoverySignal`: CLUSTER_BUY /
  NEW_POSITION / MEANINGFUL_ADD), manager(s), and the action buttons for its state.
- **Reference tail:** `rejected` and `promoted_to_research_case` candidates shown collapsed (promoted ones
  link to their research case). The live conveyor view stays on `/pipeline`.

### 2. Run trigger — `POST /api/discovery/run`

Mirrors the research-run spawn (`defaultSpawnWorker` in `apps/web/src/lib/workflow.ts`):
- Resolve personal-local onboarding state (guard as other personal-local ops do).
- Spawn `corepack pnpm --filter @owlfolio/worker dev -- --once --task-kind discovery_13f`, with
  `cwd: OWLFOLIO_PROJECT_DIR` and the child env extended with `OWLFOLIO_DISCOVERY_13F_ENABLED: '1'` (so the
  otherwise-opt-in task runs for an explicit on-demand request) plus the usual ledger/source/config/cert
  path env the existing spawn passes.
- The spawn is injectable (`deps.spawn`) so route tests never launch a process or hit the network.
- Return `202 { started: true }`. The button then `router.refresh()`s; the run bar shows "Running…" from
  the `scheduled_task_run_started` event the worker emits, and the candidates appear once it completes.

### 3. Triage actions — three thin routes wiring the existing workflow

- `POST /api/discovery/candidates/[id]/accept` → `queueDiscoveryCandidateForQuickScreen` →
  status `queued_for_quick_screen`.
- `POST /api/discovery/candidates/[id]/reject` (reason from the request) → `rejectDiscoveryCandidate` →
  status `rejected`.
- `POST /api/discovery/candidates/[id]/promote` → `promoteDiscoveryCandidateToResearchCase` (generates a
  `research_case_id`, creates the research case) → status `promoted_to_research_case`; returns
  `{ research_case_id }` so the UI can link to it.

Each resolves the personal-local ledger, calls the matching workflow function with a generated
`causation_id`/`actor_id: 'user_local'`, and the client `router.refresh()`es. Buttons render per state:
`discovered` → [Accept for screening] / [Reject]; `queued_for_quick_screen` → [Promote to research case] /
[Reject]. Promote deliberately does **not** auto-start a deep-dive run — it creates the case; starting
research stays a separate deliberate action, consistent with the engine today.

## Data flow

```
[/discovery] --Run--> POST /api/discovery/run --> spawn worker (--task-kind discovery_13f, ENABLED=1)
                                                    └─ runDiscovery13f → discovery_candidate_discovered
        projectDiscoveryCandidates ──> triage inbox (grouped by status)
        projectScheduledTasks      ──> run bar (running / last-run summary)

[Accept]  POST …/[id]/accept  → queueDiscoveryCandidateForQuickScreen → queued_for_quick_screen
[Reject]  POST …/[id]/reject  → rejectDiscoveryCandidate               → rejected
[Promote] POST …/[id]/promote → promoteDiscoveryCandidateToResearchCase→ creates research case + promoted
```

## Error handling

- Run route: if not personal-local/initialized → 409. Spawn failure is caught → 500 with a message; the
  button surfaces it. Concurrent runs are harmless (the engine is idempotent per manager-quarter/cusip),
  but the run bar showing "Running…" discourages double-clicks.
- Triage routes: the workflow functions throw on illegal transitions (e.g. promote before
  `queued_for_quick_screen`, or acting on a missing/duplicate candidate) → 409 with the message; the page
  is unaffected. The state-gated buttons make illegal transitions unreachable in normal use, but the guard
  is enforced server-side regardless.
- A discovery run that finds nothing → 0 new candidates, run bar shows the zero-count summary honestly.

## Testing

- `POST /api/discovery/run` — route test with injected `deps.spawn` asserting the worker is invoked with
  `--task-kind discovery_13f` and `OWLFOLIO_DISCOVERY_13F_ENABLED=1`, returns 202; 409 when uninitialized.
- Triage routes — temp-ledger tests seeded with a `discovered` candidate: accept → `queued_for_quick_screen`;
  reject → `rejected`; promote-before-accept → 409 (guard); accept-then-promote → `promoted_to_research_case`
  with a created research case + returned `research_case_id`.
- Page/panel — render test: grouping by status, correct buttons per state, run-bar status from a seeded
  scheduled-task run (running vs completed).
- Reuse existing `projectDiscoveryCandidates` / `projectScheduledTasks` / `discoveryCandidateWorkflow`
  tests (unchanged).

## Verification

- `corepack pnpm typecheck` + `lint` clean; full unit suite green including the new route/page tests.
- Manual: on a personal-local instance, open `/discovery`, click **Run discovery** (run bar → "Running…"),
  wait for the live 13F harvest to complete, see candidates appear; **Accept** one, then **Promote** it and
  follow the link to the new research case; **Reject** another with a reason. Confirm `/pipeline` still
  renders the same candidates read-only.

## Out of scope (future)

- The scheduler daemon / cadence evaluation — the `discovery_13f` cadence already exists in automation
  settings; the scheduler phase wires it to fire the same worker task. This spec makes that a cadence
  stitch, not new discovery logic.
- A one-click accept+promote shortcut; the mock-strategy discovery path (`runMockStrategyDiscovery`);
  auto-starting a deep-dive run on promote; any change to `/pipeline`; and visual polish (folded into the
  later cross-page polish sweep).
