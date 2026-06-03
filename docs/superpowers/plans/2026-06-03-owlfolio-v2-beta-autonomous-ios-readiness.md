# Owlfolio v2 Beta Autonomous IOS Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Owlfolio from a verified local-first alpha branch into a beta roadmap focused on certified real providers, evidence provenance, safe autonomy, and accounting/purification maturity.

**Architecture:** Keep the current alpha branch as the release-candidate baseline, then open a new Kanban phase on the existing `owlfolio-v2` board. The next phase should certify provider surfaces before raising support claims, expand autonomy only through dry-run/approval-gated scheduled tasks, and deepen finance/Shariah domains through source-grounded ledger events instead of direct provider writes.

**Tech Stack:** TypeScript, pnpm/Corepack, Next.js app router, Vitest, Playwright, SQLite event ledger, Hermes Kanban, GitHub PR workflow.

---

## Current baseline

- Branch: `feat/phase2-design-shell`.
- Board: `owlfolio-v2`, all 51 prior cards done, diagnostics empty at phase-4 closeout.
- Verification baseline from 2026-06-03: `git diff --check`, `corepack pnpm typecheck`, `corepack pnpm test` (49 files / 258 tests), `corepack pnpm lint` (placeholder scripts), `corepack pnpm e2e` (5/5), web `next build` with known Turbopack NFT warning, and production web audit passed.
- Provider truth: `mock-provider` certified; OpenAI Codex CLI experimental; Claude CLI unsupported/not-configured here; OpenAI API and Gemini Developer API are experimental/fail-closed candidates; Gemini CLI is setup-only until execution adapter/certification exists.

## File structure and responsibilities

- `README.md`: human-facing alpha summary, provider support table, and verification commands.
- `CLAUDE.md`: agent/developer instructions for current provider IDs and claim boundaries.
- `docs/ALPHA_READINESS.md`: release boundary, verification evidence, provider certification evidence, remaining full-v2 gaps.
- `docs/FUTURE_PLAN.md`: beta/autonomous IOS roadmap.
- `docs/architecture/owlfolio-v2-provider-model-support.md`: provider support matrix and certification posture.
- `docs/superpowers/plans/2026-06-03-owlfolio-v2-beta-autonomous-ios-readiness.md`: this handoff plan.
- Hermes Kanban board `owlfolio-v2`: durable next-phase task graph.

---

### Task 1: Release-candidate documentation checkpoint

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/ALPHA_READINESS.md`
- Modify: `docs/FUTURE_PLAN.md`
- Modify: `docs/architecture/owlfolio-v2-provider-model-support.md`
- Create: `docs/superpowers/plans/2026-06-03-owlfolio-v2-beta-autonomous-ios-readiness.md`

- [x] **Step 1: Update provider support language**

Ensure docs say:

```text
mock-provider: certified deterministic demo/test/e2e only.
openai/openai-codex-cli: experimental personal-local only.
claude: unsupported/not-configured in this environment.
openai-api: direct API candidate, experimental/fail-closed until target-specific certification report exists.
gemini-developer-api: direct API candidate, experimental/fail-closed until certification plus privacy posture are recorded.
gemini-cli: setup-only personal-local lane until execution adapter/certification exists.
```

- [x] **Step 2: Update verification counts**

Record the current gate as:

```text
corepack pnpm test: 49 test files / 258 tests passed
corepack pnpm e2e: 5/5 passed
next build: passed with known Turbopack NFT/import-trace warning
```

- [ ] **Step 3: Verify docs-only checkpoint**

Run:

```bash
git diff --check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm audit --filter @owlfolio/web --prod --audit-level moderate
```

Expected: all exit 0. Note that lint scripts are currently placeholders.

- [ ] **Step 4: Commit docs checkpoint**

Run:

```bash
git add README.md CLAUDE.md docs/ALPHA_READINESS.md docs/FUTURE_PLAN.md docs/architecture/owlfolio-v2-provider-model-support.md docs/superpowers/plans/2026-06-03-owlfolio-v2-beta-autonomous-ios-readiness.md
git commit -m "docs: close Owlfolio v2 alpha provider roadmap"
```

Expected: one docs commit on `feat/phase2-design-shell`.

---

### Task 2: Push alpha branch and open PR

**Files:**
- No source changes expected.

- [ ] **Step 1: Confirm clean tree**

Run:

```bash
git status --short --branch
```

Expected: clean `feat/phase2-design-shell`.

- [ ] **Step 2: Push branch**

Run:

```bash
git push -u origin feat/phase2-design-shell
```

Expected: branch is created or updated on `origin`.

- [ ] **Step 3: Create PR to `main`**

Run:

```bash
gh pr create --base main --head feat/phase2-design-shell --title "feat: close Owlfolio v2 alpha workflow and provider surfaces" --body-file /tmp/owlfolio-v2-alpha-pr.md
```

PR body must include summary, verification commands, provider-support boundaries, known Turbopack warning, and remaining beta/autonomous IOS gaps.

- [ ] **Step 4: Inspect PR status**

Run:

```bash
gh pr view --json number,url,state,mergeable,statusCheckRollup
```

Expected: PR exists and local output gives the number and URL. If CI is absent, record that explicitly.

---

### Task 3: Create next-phase Kanban graph

**Files:**
- No repo file changes expected.

- [ ] **Step 1: Confirm available profiles**

Run:

```bash
hermes profile list
```

Expected existing profiles include `code-agent`, `security-agent`, `ops-agent`, `research-agent`, and `buffet-agent`.

- [ ] **Step 2: Create beta release/merge gate card**

Create a card on `owlfolio-v2` assigned to `code-agent`:

```text
release: merge/push Owlfolio v2 alpha branch and refresh docs
```

Acceptance criteria: PR is pushed/open, docs reflect phase-4 provider truth, CI/verification status is recorded, and post-merge service/runtime follow-up is identified if merge happens.

- [ ] **Step 3: Create provider-certification cards**

Create independent `code-agent` cards:

```text
providers: run and record OpenAI direct API target certification
providers: run and record Gemini Developer API target certification and privacy posture
providers: implement Gemini CLI execution adapter or explicitly keep CLI onboarding setup-only
```

Each card must require no secret/path leakage, target surface/auth/model/role identity in reports, fail-closed UI semantics, and focused tests before support claims change.

- [ ] **Step 4: Create hardening cards**

Create independent cards:

```text
lint: replace placeholder lint scripts with real workspace linting
ops: design backup/restore for local ledgers and source bundles
```

Assign lint to `code-agent`; assign backup/restore to `ops-agent`.

- [ ] **Step 5: Create phase synthesis gate**

Create a dependent `code-agent` card:

```text
release-gate: beta provider/evidence/autonomy readiness assessment
```

Parents: the provider-certification cards, lint card, and backup/restore design card. Acceptance criteria: full verification, provider claims compared with reports, and recommended next cards for evidence ingestion and safe autonomy.

- [ ] **Step 6: Dispatch ready cards**

Run:

```bash
hermes kanban --board owlfolio-v2 dispatch
hermes kanban --board owlfolio-v2 stats --json
hermes kanban --board owlfolio-v2 diagnostics --json
```

Expected: initial independent cards are ready/running/done with no diagnostics.

---

## Self-review

- Spec coverage: the plan covers alpha branch closeout, PR handoff, next-phase Kanban creation, provider certification, lint hardening, backup/restore, and beta release-gate assessment.
- Placeholder scan: no implementation task uses TBD/TODO/fill-in placeholders.
- Claim boundary: docs and cards keep direct API/CLI claims below certification evidence.
