# Owlfolio worker

The worker is a local, ledger-first process for scheduled task runtime and observability. It intentionally has no CommandCenter or UI imports: it loads runtime paths, reads/writes the ledger, and appends scheduled-task lifecycle events.

## Safety model

Current handlers are dry-run/mock-safe only:

- `review_reminder`: projects due/upcoming holding-review prompts and records observations.
- `watchlist_monitor`: projects confirmed watchlist items, optionally runs a certified scheduled-monitoring provider, and records monitoring observations/provider-run events.
- `holding_review_draft`: beta proposal-only job for due holdings. It requires a certified provider readiness check, appends provider-authored `holding_review_drafted` proposal events only, and leaves confirmation/rejection to the approval queue.

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
- `task_holding_review_drafts_daily`

Each run appends:

1. `scheduled_task_run_started` with attempt metadata plus task timeout/max-cost metadata when defined
2. `scheduled_task_run_completed` on success, with observations, result summary, proposal/provider-run ids, and approval gates when relevant
3. `scheduled_task_run_failed` on handler failure, with attempt/max-attempts/retry-after metadata

`holding_review_draft` success adds only `holding_review_drafted` proposal events (`actor_type: provider`, `user_approved: false`). It does not append `holding_review_confirmed`, `holding_review_overridden`, `holding_opened`, `watchlist_draft_confirmed`, `shariah_gate_decision_recorded`, or `purification_payment_recorded`.

Read task status with `projectScheduledTasks(events)` from `@owlfolio/ledger/projections/scheduledTaskProjection`.
