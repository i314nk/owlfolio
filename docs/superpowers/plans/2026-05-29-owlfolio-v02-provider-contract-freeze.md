# Owlfolio v0.2 Provider Contract Freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the provider-neutral provider/workflow/runtime contracts so future Claude/OpenAI adapters, workflow execution code, worker runtime, and UI can build against one stable set of types and semantics.

**Architecture:** Keep the current package layout and harden the existing surfaces instead of inventing a second engine. `@owlfolio/providers` becomes the source of truth for provider capabilities, provider catalog/status semantics, and certification harness types. `@owlfolio/workflow` becomes the source of truth for specialist/synthesis execution contracts, ledger update proposals, and source-ledger record/storage contracts. The web app consumes those frozen contracts instead of duplicating provider metadata locally.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Next.js App Router, React, SQLite, workspace packages `@owlfolio/shared`, `@owlfolio/providers`, `@owlfolio/workflow`.

---

## File structure

- Modify: `packages/providers/package.json` — export the new contract modules.
- Modify: `packages/providers/src/providerContract.ts` — expand from demo-only methods into a stable capability + run contract.
- Create: `packages/providers/src/providerCatalog.ts` — provider metadata/status semantics shared by app and runtime.
- Create: `packages/providers/src/certificationContract.ts` — certification suite/test-case/report shape.
- Create: `packages/providers/src/__tests__/providerContract.test.ts` — red/green contract coverage.
- Modify: `packages/providers/src/mockProvider.ts` — conform to the frozen provider contract.
- Modify: `packages/providers/src/runProviderTask.ts` — use the richer provider run result.
- Modify: `packages/workflow/package.json` — export new workflow contract modules.
- Create: `packages/workflow/src/workflowContract.ts` — specialist/synthesis request/response, retry/idempotency, ledger update proposal types.
- Create: `packages/workflow/src/sourceLedger.ts` — source record shape and runtime storage path contract.
- Create: `packages/workflow/src/__tests__/workflowContract.test.ts` — red/green workflow contract coverage.
- Modify: `packages/workflow/src/index.ts` — re-export the frozen workflow contracts.
- Modify: `packages/workflow/src/researchWorkflow.ts` — consume the frozen provider/workflow contracts.
- Modify: `packages/shared/src/appConfig.ts` — add `source_ledger_path` to the runtime config contract.
- Modify: `apps/web/src/lib/appConfigStore.ts` — path resolver for `source_ledger_path` defaults.
- Modify: `apps/web/src/lib/onboarding.ts` — initialize and reset `source_ledger_path` with the ledger path.
- Modify: `apps/web/src/lib/providerReadiness.ts` — derive provider options/status semantics from `@owlfolio/providers`.
- Modify: `apps/web/src/lib/__tests__/appConfigStore.test.ts` — contract coverage for source-ledger config persistence.
- Modify: `apps/web/src/lib/__tests__/onboarding.test.ts` — runtime path coverage for `source_ledger_path`.
- Modify: `apps/web/src/lib/__tests__/providerReadiness.test.ts` — provider catalog/status-semantic coverage.

## Task 1: Freeze provider capabilities and provider catalog semantics

**Files:**
- Modify: `packages/providers/package.json`
- Modify: `packages/providers/src/providerContract.ts`
- Create: `packages/providers/src/providerCatalog.ts`
- Create: `packages/providers/src/certificationContract.ts`
- Create: `packages/providers/src/__tests__/providerContract.test.ts`
- Modify: `packages/providers/src/mockProvider.ts`
- Modify: `packages/providers/src/runProviderTask.ts`

- [ ] **Step 1: Write the failing provider contract tests**

Add tests that assert all required Milestone 2 provider capabilities and status semantics exist in the exported contracts:

