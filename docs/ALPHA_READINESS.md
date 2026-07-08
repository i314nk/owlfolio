# Owlfolio v2 local-use candidate readiness

Date: 2026-06-07 · **Updated: 2026-07-08**
Scope: automation-first local-use candidate readiness for the TypeScript/pnpm Owlfolio v2 branch after provider-surface, research-pipeline, accounting, purification, and Data Safety hardening.

> **Update 2026-07-08.** Major changes since the 2026-06-07 baseline:
>
> - **Provider excision (2026-06-29):** the whole CLI/OAuth lane (Codex CLI, Claude CLI, Gemini CLI)
>   was retired. Surviving providers: `mock-provider` (certified) plus `openrouter` (the new default),
>   `openai-api`, `anthropic-api`, `gemini-developer-api` — all experimental/fail-closed on one shared
>   function-calling grounded tool loop. Native/provider web search is disabled by construction.
> - **EDGAR grounding deepened:** annual filings readable by Item via a hash-verified `read_source`
>   tool; 8-K/10-Q/6-K interim narrative grounded (10-Q numbers quarantined); DEF 14A proxies for the
>   management lane; EX-99 press-release exhibits grounded alongside 8-K covers; cross-run source
>   bundles persist pointers + hashes for re-fetch-and-verify audit.
> - **Circle-of-competence gate hardened:** k-sample unanimous agreement + grounded evidence floors,
>   Settings-tunable; set-aside is a recorded early exit.
> - **Thesis re-review shipped:** on-demand (dossier/watchlist/portfolio) and worker-tick diffs of
>   filings filed since a decision vs the recorded thesis (`INTACT|WEAKENED|BROKEN|INCONCLUSIVE|UNVERIFIED`,
>   fail-closed), 8-K item-code trigger weighting, escalation drafts on broken held theses.
> - **Worker grew to twelve one-tick task kinds** (see `docs/WORKER.md`); still no scheduler by design.
> - **Read-only CLI** (`owlfolio start|status|doctor`) added; onboarding/decisions stay in the browser.
> - **Insider Form 4 signal shipped:** deterministic transaction parsing (never a model judgment), a
>   computed management-lane digest, a sell-cluster trigger, and a dossier card.
> - **Demo mode removed:** the app is now unconfigured → personal-local; `mock-provider` remains for
>   tests/e2e only.
> - **On-demand discovery + price checks shipped:** 13F harvest + triage into research candidates, and
>   watchlist/portfolio price checks — human-fired.
> - **Honest test posture:** the tiered model setup is designed but NOT yet exercised end-to-end;
>   nearly all live testing ran through OpenRouter with a single routed model, and the other providers
>   remain experimental and largely unexercised.
> - **e2e green again (2026-07-08):** the two failing specs (monthly accounting, workflow intake)
>   shared one root cause — the on-demand price-check button (a `<div>`) nested inside a `<p>` on the
>   watchlist/portfolio pages, invalid HTML that failed hydration and swallowed form interactions.
>   Fixed; the suite is 8/8.

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
| `mock-provider` | `mock-provider.latest.json` | Certified | Deterministic provider for demo/test/e2e only, not real research intelligence. |
| `openrouter` | none target-specific yet | Experimental (the default personal-local provider) | Proven grounded `runToolLoop` in live product use; usable with `OPENROUTER_API_KEY`. Model choice + optional per-model certification are the user's responsibility; support labels stay experimental until a report exists. |
| `openai-api` | `openai-api.latest.json` (historical) | Experimental | Shares OpenRouter's tool loop; distinct from the retired Codex CLI lane; usable with a key. |
| `anthropic-api` | none recorded yet | Experimental | Shares OpenRouter's tool loop; distinct from the retired Claude CLI lane; usable with a key. |
| `gemini-developer-api` | `gemini-developer-api.latest.json` (historical) | Experimental | Usable with a key. Privacy posture still blocks production/autonomous claims; paid Developer API remains experimental behind privacy/security gates. |
| retired: `openai`/`openai-codex-cli`, `claude`, `gemini-cli` | `openai.latest.json`, `claude.latest.json` (historical evidence) | Removed 2026-06-29 | The CLI/OAuth lane was excised; these reports remain as dated evidence only and must not be read as current support. |

Provider claims must not exceed this evidence. **Certification has shifted to the user's responsibility and is optional before use**: a capable reasoning model (reasoning + tool-calling + structured output, the model picker's floor) can be selected and used immediately; the certification runner is a deeper per-model audit a user may run for recorded evidence. Docs/UI never describe a surface as certified/live/autonomous without a passing target-specific latest report.

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

Twelve one-tick task kinds are defined (reviews, deterministic monitors, Shariah re-screen,
valuation refresh, purification, forecast resolution, 13F discovery, the thesis re-review sweep, and
the research/deep-dive queue executors). All are human-fired today — cadence cron strings are
recorded as metadata, but no scheduler evaluates them yet (a deliberate gap pending an
unattended-spend policy). The worker command surface is documented in `docs/WORKER.md`.

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

Current gate result (2026-07-05, re-review merge closeout):

- `git diff --check`: passed.
- `corepack pnpm typecheck`: passed across the workspace.
- `corepack pnpm test`: passed, 2,381 tests.
- `corepack pnpm lint`: passed with `--max-warnings=0` across the touched packages.
- `corepack pnpm audit --filter @owlfolio/web --prod --audit-level moderate`: passed, no known vulnerabilities.
- `NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build`: passed.
- `corepack pnpm e2e`: **8/8 passed (2026-07-08)** — the monthly-accounting and workflow-intake specs were fixed (one shared hydration root cause on the watchlist/portfolio pages).

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
