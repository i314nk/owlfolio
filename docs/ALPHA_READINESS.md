# Owlfolio v2 local-use candidate readiness

Date: 2026-06-07
Scope: automation-first local-use candidate readiness for the TypeScript/pnpm Owlfolio v2 branch after provider-surface, research-pipeline, accounting, purification, and Data Safety hardening.

## Release position

Owlfolio v2 is an automation-first local-use candidate and personal-local operating-ledger slice. It is not a public beta, production SaaS, broker connection, live trading system, or complete autonomous investment operating system. The current app is suitable for trusted local use and product validation around the local ledger workflow, strategy-based research pipeline, provider readiness boundaries, Shariah/accounting/purification projections, Data Safety surfaces, and dry-run worker safety model.

## What is in the local-use candidate

- Local Next.js web app as the primary interface.
- Browser onboarding for deterministic demo mode and personal-local mode.
- Command Center with setup-aware status, workflow counts, next actions, accounting prompts, holding-review prompts, and recent ledger activity.
- Strategy-based research cockpit from discovery to quick screen, deep dive, synthesis/decision, watchlist, and holding transitions.
- Default Buffett-Munger strategy posture; future selectable strategies remain experimental until policy, audit, Shariah, valuation, and provider-certification gates are complete.
- Provider-authored research/watchlist drafts with explicit source/audit evidence.
- Explicit user confirmation for watchlist items.
- Explicit user transition from confirmed watchlist item to open holding.
- Portfolio lot entry, manual valuation, holding review draft/confirm/reject/override flows.
- Automatic local portfolio, monthly accounting, and purification projections from ledger events and manual/source-backed inputs.
- Monthly accounting report page from period-bounded ledger projections.
- Purification obligation/payment report page from ledger projections.
- Shariah gate/policy helpers and ledger projection tests.
- Audit activity page over append-only event envelopes.
- Provider status page bounded by catalog capabilities plus latest certification reports.
- Settings / Data Safety visibility for local backup contents, excluded credential/auth material, and restore-proposal boundaries.
- Local worker for mock-safe/dry-run `review_reminder` and `watchlist_monitor` scheduled tasks.

## Provider certification evidence

Latest persisted reports are under `data/provider-certifications/` and are summarized in `docs/architecture/owlfolio-v2-provider-model-support.md`.

| Provider id / surface | Latest report | Effective local-use status | Notes |
| --- | --- | --- | --- |
| `mock-provider` | `mock-provider.latest.json` | Certified | Completed; 13/13 scenarios passed. Deterministic provider for demo/test/e2e only, not real research intelligence. |
| `openai` / `openai-codex-cli` | `openai.latest.json` | Experimental | Completed; 9/13 scenarios passed with Codex CLI/OAuth. Unsupported tool-loop capabilities and a source-grounded timeout block certified status. Personal-local only; not production/headless certification. |
| `claude` | `claude.latest.json` | Unsupported/not configured in this environment | Latest report says Claude Code subscription access is disabled. A credential-file presence check is not enough to claim readiness. |
| `openai-api` | `openai-api.latest.json` | Unsupported/not configured in this environment | Target-specific direct API report is recorded for `openai-api` / `api_key` / `research_draft` / `gpt-4.1-mini`; the run was skipped as not configured because no direct API credential was available. |
| `gemini-developer-api` | `gemini-developer-api.latest.json` | Unsupported/not configured in this environment | Target-specific report is recorded for `gemini-developer-api` / `api_key` / `research_draft` / `gemini-2.5-pro`; the run was skipped as not configured because no Developer API key was available. Gemini CLI sign-in, Vertex/service-account lanes, and Developer API certification remain separate. Privacy posture still blocks production/autonomous claims: free/unpaid Developer API is unsuitable for private-investment workflows, paid Developer API remains experimental behind privacy/security gates, and Vertex/Gemini Enterprise should be evaluated separately for ZDR/data residency. |
| `gemini-cli` | none recorded yet | Setup-only personal-local lane | UI/onboarding models Google/Gemini CLI sign-in as an experimental local lane, but no execution adapter/certification exists yet. |

Provider claims must not exceed this evidence. OpenAI and Gemini direct API candidates are implemented as bounded experimental surfaces, not certified live providers; current target-specific direct API reports are unsupported/not configured until credentials, privacy posture, and certification scenarios pass. Anthropic, Perplexity/OpenRouter/xAI/DeepSeek/Qwen/local OpenAI-compatible servers remain future candidates until implemented and certified.

