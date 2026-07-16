# Owlfolio v2 architecture

This document describes the active TypeScript/pnpm Owlfolio v2 alpha branch. Earlier Python/FastAPI/Claude-only architecture notes are historical and should not be used as setup or support claims for this branch.

## Product shape

Owlfolio v2 is an automation-first local investment workflow OS. The product center is a workflow UI and append-only investment ledger, not a chat-first assistant, public SaaS, broker connector, or trading bot.

Target workflow:

```text
Onboarding
  -> Default Buffett-Munger strategy posture (future selectable strategies remain experimental until gated)
  -> Discovery queue
  -> Shariah gate (grounded sector judgment + AAOIFI ratios, pre-spend)
  -> Circle-of-competence gate
  -> Deep dive (5 grounded specialist lanes)
  -> Valuation judgment (dedicated grounded stage; T0 margin-of-safety grade, FX-converted for foreign filers)
  -> Synthesis / decision draft
  -> User-confirmed watchlist item
  -> User-opened holding
  -> Lot entry / valuation
  -> Holding review draft and user decision
  -> Automatic local portfolio/accounting/purification projections
  -> Audit timeline / provider status / Data Safety / worker observations
```

Provider and worker outputs are drafts or observations. Irreversible portfolio/accounting/purification transitions remain explicit user-authored ledger events.

## Monorepo layout

```text
apps/
  web/       Next.js app and local API routes; primary product surface
  worker/    local scheduled-task worker; dry-run/mock-safe for alpha
packages/
  ledger/    SQLite event store, event envelopes, domain contracts, projections
  providers/ provider catalog, CLI-backed adapters, certification runner
  shared/    app configuration and shared provider/domain types
  shariah/   Shariah policy helpers
  strategies/ Buffett-Munger strategy reference package
  workflow/  workflow helpers for research/watchlist/holdings/reviews/Shariah gates
scripts/
  certify-providers.mjs
```

The workspace uses `pnpm@11.3.0` through Corepack. `apps/web` runs on Next.js at `http://127.0.0.1:3000` for local development.

## Runtime paths

The app is local, not serverless. Runtime files are local and gitignored:

- App config: `OWLFOLIO_APP_CONFIG_PATH`, otherwise `data/app-config.json` under `OWLFOLIO_PROJECT_DIR` / workspace root.
- Demo ledger: `OWLFOLIO_DEMO_LEDGER_PATH`, otherwise `data/demo-ledger.sqlite`.
- Personal ledger: `OWLFOLIO_PERSONAL_LEDGER_PATH`, otherwise `data/personal-ledger.sqlite`.
- Worker ledger: `OWLFOLIO_LEDGER_PATH`, otherwise app-config `ledger_path`, otherwise `data/owlfolio-ledger.sqlite`.
- Source ledger: `OWLFOLIO_SOURCE_LEDGER_PATH`, otherwise app-config `source_ledger_path`, otherwise `data/source-ledger`.
- Provider certification reports: `OWLFOLIO_PROVIDER_CERTIFICATION_DIR`, otherwise `data/provider-certifications`.

Generated/runtime directories such as `data/`, `.next/`, `test-results/`, `playwright-report/`, `.playwright-runtime/`, `.live-openai-runtime/`, `.worktrees/`, and `*.tsbuildinfo` must stay out of commits unless a tracked fixture/certification artifact is intentionally updated.

## Web app

Primary routes:

| Route | Purpose |
| --- | --- |
| `/` | Command Center with setup status, workflow counts, next action, accounting/review prompts, recent activity. |
| `/onboarding` | Demo/personal-local setup and provider readiness flow. |
| `/research/new` | Secondary manual ticker intake into the strategy pipeline. |
| `/research` | Strategy pipeline cockpit: discovery, the front gates (Shariah + circle), deep dive, decision drafts, watchlist, and outcomes. |
| `/research/[caseId]` | Review a research case and draft watchlist recommendation. |
| `/watchlist` | Confirm watchlist drafts and open holdings. |
| `/portfolio` | Holdings, lot entry, valuations, holding review decisions. |
| `/accounting/monthly` | Monthly accounting report from ledger projections. |
| `/purification` | Purification obligation/payment report. |
| `/audit` | Cross-domain ledger timeline. |
| `/providers` | Provider readiness, catalog support, latest certification reports. |
| `/settings/data-safety` | Local backup inventory and restore-proposal visibility; credentials/auth homes excluded. |

API routes are colocated under `apps/web/src/app/api/**` and are local-app routes, not public SaaS endpoints.

## Ledger model

`packages/ledger` owns the durable event model. Events use a shared `LedgerEventEnvelope` shape with stable `event_id`, `aggregate_type`, `aggregate_id`, `actor_type`, causation/correlation metadata, source IDs, and a typed payload.

Key event families:

- Research/watchlist/holding workflow events, including discovery candidates, gate judgments (Shariah + circle; legacy quick-screen events fold read-only), deep dives, decision drafts, and explicit user transitions.
- Holding valuation and review events.
- Scheduled task definition/run lifecycle events.
- Provider run and certification report events.
- Shariah evaluation/status events.
- Purification obligation/payment events.
- Monthly accounting snapshot events.
- Cash movement events.