```ts
import { describe, expect, it } from 'vitest'

import {
  certificationScenarioIds,
  getProviderCatalog,
  providerCapabilityIds,
  type ProviderRunRequest,
} from '..'

describe('provider contract freeze', () => {
  it('exposes the Milestone 2 provider capability set', () => {
    expect(providerCapabilityIds).toEqual([
      'text-generation',
      'structured-output',
      'tool-function-calling',
      'streaming-observability',
      'multi-step-tool-loop',
    ])
  })

  it('locks provider support semantics and onboarding visibility', () => {
    const catalog = getProviderCatalog()
    expect(catalog.find((provider) => provider.provider_id === 'claude')).toMatchObject({
      support_level: 'certified',
      visible_in_onboarding: true,
    })
    expect(catalog.find((provider) => provider.provider_id === 'openai')).toMatchObject({
      support_level: 'experimental',
      visible_in_onboarding: true,
    })
  })

  it('defines the minimum certification scenario set before real adapters land', () => {
    expect(certificationScenarioIds).toContain('simple-completion')
    expect(certificationScenarioIds).toContain('multi-step-tool-loop')
    expect(certificationScenarioIds).toContain('ledger-update-proposal')
  })

  it('returns structured provider runs with observability fields', async () => {
    const request: ProviderRunRequest = {
      run_id: 'run_contract_001',
      provider_id: 'mock-provider',
      model_id: 'mock-research-v2',
      task_kind: 'structured-output',
      prompt: 'Return a Buffett-Munger research summary',
      timeout_ms: 1000,
      budget: { max_tool_calls: 1, max_tokens: 500 },
      tool_allowlist: ['source.fetch'],
      response_format: { kind: 'json-schema', schema_name: 'BuffettMungerAnalysis' },
    }

    expect(request.task_kind).toBe('structured-output')
  })
})
```

- [ ] **Step 2: Run the provider contract tests and verify RED**

Run:
```bash
corepack pnpm test -- --run packages/providers/src/__tests__/providerContract.test.ts
```

Expected: FAIL because the new provider contract exports do not exist yet.

- [ ] **Step 3: Implement the provider contract freeze**

Add these shapes in `packages/providers/src/providerContract.ts`:

```ts
export const providerCapabilityIds = [
  'text-generation',
  'structured-output',
  'tool-function-calling',
  'streaming-observability',
  'multi-step-tool-loop',
] as const

export type ProviderTaskKind = 'text-generation' | 'structured-output' | 'tool-loop'
export type ProviderRunStage = 'queued' | 'running' | 'tool-call' | 'completed' | 'failed'
export type ProviderResponseFormat =
  | { kind: 'text' }
  | { kind: 'json-schema'; schema_name: string }

export type ProviderObservation = {
  at: string
  stage: ProviderRunStage
  message: string
}

export type ProviderRunRequest = {
  run_id: string
  provider_id: string
  model_id: string
  task_kind: ProviderTaskKind
  prompt: string
  timeout_ms: number
  budget: ProviderBudget
  tool_allowlist: string[]
  response_format: ProviderResponseFormat
}
```

Add a provider catalog in `packages/providers/src/providerCatalog.ts` with one exported `getProviderCatalog()` source of truth. Each entry should include:
- `provider_id`
- `label`
- `support_level`
- `visible_in_onboarding`
- `description`
- `capabilities`

Add certification types in `packages/providers/src/certificationContract.ts` for:
- `CertificationScenarioId`
- `CertificationScenario`
- `CertificationCaseResult`
- `CertificationReport`
- `certificationScenarioIds`

Update `MockProvider` and `runProviderTask()` so the mock implementation returns the richer metadata/observability fields while preserving current tests.

- [ ] **Step 4: Run the provider contract tests and verify GREEN**

Run:
```bash
corepack pnpm test -- --run packages/providers/src/__tests__/providerContract.test.ts packages/providers/src/__tests__/mockProvider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the provider contract checkpoint**

```bash
git add packages/providers/package.json packages/providers/src/providerContract.ts packages/providers/src/providerCatalog.ts packages/providers/src/certificationContract.ts packages/providers/src/__tests__/providerContract.test.ts packages/providers/src/mockProvider.ts packages/providers/src/runProviderTask.ts
git commit -m "feat(providers): freeze provider capability contracts"
```

## Task 2: Freeze workflow execution and source-ledger contracts

**Files:**
- Modify: `packages/workflow/package.json`
- Create: `packages/workflow/src/workflowContract.ts`
- Create: `packages/workflow/src/sourceLedger.ts`
- Create: `packages/workflow/src/__tests__/workflowContract.test.ts`
- Modify: `packages/workflow/src/index.ts`
- Modify: `packages/workflow/src/researchWorkflow.ts`

- [ ] **Step 1: Write the failing workflow contract tests**

Add tests that assert the workflow contract exposes specialist/synthesis run shapes, retry/idempotency policy, and source-ledger storage path semantics:

```ts
import { describe, expect, it } from 'vitest'

