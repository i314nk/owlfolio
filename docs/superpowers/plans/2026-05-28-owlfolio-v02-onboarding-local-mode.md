# Owlfolio v0.2 Onboarding + Local Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `/onboarding` page with a real browser-guided setup flow that persists local Owlfolio configuration, reports provider readiness, initializes the local ledger, and hands the user into the command center.

**Architecture:** Add a small shared app-config contract plus a local JSON-backed config store under the web app, then expose that through Next.js route handlers used by a wizard-style onboarding page. Keep the current deterministic demo workflow intact, but stop hard-coding onboarding state in JSX. Personal local mode will become a real saved configuration path even before full live-provider execution lands.

**Tech Stack:** TypeScript, Next.js App Router, React server/client components, Vitest, Playwright, SQLite ledger adapter, local JSON config file.

---

## File structure

- `packages/shared/src/appConfig.ts` — typed onboarding/config contract shared across UI and routes.
- `packages/shared/src/index.ts` — shared-package export surface.
- `apps/web/src/lib/appConfigStore.ts` — local filesystem persistence for onboarding config.
- `apps/web/src/lib/providerReadiness.ts` — provider options + deterministic readiness checks.
- `apps/web/src/lib/onboarding.ts` — orchestration helpers for defaults, ledger init, and status shaping.
- `apps/web/src/app/api/onboarding/config/route.ts` — GET/PUT config route.
- `apps/web/src/app/api/onboarding/readiness/route.ts` — provider readiness route.
- `apps/web/src/app/api/onboarding/start/route.ts` — initialize selected mode and ledger, then return next destination.
- `apps/web/src/app/onboarding/page.tsx` — server wrapper for onboarding.
- `apps/web/src/app/onboarding/OnboardingWizard.tsx` — client wizard UI.
- `apps/web/src/app/page.tsx` — command-center entry reads saved config instead of always implying setup complete.
- `apps/web/src/components/__tests__/OnboardingWizard.test.tsx` — UI tests for real onboarding states.
- `apps/web/src/lib/__tests__/appConfigStore.test.ts` — config persistence tests.
- `apps/web/src/lib/__tests__/providerReadiness.test.ts` — readiness/status tests.
- `apps/web/e2e/onboarding.spec.ts` — end-to-end browser flow covering demo mode and personal local mode setup.

## Task 1: Shared app-config contract