Projection rules matter as much as event writes:

- Do not infer holdings from provider recommendations or watchlist drafts.
- User-authored watchlist confirmation and holding-opened events are explicit boundaries.
- Accounting snapshots must be period/as-of bounded.
- Purification obligations and payments remain separate auditable transitions.
- Provider/worker authored drafts must not masquerade as user decisions.

## Provider model

Provider support is evidence-bounded. The catalog in `packages/providers/src/providerCatalog.ts` is not enough by itself; latest certification reports under `data/provider-certifications/*.latest.json` determine effective support labels in the UI and docs.

Current alpha support (**update 2026-06-29**: the whole CLI/OAuth lane — Codex CLI, Claude CLI, Gemini CLI — was retired; surviving providers share one function-calling grounded tool loop):

| Provider id | Adapter path | Effective support |
| --- | --- | --- |
| `mock-provider` | Deterministic in-process provider | Certified for demo/test/e2e; not real research intelligence. |
| `openrouter` | OpenAI-compatible meta-aggregator (`OpenRouterProvider`); the default personal-local provider | Experimental. Proven grounded tool loop; usable with a key — model choice/certification is the user's responsibility. |
| `openai-api` | Direct OpenAI API (OpenAI-compatible adapter) | Experimental; usable with a key. |
| `anthropic-api` | Direct Anthropic API (OpenAI-compatible adapter) | Experimental; usable with a key. |
| `gemini-developer-api` | Direct Gemini Developer API candidate | Experimental; usable with a key. Privacy posture caveats apply. |

The three direct API-key providers are `OpenRouterProvider` instances configured per-endpoint, so they share OpenRouter's `runToolLoop`. Native/provider-side web search is disabled by construction — the harness executor is the only egress.

Readiness inputs (keys live in the local env file `OWLFOLIO_ENV_FILE`, default `~/.owlfolio/.env`):

- OpenRouter: `OPENROUTER_API_KEY`.
- OpenAI: `OPENAI_API_KEY`.
- Anthropic: `ANTHROPIC_API_KEY`.
- Gemini: `GEMINI_API_KEY` / `GOOGLE_API_KEY`.

Readiness is not certification. A credential file cannot override a latest `not-configured`, `unsupported`, or partial certification report, and no real-provider path should be described as live/autonomous until the target-specific report says it is supported.

For how the research harness actually runs under the hood — the grounded two-phase tool loop, the swarm, model tiering/OpenRouter routing, the EDGAR owner-earnings anchor, the `max_tool_calls` depth knob, and the golden-set qualification gate — see `docs/architecture/owlfolio-v2-research-harness-internals.md` (the living "internals" reference; keep it in sync when changing a load-bearing mechanism).

## Data Safety model

Runtime data is local and sensitive. Backup manifests may include ledgers, source bundles, app config metadata, provider reports, and Shariah/accounting/purification context, but must exclude credentials, API keys, provider auth homes, CLI sessions, generated builds, test artifacts, caches, and local browser state. The web Data Safety route is status/proposal evidence only; destructive restore remains operator-managed until a reviewed restore workflow exists.

## Worker model

`apps/worker` is a separate local Node process using the same config/ledger paths as the web app. In alpha it is one-tick/dry-run oriented:

```bash
corepack pnpm worker -- --once --dry-run --define-defaults
corepack pnpm --filter @owlfolio/worker dev -- --task-kind review_reminder
corepack pnpm --filter @owlfolio/worker dev -- --task-kind watchlist_monitor
```

The worker appends lifecycle events (`scheduled_task_run_started`, `scheduled_task_run_completed`, `scheduled_task_run_failed`) and observations. It must not auto-approve investment decisions, trades, watchlist confirmations, holding opens, Shariah overrides, accounting closes, or purification payments.

## Shariah, accounting, and purification

These are first-class domains in v2, with conservative alpha boundaries:

- Shariah helpers and projections support workflow gating and audit history; they are not formal fatwas.
- Monthly accounting reports project local ledger state and manual inputs; they are not broker statements or tax filings.
- Purification tracks obligations and payments separately; final calculation and payment decisions remain the user's responsibility.

## Verification

Release gate:

```bash
git diff --check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm lint
corepack pnpm audit --filter @owlfolio/web --prod --audit-level moderate
NODE_OPTIONS=--disable-warning=ExperimentalWarning corepack pnpm --filter @owlfolio/web exec next build
corepack pnpm e2e
```

Known build warning: Next/Turbopack may emit an NFT/import-trace warning involving `next.config.mjs`, `appConfigStore`, `onboarding`, and the Playwright-only testing reset API. This warning is documented in `docs/ALPHA_READINESS.md`; the build must still exit 0 and generated artifacts must not appear in git status.

## Current alpha readiness

See `docs/ALPHA_READINESS.md` for:

- latest gate results,
- provider certification evidence,
- Shariah/accounting/purification limitations,
- worker safety boundaries,
- remaining gaps against the full autonomous Shariah-by-design investment workflow vision.
