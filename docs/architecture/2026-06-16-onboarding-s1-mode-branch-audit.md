# Onboarding S1 — three-state mode model + mode-branch audit

Status: implemented (slice S1 of the onboarding-consolidation track).

## The trap this slice closes

`config.mode` was `'demo' | 'personal-local'` with a default of `'demo'`. A real fresh install
silently fell through to **demo mode** (mock-provider + seeded data) with no first-class "I have not
chosen yet" state. S1 makes the model **three-state**:

```
unconfigured | demo | personal-local
```

- `unconfigured` is now an **explicit enum member** (`packages/shared/src/appConfig.ts`,
  `owlfolioModeValues = ['unconfigured', 'demo', 'personal-local']`) and the **default for a real
  fresh install** (`defaultUnconfiguredAppConfig()` via
  `defaultAppConfigForNewInstall()` in `apps/web/src/lib/appConfigStore.ts`).
- `demo` and `personal-local` are deliberately **chosen** states. Nothing falls into `demo` by
  default any more.
- Absence-based defaulting (relying on `initialized_at === undefined`) is no longer the signal for
  "not set up"; `mode === 'unconfigured'` is the explicit value every branch must handle.

## How the default-flip was kept green (test path stays demo)

`loadAppConfig` returns `defaultAppConfigForNewInstall(env)`:

- Under **test mode** (`OWLFOLIO_TEST_MODE === 'playwright'` or `VITEST` set in the passed env or
  `process.env`) it returns `defaultDemoAppConfig()` — so `demo-mode.spec.ts` and the unit tests that
  assume a demo default stay usable WITHOUT depending on the S5 e2e→programmatic-init migration.
- Otherwise (a real install) it returns `defaultUnconfiguredAppConfig()`.
- `OWLFOLIO_DISABLE_TEST_DEFAULTS=1` forces the real-install branch so a unit test can assert the
  production (unconfigured) behaviour even under the vitest runner.

## Mode-branch call-site classification

Tags: **(a)** personal-local-guarded (`mode === 'personal-local'` → `unconfigured` naturally
excluded, feature stays off — SAFE); **(b)** explicit-demo (`mode === 'demo'` → only fires for chosen
demo — SAFE); **(c)** implicit-else (a `mode === 'demo' ? demo : …` / `else` arm that an
`unconfigured` config would now hit and render demo OR a misleading empty configured-workflow view —
MUST-FIX).

### (c) MUST-FIX — every data-loading page (fixed)

Each branched `state.config.mode === 'demo' ? <demo data> : <personal data, empty if no ledger>`.
With `unconfigured` they would have rendered an empty *personal* view that looks like a configured but
empty workflow (and the command center would have mis-routed). Each now short-circuits FIRST on
`isUnconfigured(state.config)` (`apps/web/src/lib/modeView.ts`) and renders `UnconfiguredNotice`
(`apps/web/src/components/UnconfiguredNotice.tsx`) — a "Choose a mode to begin" state steering to
`/onboarding` and `/settings/providers`, never demo data.

| Site | Fix |
| --- | --- |
| `apps/web/src/lib/demo.ts` `getSetupAwareCommandCenter` | explicit `unconfigured` branch: "Choose a mode to begin", zero counts, no demo seed, steers to `/onboarding` + `/settings/providers` |
| `apps/web/src/app/research/page.tsx` | `UnconfiguredNotice feature="Research library"` |
| `apps/web/src/app/research/[caseId]/page.tsx` | `UnconfiguredNotice feature="Research case"` |
| `apps/web/src/app/watchlist/page.tsx` | `UnconfiguredNotice feature="Watchlist"` |
| `apps/web/src/app/pipeline/page.tsx` | `UnconfiguredNotice feature="Pipeline"` |
| `apps/web/src/app/portfolio/page.tsx` | `UnconfiguredNotice feature="Portfolio"` (helper `loadHoldings` widened to `WorkflowMode`) |
| `apps/web/src/app/lifecycle/page.tsx` | `UnconfiguredNotice feature="Lifecycle"` |
| `apps/web/src/app/purification/page.tsx` | `UnconfiguredNotice feature="Purification"` |
| `apps/web/src/app/calibration/page.tsx` | `UnconfiguredNotice feature="Calibration"` |
| `apps/web/src/app/audit/page.tsx` | `UnconfiguredNotice feature="Audit"` |
| `apps/web/src/app/accounting/monthly/page.tsx` | `UnconfiguredNotice feature="Accounting"` |
| `apps/web/src/app/performance/page.tsx` | `UnconfiguredNotice feature="Performance"` |
| `apps/web/src/app/research/new/page.tsx` | already gated to `personal-local`+initialized; added an explicit `unconfigured` block message (type widened to `OwlfolioMode`) |