**Files:**
- Create: `packages/shared/src/appConfig.ts`
- Create: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json`
- Modify: `packages/shared/tsconfig.json`
- Test: `apps/web/src/lib/__tests__/appConfigStore.test.ts`

- [ ] **Step 1: Add the shared config types**

Create `packages/shared/src/appConfig.ts` with:
- `OwlfolioMode = 'demo' | 'personal-local'`
- `ProviderId = 'mock-provider' | 'claude' | 'openai'`
- `ProviderSupportLevel = 'certified' | 'experimental' | 'unsupported'`
- `StrategyId = 'buffett-munger'`
- `ShariahDefaults` object
- `MarketUniverseConfig` object
- `ProviderSelection` object
- `AppConfig` object with `version`, `mode`, `provider`, `strategy_id`, `shariah`, `market_universe`, `ledger_path`, `initialized_at`
- `defaultDemoAppConfig()` and `defaultPersonalLocalAppConfig()` helpers

- [ ] **Step 2: Export the shared package entrypoint**

Create `packages/shared/src/index.ts` that re-exports `./appConfig`.

- [ ] **Step 3: Make the shared package importable**

Update `packages/shared/package.json` to expose `./src/index.ts` via standard workspace package fields.

- [ ] **Step 4: Typecheck**

Run: `corepack pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/package.json packages/shared/src/appConfig.ts packages/shared/src/index.ts
git commit -m "feat(shared): add owlfolio app config contract"
```

## Task 2: Local config store + provider readiness

**Files:**
- Create: `apps/web/src/lib/appConfigStore.ts`
- Create: `apps/web/src/lib/providerReadiness.ts`
- Create: `apps/web/src/lib/__tests__/appConfigStore.test.ts`
- Create: `apps/web/src/lib/__tests__/providerReadiness.test.ts`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Write failing config-store tests**

Add tests for:
- reading default config when no config file exists
- saving config to a local JSON file
- preserving existing user-selected values on reload
- resolving the config path from `OWLFOLIO_PROJECT_DIR` or workspace root

Run: `corepack pnpm test apps/web/src/lib/__tests__/appConfigStore.test.ts`
Expected: FAIL because the store does not exist yet

- [ ] **Step 2: Write failing readiness tests**

Add tests for:
- mock provider always returns ready/certified in demo mode
- claude provider reports ready when subscription credentials or API key are present
- openai provider reports experimental and not ready when no key is configured
- readiness response includes `auth_source`, `status_label`, and `support_level`

Run: `corepack pnpm test apps/web/src/lib/__tests__/providerReadiness.test.ts`
Expected: FAIL because readiness helpers do not exist yet

- [ ] **Step 3: Implement `appConfigStore.ts`**

Implement helpers:
- `resolveAppConfigPath()`
- `loadAppConfig()`
- `saveAppConfig(config)`
- `appConfigExists()`

Use a JSON file under `<projectRoot>/data/app-config.json` by default. Create parent dirs automatically. Keep this store synchronous at the filesystem edge only if it simplifies route use; otherwise use `fs/promises` consistently.

- [ ] **Step 4: Implement `providerReadiness.ts`**

Implement:
- static provider catalog for `mock-provider`, `claude`, `openai`
- `getProviderOptions()`
- `getProviderReadiness(providerId, env)`
- auth-source detection for Claude subscription credentials vs `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`

Do not attempt live API calls in this milestone; keep readiness deterministic and local.

- [ ] **Step 5: Run the targeted tests**

Run:
- `corepack pnpm test apps/web/src/lib/__tests__/appConfigStore.test.ts`
- `corepack pnpm test apps/web/src/lib/__tests__/providerReadiness.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/src/lib/appConfigStore.ts apps/web/src/lib/providerReadiness.ts apps/web/src/lib/__tests__/appConfigStore.test.ts apps/web/src/lib/__tests__/providerReadiness.test.ts
git commit -m "feat(web): add onboarding config and readiness helpers"
```

## Task 3: Onboarding orchestration + API routes

**Files:**
- Create: `apps/web/src/lib/onboarding.ts`
- Create: `apps/web/src/app/api/onboarding/config/route.ts`
- Create: `apps/web/src/app/api/onboarding/readiness/route.ts`
- Create: `apps/web/src/app/api/onboarding/start/route.ts`
- Modify: `apps/web/src/lib/demo.ts`

- [ ] **Step 1: Write failing route/orchestration tests**

Add tests or low-level helper tests for:
- returning default config when no file exists
- persisting selected mode/provider/strategy/shariah settings
- initializing demo mode seeds the durable ledger
- initializing personal local mode creates an empty durable ledger path without seeding demo events
- returning `/` as the next destination after successful onboarding

Run the relevant focused test file(s).
Expected: FAIL because the helpers/routes do not exist yet

- [ ] **Step 2: Implement `onboarding.ts`**

Implement helpers:
- `getOnboardingState()`
- `updateOnboardingConfig(partial)`
- `getProviderReadinessSnapshot(config)`
- `initializeSelectedMode(config)`

For demo mode, call the existing durable demo seed path.
For personal local mode, create the configured SQLite file through `SQLiteEventStore` without injecting demo events.

- [ ] **Step 3: Implement route handlers**

Add App Router JSON endpoints:
- `GET/PUT /api/onboarding/config`
- `GET /api/onboarding/readiness?provider=<id>`
- `POST /api/onboarding/start`

Validate inputs strictly and return shaped JSON errors for unsupported providers or invalid mode combinations.

- [ ] **Step 4: Update `demo.ts` integration points**

Make sure demo helpers remain compatible with onboarding-selected ledger paths and do not hard-code “setup ready” in a way that conflicts with uninitialized personal-local mode.

- [ ] **Step 5: Run targeted tests**

Run the focused onboarding helper/route tests.
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/onboarding.ts apps/web/src/app/api/onboarding/config/route.ts apps/web/src/app/api/onboarding/readiness/route.ts apps/web/src/app/api/onboarding/start/route.ts apps/web/src/lib/demo.ts
git commit -m "feat(web): add onboarding api and initialization flow"
```

## Task 4: Replace placeholder onboarding UI with a real wizard

**Files:**
- Modify: `apps/web/src/app/onboarding/page.tsx`
- Create: `apps/web/src/app/onboarding/OnboardingWizard.tsx`
- Create: `apps/web/src/components/__tests__/OnboardingWizard.test.tsx`

