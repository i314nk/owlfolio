# Owlfolio v2 Private/Local Beta Checkpoint

Date: 2026-06-04

Status: private/local beta candidate

Checkpoint commit on local `main`:

- `b6da4a50fde921265e0a55c765b0c2f5c6246b3a` — `merge: Owlfolio v2 private beta checkpoint`

Remote publish status at time of writing:

- Local `main` contains the checkpoint merge.
- Push to `origin/main` is pending because the local environment does not currently have GitHub credentials available.
- Intended remote target: `https://github.com/i314nk/owlfolio.git`, branch `main`.

## What this checkpoint includes

This checkpoint turns Owlfolio v2 into a local-first investment workflow cockpit centered on a certified demo/personal-local mock-provider path. It consolidates the recent provider-readiness, source-evidence, worker-safety, approval, accounting, purification, backup/restore, and beta UX stabilization work.

Major included areas:

- Provider readiness and onboarding surfaces
  - separates provider surfaces instead of collapsing CLI/API/provider readiness
  - treats mock provider as the certified demo/local path
  - keeps real provider paths gated by explicit readiness/certification evidence
  - keeps Gemini CLI setup-only rather than implying execution capability

- Durable source/evidence workflow
  - source ledger ingestion and source-bundle provenance
  - research evidence tied to auditability and workflow state

- Worker proposal safety
  - worker flow remains proposal/dry-run oriented
  - no autonomous portfolio mutation/trading is introduced
  - user confirmation remains the state-change boundary

- Approval queue / Command Center UX
  - operational state and queue awareness
  - provider and data-safety caveats surfaced in the product shell

- Accounting and purification
  - monthly accounting projection
  - purification obligation/payment tracking
  - clearer distinction between ledger-backed cash flow and valuation/manual updates

- Backup/restore CLI and runbook
  - local backup manifest/inventory and restore verification support
  - credential/auth/log/build/test artifacts excluded by policy
  - restore verification uses credential-unsetting rather than redacted placeholder secrets

- Beta UX stabilization
  - audit search affordance
  - provider status scanability
  - portfolio review ergonomics
  - relevant component/e2e tests updated

## Validation evidence

The merge-prep task reported the following validation passed on both the checkpoint branch and `main`:

- `git diff --check`
- `corepack pnpm typecheck`
- `corepack pnpm test`
  - 52 test files
  - 284 tests
- `corepack pnpm lint`
- `corepack pnpm audit --filter @owlfolio/web --prod --audit-level moderate`
  - no known vulnerabilities found
- `NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build`
  - passed with a known Turbopack/NFT trace warning
- `PLAYWRIGHT_BROWSERS_PATH=/home/hermes_agent/.hermes/profiles/code-agent/home/.cache/ms-playwright corepack pnpm e2e`
  - 7/7 passed

## Supported label

Use this label:

- Owlfolio v2 private/local beta candidate

This means the checkpoint is suitable for trusted local/private usage around the certified demo/mock-provider workflow.

## Explicit non-goals / not yet supported

Do not describe this checkpoint as:

- public release-ready
- live real-provider certified autonomy
- autonomous trading
- autonomous portfolio mutation
- user-facing backup/restore complete
- Gemini CLI execution-adapter support

Real provider paths remain experimental/candidate unless target-specific certification evidence says otherwise.

Backup/restore remains CLI/operator/runbook-only. The web app may surface caveats, but it does not yet provide a full Settings/Data Safety panel or destructive restore workflow.

## Remaining blocked beta-hardening card

Open blocked Kanban card:

- `t_8b9bc6d6` — `web: add Settings data safety panel for backup/restore manifest UX`

This card is not critical for private/local developer beta, but it becomes critical for broader user-facing beta.

Recommended treatment:

- keep blocked for private/local beta checkpoint
- unblock and scope as next beta-hardening milestone before broader tester/user distribution
- keep destructive restore out of web UX until an operator-confirmed restore flow is explicitly designed and reviewed

## Recommended next milestone

After remote publish is completed, choose one of:

1. Private/local beta polish
   - manual UI clickthrough
   - screenshots/checklist
   - release/readme note alignment

2. Broader beta hardening
   - unblock `t_8b9bc6d6`
   - implement Settings/Data Safety panel
   - run security/product review on backup manifest UX and user-facing privacy copy

3. Real provider readiness
   - certify individual provider surfaces separately
   - preserve fail-closed readiness semantics
   - do not introduce live autonomous mutations without explicit user confirmation boundaries
