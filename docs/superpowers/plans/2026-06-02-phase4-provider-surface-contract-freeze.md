# Phase 4 Provider Surface Contract Freeze Implementation Plan

> **For Hermes:** Use test-driven-development skill to implement this plan task-by-task.

**Goal:** Freeze the TypeScript contract split between provider family/vendor identity and certifiable provider integration surface before direct adapter work starts.

**Architecture:** Keep legacy `ProviderId` values (`mock-provider`, `claude`, `openai`) working for app config, factory resolution, and existing UI while adding explicit surface/auth/runtime metadata to provider contracts, catalog entries, readiness outputs, certification targets, and provider run metadata. The new surface contract should distinguish direct API candidates from CLI/subscription personal-local lanes without claiming unimplemented adapters are runnable.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Next.js app-library tests.

---

## Task 1: RED catalog surface identity and capability taxonomy tests

**Objective:** Prove the catalog exposes distinct certifiable surfaces and richer provider-role/capability metadata without overclaiming implementation.

**Files:**
- Modify: `packages/providers/src/__tests__/providerCatalog.test.ts`
- Modify: `packages/providers/src/providerContract.ts`
- Modify: `packages/providers/src/providerCatalog.ts`

**Steps:**
1. Add failing tests that assert:
   - catalog entries include `vendor_id`, `provider_surface_id`, `runtime_kind`, `auth_mode`, `billing_mode`, `privacy`, `quota`, `automation`, `workflow_roles`, and `provider_kind` metadata.
   - `openai-api` and `openai-codex-cli` are separate surface ids.
   - `gemini-developer-api` and `gemini-cli` are separate surface ids.
   - legacy `openai` compatibility still maps to the Codex CLI provider path.
2. Run `corepack pnpm test packages/providers/src/__tests__/providerCatalog.test.ts` and confirm RED from missing fields/surfaces.
3. Add minimal contract types and catalog entries to pass the test.
4. Re-run the focused test to GREEN.

## Task 2: RED certification target identity tests

**Objective:** Key certification reports and ledger payloads by provider surface/auth/model/workflow role while preserving legacy report compatibility.

**Files:**
- Modify: `packages/providers/src/__tests__/certificationRunner.test.ts`
- Modify: `packages/providers/src/certificationContract.ts`
- Modify: `packages/providers/src/certificationRunner.ts`

**Steps:**
1. Add failing tests that assert:
   - a certification report has a `target` containing `provider_surface_id`, `vendor_id`, `runtime_kind`, `auth_mode`, `model_id`, and `workflow_role`.
   - report ids include the target surface/auth/role/model context.
   - `toCertificationLedgerPayload()` carries the target and never contains credential values or raw secret paths.
   - `createNotConfiguredCertificationReport()` can record not-configured/reauth/quota style reasons without exposing secrets.
2. Run `corepack pnpm test packages/providers/src/__tests__/certificationRunner.test.ts` and confirm RED.
3. Add minimal certification target types/options and runner plumbing.
4. Re-run the focused test to GREEN.

## Task 3: RED readiness redaction/auth-mode tests

**Objective:** Make readiness output explicit about auth/runtime/source categories while preserving existing mock/Claude/OpenAI compatibility.

**Files:**
- Modify: `apps/web/src/lib/__tests__/providerReadiness.test.ts`
- Modify: `apps/web/src/lib/providerReadiness.ts`
- Modify as needed: `packages/shared/src/appConfig.ts`

**Steps:**
1. Add failing tests that assert:
   - readiness exposes `readiness_state`, `auth_mode`, `runtime_kind`, `credential_source_category`, `reauth_action`, and metadata from the catalog.
   - env var names may appear, but credential values and raw credential paths do not appear in readiness outputs.
   - Codex CLI cached session/access token remains personal-local experimental and distinct from OpenAI direct API.
2. Run `corepack pnpm test apps/web/src/lib/__tests__/providerReadiness.test.ts` and confirm RED.
3. Implement minimal readiness mapping/redaction.
4. Re-run focused test to GREEN.

## Task 4: Compatibility and focused verification

**Objective:** Ensure existing mock/Claude/OpenAI behavior still works and no broad type breaks remain.

**Files:**
- Modify tests/helpers as required by previous tasks.

**Steps:**
1. Run focused provider/readiness/status tests:
   `corepack pnpm test packages/providers/src/__tests__/providerCatalog.test.ts packages/providers/src/__tests__/certificationRunner.test.ts apps/web/src/lib/__tests__/providerReadiness.test.ts apps/web/src/lib/__tests__/providerStatus.test.ts`
2. Run `corepack pnpm typecheck`.
3. Run `git diff --check`.
4. If tests/typecheck expose compatibility gaps, add narrow regression tests first, confirm RED, then implement minimal fixes.
5. Leave the card blocked for human review with a structured Kanban comment listing changed files and verification commands.
