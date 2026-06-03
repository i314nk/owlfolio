# Owlfolio v0.2 OpenAI Codex OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add honest OpenAI provider support for the auth surface the user actually has: local Codex CLI OAuth or access-token login, with API-key fallback. Owlfolio should detect Codex readiness truthfully in onboarding, resolve `openai` through the provider factory, and execute the existing Buffett-Munger personal-local workflow through a real `codex exec` adapter when credentials are available in the runtime.

**Current live constraint:** `codex` is installed on this machine, but `codex doctor` currently reports `no Codex credentials were found`, so a true live OAuth-backed run cannot pass until this runtime is logged in. The code slice should therefore: (a) support Codex OAuth detection and execution, (b) keep deterministic tests stubbed via injected runners, and (c) leave the provider support level as experimental until a live authenticated run is verified.

**Architecture:** Keep Owlfolio as workflow owner. The web route resolves the selected provider via `@owlfolio/providers`, the OpenAI path executes `codex exec` non-interactively, structured output is validated in `@owlfolio/workflow`, and Owlfolio alone persists source-ledger bundles and ledger events. OpenAI/Codex remains a reasoning backend; Owlfolio owns prompts, schemas, persistence, audit trails, and decision drafting.

**Tech Stack:** TypeScript, pnpm workspace, Next.js App Router, React, SQLite, Vitest, Playwright, local Codex CLI.

---

## File structure

- Create: `packages/providers/src/openaiCodexCliProvider.ts` — real OpenAI adapter using `codex exec` with output schema files and JSONL event parsing.
- Create: `packages/providers/src/__tests__/openaiCodexCliProvider.test.ts` — failing-first adapter coverage for API key, access token, OAuth auth-file presence, structured output, and surfaced CLI failures.
- Modify: `packages/providers/src/providerFactory.ts` — resolve `openai` to the new adapter.
- Modify: `packages/providers/src/index.ts` — export the new adapter.
- Modify: `apps/web/src/lib/providerReadiness.ts` — detect OpenAI readiness via `OPENAI_API_KEY`, `CODEX_ACCESS_TOKEN`, or Codex OAuth auth file.
- Modify: `apps/web/src/lib/__tests__/providerReadiness.test.ts` — red/green for honest OpenAI readiness semantics.
- Modify: `apps/web/src/lib/workflow.ts` — default `openai` personal-local runs to a Codex model id when none is configured.
- Modify: `apps/web/src/lib/__tests__/workflow.test.ts` — add/extend a focused OpenAI personal-local happy-path using injected mock provider or factory selection if needed.
- Modify: `playwright.config.ts` only if test-runtime env needs an explicit missing Codex auth path for deterministic readiness assertions.
- Create: `docs/superpowers/plans/2026-05-29-owlfolio-v02-openai-codex-oauth.md` — this plan.

## Task 1: Add the OpenAI Codex CLI provider adapter

**Files:**
- Create: `packages/providers/src/openaiCodexCliProvider.ts`
- Create: `packages/providers/src/__tests__/openaiCodexCliProvider.test.ts`
- Modify: `packages/providers/src/providerFactory.ts`
- Modify: `packages/providers/src/index.ts`

- [ ] **Step 1: Write failing OpenAI adapter tests first**

Add provider tests that cover:
- structured output via `codex exec --output-schema <tempfile> -o <outfile>`
- plain completion via `codex exec -o <outfile>`
- readiness-compatible auth surfaces passed through env: `OPENAI_API_KEY`, `CODEX_ACCESS_TOKEN`
- helpful failure when `codex` exits non-zero or never writes the expected output file
- provider metadata and observations aligned with the frozen provider contract

Test design notes:
- Inject the command runner; do not shell out in unit tests.
- Use the real `ProviderRunRequest` contract.
- Verify the adapter uses `codex` by default and preserves requested `model_id`.

- [ ] **Step 2: Run the new provider tests and verify RED**

```bash
corepack pnpm test -- --run packages/providers/src/__tests__/openaiCodexCliProvider.test.ts
```

Expected: FAIL because the adapter and factory support do not exist yet.

- [ ] **Step 3: Implement the OpenAI Codex CLI adapter**

Requirements:
- use `codex exec` non-interactively
- use a temporary schema file for `structured()` because Codex expects `--output-schema <FILE>`
- use `-o <FILE>` for last-message capture
- optionally use `--json` to collect JSONL event/observation messages
- surface 401/auth failures clearly
- keep all ledger writes outside the provider adapter

Factory behavior:
- `mock-provider` -> `MockProvider`
- `claude` -> `ClaudeCliProvider`
- `openai` -> `OpenAICodexCliProvider`
- unknown provider -> throw

- [ ] **Step 4: Run focused provider tests and verify GREEN**

