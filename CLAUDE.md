# Owlfolio v2

Owlfolio v2 is a TypeScript/pnpm monorepo for a local-first, web-first investment workflow system. The old Python/FastAPI/Claude-only instructions are historical and should not be used for this branch.

## Current stack

- TypeScript workspace managed by `pnpm@11.3.0` through Corepack.
- `apps/web`: local Next.js app; primary product surface at `http://127.0.0.1:3000`.
- `apps/worker`: local scheduled-task worker; currently one-tick/dry-run oriented.
- `packages/ledger`: append-only SQLite event store, event contracts, projections.
- `packages/workflow`: research/watchlist/holding/review/Shariah workflow helpers.
- `packages/providers`: provider catalog, adapters, certification runner.
- `packages/shared`: shared app config and provider/domain types.
- `packages/shariah`: Shariah policy helpers.

## Setup and local run

```bash
corepack enable
corepack pnpm install
corepack pnpm dev
```

Open `http://127.0.0.1:3000`. The browser onboarding flow writes local app config and ledger paths; normal setup should not require editing `.env`.

Useful runtime path overrides:

```bash
OWLFOLIO_PROJECT_DIR=$PWD
OWLFOLIO_APP_CONFIG_PATH=$PWD/data/app-config.json
OWLFOLIO_DEMO_LEDGER_PATH=$PWD/data/demo-ledger.sqlite
OWLFOLIO_PERSONAL_LEDGER_PATH=$PWD/data/personal-ledger.sqlite
OWLFOLIO_LEDGER_PATH=$PWD/data/owlfolio-ledger.sqlite
OWLFOLIO_SOURCE_LEDGER_PATH=$PWD/data/source-ledger
OWLFOLIO_PROVIDER_CERTIFICATION_DIR=$PWD/data/provider-certifications
```

`data/`, `.next/`, `test-results/`, `playwright-report/`, `*.tsbuildinfo`, `.playwright-runtime/`, `.live-openai-runtime/`, and `.worktrees/` are runtime/generated artifacts and must not be committed unless a tracked fixture or certification report is intentionally updated.

## Providers

Current provider IDs:

- `mock-provider`: certified deterministic demo/test provider.
- `openai` / `openai-codex-cli`: experimental OpenAI Codex CLI-backed personal-local path.
- `claude`: experimental Claude CLI-backed path, but the latest local certification report marks it unsupported/not-configured in this environment.
- `openai-api`: direct OpenAI API candidate; locally runnable with `OPENAI_API_KEY` but fail-closed until target-specific latest certification is recorded.
- `gemini-developer-api`: direct Gemini Developer API candidate; experimental/fail-closed until privacy posture and target-specific latest certification are recorded.
- `gemini-cli`: Google/Gemini CLI sign-in onboarding lane; setup-only until an execution adapter and certification report exist.

Provider claims must be bounded by `data/provider-certifications/*.latest.json` and `docs/architecture/owlfolio-v2-provider-model-support.md`. Do not describe any direct API or CLI surface as certified/live/autonomous until a corresponding target-specific latest report exists and passes the required scenarios.

Credential/readiness checks use:

- Claude: `ANTHROPIC_API_KEY` or `OWLFOLIO_CLAUDE_CREDENTIALS_PATH` / default Claude credentials.
- OpenAI/Codex: `OPENAI_API_KEY`, `CODEX_ACCESS_TOKEN`, `OWLFOLIO_CODEX_AUTH_PATH`, or `CODEX_HOME`.
- Gemini: `GEMINI_API_KEY` / `GOOGLE_API_KEY` for the Developer API candidate; `GEMINI_HOME`, `OWLFOLIO_GEMINI_CLI_AUTH_PATH`, and `OWLFOLIO_GEMINI_CLI_STATUS` for the setup-only CLI lane.

Readiness is not certification. If a latest certification report is `not-configured`, `unsupported`, or `experimental`, UI/docs should say so even if a credential file exists.

## Worker

Run one dry-run tick from the repo root:

```bash
corepack pnpm worker -- --once --dry-run --define-defaults
```

Limit to one task kind:

```bash
corepack pnpm --filter @owlfolio/worker dev -- --task-kind review_reminder
corepack pnpm --filter @owlfolio/worker dev -- --task-kind watchlist_monitor
```

The worker is dry-run/mock-safe for the alpha. It records scheduled-task lifecycle events and observations, but it must not auto-approve investment decisions, buy/sell actions, watchlist confirmations, holding opens, Shariah overrides, or purification payments.

## Verification

Use these gates on the final tree:

```bash
git diff --check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm audit --filter @owlfolio/web --prod --audit-level moderate
NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build
corepack pnpm e2e
```

For provider certification:

```bash
corepack pnpm certify:providers
```

For a dry-run worker smoke test with isolated state:

```bash
OWLFOLIO_PROJECT_DIR=$PWD \
OWLFOLIO_LEDGER_PATH=$PWD/.data/local-worker-ledger.sqlite \
corepack pnpm worker -- --once --dry-run --define-defaults
```

Known warning: Next/Turbopack may print an NFT/import-trace warning around local filesystem helpers (`next.config.mjs`, `appConfigStore`, `onboarding`). Treat new warnings or generated-file churn as release blockers, but do not claim this known warning is a functional failure without reproducing a failing build/test.

## Product boundaries for v2 alpha

- Alpha is a local workflow demo and personal-local ledger slice, not a complete robo-advisor.
- Web workflow is primary; CLI is for developer/admin operations.
- Buffett-Munger is the main certified strategy direction; other strategy concepts remain experimental until policy/audit gates are complete.
- Shariah, accounting, and purification are first-class domains, but current screens are local-ledger/accounting aids, not professional legal/tax/Shariah rulings.
- Broker credentials, broker sync, live trading, automatic portfolio actions, tax filing, and production-grade direct API provider parity are out of scope unless explicitly requested.

## Coding conventions

- Prefer small, verified vertical slices.
- Use TDD for behavior changes: write a failing test, confirm RED, implement, rerun targeted and broad verification.
- Keep user-authored transitions separate from provider/worker-authored drafts and observations.
- Preserve stable `event_id`s and causation/correlation IDs in ledger projections.
- Do not infer holdings from watchlist drafts or provider recommendations; user confirmation/open-holding events are explicit ledger transitions.
- Monthly accounting projections must be bounded by the snapshot period/as-of date.
- Purification obligations and payments are separate auditable events.
- No secrets in git, logs, Kanban metadata, README examples, or provider reports.