- [ ] **Step 1: Write failing onboarding UI tests**

Cover:
- mode step offers demo and personal-local modes
- provider step shows support badge and readiness text
- strategy step defaults to Buffett-Munger default posture
- Shariah defaults are visible and enabled by default
- start button posts to `/api/onboarding/start` and redirects to `/`

Run: `corepack pnpm test apps/web/src/components/__tests__/OnboardingWizard.test.tsx`
Expected: FAIL because the wizard does not exist yet

- [ ] **Step 2: Implement `OnboardingWizard.tsx`**

Build a compact client wizard with the spec-driven steps:
1. choose mode
2. connect provider
3. readiness summary
4. choose strategy
5. configure Shariah defaults
6. configure market universe
7. initialize ledger / start workflow

Keep the personal-local path honest: if the selected provider is not ready, show the missing credential source rather than pretending setup is complete.

- [ ] **Step 3: Convert `page.tsx` into a server wrapper**

Load the current onboarding state server-side and pass it to the wizard. Remove the “coming later” placeholder copy.

- [ ] **Step 4: Run the UI test**

Run: `corepack pnpm test apps/web/src/components/__tests__/OnboardingWizard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/onboarding/page.tsx apps/web/src/app/onboarding/OnboardingWizard.tsx apps/web/src/components/__tests__/OnboardingWizard.test.tsx
git commit -m "feat(web): replace onboarding placeholder with setup wizard"
```

## Task 5: Wire command-center entry to onboarding state

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/lib/demo.ts`
- Modify: `apps/web/src/components/__tests__/CommandCenter.test.tsx`

- [ ] **Step 1: Write failing command-center tests**

Add cases for:
- uninitialized personal-local mode shows setup/incomplete provider status instead of fake-ready demo messaging
- initialized demo mode still renders the durable demo command center
- initialized personal-local mode renders a clean empty-state command center with next best action

Run: `corepack pnpm test apps/web/src/components/__tests__/CommandCenter.test.tsx`
Expected: FAIL for the new cases

- [ ] **Step 2: Implement command-center state branching**

Use saved app config to determine whether `/` should show:
- demo seeded command center
- personal-local setup-needed summary
- personal-local empty-state summary after initialization

Do not break the existing deterministic demo path.

- [ ] **Step 3: Run the command-center tests**

Run: `corepack pnpm test apps/web/src/components/__tests__/CommandCenter.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/page.tsx apps/web/src/lib/demo.ts apps/web/src/components/__tests__/CommandCenter.test.tsx
git commit -m "feat(web): derive command center from onboarding state"
```

## Task 6: End-to-end verification

**Files:**
- Create: `apps/web/e2e/onboarding.spec.ts`
- Modify: `apps/web/e2e/demo-mode.spec.ts`

- [ ] **Step 1: Write the onboarding E2E coverage**

Cover:
- `/onboarding` demo mode -> start workflow -> `/` command center
- `/onboarding` personal-local mode -> choose Claude/OpenAI/mock provider -> readiness card reflects environment -> initialize -> `/` empty-state command center
- watch that setup does not require editing `.env` in the UI flow

- [ ] **Step 2: Run focused E2E and make it fail first**

Run: `corepack pnpm e2e --grep onboarding`
Expected: FAIL until the UI/routes are fully wired

- [ ] **Step 3: Make the E2E pass**

Adjust selectors/copy only as needed to keep the browser path robust.

- [ ] **Step 4: Run full verification**

Run:
- `git diff --check`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm lint`
- `corepack pnpm e2e`
- `NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/onboarding.spec.ts apps/web/e2e/demo-mode.spec.ts
git commit -m "test(web): cover onboarding flows"
```

## Self-review

- Spec coverage: This plan covers the missing first-run onboarding wizard, provider readiness, strategy choice, Shariah defaults, market universe config, local ledger init, and command-center handoff. It intentionally does not include full live-provider execution, scheduled worker automation, accounting, or purification workflows.
- Placeholder scan: No TBD markers or “implement later” placeholders are left inside the task steps.
- Type consistency: `AppConfig`, `OwlfolioMode`, `ProviderId`, and readiness/support-level types are introduced once in `packages/shared` and reused downstream.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-owlfolio-v02-onboarding-local-mode.md`.

Because the user explicitly asked to continue, default to Inline Execution in this session using the plan as the working checklist, unless they later ask to switch to subagent-driven execution.