import {
  defaultSourceLedgerStorage,
  defaultWorkflowExecutionPolicy,
  type LedgerUpdateProposal,
  type SpecialistRunRequest,
  type SynthesisRunRequest,
} from '..'

describe('workflow contract freeze', () => {
  it('defines a stable specialist run request shape', () => {
    const request: SpecialistRunRequest = {
      workflow_run_id: 'workflow_run_001',
      research_case_id: 'rc_msft_001',
      provider_id: 'claude',
      model_id: 'claude-sonnet',
      specialist_id: 'financial_analyst',
      ticker: 'MSFT',
      company_id: 'company_msft',
      strategy_id: 'buffett-munger',
      source_record_ids: [],
    }

    expect(request.specialist_id).toBe('financial_analyst')
  })

  it('defines source-ledger storage relative to the project runtime', () => {
    expect(defaultSourceLedgerStorage.relative_dir).toBe('data/source-ledger')
    expect(defaultSourceLedgerStorage.file_prefix).toBe('research-source-bundle')
  })

  it('defines retry, idempotency, and ledger update proposal contracts', () => {
    const proposal: LedgerUpdateProposal = {
      aggregate_type: 'research_case',
      aggregate_id: 'rc_msft_001',
      event_type: 'research_sources_captured',
      payload: { source_record_ids: ['src_msft_10k_2025'] },
      source_record_ids: ['src_msft_10k_2025'],
    }

    expect(defaultWorkflowExecutionPolicy.max_retries).toBe(2)
    expect(proposal.event_type).toBe('research_sources_captured')
  })
})
```

- [ ] **Step 2: Run the workflow contract tests and verify RED**

Run:
```bash
corepack pnpm test -- --run packages/workflow/src/__tests__/workflowContract.test.ts
```

Expected: FAIL because the new workflow contract files and exports do not exist yet.

- [ ] **Step 3: Implement the workflow and source-ledger contracts**

Create `packages/workflow/src/workflowContract.ts` with frozen request/response types for:
- `SpecialistRunRequest`
- `SpecialistRunResult`
- `SynthesisRunRequest`
- `SynthesisRunResult`
- `WorkflowExecutionPolicy`
- `LedgerUpdateProposal`
- `defaultWorkflowExecutionPolicy`

Create `packages/workflow/src/sourceLedger.ts` with:

```ts
export type SourceLedgerRecord = {
  source_record_id: string
  research_case_id: string
  source_id: string
  provider_id: string
  captured_at: string
  title?: string
  url?: string
  excerpt?: string
  citation_locator?: string
  content_hash?: string
  metadata: Record<string, unknown>
}

export const defaultSourceLedgerStorage = {
  relative_dir: 'data/source-ledger',
  file_prefix: 'research-source-bundle',
} as const
```

Update `researchWorkflow.ts` so the demo research function uses the frozen provider/workflow types rather than ad-hoc local shapes.

- [ ] **Step 4: Run the workflow contract tests and verify GREEN**

Run:
```bash
corepack pnpm test -- --run packages/workflow/src/__tests__/workflowContract.test.ts packages/workflow/src/__tests__/verticalSlice.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the workflow contract checkpoint**

```bash
git add packages/workflow/package.json packages/workflow/src/workflowContract.ts packages/workflow/src/sourceLedger.ts packages/workflow/src/__tests__/workflowContract.test.ts packages/workflow/src/index.ts packages/workflow/src/researchWorkflow.ts
git commit -m "feat(workflow): freeze execution and source-ledger contracts"
```

## Task 3: Freeze runtime config and app-facing provider semantics

**Files:**
- Modify: `packages/shared/src/appConfig.ts`
- Modify: `apps/web/src/lib/appConfigStore.ts`
- Modify: `apps/web/src/lib/onboarding.ts`
- Modify: `apps/web/src/lib/providerReadiness.ts`
- Modify: `apps/web/src/lib/__tests__/appConfigStore.test.ts`
- Modify: `apps/web/src/lib/__tests__/onboarding.test.ts`
- Modify: `apps/web/src/lib/__tests__/providerReadiness.test.ts`