## Shariah, accounting, and purification boundaries

- Owlfolio is Shariah-by-design at the workflow/domain level, but local-use outputs are decision-support artifacts, not fatwas or professional rulings.
- Shariah results must remain source-grounded and conservative; user-authored overrides/status changes are explicit ledger events.
- Purification obligations and payments are separate auditable events; the app tracks them but does not make the charitable payment or guarantee final compliance.
- Monthly accounting is based on local ledger events, manual lot/valuation/cash inputs, and period-bounded projections; it is not a broker statement, custodian record, or tax filing system.
- Broker credentials, broker synchronization, live trading, order placement, tax reporting, and portfolio rebalancing automation are out of scope for this local-use candidate.

## Data Safety boundaries

- Local backups may include sensitive investment ledgers, source bundles, app configuration metadata, provider certification metadata, and Shariah/accounting/purification context.
- Credentials, API keys, provider auth homes, CLI session files, build outputs, test artifacts, and browser/runtime caches must stay out of backup manifests and git.
- The web Data Safety panel is status/proposal evidence only. Destructive restore remains an operator-confirmed runbook flow until a separate reviewed restore UX exists.
- Provider readiness after restore still requires re-authentication and certification evidence; a restored config must not imply real-provider readiness.

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

Current gate result from the 2026-06-03 phase-4 closeout: green with a documented known warning.

- `git diff --check`: passed.
- `corepack pnpm typecheck`: passed across the workspace.
- `corepack pnpm test`: passed, 49 test files / 258 tests.
- `corepack pnpm lint`: passed; package lint scripts are placeholders where noted by the workspace.
- `corepack pnpm audit --filter @owlfolio/web --prod --audit-level moderate`: passed, no known vulnerabilities.
- `NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build`: passed.
- `corepack pnpm e2e`: passed, 5/5 Playwright specs.

Known warning observed during `next build`: Next/Turbopack emitted one NFT/import-trace warning around local filesystem helpers (`next.config.mjs`, `appConfigStore`, `onboarding`, `api/testing/reset`). The build exited 0 and no generated/runtime artifacts appeared in git status; keep this as a known warning rather than a release blocker unless it expands, changes behavior, or starts tracing sensitive runtime files.

## Remaining full-v2 gaps

Against the larger autonomous, Shariah-by-design investment workflow vision, these gaps remain after alpha:

1. Production provider parity: OpenAI/Gemini direct API candidates exist, but target-specific latest certification reports, privacy posture decisions, and full workflow certification for real providers are not complete.
2. Autonomous discovery/research: the worker does not yet run production-grade discovery, research, valuation, or review jobs with real provider cost/timeout controls.
3. Evidence ingestion: filings, broker statements, dividends, market data freshness, and source-ledger provenance need hardened ingestion paths beyond current local/demo flows.
4. Broker/account integration: no broker credentials, broker sync, order placement, settlement tracking, dividend import, or cash reconciliation.
5. Shariah certification: policy helpers and tests exist, but formal scholar-reviewed methodology, issuer-specific source coverage, and audited override policy are not complete.
6. Accounting completeness: monthly snapshots exist, but tax lots, corporate actions, realized gains, FX, dividends, fees, benchmark performance, and statement reconciliation remain incomplete.
7. Purification automation: obligation/payment tracking exists, but automatic dividend impurity calculation, payment execution, evidence upload, and period close workflows remain incomplete.
8. Strategy certification: Buffett-Munger is the default strategy direction; other strategies need policy gates, valuation rules, Shariah handling, and provider certification before being first-class.
9. Packaging/operations: no signed desktop package, hosted deployment story, multi-user auth, backup/restore UX, or production observability story.
10. Human review UX: provider proposals remain safer than autonomous writes, but the UI still needs richer approval queues, diff explanations, and decision-review ergonomics before full autonomy.

## Git hygiene requirement

Before release or review, `git status --short` must show only intentional source/docs/certification changes. Runtime/generated artifacts such as `.next/`, `test-results/`, `playwright-report/`, `*.tsbuildinfo`, `.playwright-runtime/`, `.live-openai-runtime/`, `.worktrees/`, local SQLite databases, and personal app config must not be present as accidental changes.