### (a) personal-local-guarded — SAFE, no behaviour change

`unconfigured` is naturally excluded (the gated feature stays off):

- `apps/web/src/lib/workflow.ts` — all the `mode !== 'personal-local'` / `mode === 'personal-local'`
  workflow gates (`enqueueResearchRun`, deep-dive, promote/admit/sell, holding-review, investable
  capital, etc., ~15 sites at lines 279, 406, 650, 784, 984, 1250, 1494, 1547, 1579, 1613, 1651,
  1695, 1730).
- `apps/web/src/lib/calibrationActions.ts` (lines 27, 112) — `mode !== 'personal-local'` guards.
- `apps/web/src/components/PortfolioPanel.tsx`, `ResearchCasePanel.tsx`, `WatchlistPanel.tsx` —
  `mode === 'personal-local'` rendering guards (and these components are only reached for
  demo/personal-local because the page short-circuits unconfigured upstream).
- `apps/web/src/app/portfolio/page.tsx` `getInvestableCapital` call — `mode === 'personal-local'`.

### (b) explicit-demo — SAFE, only fires for chosen demo

- `apps/web/src/lib/workflow.ts` (501, 518, 532) `getApp*FromStore` `mode === 'demo'` branches.
- `apps/web/src/components/AuditActivityPanel.tsx:229` demo-vs-personal ledger label (display only;
  page short-circuits unconfigured).
- `apps/web/src/app/onboarding/OnboardingWizard.tsx` — the SETUP surface where the user picks a mode;
  its `mode === 'demo'` literals describe the chosen-mode action, not a fall-through.

### Type-only widenings required by the new enum member

- `packages/shared/src/runtimeBackup.ts` local `AppConfig.mode` union widened to include
  `'unconfigured'` (records the mode in the backup manifest; SAFE).
- `apps/web/src/app/portfolio/page.tsx` `loadHoldings(mode)` and `apps/web/src/app/research/new/page.tsx`
  `getResearchBlockMessage(mode)` widened off the old `'demo' | 'personal-local'` literal.
- `WorkflowMode = AppConfig['mode']` automatically picked up `'unconfigured'`; no component switch
  was non-exhaustive in a way that broke typecheck.

## Idempotent, non-destructive re-init (Decision 2)

`initializeSelectedMode` (first-run) was left intact. A NEW guarded `switchMode(mode, options)`
(`apps/web/src/lib/onboarding.ts`) is the safe re-entry path:

1. Re-selecting the already-initialized current mode is a **no-op** — appends nothing, re-seeds
   nothing, leaves `initialized_at` unchanged.
2. Switching demo↔personal-local repoints `ledger_path` at the other mode's ledger WITHOUT wiping or
   re-seeding either; the previous mode's events are preserved.
3. A demo ledger is seeded only when empty/new (and `seedDemoLedger` is event-level idempotent via
   idempotency keys regardless).
4. `initialized_at` is stamped once (first time the app leaves the uninitialized state) and preserved
   thereafter.

Exercised by `apps/web/src/lib/__tests__/onboarding.test.ts`:
- demo→personal-local→demo→personal-local preserves the personal ledger's events + timestamp.
- re-selecting the current mode appends nothing, re-seeds nothing, leaves `initialized_at` unchanged.

## Notes for later slices

- **S2 indicator:** `unconfigured` is represented by `config.mode === 'unconfigured'` (use
  `isUnconfigured(config)` from `apps/web/src/lib/modeView.ts`). It implies `is_initialized === false`,
  `ledger_path === undefined`, `initialized_at === undefined`. The command center's unconfigured
  dashboard uses `setup_status: 'Choose a mode to begin'` and
  `provider_status: 'Provider: not selected yet'`.
- **S3 (providers-page switch):** use `switchMode` (already idempotent + re-entry-tested here), not a
  re-run of `initializeSelectedMode`.
- **S5 (e2e migration):** the test path currently stays demo via `shouldUseTestDemoDefault`. When e2e
  moves to programmatic init, the `OWLFOLIO_TEST_MODE`/`VITEST` demo default can be removed so real
  installs and tests both start `unconfigured`.
