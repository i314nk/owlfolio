# Owlfolio worker

The worker is a local, ledger-first process for scheduled task runtime and observability. It intentionally has no CommandCenter or UI imports: it loads runtime paths, reads/writes the ledger, and appends scheduled-task lifecycle events.

## Safety model

Current handlers are dry-run/mock-safe only:

- `review_reminder`: projects due/upcoming holding-review prompts and records observations.
- `watchlist_monitor`: projects confirmed watchlist items and records mock-safe monitoring observations.

The worker never auto-approves investment decisions, watchlist confirmations, holding reviews, holding opens, buys, sells, or portfolio actions. Completed run payloads include `auto_approved_actions: 0`; live/non-dry-run task execution is skipped.

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
```

Use an isolated test ledger:

```bash
OWLFOLIO_PROJECT_DIR=$PWD \
OWLFOLIO_LEDGER_PATH=$PWD/.data/local-worker-ledger.sqlite \
corepack pnpm worker -- --once --dry-run --define-defaults
```

## Ledger events

Default task setup appends idempotent `scheduled_task_defined` events for:

- `task_review_reminders_daily`
- `task_watchlist_monitor_daily`

Each run appends:

1. `scheduled_task_run_started`
2. `scheduled_task_run_completed` on success, with observations and result summary
3. `scheduled_task_run_failed` on handler failure, with attempt/max-attempts/retry-after metadata

Read task status with `projectScheduledTasks(events)` from `@owlfolio/ledger/projections/scheduledTaskProjection`.
