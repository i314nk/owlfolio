# Owlfolio v2 — Workstream A design: multi-agent, grounded, worker-driven research harness

## Context

This is the spec for **workstream A** of the approved direction
(`~/.claude/plans/fancy-wibbling-snowflake.md`): the investment-grade autonomous research harness — the
product itself. The Phase 0 dogfood
(`docs/superpowers/dogfood/2026-06-08-phase0-codex-msft-dogfood-findings.md`) proved the plumbing is
excellent but the "brain" is not investment-grade: the web research path
(`runClaudeBuffettMungerResearch`) is a **single** `provider.structured()` call with **tools disabled**
that **fabricates sources and records them as verified**, and it is fanned out into 7 "specialist"
events that are not independent analyses.

Owner requirements settled in brainstorming:
- **Multi-agent swarm:** each pipeline stage runs real, separate agent calls; the deep dive is a
  concurrent swarm of per-lane specialist agents — not one LLM call.
- **Investment-grade + grounded:** every claim cited to a source the harness actually captured and can
  replay (grounding invariant). Mechanism chosen by the harness, not hand-fed.
- **Provider-agnostic:** Codex CLI first; Claude/Gemini/ChatGPT plug into the same contract.
- **Execution:** worker-driven, **web-triggered** (web enqueues + spawns a worker run; no babysat
  daemon). Safe because research is draft authoring — the dry-run boundary is untouched.

## Goals / non-goals

**Goals:** replace the monolithic call with a strategy-driven multi-agent swarm; enforce harness-side
grounding; run research in the worker triggered by the web; keep everything resumable via ledger
events; formalize a trust contract and re-certify Codex against it.

**Non-goals (this workstream):** real price feed (workstream C), onboarding/UI polish (B/E), the
pipeline observability page (workstream F — its own spec), new strategies beyond Buffett-Munger,
auto-approval of any decision/action (permanently out).

