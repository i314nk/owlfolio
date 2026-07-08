# Owlfolio worker

The worker is a local, ledger-first process for scheduled task runtime and observability. It intentionally has no CommandCenter or UI imports: it loads runtime paths, reads/writes the ledger, and appends scheduled-task lifecycle events.

## Safety model

Current handlers are dry-run/mock-safe only. Every task is ONE-TICK (`--once` is the only mode) and
scheduler-shaped: cadence metadata rides the `scheduled_task_defined` events, but **no scheduler
exists yet** — nothing evaluates the cron strings; a human (or, later, a scheduler) fires each tick.
Scheduled-task kinds:

- `review_reminder`: projects due/upcoming holding-review prompts and records observations.
- `watchlist_monitor` / `holdings_monitor`: deterministic buy-window / tranche / concentration / staleness monitors; append `*_monitor_alert_recorded` observation events surfaced by the monitor-alert projection.
- `holding_review_draft`: proposal-only grounded review for due holdings; requires a provider readiness check, appends provider-authored `holding_review_drafted` events only, and a broken thesis escalates a versioned full-reanalysis *draft*.
- `re_review_check`: the thesis re-review sweep — diffs filings NEW since each decided case's persisted corpus (8-K item-code-weighted); strong triggers run a grounded thesis diff (`research_case_re_review_recorded`), capped per tick; medium/weak triggers are observations with zero provider spend.
- `shariah_rescreen`, `portfolio_valuation_refresh`, `purification_projection`, `forecast_resolution`, `discovery_13f`, `falsifier_check`, `re_underwrite`: deterministic/cadence passes over ledger + injected data.
- `process_research_queue` / `process_deep_dive_queue`: the research-run executors, auto-spawned per run by the web app (the only automatic invocations today).

The worker never auto-approves investment decisions, watchlist confirmations, holding reviews, holding opens, buys, sells, Shariah overrides, purification payments, or portfolio actions. Completed run payloads include `auto_approved_actions: 0`; live/non-dry-run task execution is skipped. Provider-backed tasks fail closed before provider/proposal events when readiness is missing, unsupported, quota-limited, reauth-required, or target-mismatched.

## Runtime paths

The worker resolves paths in this order:

- Project directory: `OWLFOLIO_PROJECT_DIR`, otherwise the nearest parent containing `pnpm-workspace.yaml`.
- App config: `OWLFOLIO_APP_CONFIG_PATH`, otherwise `data/app-config.json` under the project directory.
- Ledger: `OWLFOLIO_LEDGER_PATH`, otherwise `config.ledger_path`, otherwise `data/owlfolio-ledger.sqlite`.
- Source ledger: `OWLFOLIO_SOURCE_LEDGER_PATH`, otherwise `config.source_ledger_path`, otherwise `data/source-ledger`.

If the app config file is missing, the worker uses `defaultDemoAppConfig()` and still stays dry-run.

## Local commands

From the repo root:

```bash
corepack pnpm worker -- --once --dry-run --define-defaults
```

Limit a tick to one task kind:

```bash
corepack pnpm --filter @owlfolio/worker dev -- --task-kind review_reminder
corepack pnpm --filter @owlfolio/worker dev -- --task-kind watchlist_monitor
corepack pnpm --filter @owlfolio/worker dev -- --task-kind re_review_check
```

Use an isolated test ledger:

```bash
OWLFOLIO_PROJECT_DIR=$PWD \
OWLFOLIO_LEDGER_PATH=$PWD/.data/local-worker-ledger.sqlite \
corepack pnpm worker -- --once --dry-run --define-defaults
```

## Ledger events

Default task setup appends idempotent `scheduled_task_defined` events for the twelve scheduled task
kinds (reviews, monitors, Shariah re-screen, valuation refresh, purification, forecast resolution,
13F discovery, the falsifier/re-underwrite cadence passes, and the quarterly
`task_re_review_check_quarterly`), each carrying its cadence cron string as metadata for the future
scheduler.

Each run appends:

1. `scheduled_task_run_started` with attempt metadata plus task timeout/max-cost metadata when defined
2. `scheduled_task_run_completed` on success, with observations, result summary, proposal/provider-run ids, and approval gates when relevant
3. `scheduled_task_run_failed` on handler failure, with attempt/max-attempts/retry-after metadata

`holding_review_draft` success adds only `holding_review_drafted` proposal events (`actor_type: provider`, `user_approved: false`). It does not append `holding_review_confirmed`, `holding_review_overridden`, `holding_opened`, `watchlist_draft_confirmed`, `shariah_gate_decision_recorded`, or `purification_payment_recorded`.

Read task status with `projectScheduledTasks(events)` from `@owlfolio/ledger/projections/scheduledTaskProjection`.
