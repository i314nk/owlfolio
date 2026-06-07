# Owlfolio v2 Automation-First Local-Use Candidate Checkpoint

Date: 2026-06-04

Status: automation-first local-use candidate

Checkpoint commits on local `main`:

- `b6da4a50fde921265e0a55c765b0c2f5c6246b3a` — `merge: Owlfolio v2 private beta checkpoint`
- `86f18f0e0c976b9cc576afb030773b3eb9bf84aa` — `checkpoint: add clean cockpit learn surface`

Remote publish status at time of writing:

- Local `main` contains the checkpoint merge and the clean cockpit/Learn surface polish commit.
- Push to `origin/main` is pending explicit user approval.
- Project-agent GitHub auth requires the normal-home pattern: `HOME=/home/hermes_agent git push origin main`.
- Intended remote target: `https://github.com/i314nk/owlfolio.git`, branch `main`.

## What this checkpoint includes

This checkpoint turns Owlfolio v2 into an automation-first local-use candidate centered on a certified demo/mock-provider path and personal-local ledger workflow. It consolidates the recent provider-readiness, source-evidence, worker-safety, approval, accounting, purification, backup/restore, Data Safety, and local UX stabilization work.

Major included areas:

- Provider readiness and onboarding surfaces
  - separates provider surfaces instead of collapsing CLI/API/provider readiness
  - treats mock provider as the certified demo/local path
  - keeps real provider paths gated by explicit readiness/certification evidence
  - keeps Gemini CLI setup-only rather than implying execution capability

- Strategy pipeline and workflow state
  - default Buffett-Munger strategy posture without claiming strategy certification
  - future selectable strategies remain experimental until policy/audit/provider gates pass
  - research flow covers discovery, quick screen, deep dive, decision drafts, watchlist, and holding transitions

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

- Accounting, purification, and Data Safety
  - automatic local portfolio/accounting/purification projections from ledger events and manual/source-backed inputs
  - monthly accounting projection
  - purification obligation/payment tracking
  - clearer distinction between ledger-backed cash flow and valuation/manual updates
  - local backup inventory excludes credentials, provider auth homes, build outputs, and runtime caches
  - web Data Safety remains status/proposal evidence, not destructive restore control

- Backup/restore CLI and runbook
  - local backup manifest/inventory and restore verification support
  - credential/auth/log/build/test artifacts excluded by policy
  - restore verification uses credential-unsetting rather than redacted placeholder secrets

- Beta UX stabilization
  - audit search affordance
  - provider status scanability
  - portfolio review ergonomics
  - relevant component/e2e tests updated

- Clean cockpit/Learn polish
  - adds an in-app `/learn` route for deeper operator documentation
  - adds Learn to the primary navigation
  - moves backup/restore detail out of the Command Center into an operator fallback Learn section
  - keeps primary workflow surfaces focused on automation proposals, approvals, and auditability

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

The clean cockpit/Learn follow-up checkpoint was also reviewed and verified on local `main`:

- `git diff --check`
- `corepack pnpm typecheck`
- `corepack pnpm test`
  - 52 test files
  - 285 tests
- `corepack pnpm lint`
- `PLAYWRIGHT_BROWSERS_PATH=/home/hermes_agent/.hermes/profiles/code-agent/home/.cache/ms-playwright corepack pnpm e2e`
  - 9/9 passed
- Browser smoke:
  - `/`
  - `/learn`

## Supported label

Use this label:

- Owlfolio v2 automation-first local-use candidate

This means the checkpoint is suitable for trusted local usage around the certified demo/mock-provider workflow and personal-local ledger workflow. It does not imply public beta readiness, production SaaS operation, live trading, broker integration, or real-provider certified autonomy.

## Explicit non-goals / not yet supported

Do not describe this checkpoint as:

- public release-ready
- live real-provider certified autonomy
- autonomous trading
- autonomous portfolio mutation
- user-facing backup/restore complete
- Gemini CLI execution-adapter support

Real provider paths remain experimental/candidate unless target-specific certification evidence says otherwise.

Backup/restore remains CLI/operator/runbook-only. The web app surfaces Settings / Data Safety status and restore proposals, but it does not provide destructive restore controls.

## Remaining blocked local-user hardening card

Open blocked Kanban card:

- `t_8b9bc6d6` — `web: add Settings data safety panel for backup/restore manifest UX`

This card is not critical for the local-use candidate checkpoint, but it becomes critical for broader user-facing hardening.

Recommended treatment:

- keep blocked for the local-use candidate checkpoint
- unblock and scope as next local-user hardening milestone before broader tester/user distribution
- keep destructive restore out of web UX until an operator-confirmed restore flow is explicitly designed and reviewed

## Recommended next milestone

After remote publish is completed, choose one of:

1. Local-use candidate polish
   - manual UI clickthrough
   - screenshots/checklist
   - release/readme note alignment

2. Broader local-user hardening
   - unblock `t_8b9bc6d6`
   - implement Settings/Data Safety panel
   - run security/product review on backup manifest UX and user-facing privacy copy

3. Real provider readiness
   - certify individual provider surfaces separately
   - preserve fail-closed readiness semantics
   - do not introduce live autonomous mutations without explicit user confirmation boundaries