**Division of labor (system principle):** *agents propose, deterministic projections compute, humans
decide.* Only research + Shariah **screening** are agent-driven. **Accounting and purification stay
deterministic** (`accountingProjection.ts`, `purificationProjection.ts`) — no agents, no swarm; they
are fed by events (dividends, valuations, the swarm's Shariah status). This spec therefore does **not**
touch purification/accounting logic; it only ensures the swarm emits a clean `shariah_evaluation` that
they consume.

**Observability hook (for workstream F):** the swarm must emit enough per-stage/per-lane detail —
status (queued/running/complete/incomplete), grounded-source count, timing, and cost — in its events so
the pipeline page can render live progress without extra plumbing. The pipeline page itself (system map
+ per-case drill-down) is workstream F.

## Architecture overview

```
Web: POST /api/research/start {ticker}
  → append research_run_requested (enqueue event, durable)   [NEW event type]
  → spawn `pnpm worker --once --task-kind process_research_queue` (OWLFOLIO_LEDGER_PATH env)
  → return 202 {research_case_id} immediately
Worker (process_research_queue handler):
  claim research_run_requested (idempotent claim via event) →
  orchestrate the swarm over the EXISTING step fns in strategyResearchPipeline.ts:
    1. createResearchCase
    2. quick-screen AGENT            → draftQuickScreen
    3. queueDeepDive → startDeepDive
    4. SWARM: one grounded AGENT per strategy lane, concurrently
         (business_quality, moat, management, financial_quality, shariah, risks, valuation)
         → recordSpecialistFinding (per lane)
    5. synthesis AGENT               → draftDeepDiveSynthesis → completeDeepDive
    6. decision draft                → draftStrategyDecision
UI: research pages render live progress from projectResearchCases / timeline (events already exist)
```

Each numbered step is a **separate provider call** (an "agent"), each subject to the grounding gate.
The lane swarm (step 4) runs concurrently with a bounded fan-out.

## Component 1 — Swarm orchestrator (replaces the monolith)

- New module `packages/workflow/src/researchSwarm.ts` exporting
  `runStrategyResearchSwarm(store, provider, command, deps)`.
- It **drives the existing discrete step functions** (`draftQuickScreen`, `queueDeepDive`,
  `startDeepDive`, `recordSpecialistFinding`, `draftDeepDiveSynthesis`, `completeDeepDive`,
  `draftStrategyDecision` — all in `strategyResearchPipeline.ts`), one provider call per step.
- Lanes come from the strategy contract (`buffettMungerDeepDiveLanes` today; long-term from
  `packages/strategies` specialist definitions) so the swarm is **strategy-driven**, not hardcoded.
- Each lane agent gets a **lane-specific prompt** derived from the strategy's specialist definition
  (task, what evidence to seek, what the gate needs) — this is where the strategy "meaningfully drives"
  the research that the dogfood found missing.
- Fan-out: lane agents run concurrently with a concurrency cap (default 4) and a per-lane timeout
  (default 180s). A failed/timed-out lane records a `specialist_finding_recorded` flagged
  `status: 'incomplete'` rather than failing the whole case (partial-swarm tolerance).
- `runClaudeBuffettMungerResearch` is retired (or thinned to a deterministic mock-only path for tests).

## Component 2 — Harness-side grounding (the trust fix)

The grounding invariant is enforced by the **harness**, independent of provider tool support (only
`MockProvider.runWithTools` returns real tool calls today; Codex/Claude return `[]`).

Flow per agent that emits citations:
1. The agent returns its analysis **plus proposed citations** (url + claimed excerpt + source_id).
2. The harness **fetches each proposed URL**, stores the fetched content, computes
   `content_hash: 'sha256:...'`, and records a `SourceLedgerRecord` via the source-ledger machinery
   (`sourceLedger.ts`), setting `availability: 'available'` **only if the fetch succeeded** and
   `'unavailable'` otherwise. `proposed_by_actor: provider`, `ingested_by_actor: research_workflow`.
3. **Verification gate:** any `source_id` referenced by a finding/analysis that does **not** resolve to
   a successfully fetched record is dropped or the claim is flagged `unverified`. Findings keep only
   grounded `source_ids`. No more fabricated sources written as `available`.
4. New `source.fetch` capability: a small fetch+hash helper in the workflow/providers layer
   (`fetchAndCaptureSource(url)`), used by the harness. Provider-native tool-calling (via
   `runWithTools`) becomes an optional richer path later for providers that support it, but is **not
   required** for grounding.

Safety/posture: harness fetch is outbound HTTP to public sources only, fail-closed, time-limited, no
credentials, content excerpted/stored locally, no secrets logged. (Codex `--sandbox read-only` can stay
as-is — grounding no longer depends on lifting it, since the harness fetches.)

## Component 3 — Worker execution, web-triggered

- New event type `research_run_requested` (aggregate `research_case`) carrying `{research_case_id,
  ticker, company_id, strategy_id, model_id, requested_by, idempotency_key}`. Append from the web
  route; this is the durable enqueue.
- New worker task kind `process_research_queue` in `apps/worker/src/runtime.ts`:
  projects pending `research_run_requested` (not yet started/completed), **claims** one idempotently
  (append `research_run_started`-style marker), runs `runStrategyResearchSwarm`, and records
  `scheduled_task_run_started/completed/failed` lifecycle events around it.
- **Web trigger:** `/api/research/start` appends the enqueue event then spawns
  `corepack pnpm --filter @owlfolio/worker dev -- --once --task-kind process_research_queue` with
  `OWLFOLIO_LEDGER_PATH` set, and returns `202` immediately. No daemon required; resilient because the
  request is durable in the ledger even if the spawn is lost (a later worker tick can pick it up).
- **Safety:** this lane runs "for real" (not dry-run) but only authors drafts/observations. The
  existing dry-run gate on **mutating** scheduled tasks (`watchlist confirm`, `holding open`,
  `purification payment`, auto-approve flags) is unchanged. Research drafting is categorically safe.
- Resumability: every step is idempotent (existing `idempotency_key` pattern); a re-run continues from
  the last recorded event rather than duplicating.

## Component 4 — Trust contract + certification

- In `packages/providers/src/certificationRunner.ts`, formalize the **research-trust tier** (structured
  analysis, specialist-parallel, synthesis, Buffett-Munger compliance, Shariah review, cited ledger
  proposal, and a **reliable, grounded** `source-grounded-research-task`). The grounded scenario now
  asserts that returned `source_ids` resolve to harness-fetched, content-hashed records.
- Track autonomy **mechanism** per provider as informational capability (harness-grounding vs
  provider-native tools), not a single required mechanism.
- Re-run `corepack pnpm certify:providers`; Codex should pass the research-trust tier once grounding +
  swarm land. Update `data/provider-certifications/*.latest.json` and the support matrix doc.

## Web/UI changes (minimal here; deep polish is workstream E)

- `/api/research/start` returns `202` + `research_case_id`; the research page polls/streams progress
  from `projectResearchCases` + timeline (events already model `deep_dive_started`,
  `specialist_finding_recorded`, `deep_dive_completed`).
- Show per-lane swarm progress (queued/running/complete/incomplete) and grounded-source counts.

## Resolved decisions

1. **Grounding mechanism:** harness-side fetch+verify (provider-agnostic). Provider-native tool-calling
   and lifting the Codex sandbox are optional future enhancements, not required.
2. **Swarm concurrency / cost caps:** default 4 concurrent lane agents, 180s per lane, plus a per-run
   token budget and `max_cost_usd` guard. Tunable in config.
3. **Outbound fetch posture (confirmed 2026-06-08):** harness may fetch **public sources only** over
   HTTPS — fail-closed, **no credentials**, content stored locally, **no secrets logged**. This is
   required for real grounding and is consistent with the local-first/privacy stance (no creds leave the
   machine; only public financial data is fetched). A domain allowlist may be layered later if desired.

## Testing & verification

- TDD per the project conventions: unit tests for the orchestrator (lane fan-out, partial-swarm
  tolerance, idempotent resume), for harness grounding (fabricated/unfetchable source → dropped/flagged;
  fetched source → hashed + `available`), and for the worker `process_research_queue` claim/run/lifecycle.
- E2e: `POST /api/research/start` returns 202; worker run drives a research case to a grounded decision
  draft; assert every analysis `source_id` resolves to a fetched, hashed record.
- Gate: `git diff --check`, `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm lint`,
  `corepack pnpm --filter @owlfolio/web exec next build`, `corepack pnpm e2e`,
  `corepack pnpm certify:providers`.
- Dogfood re-run (workstream D): MSFT through the swarm; confirm grounded citations and no fabricated
  `available` sources.

## Key seams (real symbols)

- Pipeline steps: `packages/workflow/src/strategyResearchPipeline.ts` — `draftQuickScreen`,
  `queueDeepDive`, `startDeepDive`, `recordSpecialistFinding`, `draftDeepDiveSynthesis`,
  `completeDeepDive`, `draftStrategyDecision`; lanes `buffettMungerDeepDiveLanes`.
- Monolith to retire: `packages/workflow/src/claudeResearchWorkflow.ts` `runClaudeBuffettMungerResearch`
  (budget `max_tool_calls:0`, `timeout_ms:120_000` — the dogfood defect).
- Provider contract: `packages/providers/src/providerContract.ts` `Provider` (`complete`, `structured`,
  `runWithTools`), `ProviderRunRequest`. Codex sandbox flag: `openaiCodexCliProvider.ts:200`.
- Grounding: `packages/workflow/src/sourceLedger.ts` `ingestManualSourceBundle` / `SourceLedgerRecord`
  (`content_hash`, `availability`).
- Worker: `apps/worker/src/runtime.ts` `runScheduledTasks`, `defaultTaskDefinitions`, lifecycle events;
  entry `apps/worker/src/index.ts:main`.
- Web enqueue point: `apps/web/src/lib/workflow.ts:157` `createPersonalResearchCase` (currently in-process).
