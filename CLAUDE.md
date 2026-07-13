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
OWLFOLIO_PERSONAL_LEDGER_PATH=$PWD/data/personal-ledger.sqlite
OWLFOLIO_LEDGER_PATH=$PWD/data/owlfolio-ledger.sqlite
OWLFOLIO_SOURCE_LEDGER_PATH=$PWD/data/source-ledger
OWLFOLIO_PROVIDER_CERTIFICATION_DIR=$PWD/data/provider-certifications
```

`data/`, `.next/`, `test-results/`, `playwright-report/`, `*.tsbuildinfo`, `.playwright-runtime/`, `.live-openai-runtime/`, and `.worktrees/` are runtime/generated artifacts and must not be committed unless a tracked fixture or certification report is intentionally updated.

## CLI

The web app is the primary surface; the CLI is a small inspect/diagnose/launch tool. All onboarding (mode, provider, API keys, model) lives in the browser, so the CLI is deliberately three commands. A repo-root `owlfolio` launcher runs it with no build step (it execs the workspace `tsx` on `apps/cli/src/index.ts`):

```bash
owlfolio start      # launch the app + open the browser to http://127.0.0.1:3000 (onboarding happens there)
owlfolio status     # mode, provider/model, readiness, and the onboarding gate (read-only, headless-safe)
owlfolio doctor     # diagnose config, the credential file (+ 0600 perms), the ledger, and certification state
```

Invocation forms, in order of brevity:

```bash
owlfolio <command>                # after putting the launcher on PATH: ln -s "$PWD/owlfolio" ~/.local/bin/owlfolio, a shell alias, or `corepack pnpm link --global`
./owlfolio <command>              # from the repo root, no setup
corepack pnpm owlfolio <command>  # zero-setup alternative (root package script)
```

The CLI is non-interactive and never authors an irreversible transition (no trades, watchlist confirmations, holding opens, or Shariah overrides) — those remain web + human-authored. It honors the same `OWLFOLIO_*` runtime overrides as the app and worker.

## Providers

The whole CLI/OAuth provider lane (Codex `openai`/`openai-codex-cli`, Claude CLI `claude`, Gemini CLI `gemini-cli`) was **retired**. Surviving providers are the function-calling tool-loop providers below. The `openai`/`anthropic` **vendor** ids and their models are preserved (they back the `*-api` providers and OpenRouter routes); only the CLI **providers** were removed.

Current provider IDs:

- `mock-provider`: certified deterministic demo/test provider.
- `openrouter`: the default personal-local provider — an OpenAI-compatible meta-aggregator that routes one `OPENROUTER_API_KEY` to many models. Proven grounded tool-loop; experimental/fail-closed until each *routed model* has its own target-specific certification report.
- `openai-api`: direct OpenAI API (OpenAI-compatible adapter); locally runnable with `OPENAI_API_KEY`, experimental/fail-closed until a target-specific latest certification is recorded.
- `anthropic-api`: direct Anthropic API (OpenAI-compatible adapter); locally runnable with `ANTHROPIC_API_KEY`, experimental/fail-closed likewise. Distinct from the retired Claude CLI login.
- `gemini-developer-api`: direct Gemini Developer API candidate; experimental/fail-closed until privacy posture and a target-specific latest certification are recorded.

The three direct API-key providers are `OpenRouterProvider` instances configured per-endpoint, so they share OpenRouter's certified `runToolLoop`.

Provider claims must be bounded by `data/provider-certifications/*.latest.json` and `docs/architecture/owlfolio-v2-provider-model-support.md`. Do not describe any direct API surface as certified/live/autonomous until a corresponding target-specific latest report exists and passes the required scenarios.

Credential/readiness checks use:

- OpenRouter: `OPENROUTER_API_KEY`.
- OpenAI: `OPENAI_API_KEY`.
- Anthropic: `ANTHROPIC_API_KEY`.
- Gemini: `GEMINI_API_KEY` / `GOOGLE_API_KEY`.

Keys are stored in the local env file (`OWLFOLIO_ENV_FILE`, default `~/.owlfolio/.env`), never the ledger, logs, or git.

Readiness is not certification. If a latest certification report is `not-configured`, `unsupported`, or `experimental`, UI/docs should say so even if a credential file exists. Certification is a deeper, optional audit — a capable reasoning model (reasoning + tool-calling + structured output, the OpenRouter picker's floor) can be used before a report exists; responsibility for the choice sits with the user. For any live model-calling cert/test on OpenRouter, use GLM (owner preference: cheapest with the highest intelligence index) via `OWLFOLIO_CERTIFY_MODEL`.

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

The worker is dry-run/mock-safe for the alpha. It records scheduled-task lifecycle events and observations, but it must not auto-approve investment decisions, buy/sell actions, watchlist confirmations, holding opens, or Shariah overrides.

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
- Buffett-Munger is the default strategy direction; other strategy concepts remain experimental until policy/audit gates are complete.
- SCALE-DOWN (owner-locked 2026-07-13): Owlfolio is a GROUNDED RESEARCH-AND-DECISION system — discovery → four-pillar research → zones/price checks → watchlist → held THESES (entry price is the one manual field). The accounting/bookkeeping half (monthly books, portfolio values, the purification obligation/payment ledger, contribution tracking, investable capital, position sizing) is REMOVED: its ground truth is unverifiable by design. Legacy events remain readable in the audit timeline.
- Shariah SCREENING is first-class and fully grounded (the front gate, harness-recomputed AAOIFI ratios, and the purification RATE as dossier guidance) — but it is a local screening aid, not a professional legal/tax/Shariah ruling. The /passive page is educational only (Shariah-ETF pedagogy; nothing tracked).
- Broker credentials, broker sync, live trading, automatic portfolio actions, tax filing, and production-grade direct API provider parity are out of scope unless explicitly requested.

## Coding conventions

- Prefer small, verified vertical slices.
- Use TDD for behavior changes: write a failing test, confirm RED, implement, rerun targeted and broad verification.
- Keep user-authored transitions separate from provider/worker-authored drafts and observations.
- Preserve stable `event_id`s and causation/correlation IDs in ledger projections.
- Do not infer holdings from watchlist drafts or provider recommendations; user confirmation/open-holding events are explicit ledger transitions.
- No secrets in git, logs, Kanban metadata, README examples, or provider reports.