```bash
corepack pnpm test -- --run packages/providers/src/__tests__/openaiCodexCliProvider.test.ts packages/providers/src/__tests__/claudeCliProvider.test.ts packages/providers/src/__tests__/mockProvider.test.ts packages/providers/src/__tests__/providerContract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the provider adapter checkpoint**

```bash
git add packages/providers/src/openaiCodexCliProvider.ts packages/providers/src/__tests__/openaiCodexCliProvider.test.ts packages/providers/src/providerFactory.ts packages/providers/src/index.ts
git commit -m "feat(providers): add OpenAI Codex CLI adapter"
```

## Task 2: Make onboarding readiness honest for Codex OAuth

**Files:**
- Modify: `apps/web/src/lib/providerReadiness.ts`
- Modify: `apps/web/src/lib/__tests__/providerReadiness.test.ts`
- Modify: `playwright.config.ts` only if needed for deterministic missing-auth assertions

- [ ] **Step 1: Write failing readiness tests first**

Add tests that prove:
- `openai` is ready via `OPENAI_API_KEY`
- `openai` is ready via `CODEX_ACCESS_TOKEN`
- `openai` is ready when a Codex OAuth auth file exists
- `openai` is not ready when none of those auth surfaces exist
- status labels/auth-source strings are explicit about whether readiness comes from API key, access token, or Codex OAuth credentials

- [ ] **Step 2: Run focused readiness tests and verify RED**

```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/providerReadiness.test.ts
```

Expected: FAIL because OpenAI readiness only checks `OPENAI_API_KEY` today.

- [ ] **Step 3: Implement Codex-aware readiness detection**

Implementation notes:
- support env override for Codex auth file path so tests do not depend on real home state
- prefer auth-source labels like:
  - `OPENAI_API_KEY`
  - `CODEX_ACCESS_TOKEN`
  - `Codex OAuth credentials`
- keep support level `experimental` until a live authenticated run is verified

- [ ] **Step 4: Run focused readiness tests and verify GREEN**

```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/providerReadiness.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the readiness checkpoint**

```bash
git add apps/web/src/lib/providerReadiness.ts apps/web/src/lib/__tests__/providerReadiness.test.ts playwri
git commit -m "feat(runtime): detect Codex OAuth readiness for OpenAI"
```

(Note: only include `playwright.config.ts` if it actually changed.)

## Task 3: Wire the OpenAI provider into the personal-local workflow path

**Files:**
- Modify: `apps/web/src/lib/workflow.ts`
- Modify: `apps/web/src/lib/__tests__/workflow.test.ts` only if needed

- [ ] **Step 1: Write/extend failing workflow tests first**

Add or extend tests so the app layer proves:
- choosing `openai` resolves a real provider path
- a missing `model_id` defaults to a Codex model (for example `codex-mini-latest`)
- existing `mock-provider` and `claude` behavior stay unchanged

Keep deterministic tests by injecting/stubbing the provider path as needed; do not make unit tests depend on live Codex auth.

- [ ] **Step 2: Run focused workflow tests and verify RED**

```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/workflow.test.ts
```

Expected: FAIL if the app still assumes `gpt-4.1` or lacks `openai` provider factory support.

- [ ] **Step 3: Implement the app-layer OpenAI defaults**

Requirements:
- preserve demo mode behavior unchanged
- preserve Claude personal-local behavior unchanged
- for `openai`, default to a Codex-compatible model id when one is not set
- continue resolving through the provider factory, not direct provider imports

- [ ] **Step 4: Run focused app tests and verify GREEN**

```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/workflow.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the app integration checkpoint**

```bash
git add apps/web/src/lib/workflow.ts apps/web/src/lib/__tests__/workflow.test.ts
git commit -m "feat(web): route OpenAI personal-local runs through Codex defaults"
```

## Task 4: Verification and live smoke boundaries

- [ ] **Step 1: Run focused milestone checks**

```bash
corepack pnpm test -- --run packages/providers/src/__tests__/openaiCodexCliProvider.test.ts apps/web/src/lib/__tests__/providerReadiness.test.ts apps/web/src/lib/__tests__/workflow.test.ts
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

Expected: PASS.

- [ ] **Step 3: Attempt a live Codex smoke run only if credentials exist in this runtime**

Suggested smoke command after readiness is green:

```bash
tmpdir=$(mktemp -d)
printf '{"type":"object","properties":{"message":{"type":"string"}},"required":["message"],"additionalProperties":false}' > "$tmpdir/schema.json"
codex exec --skip-git-repo-check --sandbox read-only --model codex-mini-latest --output-schema "$tmpdir/schema.json" -o "$tmpdir/out.json" 'Return JSON with a message field set to hello.'
cat "$tmpdir/out.json"
```

Expected:
- if credentials are present: success with JSON output
- if credentials are absent: a clear 401/auth failure; report that the code path is implemented but the local runtime still needs `codex login`

## Done condition

This slice is complete when:
- Owlfolio resolves `openai` through a real Codex CLI adapter
- onboarding readiness can truthfully detect Codex OAuth/access-token/API-key auth surfaces
- personal-local workflow defaults are Codex-compatible for `openai`
- all focused and full verification passes
- live smoke testing is attempted and accurately reported based on the actual auth state of this runtime