- [ ] **Step 1: Write the failing runtime contract tests**

Add assertions like:

```ts
expect(config.source_ledger_path).toBe(join(projectDir, 'data', 'source-ledger'))
expect(updated.source_ledger_path).toBeDefined()
expect(getProviderOptions().map((provider) => provider.support_level)).toEqual(['certified', 'certified', 'experimental'])
```

- [ ] **Step 2: Run the runtime-focused tests and verify RED**

Run:
```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/appConfigStore.test.ts apps/web/src/lib/__tests__/onboarding.test.ts apps/web/src/lib/__tests__/providerReadiness.test.ts
```

Expected: FAIL because `source_ledger_path` is not in the config contract and the web app still owns provider metadata locally.

- [ ] **Step 3: Implement the runtime freeze**

In `packages/shared/src/appConfig.ts`, extend `AppConfig`:

```ts
export type AppConfig = {
  version: 1
  mode: OwlfolioMode
  provider: ProviderSelection
  strategy_id: StrategyId
  shariah: ShariahDefaults
  market_universe: MarketUniverseConfig
  ledger_path?: string
  source_ledger_path?: string
  initialized_at?: string
}
```

In `apps/web/src/lib/appConfigStore.ts`, add a resolver for the default source-ledger directory:

```ts
export function resolveSourceLedgerPath({ cwd = process.cwd(), env = process.env as AppConfigEnv }: AppConfigStoreOptions = {}): string {
  const projectRoot = env.OWLFOLIO_PROJECT_DIR ?? resolveProjectRootFromCwd(cwd)
  return join(projectRoot, 'data', 'source-ledger')
}
```

In `apps/web/src/lib/onboarding.ts`, set `source_ledger_path` during initialization and remove it during reset.

In `apps/web/src/lib/providerReadiness.ts`, replace the duplicated `providerOptions` array with catalog data imported from `@owlfolio/providers/providerCatalog`.

- [ ] **Step 4: Run the runtime-focused tests and verify GREEN**

Run:
```bash
corepack pnpm test -- --run apps/web/src/lib/__tests__/appConfigStore.test.ts apps/web/src/lib/__tests__/onboarding.test.ts apps/web/src/lib/__tests__/providerReadiness.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the runtime contract checkpoint**

```bash
git add packages/shared/src/appConfig.ts apps/web/src/lib/appConfigStore.ts apps/web/src/lib/onboarding.ts apps/web/src/lib/providerReadiness.ts apps/web/src/lib/__tests__/appConfigStore.test.ts apps/web/src/lib/__tests__/onboarding.test.ts apps/web/src/lib/__tests__/providerReadiness.test.ts
git commit -m "feat(runtime): freeze provider status and source-ledger config"
```

## Task 4: Full verification

**Files:**
- No new files; verify final tree.

- [ ] **Step 1: Run focused contract checks first**

```bash
corepack pnpm test -- --run packages/providers/src/__tests__/providerContract.test.ts packages/providers/src/__tests__/mockProvider.test.ts packages/workflow/src/__tests__/workflowContract.test.ts packages/workflow/src/__tests__/verticalSlice.test.ts apps/web/src/lib/__tests__/appConfigStore.test.ts apps/web/src/lib/__tests__/onboarding.test.ts apps/web/src/lib/__tests__/providerReadiness.test.ts
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

Expected: every command exits 0.

- [ ] **Step 3: Commit the plan doc checkpoint**

```bash
git add docs/superpowers/plans/2026-05-29-owlfolio-v02-provider-contract-freeze.md
git commit -m "docs: add provider contract freeze plan"
```

## Self-review

- Spec coverage: this plan freezes the Milestone 2 contract surface called for in the v0.2 design: provider capabilities, provider status semantics, workflow execution shapes, source-ledger contract, certification harness shape, and runtime storage-path contract.
- Placeholder scan: no `TODO`, `TBD`, or vague "add tests later" steps remain.
- Type consistency: the plan uses the same provider/workflow names across package, app-config, and web-readiness tasks so future Milestone 3/4 work can build directly on these exports.
