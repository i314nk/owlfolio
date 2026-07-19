# Contributing to Owlfolio

Owner's Manual (engine namespace: Owlfolio) is a TypeScript/pnpm monorepo for a local-first investment workflow app — an educational project and portfolio piece. The pre-rework Python/FastAPI-era contribution notes no longer apply.

## Getting started

```bash
git clone https://github.com/i314nk/owlfolio.git
cd owlfolio
corepack enable
corepack pnpm install
corepack pnpm dev
```

Open `http://127.0.0.1:3000` and complete browser onboarding. Runtime config, SQLite ledgers, source bundles, and local provider certification reports are stored under `data/` by default and must stay out of git unless a tracked fixture/report is intentionally updated.

## Repository map

```text
apps/
  web/       Next.js local app and API routes
  worker/    local scheduled-task worker
  cli/       read-only launch/inspect/diagnose CLI
packages/
  ledger/    SQLite event store, event envelopes, domain contracts, projections
  providers/ provider catalog, adapters, certification runner
  shared/    app config and shared provider/domain types
  shariah/   Shariah policy helpers
  strategies/ strategy reference package
  workflow/  workflow helpers for research/watchlist/holdings/reviews/Shariah gates
```

## Running tests and verification

Run targeted tests first for the area you changed, then the release gate when preparing a PR or release handoff:

```bash
git diff --check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm audit --filter @owlfolio/web --prod --audit-level moderate
NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build
corepack pnpm e2e
```

Provider certification reports are generated with:

```bash
corepack pnpm certify:providers
```

A known Next/Turbopack NFT/import-trace warning can appear during `next build`; the build still must exit 0, and generated/runtime artifacts must not appear in `git status`.

## Development workflow

Branch naming:

- `feat/short-description` for new features
- `fix/short-description` for bug fixes
- `refactor/short-description` for internal changes
- `docs/short-description` for documentation-only changes

PRs should be small, test-backed, and honest about scope. If a change modifies ledger event semantics, provider support labels, worker behavior, or user-authored workflow transitions, include regression tests and explain the audit/safety boundary in the PR description.

## Provider support rules

Owlfolio distinguishes readiness from certification. Current alpha claims are bounded by the latest `data/provider-certifications/*.latest.json` reports and `docs/architecture/owlfolio-v2-provider-model-support.md`:

- `mock-provider`: certified deterministic demo/test provider.
- `openrouter`: the default personal-local provider — one API key routes to many models; experimental/fail-closed until a routed model has its own certification report.
- `local`: an OpenAI-compatible endpoint you run yourself (Ollama / vLLM) — UNSTABLE / EXPERIMENTAL / UNTESTED; fail-closed.

(The CLI/OAuth provider lane and the direct Anthropic/OpenAI/Gemini API surfaces were removed in the 2026-06/07 consolidations.) Do not raise README/UI/docs support labels above the latest evidence.

## Ledger and workflow rules

- Provider-authored recommendations are drafts, not portfolio decisions.
- User-authored events are required for watchlist confirmations, holding opens, review overrides, and other irreversible transitions.
- Do not infer holdings from watchlist drafts or provider recommendations.
- Preserve stable `event_id`, causation, correlation, actor, provider, and source metadata in projections.

## Worker rules

The alpha worker is local and dry-run/mock-safe. It may define scheduled tasks and append run lifecycle events/observations, but it must not auto-approve investment decisions, trades, watchlist confirmations, holding opens, or Shariah overrides.

Worker smoke commands:

```bash
corepack pnpm worker -- --once --dry-run --define-defaults
corepack pnpm --filter @owlfolio/worker dev -- --task-kind re_review_check
corepack pnpm --filter @owlfolio/worker dev -- --task-kind watchlist_monitor
```

## Shariah screening limitations

Shariah screening is first-class, grounded, and optional (default ON). This is an educational project: its outputs are decision-support artifacts, never fatwas — obtain a ruling from certified Islamic scholars before acting on any Shariah conclusion. (The accounting/purification bookkeeping half was removed in the 2026-07 scale-down; the purification RATE remains dossier guidance.)

## Code style

- Prefer small, verified vertical slices.
- Use TDD for behavior changes: write or update the test first, confirm it fails for the right reason, implement, then rerun targeted and broad verification.
- Keep generated artifacts out of commits: `data/`, `.next/`, `test-results/`, `playwright-report/`, `*.tsbuildinfo`, `.playwright-runtime/`, `.live-openai-runtime/`, `.worktrees/`.
- No secrets in git, logs, Kanban metadata, README examples, or provider reports.

## Reporting issues

Open a GitHub issue with:

- What you expected vs. what happened.
- Whether you were in demo mode or personal-local mode.
- Provider id and latest certification status if provider behavior is involved.
- Relevant command output, browser route, or ledger event sequence with secrets redacted.

For strategy-quality issues, include the ticker, provider id/model, source bundle references, and the relevant provider-authored draft so the policy/prompts can be tuned without weakening audit boundaries.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
