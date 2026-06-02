# Owlfolio v2 alpha readiness

Date: 2026-06-02
Scope: final alpha-readiness gate for the TypeScript/pnpm Owlfolio v2 branch.

## Release position

Owlfolio v2 alpha is a local-first workflow demo and personal-local operating-ledger slice. It is not yet a complete autonomous investment operating system. The alpha is suitable for demonstrating the intended product direction and validating the local ledger workflow, provider certification boundaries, Shariah/accounting/purification surfaces, and dry-run worker safety model.

## What is in the alpha

- Local Next.js web app as the primary interface.
- Browser onboarding for deterministic demo mode and personal-local mode.
- Command Center with setup-aware status, workflow counts, next actions, accounting prompts, holding-review prompts, and recent ledger activity.
- Research intake and provider-authored research/watchlist drafts.
- Explicit user confirmation for watchlist items.
- Explicit user transition from confirmed watchlist item to open holding.
- Portfolio lot entry, manual valuation, holding review draft/confirm/reject/override flows.
- Monthly accounting projection and report page from ledger events.
- Purification obligation/payment projection and report page from ledger events.
- Shariah gate/policy helpers and ledger projection tests.
- Audit activity page over append-only event envelopes.
- Provider status page bounded by catalog capabilities plus latest certification reports.
- Local worker for mock-safe/dry-run `review_reminder` and `watchlist_monitor` scheduled tasks.

## Provider certification evidence

Latest persisted reports are under `data/provider-certifications/` and are summarized in `docs/architecture/owlfolio-v2-provider-model-support.md`.

| Provider id | Latest report | Effective alpha status | Notes |
| --- | --- | --- | --- |
| `mock-provider` | `mock-provider.latest.json` | Certified | Completed; 13/13 scenarios passed. Deterministic provider for demo/test/e2e only, not real research intelligence. |
| `openai` | `openai.latest.json` | Experimental | Completed; 9/13 scenarios passed with Codex CLI/OAuth. Unsupported tool-loop capabilities and a source-grounded timeout block certified status. |
| `claude` | `claude.latest.json` | Unsupported/not configured in this environment | Latest report says Claude Code subscription access is disabled. A credential-file presence check is not enough to claim readiness. |

Provider claims must not exceed this evidence. Direct API adapters for Anthropic/OpenAI/Gemini/Perplexity/OpenRouter/xAI/DeepSeek/Qwen/local OpenAI-compatible servers remain future candidates until implemented and certified.

## Shariah, accounting, and purification boundaries

- Owlfolio is Shariah-by-design at the workflow/domain level, but alpha outputs are decision-support artifacts, not fatwas or professional rulings.
- Shariah results must remain source-grounded and conservative; user-authored overrides/status changes are explicit ledger events.
- Purification obligations and payments are separate auditable events; the app tracks them but does not make the charitable payment or guarantee final compliance.
- Monthly accounting is based on local ledger events, manual lot/valuation/cash inputs, and period-bounded projections; it is not a broker statement, custodian record, or tax filing system.
- Broker credentials, broker synchronization, live trading, order placement, tax reporting, and portfolio rebalancing automation are out of scope for this alpha.

## Worker safety boundary

The local worker is dry-run/mock-safe for alpha. It can define default scheduled tasks and append run lifecycle events, but it must not auto-approve investment decisions or create irreversible portfolio/accounting/purification actions.

Supported handlers now:

- `review_reminder`: observes due/upcoming holding reviews.
- `watchlist_monitor`: observes confirmed watchlist items.

The worker command surface is documented in `docs/WORKER.md`.

## Verification gate

These commands are the release gate for this branch:

```bash
git diff --check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm audit --filter @owlfolio/web --prod --audit-level moderate
NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build
corepack pnpm e2e
```

Current gate result from this release task: green with a documented known warning.

- `git diff --check`: passed.
- `corepack pnpm typecheck`: passed across the workspace.
- `corepack pnpm test`: passed, 46 test files / 173 tests.
- `corepack pnpm lint`: passed; package lint scripts are placeholders where noted by the workspace.
- `corepack pnpm audit --filter @owlfolio/web --prod --audit-level moderate`: passed, no known vulnerabilities.
- `NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build`: passed.
- `corepack pnpm e2e`: passed, 5/5 Playwright specs.

Known warning observed during `next build`: Next/Turbopack emitted one NFT/import-trace warning around local filesystem helpers (`next.config.mjs`, `appConfigStore`, `onboarding`, `api/testing/reset`). The build exited 0 and no generated/runtime artifacts appeared in git status; keep this as a known warning rather than a release blocker unless it expands, changes behavior, or starts tracing sensitive runtime files.

## Remaining full-v2 gaps

Against the larger autonomous, Shariah-by-design investment workflow vision, these gaps remain after alpha:

1. Production provider parity: direct API adapters and full workflow certification for real providers are not complete.
2. Autonomous discovery/research: the worker does not yet run production-grade discovery, research, valuation, or review jobs with real provider cost/timeout controls.
3. Evidence ingestion: filings, broker statements, dividends, market data freshness, and source-ledger provenance need hardened ingestion paths beyond current local/demo flows.
4. Broker/account integration: no broker credentials, broker sync, order placement, settlement tracking, dividend import, or cash reconciliation.
5. Shariah certification: policy helpers and tests exist, but formal scholar-reviewed methodology, issuer-specific source coverage, and audited override policy are not complete.
6. Accounting completeness: monthly snapshots exist, but tax lots, corporate actions, realized gains, FX, dividends, fees, benchmark performance, and statement reconciliation remain incomplete.
7. Purification automation: obligation/payment tracking exists, but automatic dividend impurity calculation, payment execution, evidence upload, and period close workflows remain incomplete.
8. Strategy certification: Buffett-Munger remains the primary certified direction; other strategies need policy gates, valuation rules, Shariah handling, and provider certification before being first-class.
9. Packaging/operations: no signed desktop package, hosted deployment story, multi-user auth, backup/restore UX, or production observability story.
10. Human review UX: provider proposals remain safer than autonomous writes, but the UI still needs richer approval queues, diff explanations, and decision-review ergonomics before full autonomy.

## Git hygiene requirement

Before release or review, `git status --short` must show only intentional source/docs/certification changes. Runtime/generated artifacts such as `.next/`, `test-results/`, `playwright-report/`, `*.tsbuildinfo`, `.playwright-runtime/`, `.live-openai-runtime/`, `.worktrees/`, local SQLite databases, and personal app config must not be present as accidental changes.
